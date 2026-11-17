//! Text selected across the diff's lines with the mouse, as the original's code editor surface
//! lets it be (`git-diff-editor-surface.tsx`): one side of a split diff at a time, copied as
//! the lines' text.

use std::ops::Range;

use crate::model::{Cell, Row};

/// A place in the diff's text: a row and a byte offset in that row's cell.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TextPoint {
    pub row: usize,
    pub offset: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextSelection {
    /// 0 for the left or only side, 1 for the right of a split row.
    pub side: u8,
    pub anchor: TextPoint,
    pub head: TextPoint,
    /// Whether the mouse is still down.
    pub selecting: bool,
}

impl TextSelection {
    pub fn at(side: u8, point: TextPoint) -> Self {
        Self { side, anchor: point, head: point, selecting: true }
    }

    fn ordered(&self) -> (TextPoint, TextPoint) {
        if self.anchor <= self.head { (self.anchor, self.head) } else { (self.head, self.anchor) }
    }

    pub fn is_empty(&self) -> bool {
        self.anchor == self.head
    }

    /// The bytes selected in the cell of `row` on `side`, `len` long.
    pub fn range_in(&self, row: usize, side: u8, len: usize) -> Option<Range<usize>> {
        if side != self.side || self.is_empty() {
            return None;
        }
        let (start, end) = self.ordered();
        if row < start.row || row > end.row {
            return None;
        }
        let from = if row == start.row { start.offset.min(len) } else { 0 };
        let to = if row == end.row { end.offset.min(len) } else { len };
        (from < to).then_some(from..to)
    }
}

/// The cell of a row on a side, when that row shows code there.
pub fn cell_at(rows: &[Row], row: usize, side: u8) -> Option<&Cell> {
    match rows.get(row)? {
        Row::Line { cell, .. } if side == 0 => Some(cell),
        Row::Split { left, .. } if side == 0 => left.as_ref(),
        Row::Split { right, .. } if side == 1 => right.as_ref(),
        _ => None,
    }
}

fn line(cell: &Cell) -> &str {
    cell.text.strip_suffix('\r').unwrap_or(&cell.text)
}

/// The selected lines' text, one line per row; rows without code on that side are skipped.
pub fn selected_text(rows: &[Row], selection: &TextSelection) -> String {
    let (start, end) = selection.ordered();
    let mut lines: Vec<&str> = Vec::new();
    for row in start.row..=end.row.min(rows.len().saturating_sub(1)) {
        let Some(cell) = cell_at(rows, row, selection.side) else { continue };
        let text = line(cell);
        if let Some(range) = selection.range_in(row, selection.side, text.len()) {
            lines.push(&text[floor_char(text, range.start)..floor_char(text, range.end)]);
        } else if row > start.row && row < end.row {
            lines.push("");
        }
    }
    lines.join("\n")
}

/// Every line on the left (or only) side.
pub fn select_all(rows: &[Row]) -> Option<TextSelection> {
    let first = (0..rows.len()).find(|row| cell_at(rows, *row, 0).is_some())?;
    let last = (0..rows.len()).rev().find(|row| cell_at(rows, *row, 0).is_some())?;
    let len = cell_at(rows, last, 0).map_or(0, |cell| line(cell).len());
    Some(TextSelection { side: 0, anchor: TextPoint { row: first, offset: 0 }, head: TextPoint { row: last, offset: len }, selecting: false })
}

fn floor_char(text: &str, mut offset: usize) -> usize {
    offset = offset.min(text.len());
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

/// The byte in `raw` that a byte of its drawn text stands for: tabs draw four columns, and with
/// whitespace shown a space draws as `·`.
pub fn raw_offset(raw: &str, drawn: usize, show_whitespace: bool) -> usize {
    let mut width = 0;
    for (index, ch) in raw.char_indices() {
        let drawn_len = match ch {
            '\t' if show_whitespace => "→   ".len(),
            '\t' => 4,
            ' ' if show_whitespace => '·'.len_utf8(),
            _ => ch.len_utf8(),
        };
        if drawn < width + drawn_len {
            return if drawn - width > drawn_len / 2 && drawn_len > 1 && ch == '\t' { index + 1 } else { index };
        }
        width += drawn_len;
    }
    raw.len()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::model::LineKind;

    fn cell(text: &str) -> Cell {
        Cell { kind: LineKind::Context, old: Some(1), new: Some(1), text: Arc::from(text), words: Vec::new() }
    }

    #[test]
    fn selections_copy_the_lines_they_cover() {
        let rows = vec![
            Row::Line { file: 0, cell: cell("fn main() {"), hunk: Some(0) },
            Row::Line { file: 0, cell: cell("    let a = 1;"), hunk: Some(0) },
            Row::Line { file: 0, cell: cell("}"), hunk: Some(0) },
        ];
        let mut selection = TextSelection::at(0, TextPoint { row: 2, offset: 1 });
        selection.head = TextPoint { row: 0, offset: 3 };
        assert_eq!(selected_text(&rows, &selection), "main() {\n    let a = 1;\n}");
        assert_eq!(selection.range_in(1, 0, 14), Some(0..14));
        assert_eq!(selection.range_in(1, 1, 14), None);
        assert_eq!(selected_text(&rows, &select_all(&rows).unwrap()), "fn main() {\n    let a = 1;\n}");
    }

    #[test]
    fn drawn_offsets_map_back_to_the_text() {
        assert_eq!(raw_offset("\tx", 4, false), 1);
        assert_eq!(raw_offset("\tx", 1, false), 0);
        assert_eq!(raw_offset("a b", 2, false), 2);
        assert_eq!(raw_offset("a b", 3, true), 2);
        assert_eq!(raw_offset("ab", 9, false), 2);
    }
}
