//! Every session's unreviewed agent edits and per-turn checkpoints, kept in memory and saved as
//! JSON in `<data dir>/dev.athas.gpui/checkpoints/<session>.json`. Plain data and file I/O; the
//! GPUI side (`review::apply`) runs these off the main thread and tells views what changed.
//!
//! Ported from Athas's `services/agent-edits-service.ts`, `services/agent-checkpoints-service.ts`
//! and `lib/agent-edit-checkpoints.ts`.

use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, PoisonError},
};

use serde::{Deserialize, Serialize};
use web_time::{SystemTime, UNIX_EPOCH};

use super::hunks::{self, EditEntry, FileChange, Hunk};

/// Turns kept per session at most; older ones are dropped first.
const MAX_CHECKPOINTS: usize = 50;
/// Characters of file snapshots kept per session at most.
const MAX_CHECKPOINT_CHARS: usize = 4_000_000;

/// One file a turn's agent changed: before its first write that turn, and after its last.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckpointFile {
    /// `None` when the file did not exist.
    pub before: Option<String>,
    /// `None` when the agent deleted it.
    pub after: Option<String>,
}

/// The files one turn's agent changed. A turn is named by its user message's transcript index.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub turn: usize,
    /// When the agent first wrote a file during the turn, in epoch milliseconds.
    pub created_at: u64,
    pub files: BTreeMap<PathBuf, CheckpointFile>,
}

impl Checkpoint {
    fn size(&self) -> usize {
        self.files.iter().map(|(path, file)| path.as_os_str().len() + file.before.as_ref().map_or(0, String::len) + file.after.as_ref().map_or(0, String::len)).sum()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionEdits {
    pub entries: BTreeMap<PathBuf, EditEntry>,
    /// Oldest first.
    pub checkpoints: Vec<Checkpoint>,
    /// The `created_at` of the newest checkpoint dropped to stay in budget: turns from before
    /// then can no longer be restored.
    pub truncated_at: Option<u64>,
}

impl SessionEdits {
    fn trim(&mut self) {
        let mut total: usize = self.checkpoints.iter().map(Checkpoint::size).sum();
        let mut drop = 0;
        while drop + 1 < self.checkpoints.len() && (self.checkpoints.len() - drop > MAX_CHECKPOINTS || total > MAX_CHECKPOINT_CHARS) {
            total -= self.checkpoints[drop].size();
            drop += 1;
        }
        if drop > 0 {
            let dropped_at = self.checkpoints[drop - 1].created_at;
            self.truncated_at = Some(self.truncated_at.unwrap_or(0).max(dropped_at));
            self.checkpoints.drain(..drop);
        }
    }
}

/// One file's unreviewed changes, for the review.
#[derive(Clone, Debug, PartialEq)]
pub struct FileReview {
    pub path: PathBuf,
    pub created: bool,
    pub current: String,
    pub hunks: Vec<Hunk>,
    pub added: usize,
    pub removed: usize,
}

/// What a turn's checkpoint holds, for the restore button.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckpointSummary {
    pub turn: usize,
    pub created_at: u64,
    pub files: Vec<PathBuf>,
}

/// What an action did: the sessions whose review changed and anything the user should know.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub changed: Vec<String>,
    pub notices: Vec<String>,
    /// Files a restore put back.
    pub restored: Vec<PathBuf>,
    /// Files a restore left alone because they changed after the agent's turn.
    pub conflicts: Vec<PathBuf>,
}

impl Outcome {
    fn changed(session: &str) -> Self {
        Self { changed: vec![session.to_string()], ..Default::default() }
    }
}

/// What the review can do to a session's changes.
#[derive(Clone, Debug, PartialEq)]
pub enum ReviewAction {
    KeepHunk { path: PathBuf, hunk: Hunk },
    RejectHunk { path: PathBuf, hunk: Hunk },
    KeepFile(PathBuf),
    RejectFile(PathBuf),
    KeepAll,
    RejectAll,
    /// Put every file the turn starting at this user message (and later turns) changed back as
    /// it was before. Files changed since by someone else are left alone unless `force`.
    Restore { turn: usize, force: bool },
}

static GLOBAL: std::sync::OnceLock<Store> = std::sync::OnceLock::new();

