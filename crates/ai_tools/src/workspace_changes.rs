//! Finds the files a shell command changed, so the agent's commands land in the same review log
//! and checkpoints as its own file writes.
//!
//! Before the command runs, [`snapshot_workspace`] records the size and modification time of
//! every workspace file `.gitignore` does not exclude. It keeps the text of files whose earlier
//! version cannot be recovered afterwards: in a Git repository only files that differ from
//! `HEAD` (the rest are read back from that commit when they change), elsewhere every small
//! text file up to a total cap. [`diff_workspace`] walks again and reports what changed.
//!
//! Ported from Athas's `crates/ai/src/workspace_changes.rs`.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::SystemTime,
};

use crate::{MAX_FILE_BYTES, display_path, walk_workspace};

/// Text kept from before a command in a workspace without Git, across all files.
const MAX_CAPTURED_BYTES: u64 = 32 * 1024 * 1024;
/// Changes reported for one command; a build that rewrites thousands of files is not reviewed.
const MAX_REPORTED_CHANGES: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    inode: u64,
}

impl Stamp {
    fn of(path: &Path) -> Option<Self> {
        let metadata = fs::symlink_metadata(path).ok()?;
        metadata.is_file().then(|| Stamp {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            #[cfg(unix)]
            inode: {
                use std::os::unix::fs::MetadataExt;
                metadata.ino()
            },
        })
    }
}

/// The Git commit the workspace's unchanged files match, and the files that differ from it.
struct GitBase {
    head: String,
    differs: HashSet<String>,
}

pub struct WorkspaceSnapshot {
    root: PathBuf,
    files: HashMap<String, Stamp>,
    captured: HashMap<String, String>,
    git: Option<GitBase>,
    truncated: bool,
}

/// One file the command changed. `previous_content` is `None` when the command created the file,
/// `content` is `None` when it deleted it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceChange {
    /// The workspace root joined with the file's relative path, as agent writes report it.
    pub path: PathBuf,
    pub previous_content: Option<String>,
    pub content: Option<String>,
}

/// A change that cannot be offered for review, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedWorkspaceChange {
    pub path: PathBuf,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct WorkspaceChanges {
    pub changes: Vec<WorkspaceChange>,
    pub skipped: Vec<SkippedWorkspaceChange>,
    /// Some changes were not looked at: the workspace is too large to walk, or the command
    /// changed more files than are reported.
    pub incomplete: bool,
}

fn git_output(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new("git")
        .args(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false"])
        .args(args)
        .current_dir(root)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output.status.success().then_some(output.stdout)
}

fn nul_separated(bytes: &[u8]) -> impl Iterator<Item = String> + '_ {
    bytes.split(|byte| *byte == 0).filter(|part| !part.is_empty()).map(|part| String::from_utf8_lossy(part).replace('\\', "/"))
}

fn git_base(root: &Path) -> Option<GitBase> {
    let head = String::from_utf8(git_output(root, &["rev-parse", "--verify", "-q", "HEAD"])?).ok()?.trim().to_string();
    let mut differs = HashSet::new();
    // Paths come back relative to the workspace, which may be a folder inside the repository.
    let changed = git_output(root, &["diff", "--name-only", "-z", "--relative", "HEAD"])?;
    differs.extend(nul_separated(&changed));
    let untracked = git_output(root, &["ls-files", "-z", "--others", "--exclude-standard"])?;
    differs.extend(nul_separated(&untracked));
    Some(GitBase { head, differs })
}

/// The file as text, or why it cannot be reviewed.
fn read_text(path: &Path) -> Result<String, &'static str> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "It could not be read.")?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "It could not be read.")?;
    text_from(bytes)
}

fn text_from(bytes: Vec<u8>) -> Result<String, &'static str> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("It is larger than 256 KiB.");
    }
    if bytes.contains(&0) {
        return Err("It is a binary file.");
    }
    String::from_utf8(bytes).map_err(|_| "It is a binary file.")
}

/// Records the workspace before a command runs.
pub fn snapshot_workspace(root: &Path) -> Result<WorkspaceSnapshot, String> {
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let walk = walk_workspace(root, None, None)?;
    let git = git_base(&canonical_root);
    let mut files = HashMap::with_capacity(walk.files.len());
    let mut captured = HashMap::new();
    let mut captured_bytes = 0_u64;
    for (path, relative) in walk.files {
        let Some(stamp) = Stamp::of(&path) else { continue };
        let keep = match &git {
            Some(git) => git.differs.contains(&relative),
            None => captured_bytes + stamp.len <= MAX_CAPTURED_BYTES,
        };
        if keep
            && stamp.len <= MAX_FILE_BYTES
            && let Ok(text) = read_text(&path)
        {
            captured_bytes += text.len() as u64;
            captured.insert(relative.clone(), text);
        }
        files.insert(relative, stamp);
    }
    Ok(WorkspaceSnapshot { root: root.to_path_buf(), files, captured, git, truncated: walk.truncated })
}

