//! Git in the editor: change markers in the gutter (the buffer against `HEAD`) and inline blame
//! for the caret line (`features/editor` git gutter and inline blame in Athas).

#[cfg(not(target_family = "wasm"))]
use std::{collections::HashMap, path::PathBuf};
use std::{
    ops::Range,
    path::Path,
    sync::Arc,
    time::Duration,
};

use web_time::{Instant, SystemTime, UNIX_EPOCH};

use gpui::{AppContext as _, Context, Task};

use crate::{Editor, Status, buffer::AppliedEdit, folding::line_shifts};

const DIFF_DELAY: Duration = Duration::from_millis(250);
/// Focusing the editor reads git again at most this often.
const FOCUS_REFRESH: Duration = Duration::from_secs(3);
/// Files larger than this get no blame (it reads the whole history of the file).
const MAX_BLAME_FILE: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HunkKind {
    Added,
    Modified,
    /// Lines were removed above `lines.start`.
    Deleted,
}

/// A changed run of lines (0-based, in the buffer).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitHunk {
    pub kind: HunkKind,
    pub lines: Range<usize>,
}

type AvatarLookup = std::rc::Rc<dyn Fn(&str, &gpui::App) -> Option<String>>;

struct GlobalAvatarLookup(AvatarLookup);

impl gpui::Global for GlobalAvatarLookup {}

/// How the blame card finds a commit author's picture by email (`git-author-avatar.ts`); the
/// workbench sets it, as the git views share one lookup.
pub fn set_author_avatar_lookup(cx: &mut gpui::App, lookup: impl Fn(&str, &gpui::App) -> Option<String> + 'static) {
    cx.set_global(GlobalAvatarLookup(std::rc::Rc::new(lookup)));
}

fn author_avatar(email: &str, cx: &gpui::App) -> Option<String> {
    let lookup = cx.try_global::<GlobalAvatarLookup>()?;
    (lookup.0)(email, cx)
}

/// Who last changed a line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlameEntry {
    pub author: String,
    pub email: String,
    /// Seconds since the Unix epoch.
    pub time: i64,
    pub summary: String,
    /// `None` for a line not committed yet.
    pub commit: Option<String>,
}

/// The file in its repository: the work tree and its `HEAD` text (`None` when untracked).
struct HeadText {
    text: Option<String>,
}

#[cfg(not(target_family = "wasm"))]
fn open_repository(path: &Path) -> Option<(git2::Repository, PathBuf)> {
    let repository = git2::Repository::discover(path.parent()?).ok()?;
    let workdir = repository.workdir()?.canonicalize().ok()?;
    let absolute = path.canonicalize().ok()?;
    let relative = absolute.strip_prefix(&workdir).ok()?.to_path_buf();
    Some((repository, relative))
}

/// The file's text at `HEAD`, or empty when it is staged but not committed yet. `None` when the
/// file is not in a repository or not tracked.
#[cfg(not(target_family = "wasm"))]
fn read_head(path: &Path) -> Option<HeadText> {
    let (repository, relative) = open_repository(path)?;
    let from_head = repository
        .head()
        .ok()
        .and_then(|head| head.peel_to_tree().ok())
        .and_then(|tree| tree.get_path(&relative).ok())
        .and_then(|entry| repository.find_blob(entry.id()).ok())
        .map(|blob| String::from_utf8_lossy(blob.content()).replace("\r\n", "\n"));
    if from_head.is_some() {
        return Some(HeadText { text: from_head });
    }
    let staged = repository.index().ok().is_some_and(|index| index.get_path(&relative, 0).is_some());
    staged.then_some(HeadText { text: Some(String::new()) })
}

