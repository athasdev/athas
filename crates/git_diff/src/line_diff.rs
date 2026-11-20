//! A small line diff for in-memory files where libgit2 is not there (the web build): the common
//! start and end are skipped, the rest is matched by longest common subsequence, and the changes
//! are grouped into hunks with three lines of context, as `git diff` shows them.
#![cfg_attr(not(target_family = "wasm"), allow(dead_code))]

use std::sync::Arc;

use crate::model::{DiffLine, FileContent, FileDiff, FileStatus, Hunk, LineKind, MAX_LINES};

const CONTEXT: usize = 3;
/// Past this many cells (old lines × new lines left after the common start and end) the changed
/// middle reads as removed, then added, instead of being matched line by line.
const MAX_CELLS: usize = 4_000_000;
/// The most text kept to unfold the unchanged lines between hunks.
const MAX_TEXT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Equal(usize, usize),
    Delete(usize),
    Insert(usize),
}

fn ops(old: &[&str], new: &[&str]) -> Vec<Op> {
    let prefix = old.iter().zip(new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..].iter().rev().zip(new[prefix..].iter().rev()).take_while(|(a, b)| a == b).count();
    let (a, b) = (&old[prefix..old.len() - suffix], &new[prefix..new.len() - suffix]);
    let mut out: Vec<Op> = (0..prefix).map(|line| Op::Equal(line, line)).collect();
    let (mut i, mut j) = (0, 0);
    if !a.is_empty() && !b.is_empty() && a.len().saturating_mul(b.len()) <= MAX_CELLS {
        // `lengths[i * width + j]`: the longest common subsequence of `a[i..]` and `b[j..]`.
        let width = b.len() + 1;
        let mut lengths = vec![0u32; (a.len() + 1) * width];
        for i in (0..a.len()).rev() {
            for j in (0..b.len()).rev() {
                lengths[i * width + j] =
                    if a[i] == b[j] { lengths[(i + 1) * width + j + 1] + 1 } else { lengths[(i + 1) * width + j].max(lengths[i * width + j + 1]) };
            }
        }
        while i < a.len() && j < b.len() {
            if a[i] == b[j] {
                out.push(Op::Equal(prefix + i, prefix + j));
                i += 1;
                j += 1;
            } else if lengths[(i + 1) * width + j] >= lengths[i * width + j + 1] {
                out.push(Op::Delete(prefix + i));
                i += 1;
            } else {
                out.push(Op::Insert(prefix + j));
                j += 1;
            }
        }
    }
    out.extend((i..a.len()).map(|line| Op::Delete(prefix + line)));
    out.extend((j..b.len()).map(|line| Op::Insert(prefix + line)));
    out.extend((0..suffix).map(|line| Op::Equal(old.len() - suffix + line, new.len() - suffix + line)));
    out
}

/// `-12,3` or `-12` for a single line, as git writes a hunk's range.
fn range(start: usize, lines: usize) -> String {
    if lines == 1 { start.to_string() } else { format!("{start},{lines}") }
}