pub struct Store {
    dir: Option<PathBuf>,
    sessions: Mutex<HashMap<String, SessionEdits>>,
    /// Saves go to the writer thread instead of happening in the caller.
    background: bool,
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |duration| duration.as_millis() as u64)
}

fn file_name(session: &str) -> String {
    let safe: String = session.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' }).collect();
    format!("{safe}.json")
}

fn read_disk(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn display(path: &Path) -> String {
    path.file_name().map_or_else(|| path.display().to_string(), |name| name.to_string_lossy().into_owned())
}

impl Store {
    /// A store saving under `dir`; `None` keeps everything in memory.
    pub fn new(dir: Option<PathBuf>) -> Self {
        Self { dir, sessions: Mutex::default(), background: false }
    }

    /// Makes the app's store keep its data under `dir` (in memory for `None`), for headless
    /// renders and tests. Only works before the store is first used; returns whether it did.
    pub fn init_global(dir: Option<PathBuf>) -> bool {
        GLOBAL.set(Store::new(dir)).is_ok()
    }

    /// The app's store, in `dev.athas.gpui/checkpoints/` (in memory while a screenshot fixture
    /// is shown).
    pub fn global() -> &'static Store {
        GLOBAL.get_or_init(|| {
            let dir = if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() {
                None
            } else {
                crate::persistence::sessions_dir().and_then(|dir| dir.parent().map(|parent| parent.join("checkpoints")))
            };
            // The app's store writes off the UI thread: every agent write saves the session's
            // checkpoints, which can run to megabytes.
            Store { background: cfg!(not(target_family = "wasm")), ..Store::new(dir) }
        })
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, SessionEdits>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn load<'a>(&self, sessions: &'a mut HashMap<String, SessionEdits>, session: &str) -> &'a mut SessionEdits {
        sessions.entry(session.to_string()).or_insert_with(|| {
            self.dir
                .as_ref()
                .and_then(|dir| std::fs::read_to_string(dir.join(file_name(session))).ok())
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or_default()
        })
    }

    fn save(&self, session: &str, edits: &SessionEdits) {
        let Some(dir) = &self.dir else { return };
        if self.background {
            #[cfg(not(target_family = "wasm"))]
            {
                writer().send((dir.clone(), session.to_string(), edits.clone())).ok();
                return;
            }
        }
        write_session(dir, session, edits);
    }
}

/// Writes one session's edits, or removes its file once nothing is left.
fn write_session(dir: &Path, session: &str, edits: &SessionEdits) {
    {
        let path = dir.join(file_name(session));
        if edits.entries.is_empty() && edits.checkpoints.is_empty() {
            let _ = std::fs::remove_file(path);
            return;
        }
        let _ = std::fs::create_dir_all(dir);
        let temp = path.with_extension("json.tmp");
        if let Ok(bytes) = serde_json::to_vec(edits)
            && std::fs::write(&temp, bytes).is_ok()
        {
            let _ = std::fs::rename(&temp, &path);
        }
    }
}

/// The thread the app's store saves on. Saves queued while it writes collapse to the newest of
/// each session, so a burst of agent writes costs one write.
#[cfg(not(target_family = "wasm"))]
fn writer() -> &'static std::sync::mpsc::Sender<(PathBuf, String, SessionEdits)> {
    static WRITER: std::sync::OnceLock<std::sync::mpsc::Sender<(PathBuf, String, SessionEdits)>> = std::sync::OnceLock::new();
    WRITER.get_or_init(|| {
        let (sender, receiver) = std::sync::mpsc::channel::<(PathBuf, String, SessionEdits)>();
        std::thread::Builder::new()
            .name("agent-checkpoints".into())
            .spawn(move || {
                while let Ok(first) = receiver.recv() {
                    let mut pending: Vec<(PathBuf, String, SessionEdits)> = vec![first];
                    while let Ok(next) = receiver.try_recv() {
                        pending.retain(|(dir, session, _)| !(dir == &next.0 && session == &next.1));
                        pending.push(next);
                    }
                    for (dir, session, edits) in pending {
                        write_session(&dir, &session, &edits);
                    }
                }
            })
            .ok();
        sender
    })
}