/// The hunks that turn `old` into `new`, by line.
#[cfg(not(target_family = "wasm"))]
pub fn diff_hunks(old: &str, new: &str) -> Vec<GitHunk> {
    let mut options = git2::DiffOptions::new();
    options.context_lines(0);
    let Ok(patch) = git2::Patch::from_buffers(old.as_bytes(), None, new.as_bytes(), None, Some(&mut options)) else { return Vec::new() };
    let mut hunks = Vec::with_capacity(patch.num_hunks());
    for index in 0..patch.num_hunks() {
        let Ok((hunk, _)) = patch.hunk(index) else { continue };
        let (old_lines, new_start, new_lines) = (hunk.old_lines() as usize, hunk.new_start() as usize, hunk.new_lines() as usize);
        let hunk = if new_lines == 0 {
            // `new_start` is the line before the removed ones, 1-based.
            GitHunk { kind: HunkKind::Deleted, lines: new_start..new_start }
        } else if old_lines == 0 {
            GitHunk { kind: HunkKind::Added, lines: new_start - 1..new_start - 1 + new_lines }
        } else {
            GitHunk { kind: HunkKind::Modified, lines: new_start - 1..new_start - 1 + new_lines }
        };
        hunks.push(hunk);
    }
    hunks
}

/// The web build reads files from a server and has no repository to diff or blame against yet.
#[cfg(target_family = "wasm")]
fn read_head(_: &Path) -> Option<HeadText> {
    None
}

#[cfg(target_family = "wasm")]
pub fn diff_hunks(_: &str, _: &str) -> Vec<GitHunk> {
    Vec::new()
}

#[cfg(target_family = "wasm")]
fn blame_lines(_: &Path, _: &str) -> Option<Vec<Option<Arc<BlameEntry>>>> {
    None
}

/// Blame for each line of `text` (the buffer, saved or not).
#[cfg(not(target_family = "wasm"))]
fn blame_lines(path: &Path, text: &str) -> Option<Vec<Option<Arc<BlameEntry>>>> {
    let (repository, relative) = open_repository(path)?;
    let blame = repository.blame_file(&relative, None).ok()?;
    let blame = blame.blame_buffer(text.as_bytes()).ok()?;
    let mut commits: HashMap<git2::Oid, Arc<BlameEntry>> = HashMap::new();
    let uncommitted = Arc::new(BlameEntry { author: "You".into(), email: String::new(), time: now_seconds(), summary: "Uncommitted changes".into(), commit: None });
    let line_count = text.lines().count().max(1) + usize::from(text.ends_with('\n'));
    let mut lines = Vec::with_capacity(line_count);
    for line in 1..=line_count {
        let entry = blame.get_line(line).map(|hunk| {
            let id = hunk.final_commit_id();
            if id.is_zero() {
                return uncommitted.clone();
            }
            commits
                .entry(id)
                .or_insert_with(|| {
                    let commit = repository.find_commit(id).ok();
                    let signature = hunk.final_signature();
                    Arc::new(BlameEntry {
                        author: signature.name().unwrap_or("Unknown").to_string(),
                        email: signature.email().unwrap_or_default().to_string(),
                        time: signature.when().seconds(),
                        summary: commit.as_ref().and_then(|commit| commit.summary().map(str::to_string)).unwrap_or_default(),
                        commit: Some(id.to_string()),
                    })
                })
                .clone()
        });
        lines.push(entry);
    }
    Some(lines)
}

fn now_seconds() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs() as i64).unwrap_or(0)
}

/// "3 days ago", as the old app's blame shows times.
pub fn relative_time(time: i64, now: i64) -> String {
    let seconds = (now - time).max(0);
    let (value, unit) = match seconds {
        0..60 => return "just now".into(),
        60..3600 => (seconds / 60, "minute"),
        3600..86_400 => (seconds / 3600, "hour"),
        86_400..604_800 => (seconds / 86_400, "day"),
        604_800..2_592_000 => (seconds / 604_800, "week"),
        2_592_000..31_536_000 => (seconds / 2_592_000, "month"),
        _ => (seconds / 31_536_000, "year"),
    };
    format!("{value} {unit}{} ago", if value == 1 { "" } else { "s" })
}

