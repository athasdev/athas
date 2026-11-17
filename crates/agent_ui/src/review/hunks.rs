//! Hunks between what a file held before an agent wrote it and what it holds now, so each change
//! can be kept or rejected on its own, and the bookkeeping that keeps them right when the file
//! also changes another way.
//!
//! Ported from Athas's `features/ai/lib/agent-edit-hunks.ts`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::diff::{self, LineKind};

/// One run of changed lines: `base_lines` at `base_start` in the older text were replaced by
/// `current_lines` at `current_start` in the newer one. Starts are 0-based line indexes.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub base_start: usize,
    pub base_lines: Vec<String>,
    pub current_start: usize,
    pub current_lines: Vec<String>,
}

impl Hunk {
    /// The 1-based line the hunk starts at in the file as it is now.
    pub fn line(&self) -> u32 {
        self.current_start as u32 + 1
    }

    /// The 0-based lines the hunk covers in the file as it is now (empty for a pure deletion,
    /// which sits before `current_start`).
    pub fn current_lines_range(&self) -> std::ops::Range<usize> {
        self.current_start..self.current_start + self.current_lines.len()
    }
}

/// A file an agent wrote that still has unreviewed changes: the hunks are the difference between
/// `baseline` and `current`. Keeping one moves it into the baseline, rejecting one takes it back
/// out of the file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditEntry {
    pub path: PathBuf,
    /// The file before the agent's first unreviewed write, plus every change kept since.
    pub baseline: String,
    /// What the file holds now, as far as the log knows: the agent's last write.
    pub current: String,
    /// The agent created the file, so rejecting all of it deletes the file again.
    pub created: bool,
    /// Bumped on every change.
    pub revision: u64,
    /// The turn (the user message's transcript index) of the first unreviewed write.
    pub turn: Option<usize>,
}

/// Replace `delete` lines at the 0-based `start` with `lines`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineEdit {
    pub start: usize,
    pub delete: usize,
    pub lines: Vec<String>,
}

/// Split the way hunk indexes count: an empty text has no lines, a trailing newline leaves an
/// empty last line.
pub fn split_lines(text: &str) -> Vec<&str> {
    if text.is_empty() { Vec::new() } else { text.split('\n').collect() }
}

fn join(lines: &[String]) -> String {
    lines.join("\n")
}

/// The changes from `base` to `current`, one hunk per run of changed lines with no context.
pub fn compute(base: &str, current: &str) -> Vec<Hunk> {
    if base == current {
        return Vec::new();
    }
    let (old, new) = (split_lines(base), split_lines(current));
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut open = false;
    let (mut base_index, mut current_index) = (0, 0);
    for (kind, line) in diff::ops(&old, &new) {
        if kind == LineKind::Context {
            open = false;
            base_index += 1;
            current_index += 1;
            continue;
        }
        if !open {
            hunks.push(Hunk { base_start: base_index, current_start: current_index, ..Default::default() });
            open = true;
        }
        let hunk = hunks.last_mut().expect("a hunk is open");
        if kind == LineKind::Removed {
            hunk.base_lines.push(line.to_string());
            base_index += 1;
        } else {
            hunk.current_lines.push(line.to_string());
            current_index += 1;
        }
    }
    hunks
}

fn slice_matches(lines: &[&str], start: usize, expected: &[String]) -> bool {
    start + expected.len() <= lines.len() && expected.iter().enumerate().all(|(offset, line)| lines[start + offset] == line)
}

fn splice(text: &str, edit: &LineEdit) -> String {
    let mut lines: Vec<String> = split_lines(text).into_iter().map(str::to_string).collect();
    let end = (edit.start + edit.delete).min(lines.len());
    lines.splice(edit.start.min(lines.len())..end, edit.lines.iter().cloned());
    join(&lines)
}

/// Keep a hunk: the baseline takes the agent's lines. `None` when the hunk is stale.
pub fn keep(baseline: &str, hunk: &Hunk) -> Option<String> {
    slice_matches(&split_lines(baseline), hunk.base_start, &hunk.base_lines)
        .then(|| splice(baseline, &LineEdit { start: hunk.base_start, delete: hunk.base_lines.len(), lines: hunk.current_lines.clone() }))
}

/// The edit to the current text that puts a hunk's baseline lines back.
pub fn reject_edit(hunk: &Hunk) -> LineEdit {
    LineEdit { start: hunk.current_start, delete: hunk.current_lines.len(), lines: hunk.base_lines.clone() }
}

/// Reject a hunk: the text gets the baseline's lines back. `None` when the hunk is stale.
pub fn reject(current: &str, hunk: &Hunk) -> Option<String> {
    slice_matches(&split_lines(current), hunk.current_start, &hunk.current_lines).then(|| splice(current, &reject_edit(hunk)))
}