impl Store {
    /// Changes `session`'s edits and saves them.
    fn update<R>(&self, session: &str, change: impl FnOnce(&mut SessionEdits) -> R) -> R {
        let mut sessions = self.lock();
        let edits = self.load(&mut sessions, session);
        let result = change(edits);
        let snapshot = edits.clone();
        drop(sessions);
        self.save(session, &snapshot);
        result
    }

    fn read<R>(&self, session: &str, read: impl FnOnce(&SessionEdits) -> R) -> R {
        let mut sessions = self.lock();
        read(self.load(&mut sessions, session))
    }

    /// Adds an agent write (or deletion) to the session's log and to the checkpoint of `turn`.
    /// Other sessions tracking the file take the change into their baselines.
    pub fn record(&self, session: &str, turn: Option<usize>, change: FileChange) -> Outcome {
        let mut outcome = Outcome::changed(session);
        self.update(session, |edits| {
            if let Some(turn) = turn {
                let index = match edits.checkpoints.iter().position(|checkpoint| checkpoint.turn == turn) {
                    Some(index) => index,
                    None => {
                        edits.checkpoints.push(Checkpoint { turn, created_at: now_millis(), files: BTreeMap::new() });
                        edits.checkpoints.len() - 1
                    }
                };
                let files = &mut edits.checkpoints[index].files;
                let before = files.get(&change.path).map_or_else(|| change.previous.clone(), |file| file.before.clone());
                files.insert(change.path.clone(), CheckpointFile { before, after: change.content.clone() });
                edits.trim();
            }
            match &change.content {
                Some(content) => {
                    let (entry, lost) = hunks::record_write(edits.entries.get(&change.path), &change.path, change.previous.as_deref(), content, turn);
                    if lost {
                        outcome.notices.push(format!(
                            "{} changed where the agent had edited it before; earlier agent changes count as kept",
                            display(&change.path)
                        ));
                    }
                    match entry {
                        Some(entry) => edits.entries.insert(change.path.clone(), entry),
                        None => edits.entries.remove(&change.path),
                    };
                }
                None => {
                    edits.entries.remove(&change.path);
                }
            }
        });
        self.rebase_others(&change.path, session, change.content.as_deref(), &mut outcome);
        outcome
    }

    /// Brings the other loaded sessions tracking `path` up to date with `content`, which one
    /// session's agent wrote or review left on disk.
    fn rebase_others(&self, path: &Path, except: &str, content: Option<&str>, outcome: &mut Outcome) {
        let others: Vec<String> = self
            .lock()
            .iter()
            .filter(|(id, edits)| id.as_str() != except && edits.entries.get(path).is_some_and(|entry| Some(entry.current.as_str()) != content))
            .map(|(id, _)| id.clone())
            .collect();
        for other in others {
            self.update(&other, |edits| {
                let Some(entry) = edits.entries.get(path) else { return };
                match content.and_then(|content| hunks::rebase(entry, content)) {
                    Some(rebased) => {
                        edits.entries.insert(path.to_path_buf(), rebased);
                    }
                    None => {
                        edits.entries.remove(path);
                        outcome.notices.push(format!("Stopped tracking another session's changes to {}", display(path)));
                    }
                }
            });
            outcome.changed.push(other);
        }
    }

    /// The session's files with unreviewed changes, by path.
    pub fn files(&self, session: &str) -> Vec<FileReview> {
        // Copied out first: diffing under the lock would hold up the UI thread's writes.
        let entries: Vec<EditEntry> = self.read(session, |edits| edits.entries.values().cloned().collect());
        {
            entries
                .iter()
                .map(|entry| {
                    let hunks = hunks::compute(&entry.baseline, &entry.current);
                    let (added, removed) = hunks::count_lines(&hunks);
                    FileReview { path: entry.path.clone(), created: entry.created, current: entry.current.clone(), hunks, added, removed }
                })
                .filter(|file| !file.hunks.is_empty())
                .collect()
        }
    }

    pub fn pending_hunks(&self, session: &str, path: &Path) -> Vec<Hunk> {
        self.read(session, |edits| edits.entries.get(path).map(|entry| hunks::compute(&entry.baseline, &entry.current)).unwrap_or_default())
    }