#[derive(Default)]
pub(crate) struct GitState {
    pub hunks: Vec<GitHunk>,
    /// The `HEAD` text the hunks compare against; `None` outside a repository.
    head: Option<Arc<String>>,
    pub blame: Vec<Option<Arc<BlameEntry>>>,
    last_refresh: Option<Instant>,
    head_task: Option<Task<()>>,
    diff_task: Option<Task<()>>,
    blame_task: Option<Task<()>>,
    /// The commit card of the inline blame: its line, once the pointer rested on the blame.
    pub card: Option<usize>,
    /// The pointer is over the inline blame (its line) or over the card.
    blame_hovered: Option<usize>,
    pub card_hovered: bool,
    card_task: Option<Task<()>>,
    copied: bool,
}

/// How long the pointer rests on inline blame before its commit card opens.
const CARD_OPEN_DELAY: Duration = Duration::from_millis(500);
/// How long the card stays after the pointer leaves, so it can move onto the card.
const CARD_CLOSE_DELAY: Duration = Duration::from_millis(120);

impl Editor {
    /// Reads the file's `HEAD` text and blame again, then diffs (on load, save and focus).
    pub(crate) fn refresh_git(&mut self, cx: &mut Context<Self>) {
        if self.status != Status::Ready || !self.fs.is_local() || !self.path.is_absolute() {
            return;
        }
        self.git.last_refresh = Some(Instant::now());
        let path = self.path.clone();
        self.git.head_task = Some(cx.spawn(async move |this, cx| {
            let head = cx.background_spawn(async move { read_head(&path) }).await;
            this.update(cx, |editor, cx| {
                editor.git.head = head.and_then(|head| head.text).map(Arc::new);
                editor.schedule_git_diff(false, cx);
                editor.schedule_blame(cx);
            })
            .ok();
        }));
    }

    pub(crate) fn refresh_git_on_focus(&mut self, cx: &mut Context<Self>) {
        if self.git.last_refresh.is_none_or(|last| last.elapsed() > FOCUS_REFRESH) {
            self.refresh_git(cx);
        }
    }