/// Whether an edit and a change touch the same lines. Replacements that only meet at a boundary
/// do not; an insertion at either end of the other range does.
fn overlaps(start: usize, end: usize, other_start: usize, other_end: usize) -> bool {
    if start < other_end && other_start < end {
        return true;
    }
    let either_empty = start == end || other_start == other_end;
    either_empty && start <= other_end && other_start <= end
}

/// Applies `edits`, made against `from`, to `to`, a text that differs from `from` in places.
/// `None` when an edit touches lines that differ between the two.
pub fn transfer(from: &str, to: &str, edits: &[LineEdit]) -> Option<String> {
    let changes = compute(from, to);
    let mut mapped = Vec::with_capacity(edits.len());
    for edit in edits {
        let end = edit.start + edit.delete;
        let mut shift: isize = 0;
        for change in &changes {
            let change_end = change.base_start + change.base_lines.len();
            if overlaps(edit.start, end, change.base_start, change_end) {
                return None;
            }
            if change_end <= edit.start {
                shift += change.current_lines.len() as isize - change.base_lines.len() as isize;
            }
        }
        mapped.push(LineEdit { start: (edit.start as isize + shift).max(0) as usize, ..edit.clone() });
    }
    mapped.sort_by(|a, b| b.start.cmp(&a.start));
    let mut lines: Vec<String> = split_lines(to).into_iter().map(str::to_string).collect();
    for edit in mapped {
        let start = edit.start.min(lines.len());
        let end = (edit.start + edit.delete).min(lines.len());
        lines.splice(start..end, edit.lines);
    }
    Some(join(&lines))
}

/// Brings an entry up to date with a file that changed without the agent. Edits clear of the
/// agent's hunks move into the baseline; `None` when one touches a hunk.
pub fn rebase(entry: &EditEntry, disk: &str) -> Option<EditEntry> {
    if disk == entry.current {
        return Some(entry.clone());
    }
    let user_edits: Vec<LineEdit> = compute(&entry.current, disk)
        .into_iter()
        .map(|hunk| LineEdit { start: hunk.base_start, delete: hunk.base_lines.len(), lines: hunk.current_lines })
        .collect();
    let baseline = transfer(&entry.current, &entry.baseline, &user_edits)?;
    Some(EditEntry { baseline, current: disk.to_string(), revision: entry.revision + 1, ..entry.clone() })
}

/// An agent write as the log records it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileChange {
    pub path: PathBuf,
    /// The file before the write; `None` when it did not exist.
    pub previous: Option<String>,
    /// The file after the write; `None` when the agent deleted it.
    pub content: Option<String>,
}

/// Adds a write to a file's entry. The first write takes the file as it was as the baseline; later
/// writes build on it until reviewed. A change in between that cannot be rebased restarts review
/// from the text the agent overwrote; the flag says so.
pub fn record_write(existing: Option<&EditEntry>, path: &std::path::Path, previous: Option<&str>, content: &str, turn: Option<usize>) -> (Option<EditEntry>, bool) {
    let mut base = existing.cloned();
    let mut lost_review = false;
    if let Some(entry) = &base
        && previous != Some(entry.current.as_str())
    {
        let rebased = previous.and_then(|previous| rebase(entry, previous));
        lost_review = rebased.is_none();
        base = rebased;
    }
    let entry = match base {
        Some(base) => EditEntry { current: content.to_string(), revision: base.revision + 1, ..base },
        None => EditEntry {
            path: path.to_path_buf(),
            baseline: previous.unwrap_or_default().to_string(),
            current: content.to_string(),
            created: previous.is_none(),
            revision: existing.map_or(0, |entry| entry.revision) + 1,
            turn,
        },
    };
    let entry = (entry.baseline != entry.current).then_some(entry);
    (entry, lost_review)
}

pub fn count_lines(hunks: &[Hunk]) -> (usize, usize) {
    hunks.iter().fold((0, 0), |(added, removed), hunk| (added + hunk.current_lines.len(), removed + hunk.base_lines.len()))
}

/// One line of a hunk as the review shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviewLine {
    pub kind: LineKind,
    pub text: String,
    /// 1-based line in the baseline; `None` on added lines.
    pub old_line: Option<usize>,
    /// 1-based line in the current text; `None` on removed lines.
    pub new_line: Option<usize>,
}