    /// Every loaded session with unreviewed changes to `path`, with its hunks.
    pub fn hunks_for_path(&self, path: &Path) -> Vec<(String, Vec<Hunk>)> {
        self.lock()
            .iter()
            .filter_map(|(id, edits)| edits.entries.get(path).map(|entry| (id.clone(), hunks::compute(&entry.baseline, &entry.current))))
            .filter(|(_, hunks)| !hunks.is_empty())
            .collect()
    }

    pub fn checkpoints(&self, session: &str) -> Vec<CheckpointSummary> {
        self.read(session, |edits| {
            edits
                .checkpoints
                .iter()
                .map(|checkpoint| CheckpointSummary { turn: checkpoint.turn, created_at: checkpoint.created_at, files: checkpoint.files.keys().cloned().collect() })
                .collect()
        })
    }

    /// Checks the session's entry for `path` against the disk: an outside change clear of the
    /// agent's hunks is rebased; one that touches them, or a missing file, drops the entry.
    fn sync_with_disk(&self, session: &str, path: &Path, outcome: &mut Outcome) -> Option<EditEntry> {
        let disk = read_disk(path);
        self.update(session, |edits| {
            let entry = edits.entries.get(path)?.clone();
            if disk.as_deref() == Some(entry.current.as_str()) {
                return Some(entry);
            }
            let rebased = disk.as_deref().and_then(|disk| hunks::rebase(&entry, disk));
            match rebased {
                Some(rebased) => {
                    edits.entries.insert(path.to_path_buf(), rebased.clone());
                    Some(rebased)
                }
                None => {
                    edits.entries.remove(path);
                    outcome.notices.push(if disk.is_none() {
                        format!("Stopped tracking agent changes to {}: the file is gone", display(path))
                    } else {
                        format!("Stopped tracking agent changes to {}: it changed where the agent had edited it", display(path))
                    });
                    None
                }
            }
        })
    }

    fn set_entry(&self, session: &str, entry: EditEntry) {
        self.update(session, |edits| {
            if entry.baseline == entry.current {
                edits.entries.remove(&entry.path);
            } else {
                edits.entries.insert(entry.path.clone(), entry);
            }
        });
    }

    fn keep_hunks(&self, session: &str, entry: EditEntry, hunks: &[Hunk]) {
        let mut sorted: Vec<&Hunk> = hunks.iter().collect();
        sorted.sort_by(|a, b| b.base_start.cmp(&a.base_start));
        let mut baseline = entry.baseline.clone();
        for hunk in sorted {
            match hunks::keep(&baseline, hunk) {
                Some(kept) => baseline = kept,
                None => return,
            }
        }
        self.set_entry(session, EditEntry { baseline, revision: entry.revision + 1, ..entry });
    }

    /// Takes hunks back out of the file on disk. Rejecting all of a file the agent created
    /// deletes it.
    fn reject_hunks(&self, session: &str, entry: EditEntry, hunks: &[Hunk], outcome: &mut Outcome) {
        if hunks.is_empty() {
            return;
        }
        let edits: Vec<hunks::LineEdit> = hunks.iter().map(hunks::reject_edit).collect();
        let Some(reverted) = hunks::transfer(&entry.current, &entry.current, &edits) else { return };
        let removes_file = entry.created && reverted.is_empty();
        // Checked against the text the review last read, as the editor's saves are: a file
        // changed on disk since then is refused rather than overwritten.
        let written = if removes_file { std::fs::remove_file(&entry.path) } else { write_checked(&entry.path, Some(Some(&entry.current)), &reverted) };
        if let Err(error) = written {
            outcome.notices.push(format!("Could not reject the change in {}: {error}", display(&entry.path)));
            return;
        }
        let path = entry.path.clone();
        if removes_file {
            self.update(session, |edits| edits.entries.remove(&path));
        } else {
            self.set_entry(session, EditEntry { current: reverted.clone(), revision: entry.revision + 1, ..entry });
        }
        self.rebase_others(&path, session, (!removes_file).then_some(reverted.as_str()), outcome);
    }

    fn find_hunk(entry: &EditEntry, hunk: &Hunk) -> Option<Hunk> {
        hunks::compute(&entry.baseline, &entry.current).into_iter().find(|candidate| candidate == hunk)
    }

