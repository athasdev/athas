//! Line diffs for the edits tool calls show: the changed lines with a little context around them.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiffRow {
    Line { kind: LineKind, text: String },
    /// Unchanged lines left out between hunks.
    Skipped(usize),
}

const CONTEXT: usize = 3;
/// Beyond this many line pairs the diff is not worth computing; the new text shows as added.
const MAX_CELLS: usize = 4_000_000;

/// Diffs kept for redraws: tool calls are drawn every frame while the agent streams, and an
/// LCS over a large file costs tens of milliseconds each time.
const CACHED_DIFFS: usize = 128;

thread_local! {
    static DIFF_CACHE: std::cell::RefCell<(std::collections::HashMap<u64, std::rc::Rc<Vec<DiffRow>>>, std::collections::VecDeque<u64>)> = Default::default();
}

/// The rows that show how `old` became `new`. Computed once per pair of texts; later calls
/// with the same texts (every redraw) only hash them.
pub fn diff_rows(old: &str, new: &str) -> Vec<DiffRow> {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (old, new).hash(&mut hasher);
    let key = hasher.finish();
    if let Some(rows) = DIFF_CACHE.with(|cache| cache.borrow().0.get(&key).cloned()) {
        return (*rows).clone();
    }
    let rows = compute_rows(old, new);
    DIFF_CACHE.with(|cache| {
        let (map, order) = &mut *cache.borrow_mut();
        if map.insert(key, std::rc::Rc::new(rows.clone())).is_none() {
            order.push_back(key);
        }
        while order.len() > CACHED_DIFFS {
            if let Some(old) = order.pop_front() {
                map.remove(&old);
            }
        }
    });
    rows
}

fn compute_rows(old: &str, new: &str) -> Vec<DiffRow> {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    collapse_context(ops(&old_lines, &new_lines))
}

/// The edit script between two line lists, removals before the additions that replace them.
pub(crate) fn ops<'a>(old: &[&'a str], new: &[&'a str]) -> Vec<(LineKind, &'a str)> {
    if old.len().saturating_mul(new.len()) > MAX_CELLS {
        old.iter().map(|line| (LineKind::Removed, *line)).chain(new.iter().map(|line| (LineKind::Added, *line))).collect()
    } else {
        line_ops(old, new)
    }
}

/// The edit script between two line lists, from their longest common subsequence.
fn line_ops<'a>(old: &[&'a str], new: &[&'a str]) -> Vec<(LineKind, &'a str)> {
    // Common prefix and suffix need no table.
    let prefix = old.iter().zip(new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..].iter().rev().zip(new[prefix..].iter().rev()).take_while(|(a, b)| a == b).count();
    let old_mid = &old[prefix..old.len() - suffix];
    let new_mid = &new[prefix..new.len() - suffix];

    let (n, m) = (old_mid.len(), new_mid.len());
    let mut table = vec![0u32; (n + 1) * (m + 1)];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            table[i * (m + 1) + j] = if old_mid[i] == new_mid[j] {
                table[(i + 1) * (m + 1) + j + 1] + 1
            } else {
                table[(i + 1) * (m + 1) + j].max(table[i * (m + 1) + j + 1])
            };
        }
    }

    let mut ops: Vec<(LineKind, &str)> = old[..prefix].iter().map(|line| (LineKind::Context, *line)).collect();
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && old_mid[i] == new_mid[j] {
            ops.push((LineKind::Context, old_mid[i]));
            i += 1;
            j += 1;
        } else if j < m && (i == n || table[i * (m + 1) + j + 1] >= table[(i + 1) * (m + 1) + j]) {
            ops.push((LineKind::Added, new_mid[j]));
            j += 1;
        } else {
            ops.push((LineKind::Removed, old_mid[i]));
            i += 1;
        }
    }
    ops.extend(old[old.len() - suffix..].iter().map(|line| (LineKind::Context, *line)));
    // Show removals before the additions that replace them.
    let mut ordered = Vec::with_capacity(ops.len());
    let mut added = Vec::new();
    for op in ops {
        match op.0 {
            LineKind::Added => added.push(op),
            LineKind::Removed => ordered.push(op),
            LineKind::Context => {
                ordered.append(&mut added);
                ordered.push(op);
            }
        }
    }
    ordered.append(&mut added);
    ordered
}

fn collapse_context(ops: Vec<(LineKind, &str)>) -> Vec<DiffRow> {
    let changed: Vec<usize> = ops.iter().enumerate().filter(|(_, (kind, _))| *kind != LineKind::Context).map(|(index, _)| index).collect();
    let near_change = |index: usize| {
        let position = changed.partition_point(|&changed| changed < index);
        let after = changed.get(position).is_some_and(|&changed| changed - index <= CONTEXT);
        let before = position > 0 && index - changed[position - 1] <= CONTEXT;
        after || before
    };
    let mut rows = Vec::new();
    let mut skipped = 0;
    for (index, (kind, text)) in ops.into_iter().enumerate() {
        if kind == LineKind::Context && !near_change(index) {
            skipped += 1;
            continue;
        }
        if skipped > 0 {
            rows.push(DiffRow::Skipped(skipped));
            skipped = 0;
        }
        rows.push(DiffRow::Line { kind, text: text.to_string() });
    }
    if skipped > 0 && !rows.is_empty() {
        rows.push(DiffRow::Skipped(skipped));
    }
    rows
}