    /// Diffs the buffer against `HEAD` in the background.
    pub(crate) fn schedule_git_diff(&mut self, debounce: bool, cx: &mut Context<Self>) {
        let Some(head) = self.git.head.clone() else {
            if !self.git.hunks.is_empty() {
                self.git.hunks.clear();
                cx.notify();
            }
            return;
        };
        let rope = self.document.buffer.rope().clone();
        let version = self.document.buffer.version();
        self.git.diff_task = Some(cx.spawn(async move |this, cx| {
            if debounce {
                cx.background_executor().timer(DIFF_DELAY).await;
            }
            let hunks = cx.background_spawn(async move { diff_hunks(&head, &rope.to_string()) }).await;
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() == version {
                    editor.git.hunks = hunks;
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    fn schedule_blame(&mut self, cx: &mut Context<Self>) {
        if !settings::get(cx).enable_inline_git_blame || self.document.buffer.len() > MAX_BLAME_FILE || self.git.head.is_none() {
            self.git.blame.clear();
            return;
        }
        let path = self.path.clone();
        let text = self.document.buffer.text();
        let version = self.document.buffer.version();
        self.git.blame_task = Some(cx.spawn(async move |this, cx| {
            let blame = cx.background_spawn(async move { blame_lines(&path, &text) }).await;
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() == version {
                    editor.git.blame = blame.unwrap_or_default();
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    /// Keeps blame on its lines through an edit (edited lines count as uncommitted) and diffs
    /// again after a pause.
    pub(crate) fn git_edited(&mut self, edits: &[AppliedEdit], cx: &mut Context<Self>) {
        if !self.git.blame.is_empty() {
            let uncommitted = Arc::new(BlameEntry { author: "You".into(), email: String::new(), time: now_seconds(), summary: "Uncommitted changes".into(), commit: None });
            for edit in edits {
                let first = edit.lsp.range.start.line as usize;
                let last = edit.lsp.range.end.line as usize;
                let new_lines = edit.lsp.text.matches('\n').count();
                let end = (last + 1).min(self.git.blame.len());
                if first <= end {
                    let replacement = std::iter::repeat_n(Some(uncommitted.clone()), new_lines + 1);
                    self.git.blame.splice(first.min(end)..end, replacement);
                }
            }
        }
        if self.git.head.is_some() {
            // Shift the old markers at once so they do not jump while the diff runs.
            for (from, delta) in line_shifts(edits) {
                for hunk in &mut self.git.hunks {
                    if hunk.lines.start >= from {
                        hunk.lines.start = (hunk.lines.start as isize + delta).max(0) as usize;
                        hunk.lines.end = (hunk.lines.end as isize + delta).max(hunk.lines.start as isize) as usize;
                    }
                }
            }
            self.schedule_git_diff(true, cx);
        }
    }

    /// The pointer moved onto (`Some(line)`) or off the inline blame, or onto or off the card.
    pub(crate) fn hover_blame(&mut self, line: Option<usize>, over_card: Option<bool>, cx: &mut Context<Self>) {
        if let Some(over_card) = over_card {
            self.git.card_hovered = over_card;
        } else {
            if self.git.blame_hovered == line {
                return;
            }
            self.git.blame_hovered = line;
        }
        let wanted = self.git.blame_hovered.or(self.git.card.filter(|_| self.git.card_hovered));
        if wanted == self.git.card {
            self.git.card_task = None;
            return;
        }
        let delay = if wanted.is_some() { CARD_OPEN_DELAY } else { CARD_CLOSE_DELAY };
        self.git.card_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            this.update(cx, |editor, cx| {
                if editor.git.card != wanted {
                    editor.git.card = wanted;
                    editor.git.copied = false;
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    /// The commit card over the inline blame at `anchor`.
    pub(crate) fn render_blame_card(&self, anchor: gpui::Bounds<gpui::Pixels>, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        use gpui::{Anchor, InteractiveElement as _, IntoElement as _, StatefulInteractiveElement as _, ParentElement as _, Styled as _, anchored, deferred, div, point, px};
        use theme::ActiveTheme as _;
        use ui::{Avatar, Button, ButtonSize, ButtonVariant, IconName, typography};

        let line = self.git.card?;
        let entry = self.git.blame.get(line)?.as_ref()?;
        let hash = entry.commit.clone()?;
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let author = if entry.author.trim().is_empty() { "Unknown".to_string() } else { entry.author.trim().to_string() };
        let summary = entry.summary.lines().next().filter(|summary| !summary.trim().is_empty()).unwrap_or("No commit message").to_string();
        let short = hash.chars().take(7).collect::<String>();
        let copied = self.git.copied;
        let card = div()
            .id("blame-card")
            .occlude()
            .flex()
            .flex_col()
            .gap(px(6.))
            .p(px(10.))
            .max_w(px(360.))
            .rounded(ui::metrics::RADIUS_LG)
            .border_1()
            .border_color(colors.border)
            .bg(colors.overlay)
            .shadow(theme.shadows.popover.clone())
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_SM)
            .text_color(colors.foreground)
            .on_hover(cx.listener(|editor, hovered: &bool, _, cx| editor.hover_blame(None, Some(*hovered), cx)))
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(6.))
                    .text_color(colors.subtle_foreground)
                    .child(Avatar::new(&author).size(px(20.)).image(author_avatar(&entry.email, cx)))
                    .child(div().min_w_0().truncate().font_weight(typography::MEDIUM).text_color(colors.foreground).child(author))
                    .child(div().flex_none().child(relative_time(entry.time, now_seconds()))),
            )
            .child(div().line_clamp(3).child(summary))
            .child(
                div().child(
                    Button::new("blame-copy-hash", short)
                        .size(ButtonSize::XSmall)
                        .variant(ButtonVariant::Ghost)
                        .leading_icon(if copied { IconName::Check } else { IconName::Copy })
                        .tooltip(if copied { "Copied" } else { "Copy commit hash" })
                        .on_click(cx.listener(move |editor, _, _, cx| {
                            cx.write_to_clipboard(gpui::ClipboardItem::new_string(hash.clone()));
                            editor.git.copied = true;
                            cx.notify();
                        })),
                ),
            );
        Some(
            deferred(anchored().anchor(Anchor::BottomLeft).position(point(anchor.left(), anchor.top() - px(4.))).snap_to_window_with_margin(px(8.)).child(card))
                .with_priority(2)
                .into_any_element(),
        )
    }

    /// The blame of the caret line, as the inline annotation shows it.
    pub(crate) fn inline_blame_text(&self, line: usize) -> Option<String> {
        let entry = self.git.blame.get(line)?.as_ref()?;
        let when = relative_time(entry.time, now_seconds());
        Some(if entry.commit.is_none() {
            format!("You, {when} · Uncommitted changes")
        } else {
            format!("{}, {when} · {}", entry.author, entry.summary)
        })
    }

    /// The changed line runs against `HEAD`, for the workbench (a "next change" command).
    pub fn git_hunks(&self) -> &[GitHunk] {
        &self.git.hunks
    }
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    #[test]
    fn hunks_by_kind() {
        let old = "one\ntwo\nthree\nfour\n";
        assert_eq!(diff_hunks(old, "one\ntwo\nthree\nfour\n"), vec![]);
        assert_eq!(diff_hunks(old, "zero\none\ntwo\nthree\nfour\n"), vec![GitHunk { kind: HunkKind::Added, lines: 0..1 }]);
        assert_eq!(diff_hunks(old, "one\nTWO\nthree\nfour\n"), vec![GitHunk { kind: HunkKind::Modified, lines: 1..2 }]);
        assert_eq!(diff_hunks(old, "one\nfour\n"), vec![GitHunk { kind: HunkKind::Deleted, lines: 1..1 }]);
        assert_eq!(diff_hunks(old, "two\nthree\nfour\n"), vec![GitHunk { kind: HunkKind::Deleted, lines: 0..0 }]);
    }

    #[test]
    fn times_read_like_the_old_app() {
        assert_eq!(relative_time(1000, 1030), "just now");
        assert_eq!(relative_time(0, 120), "2 minutes ago");
        assert_eq!(relative_time(0, 86_400), "1 day ago");
        assert_eq!(relative_time(0, 3 * 31_536_000), "3 years ago");
    }

    fn git(directory: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(["-c", "user.name=Ada", "-c", "user.email=ada@example.com", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(directory)
            .output()
            .expect("git runs");
        assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stderr));
    }

    #[test]
    fn gutter_hunks_and_blame_on_a_temporary_repository() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../target/editor-git-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let directory = directory.canonicalize().unwrap();
        git(&directory, &["init", "-q"]);
        let file = directory.join("main.rs");
        std::fs::write(&file, "fn main() {\n    one();\n    two();\n}\n").unwrap();
        git(&directory, &["add", "."]);
        git(&directory, &["commit", "-q", "-m", "First commit"]);

        // Edited on disk and in the buffer: a changed line, an added one, one removed.
        let buffer = "fn main() {\n    ONE();\n}\n// end\n";
        std::fs::write(&file, buffer).unwrap();
        let head = read_head(&file).unwrap().text.unwrap();
        assert_eq!(head, "fn main() {\n    one();\n    two();\n}\n");
        let hunks = diff_hunks(&head, buffer);
        assert_eq!(
            hunks,
            vec![
                GitHunk { kind: HunkKind::Modified, lines: 1..2 },
                GitHunk { kind: HunkKind::Added, lines: 3..4 },
            ]
        );

        let blame = blame_lines(&file, buffer).unwrap();
        let first = blame[0].as_ref().unwrap();
        assert_eq!(first.author, "Ada");
        assert_eq!(first.summary, "First commit");
        assert!(first.commit.is_some());
        assert!(blame[1].as_ref().unwrap().commit.is_none());

        // An untracked file has no diff base.
        let untracked = directory.join("new.rs");
        std::fs::write(&untracked, "x").unwrap();
        assert!(read_head(&untracked).is_none());
        std::fs::remove_dir_all(&directory).ok();
    }
}