    /// Does what the review asked, reading and writing the files on disk.
    pub fn apply(&self, session: &str, action: ReviewAction) -> Outcome {
        let mut outcome = Outcome::changed(session);
        match action {
            ReviewAction::KeepHunk { path, hunk } => {
                if let Some(entry) = self.sync_with_disk(session, &path, &mut outcome)
                    && let Some(hunk) = Self::find_hunk(&entry, &hunk)
                {
                    self.keep_hunks(session, entry, &[hunk]);
                }
            }
            ReviewAction::RejectHunk { path, hunk } => {
                if let Some(entry) = self.sync_with_disk(session, &path, &mut outcome)
                    && let Some(hunk) = Self::find_hunk(&entry, &hunk)
                {
                    self.reject_hunks(session, entry, &[hunk], &mut outcome);
                }
            }
            ReviewAction::KeepFile(path) => self.keep_file(session, &path, &mut outcome),
            ReviewAction::RejectFile(path) => self.reject_file(session, &path, &mut outcome),
            ReviewAction::KeepAll => {
                for path in self.read(session, |edits| edits.entries.keys().cloned().collect::<Vec<_>>()) {
                    self.keep_file(session, &path, &mut outcome);
                }
            }
            ReviewAction::RejectAll => {
                for path in self.read(session, |edits| edits.entries.keys().cloned().collect::<Vec<_>>()) {
                    self.reject_file(session, &path, &mut outcome);
                }
            }
            ReviewAction::Restore { turn, force } => self.restore(session, turn, force, &mut outcome),
        }
        outcome.changed.dedup();
        outcome
    }

    fn keep_file(&self, session: &str, path: &Path, outcome: &mut Outcome) {
        if let Some(entry) = self.sync_with_disk(session, path, outcome) {
            let hunks = hunks::compute(&entry.baseline, &entry.current);
            self.keep_hunks(session, entry, &hunks);
        }
    }

    fn reject_file(&self, session: &str, path: &Path, outcome: &mut Outcome) {
        if let Some(entry) = self.sync_with_disk(session, path, outcome) {
            let hunks = hunks::compute(&entry.baseline, &entry.current);
            self.reject_hunks(session, entry, &hunks, outcome);
        }
    }