/// `old` against `new` as the text diff of `path`.
pub fn diff_texts(path: &str, old: &str, new: &str) -> FileDiff {
    let mut file = FileDiff {
        old_path: None,
        path: path.replace('\\', "/"),
        status: FileStatus::Modified,
        content: FileContent::Binary,
        additions: 0,
        deletions: 0,
        truncated: false,
    };
    if old.contains('\0') || new.contains('\0') {
        return file;
    }
    let (old_lines, new_lines): (Vec<&str>, Vec<&str>) = (old.lines().collect(), new.lines().collect());
    let ops = ops(&old_lines, &new_lines);
    let changes: Vec<usize> = ops.iter().enumerate().filter(|(_, op)| !matches!(op, Op::Equal(..))).map(|(index, _)| index).collect();

    // Changes closer than twice the context share a hunk.
    let mut groups: Vec<(usize, usize)> = Vec::new();
    for &index in &changes {
        let (start, end) = (index.saturating_sub(CONTEXT), (index + CONTEXT + 1).min(ops.len()));
        match groups.last_mut() {
            Some(last) if start <= last.1 => last.1 = end,
            _ => groups.push((start, end)),
        }
    }

    let mut budget = MAX_LINES;
    let mut hunks = Vec::new();
    'groups: for (start, end) in groups {
        let consumed = |ops: &[Op], old_side: bool| ops.iter().filter(|op| if old_side { !matches!(op, Op::Insert(_)) } else { !matches!(op, Op::Delete(_)) }).count();
        let (old_before, new_before) = (consumed(&ops[..start], true), consumed(&ops[..start], false));
        let mut lines = Vec::new();
        for op in &ops[start..end] {
            if budget == 0 {
                file.truncated = true;
                break 'groups;
            }
            budget -= 1;
            lines.push(match *op {
                Op::Equal(old, new) => DiffLine { kind: LineKind::Context, old: Some(old as u32 + 1), new: Some(new as u32 + 1), text: old_lines[old].to_string() },
                Op::Delete(old) => {
                    file.deletions += 1;
                    DiffLine { kind: LineKind::Removed, old: Some(old as u32 + 1), new: None, text: old_lines[old].to_string() }
                }
                Op::Insert(new) => {
                    file.additions += 1;
                    DiffLine { kind: LineKind::Added, old: None, new: Some(new as u32 + 1), text: new_lines[new].to_string() }
                }
            });
        }
        let (old_count, new_count) = (consumed(&ops[start..end], true), consumed(&ops[start..end], false));
        let old_start = if old_count == 0 { old_before } else { old_before + 1 };
        let new_start = if new_count == 0 { new_before } else { new_before + 1 };
        hunks.push(Hunk {
            header: format!("@@ -{} +{} @@", range(old_start, old_count), range(new_start, new_count)),
            old_start: old_start as u32,
            old_lines: old_count as u32,
            new_start: new_start as u32,
            new_lines: new_count as u32,
            lines,
        });
    }
    let keep = |text: &str, lines: &[&str]| (text.len() <= MAX_TEXT_BYTES).then(|| Arc::new(lines.iter().map(|line| line.to_string()).collect::<Vec<_>>()));
    file.content = FileContent::Text { hunks, old_text: keep(old, &old_lines), new_text: keep(new, &new_lines) };
    file
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(file: &FileDiff) -> Vec<(LineKind, Option<u32>, Option<u32>, String)> {
        file.hunks().iter().flat_map(|hunk| hunk.lines.iter().map(|line| (line.kind, line.old, line.new, line.text.clone()))).collect()
    }

    #[test]
    fn one_changed_line_with_context() {
        let old = "a\nb\nc\nd\ne\nf\ng\nh\n";
        let new = "a\nb\nc\nd\nE\nf\ng\nh\n";
        let file = diff_texts("x.txt", old, new);
        assert_eq!((file.additions, file.deletions), (1, 1));
        let hunk = &file.hunks()[0];
        assert_eq!(hunk.header, "@@ -2,7 +2,7 @@");
        let lines = kinds(&file);
        assert_eq!(lines[0], (LineKind::Context, Some(2), Some(2), "b".into()));
        assert_eq!(lines[3], (LineKind::Removed, Some(5), None, "e".into()));
        assert_eq!(lines[4], (LineKind::Added, None, Some(5), "E".into()));
        assert_eq!(lines.len(), 8);
    }

    #[test]
    fn far_apart_changes_get_their_own_hunks() {
        let old: String = (1..=30).map(|line| format!("{line}\n")).collect();
        let new: String = (1..=30).filter(|line| *line != 28).map(|line| if line == 2 { "two\n".to_string() } else { format!("{line}\n") }).collect();
        let file = diff_texts("x.txt", &old, &new);
        assert_eq!(file.hunks().len(), 2);
        assert_eq!(file.hunks()[0].header, "@@ -1,5 +1,5 @@");
        assert_eq!(file.hunks()[1].header, "@@ -25,6 +25,5 @@");
        assert_eq!((file.additions, file.deletions), (1, 2));
    }

    #[test]
    fn added_and_deleted_files() {
        let added = diff_texts("new.rs", "", "fn main() {}\n");
        assert_eq!(added.hunks()[0].header, "@@ -0,0 +1 @@");
        assert_eq!(added.additions, 1);
        let deleted = diff_texts("old.rs", "x\ny\n", "");
        assert_eq!(deleted.hunks()[0].header, "@@ -1,2 +0,0 @@");
        assert!(diff_texts("same.rs", "x\n", "x\n").hunks().is_empty());
        assert!(matches!(diff_texts("blob", "a\0b", "c").content, FileContent::Binary));
    }
}