/// A diff row as the diff preview lays it out (`createAcpDiffViewNode`): a hunk header, or a
/// line with its numbers in the old and new text (1-based).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NumberedRow {
    /// `-old_start,old_count +new_start,new_count`.
    Header(String),
    Line { kind: LineKind, text: String, old: Option<usize>, new: Option<usize> },
}

/// `rows` with a header before each hunk and every line numbered.
pub fn numbered_rows(rows: &[DiffRow]) -> Vec<NumberedRow> {
    let mut numbered = Vec::new();
    let (mut old_line, mut new_line) = (1usize, 1usize);
    let mut index = 0;
    while index < rows.len() {
        match &rows[index] {
            DiffRow::Skipped(count) => {
                old_line += count;
                new_line += count;
                index += 1;
            }
            DiffRow::Line { .. } => {
                let end = rows[index..].iter().position(|row| matches!(row, DiffRow::Skipped(_))).map_or(rows.len(), |offset| index + offset);
                let hunk = &rows[index..end];
                let old_count = hunk.iter().filter(|row| matches!(row, DiffRow::Line { kind: LineKind::Context | LineKind::Removed, .. })).count();
                let new_count = hunk.iter().filter(|row| matches!(row, DiffRow::Line { kind: LineKind::Context | LineKind::Added, .. })).count();
                // An empty side starts before its first line, as unified diffs write it.
                let old_start = if old_count == 0 { old_line - 1 } else { old_line };
                let new_start = if new_count == 0 { new_line - 1 } else { new_line };
                numbered.push(NumberedRow::Header(format!("-{old_start},{old_count} +{new_start},{new_count}")));
                for row in hunk {
                    let DiffRow::Line { kind, text } = row else { continue };
                    let (old, new) = match kind {
                        LineKind::Context => (Some(old_line), Some(new_line)),
                        LineKind::Removed => (Some(old_line), None),
                        LineKind::Added => (None, Some(new_line)),
                    };
                    old_line += usize::from(old.is_some());
                    new_line += usize::from(new.is_some());
                    numbered.push(NumberedRow::Line { kind: *kind, text: text.clone(), old, new });
                }
                index = end;
            }
        }
    }
    numbered
}

/// Lines added and removed.
pub fn stats(rows: &[DiffRow]) -> (usize, usize) {
    rows.iter().fold((0, 0), |(added, removed), row| match row {
        DiffRow::Line { kind: LineKind::Added, .. } => (added + 1, removed),
        DiffRow::Line { kind: LineKind::Removed, .. } => (added, removed + 1),
        _ => (added, removed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(kind: LineKind, text: &str) -> DiffRow {
        DiffRow::Line { kind, text: text.into() }
    }

    #[test]
    fn shows_changes_with_context() {
        let old = "a\nb\nc\nd\ne\nf\ng\nh\ni\n";
        let new = "a\nb\nc\nd\nE\nf\ng\nh\ni\nj\n";
        let rows = diff_rows(old, new);
        assert_eq!(
            rows,
            vec![
                DiffRow::Skipped(1),
                line(LineKind::Context, "b"),
                line(LineKind::Context, "c"),
                line(LineKind::Context, "d"),
                line(LineKind::Removed, "e"),
                line(LineKind::Added, "E"),
                line(LineKind::Context, "f"),
                line(LineKind::Context, "g"),
                line(LineKind::Context, "h"),
                line(LineKind::Context, "i"),
                line(LineKind::Added, "j"),
            ]
        );
        assert_eq!(stats(&rows), (2, 1));
    }

    #[test]
    fn hunks_carry_headers_and_line_numbers() {
        let rows = diff_rows("a\nb\nc\nd\ne\nf\ng\nh\ni\n", "a\nb\nc\nd\nE\nf\ng\nh\ni\nj\n");
        let numbered = numbered_rows(&rows);
        assert_eq!(numbered[0], NumberedRow::Header("-2,8 +2,9".into()));
        assert_eq!(numbered[4], NumberedRow::Line { kind: LineKind::Removed, text: "e".into(), old: Some(5), new: None });
        assert_eq!(numbered[5], NumberedRow::Line { kind: LineKind::Added, text: "E".into(), old: None, new: Some(5) });
        assert_eq!(numbered.last(), Some(&NumberedRow::Line { kind: LineKind::Added, text: "j".into(), old: None, new: Some(10) }));
        assert_eq!(numbered_rows(&diff_rows("", "x")), vec![NumberedRow::Header("-0,0 +1,1".into()), NumberedRow::Line { kind: LineKind::Added, text: "x".into(), old: None, new: Some(1) }]);
        assert!(numbered_rows(&[]).is_empty());
    }

    #[test]
    fn a_new_file_is_all_added() {
        assert_eq!(diff_rows("", "x\ny"), vec![line(LineKind::Added, "x"), line(LineKind::Added, "y")]);
    }
}