    /// Puts files back as they were before `turn`'s agent (and every later turn's) wrote them.
    fn restore(&self, session: &str, turn: usize, force: bool, outcome: &mut Outcome) {
        let (plan, truncated) = self.read(session, |edits| {
            let mut plan: BTreeMap<PathBuf, (Option<String>, Option<String>)> = BTreeMap::new();
            for checkpoint in edits.checkpoints.iter().filter(|checkpoint| checkpoint.turn >= turn) {
                for (path, file) in &checkpoint.files {
                    let target = plan.get(path).map_or_else(|| file.before.clone(), |(target, _)| target.clone());
                    plan.insert(path.clone(), (target, file.after.clone()));
                }
            }
            let truncated = edits.truncated_at.is_some() && edits.checkpoints.first().is_none_or(|first| first.turn > turn);
            (plan, truncated)
        });
        if truncated {
            outcome.notices.push("Older checkpoints were dropped to save space; files from before then are not restored".into());
        }
        let mut failed: Vec<PathBuf> = Vec::new();
        for (path, (target, expected)) in plan {
            if target == expected {
                continue;
            }
            let disk = read_disk(&path);
            if disk != expected && disk != target && !force {
                outcome.conflicts.push(path);
                continue;
            }
            let result = match &target {
                Some(content) => path.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| write_checked(&path, (!force).then_some(disk.as_deref()), content)),
                None if path.exists() => std::fs::remove_file(&path),
                None => Ok(()),
            };
            match result {
                Ok(()) => {
                    self.update(session, |edits| {
                        if let Some(entry) = edits.entries.get_mut(&path) {
                            match &target {
                                Some(content) if *content != entry.baseline => {
                                    entry.current = content.clone();
                                    entry.revision += 1;
                                }
                                _ => {
                                    edits.entries.remove(&path);
                                }
                            }
                        }
                    });
                    self.rebase_others(&path, session, target.as_deref(), outcome);
                    outcome.restored.push(path);
                }
                Err(error) => {
                    outcome.notices.push(format!("Could not restore {}: {error}", display(&path)));
                    failed.push(path);
                }
            }
        }
        let keep: Vec<PathBuf> = failed.into_iter().chain(outcome.conflicts.iter().cloned()).collect();
        self.update(session, |edits| {
            edits.checkpoints.retain_mut(|checkpoint| {
                if checkpoint.turn < turn {
                    return true;
                }
                checkpoint.files.retain(|path, _| keep.contains(path));
                !checkpoint.files.is_empty()
            });
        });
        if !outcome.conflicts.is_empty() {
            let names: Vec<String> = outcome.conflicts.iter().map(|path| display(path)).collect();
            outcome.notices.push(format!("Left {} alone: changed after the agent's turn", names.join(", ")));
        }
    }

    /// A sent prompt at `turn` was edited: the turns after it are gone from the transcript, so
    /// their checkpoints fold into `turn`'s. Each file keeps its earliest "before" (what it was
    /// before `turn`) and its latest "after"; no later turn index is left to be reused.
    pub fn rewind(&self, session: &str, turn: usize) {
        self.update(session, |edits| {
            let (mut keep, later): (Vec<Checkpoint>, Vec<Checkpoint>) = edits.checkpoints.drain(..).partition(|checkpoint| checkpoint.turn <= turn);
            if let Some(first) = later.first() {
                let index = match keep.iter().position(|checkpoint| checkpoint.turn == turn) {
                    Some(index) => index,
                    None => {
                        keep.push(Checkpoint { turn, created_at: first.created_at, files: BTreeMap::new() });
                        keep.len() - 1
                    }
                };
                let target = &mut keep[index].files;
                for checkpoint in later {
                    for (path, file) in checkpoint.files {
                        match target.entry(path) {
                            std::collections::btree_map::Entry::Vacant(entry) => {
                                entry.insert(file);
                            }
                            std::collections::btree_map::Entry::Occupied(mut entry) => entry.get_mut().after = file.after,
                        }
                    }
                }
            }
            edits.checkpoints = keep;
        });
    }

    /// Forgets every session's review and checkpoints (Clear chat history).
    pub fn forget_all(&self) {
        self.lock().clear();
        if let Some(dir) = &self.dir {
            crate::persistence::remove_json_files(dir);
        }
    }

    /// Forgets a session's review and checkpoints, as when it is deleted.
    pub fn forget(&self, session: &str) {
        self.lock().remove(session);
        if let Some(dir) = &self.dir {
            let _ = std::fs::remove_file(dir.join(file_name(session)));
        }
    }
}

/// Writes `text` to `path` through Athas's checked writer. With `expected`, the file must still
/// hold that text (`Some(None)`: must not exist) or the write is refused; `None` writes anyway.
#[cfg(not(target_family = "wasm"))]
fn write_checked(path: &Path, expected: Option<Option<&str>>, text: &str) -> std::io::Result<()> {
    let written = match expected {
        Some(expected) => athas_project::local_fs::write_text_checked(path, expected.map(athas_project::local_fs::ExpectedFileDigest::of), text.to_string()),
        None => athas_project::local_fs::write_text(path, text.to_string()),
    };
    written.map_err(std::io::Error::other)
}