/// A hunk's lines with up to `context` unchanged lines around it.
pub fn preview(current: &str, hunk: &Hunk, context: usize) -> Vec<PreviewLine> {
    let lines = split_lines(current);
    let mut preview = Vec::new();
    let context_line = |index: usize, shift: isize| PreviewLine {
        kind: LineKind::Context,
        text: lines[index].to_string(),
        old_line: Some((index as isize + shift + 1).max(1) as usize),
        new_line: Some(index + 1),
    };
    let before_shift = hunk.base_start as isize - hunk.current_start as isize;
    for index in hunk.current_start.saturating_sub(context)..hunk.current_start.min(lines.len()) {
        preview.push(context_line(index, before_shift));
    }
    preview.extend(hunk.base_lines.iter().enumerate().map(|(offset, text)| PreviewLine {
        kind: LineKind::Removed,
        text: text.clone(),
        old_line: Some(hunk.base_start + offset + 1),
        new_line: None,
    }));
    preview.extend(hunk.current_lines.iter().enumerate().map(|(offset, text)| PreviewLine {
        kind: LineKind::Added,
        text: text.clone(),
        old_line: None,
        new_line: Some(hunk.current_start + offset + 1),
    }));
    let after = hunk.current_start + hunk.current_lines.len();
    let after_shift = (hunk.base_start + hunk.base_lines.len()) as isize - after as isize;
    for index in after..(after + context).min(lines.len()) {
        preview.push(context_line(index, after_shift));
    }
    preview
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(baseline: &str, current: &str) -> EditEntry {
        EditEntry { path: "/p/a.rs".into(), baseline: baseline.into(), current: current.into(), created: false, revision: 1, turn: Some(0) }
    }

    #[test]
    fn hunks_cover_each_run_of_changed_lines() {
        let hunks = compute("a\nb\nc\nd\ne", "a\nB\nc\nd\ne\nf");
        assert_eq!(
            hunks,
            vec![
                Hunk { base_start: 1, base_lines: vec!["b".into()], current_start: 1, current_lines: vec!["B".into()] },
                Hunk { base_start: 5, base_lines: vec![], current_start: 5, current_lines: vec!["f".into()] },
            ]
        );
        assert_eq!(count_lines(&hunks), (2, 1));
        assert_eq!(hunks[0].line(), 2);
        assert!(compute("same", "same").is_empty());
        assert_eq!(compute("", "x\ny")[0].current_lines, ["x", "y"]);
    }

    #[test]
    fn keeping_and_rejecting_one_hunk_leaves_the_other() {
        let (base, current) = ("a\nb\nc\nd\ne", "a\nB\nc\nd\nE");
        let hunks = compute(base, current);
        let kept = keep(base, &hunks[0]).unwrap();
        assert_eq!(kept, "a\nB\nc\nd\ne");
        assert_eq!(compute(&kept, current).len(), 1);
        let rejected = reject(current, &hunks[1]).unwrap();
        assert_eq!(rejected, "a\nB\nc\nd\ne");
        assert_eq!(reject("totally different", &hunks[0]), None);
    }

    #[test]
    fn outside_edits_clear_of_the_agents_are_rebased() {
        let agent = entry("one\ntwo\nthree\nfour\nfive", "one\nTWO\nthree\nfour\nfive");
        let rebased = rebase(&agent, "zero\none\nTWO\nthree\nfour\nfive").unwrap();
        assert_eq!(rebased.baseline, "zero\none\ntwo\nthree\nfour\nfive");
        assert_eq!(compute(&rebased.baseline, &rebased.current).len(), 1);
        assert_eq!(rebase(&agent, "one\nTwo!\nthree\nfour\nfive"), None);
    }

    #[test]
    fn writes_build_on_the_first_baseline() {
        let path = std::path::Path::new("/p/a.rs");
        let (first, lost) = record_write(None, path, Some("a\nb"), "a\nB", Some(0));
        let first = first.unwrap();
        assert!(!lost && !first.created && first.baseline == "a\nb");
        let (second, _) = record_write(Some(&first), path, Some("a\nB"), "a\nB\nc", Some(2));
        let second = second.unwrap();
        assert_eq!((second.baseline.as_str(), second.current.as_str(), second.turn), ("a\nb", "a\nB\nc", Some(0)));
        let (reverted, _) = record_write(Some(&second), path, Some("a\nB\nc"), "a\nb", None);
        assert_eq!(reverted, None);
        let (created, _) = record_write(None, path, None, "new", None);
        assert!(created.unwrap().created);
    }

    #[test]
    fn previews_show_context_and_line_numbers() {
        let current = "a\nb\nC\nd\ne";
        let hunk = &compute("a\nb\nc\nd\ne", current)[0];
        let lines = preview(current, hunk, 1);
        let kinds: Vec<LineKind> = lines.iter().map(|line| line.kind).collect();
        assert_eq!(kinds, [LineKind::Context, LineKind::Removed, LineKind::Added, LineKind::Context]);
        assert_eq!((lines[1].old_line, lines[2].new_line, lines[3].old_line), (Some(3), Some(3), Some(4)));
    }
}