impl WorkspaceSnapshot {
    /// What `relative` held when the snapshot was taken, or why that is unknown.
    fn previous_content(&self, relative: &str) -> Result<String, &'static str> {
        if let Some(text) = self.captured.get(relative) {
            return Ok(text.clone());
        }
        match &self.git {
            Some(git) if !git.differs.contains(relative) => {
                let object = format!("{}:./{relative}", git.head);
                let root = fs::canonicalize(&self.root).map_err(|_| "It could not be read.")?;
                // `--filters` gives the file as checked out, line endings included.
                let bytes = git_output(&root, &["cat-file", "--filters", &object]).ok_or("Its earlier version could not be read from Git.")?;
                text_from(bytes)
            }
            _ => Err("Its earlier version was too large or not text."),
        }
    }
}

/// Compares the workspace with `snapshot` after the command finished.
pub fn diff_workspace(snapshot: &WorkspaceSnapshot) -> Result<WorkspaceChanges, String> {
    let walk = walk_workspace(&snapshot.root, None, None)?;
    let mut result = WorkspaceChanges { incomplete: snapshot.truncated || walk.truncated, ..WorkspaceChanges::default() };
    let mut seen = HashSet::with_capacity(walk.files.len());
    let mut changed: Vec<(Option<PathBuf>, String)> = Vec::new();
    for (path, relative) in walk.files {
        let stamp = Stamp::of(&path);
        if stamp.is_none() || snapshot.files.get(&relative).copied() != stamp {
            changed.push((Some(path), relative.clone()));
        }
        seen.insert(relative);
    }
    if !walk.truncated {
        let mut deleted = snapshot.files.keys().filter(|relative| !seen.contains(*relative)).collect::<Vec<_>>();
        deleted.sort();
        changed.extend(deleted.into_iter().map(|relative| (None, relative.clone())));
    }
    for (path, relative) in changed {
        if result.changes.len() + result.skipped.len() >= MAX_REPORTED_CHANGES {
            result.incomplete = true;
            break;
        }
        let display = display_path(&snapshot.root, &relative);
        let skip = |reason: &str| SkippedWorkspaceChange { path: display.clone(), reason: reason.to_string() };
        let previous = if snapshot.files.contains_key(&relative) {
            match snapshot.previous_content(&relative) {
                Ok(text) => Some(text),
                Err(reason) => {
                    result.skipped.push(skip(reason));
                    continue;
                }
            }
        } else {
            None
        };
        let content = match path.filter(|path| path.exists()) {
            Some(path) => match read_text(&path) {
                Ok(text) => Some(text),
                Err(reason) => {
                    result.skipped.push(skip(reason));
                    continue;
                }
            },
            None => None,
        };
        if previous == content {
            continue;
        }
        result.changes.push(WorkspaceChange { path: display, previous_content: previous, content });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_files_a_command_created_changed_and_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("keep.txt"), "same\n").unwrap();
        fs::write(root.join("edit.txt"), "before\n").unwrap();
        fs::write(root.join("gone.txt"), "bye\n").unwrap();
        let snapshot = snapshot_workspace(root).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(root.join("edit.txt"), "after, longer\n").unwrap();
        fs::remove_file(root.join("gone.txt")).unwrap();
        fs::write(root.join("new.txt"), "hello\n").unwrap();
        let changes = diff_workspace(&snapshot).unwrap();
        let mut found: Vec<(String, Option<String>, Option<String>)> = changes
            .changes
            .into_iter()
            .map(|change| (change.path.file_name().unwrap().to_string_lossy().into_owned(), change.previous_content, change.content))
            .collect();
        found.sort();
        assert_eq!(
            found,
            vec![
                ("edit.txt".into(), Some("before\n".into()), Some("after, longer\n".into())),
                ("gone.txt".into(), Some("bye\n".into()), None),
                ("new.txt".into(), None, Some("hello\n".into())),
            ]
        );
        assert!(changes.skipped.is_empty());
    }

    #[test]
    fn binary_files_are_skipped_with_a_reason() {
        let dir = tempfile::tempdir().unwrap();
        let snapshot = snapshot_workspace(dir.path()).unwrap();
        fs::write(dir.path().join("blob.bin"), [0u8, 1, 2, 3]).unwrap();
        let changes = diff_workspace(&snapshot).unwrap();
        assert!(changes.changes.is_empty());
        assert_eq!(changes.skipped[0].reason, "It is a binary file.");
    }
}