#[cfg(target_family = "wasm")]
fn write_checked(path: &Path, _expected: Option<Option<&str>>, text: &str) -> std::io::Result<()> {
    std::fs::write(path, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        std::fs::write(path, text).unwrap();
    }

    fn change(path: &Path, previous: Option<&str>, content: Option<&str>) -> FileChange {
        FileChange { path: path.to_path_buf(), previous: previous.map(str::to_string), content: content.map(str::to_string) }
    }

    #[test]
    fn hunks_are_kept_and_rejected_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(Some(dir.path().join("checkpoints")));
        let file = dir.path().join("lib.rs");
        write(&file, "a\nB\nc\nd\nE\n");
        store.record("s", Some(0), change(&file, Some("a\nb\nc\nd\ne\n"), Some("a\nB\nc\nd\nE\n")));
        let files = store.files("s");
        assert_eq!((files.len(), files[0].hunks.len(), files[0].added, files[0].removed), (1, 2, 2, 2));

        let first = files[0].hunks[0].clone();
        store.apply("s", ReviewAction::KeepHunk { path: file.clone(), hunk: first });
        let second = store.pending_hunks("s", &file);
        assert_eq!(second.len(), 1);
        store.apply("s", ReviewAction::RejectHunk { path: file.clone(), hunk: second[0].clone() });
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "a\nB\nc\nd\ne\n");
        assert!(store.files("s").is_empty());

        // Saved and read back by a fresh store.
        let reopened = Store::new(Some(dir.path().join("checkpoints")));
        assert_eq!(reopened.checkpoints("s").len(), 1);
    }

    #[test]
    fn rejecting_a_created_file_deletes_it_and_outside_edits_are_respected() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(None);
        let created = dir.path().join("new.rs");
        write(&created, "fn new() {}");
        store.record("s", Some(0), change(&created, None, Some("fn new() {}")));
        let edited = dir.path().join("edited.rs");
        write(&edited, "one\nTWO\nthree");
        store.record("s", Some(0), change(&edited, Some("one\ntwo\nthree"), Some("one\nTWO\nthree")));
        // The user changes the agent's line before reviewing: the review drops the file.
        write(&edited, "one\nTwo?\nthree");
        let outcome = store.apply("s", ReviewAction::RejectAll);
        assert!(!created.exists());
        assert_eq!(std::fs::read_to_string(&edited).unwrap(), "one\nTwo?\nthree");
        assert_eq!(outcome.notices.len(), 1);
        assert!(store.files("s").is_empty());
    }

    #[test]
    fn restoring_a_turn_puts_files_back_and_skips_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(None);
        let (a, b, c) = (dir.path().join("a"), dir.path().join("b"), dir.path().join("c"));
        write(&a, "a1");
        store.record("s", Some(0), change(&a, Some("a0"), Some("a1")));
        write(&a, "a2");
        store.record("s", Some(2), change(&a, Some("a1"), Some("a2")));
        write(&b, "b1");
        store.record("s", Some(2), change(&b, None, Some("b1")));
        write(&c, "user edit");
        store.record("s", Some(2), change(&c, Some("c0"), Some("c1")));

        let outcome = store.apply("s", ReviewAction::Restore { turn: 2, force: false });
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "a1");
        assert!(!b.exists());
        assert_eq!(std::fs::read_to_string(&c).unwrap(), "user edit");
        assert_eq!(outcome.conflicts, vec![c.clone()]);
        assert_eq!(outcome.restored.len(), 2);
        // The turn-0 checkpoint stays, and the conflicting file can still be forced back.
        assert_eq!(store.checkpoints("s").iter().map(|checkpoint| checkpoint.turn).collect::<Vec<_>>(), [0, 2]);
        store.apply("s", ReviewAction::Restore { turn: 2, force: true });
        assert_eq!(std::fs::read_to_string(&c).unwrap(), "c0");
        store.apply("s", ReviewAction::Restore { turn: 0, force: false });
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "a0");
        assert!(store.checkpoints("s").is_empty());
    }

    #[test]
    fn another_sessions_write_moves_into_this_sessions_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(None);
        let file = dir.path().join("f");
        write(&file, "1\nTWO\n3\n4\n5");
        store.record("first", Some(0), change(&file, Some("1\n2\n3\n4\n5"), Some("1\nTWO\n3\n4\n5")));
        write(&file, "1\nTWO\n3\n4\nFIVE");
        let outcome = store.record("second", Some(0), change(&file, Some("1\nTWO\n3\n4\n5"), Some("1\nTWO\n3\n4\nFIVE")));
        assert!(outcome.changed.contains(&"first".to_string()));
        assert_eq!(store.pending_hunks("first", &file).len(), 1);
        assert_eq!(store.pending_hunks("second", &file).len(), 1);
        assert_eq!(store.hunks_for_path(&file).len(), 2);
    }

    #[test]
    fn old_checkpoints_are_dropped_past_the_budget() {
        let mut edits = SessionEdits::default();
        for turn in 0..60 {
            edits.checkpoints.push(Checkpoint { turn, created_at: turn as u64, files: BTreeMap::new() });
        }
        edits.trim();
        assert_eq!(edits.checkpoints.len(), MAX_CHECKPOINTS);
        assert_eq!(edits.truncated_at, Some(9));
    }
}
