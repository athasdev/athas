//! Buffer offsets to display rows and columns: tabs expand to the tab size, and with soft wrap a
//! line spans several rows. Columns count characters (the editor font is monospace), so wrapping
//! never needs to shape text and stays cheap for long files.

use std::ops::Range;

use crate::buffer::Buffer;

/// A row on screen and a column (in character cells, tabs expanded) within it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct DisplayPoint {
    pub row: usize,
    pub column: usize,
}

/// Rows without text between lines: code lenses above a line, the references peek below one.
/// Each list holds (line, rows), sorted by line.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Blocks {
    pub above: Vec<(usize, usize)>,
    pub below: Vec<(usize, usize)>,
}

impl Blocks {
    pub fn is_empty(&self) -> bool {
        self.above.is_empty() && self.below.is_empty()
    }

    fn rows(list: &[(usize, usize)], line: usize) -> usize {
        list.binary_search_by_key(&line, |(line, _)| *line).map(|index| list[index].1).unwrap_or(0)
    }
}

/// What a display row shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowKind {
    /// The `sub_row`th row of the line's text.
    Text { line: usize, sub_row: usize },
    /// The `index`th row of the block above the line.
    Above { line: usize, index: usize },
    /// The `index`th row of the block below the line.
    Below { line: usize, index: usize },
}

/// The first display row of every line, when soft wrap is on, lines are folded away, or blocks
/// sit between lines. A folded line takes no rows.
#[derive(Clone, Debug)]
pub struct WrapIndex {
    pub version: usize,
    /// The row width in columns; `None` when only folds need the index.
    pub columns: Option<usize>,
    pub tab_size: usize,
    /// The fold set the index was built for.
    pub fold_generation: usize,
    /// `row_starts[line]` is the line's first row; the last entry is the row count.
    row_starts: Vec<u32>,
    /// Hidden line ranges (inclusive), sorted and disjoint; the line before each is its header.
    hidden: Vec<(usize, usize)>,
    pub blocks: Blocks,
}

impl WrapIndex {
    #[cfg(test)]
    pub fn build(buffer: &Buffer, columns: Option<usize>, tab_size: usize, hidden: &[(usize, usize)], fold_generation: usize) -> Self {
        Self::build_with_blocks(buffer, columns, tab_size, hidden, fold_generation, Blocks::default())
    }

    pub fn build_with_blocks(buffer: &Buffer, columns: Option<usize>, tab_size: usize, hidden: &[(usize, usize)], fold_generation: usize, blocks: Blocks) -> Self {
        let mut row_starts = Vec::with_capacity(buffer.line_count() + 1);
        let mut row = 0u32;
        let mut folds = hidden.iter().peekable();
        for (line, text) in buffer.rope().lines().enumerate() {
            row_starts.push(row);
            while folds.peek().is_some_and(|(_, end)| *end < line) {
                folds.next();
            }
            if folds.peek().is_some_and(|(start, end)| (*start..=*end).contains(&line)) {
                continue;
            }
            let rows = match columns {
                None => 1,
                Some(columns) => {
                    let len = text.len_bytes();
                    if len <= columns && !text.chars().any(|ch| ch == '\t') {
                        1
                    } else {
                        let text: String = text.chars().filter(|ch| *ch != '\n').collect();
                        wrap_boundaries(&text, columns, tab_size).len()
                    }
                }
            };
            row += (rows + Blocks::rows(&blocks.above, line) + Blocks::rows(&blocks.below, line)) as u32;
        }
        row_starts.push(row);
        Self { version: buffer.version(), columns, tab_size, fold_generation, row_starts, hidden: hidden.to_vec(), blocks }
    }

    /// The hidden range `line` is in.
    fn hidden_range(&self, line: usize) -> Option<(usize, usize)> {
        let index = self.hidden.partition_point(|(_, end)| *end < line);
        self.hidden.get(index).copied().filter(|(start, _)| *start <= line)
    }
}

pub struct DisplayMap<'a> {
    pub buffer: &'a Buffer,
    pub tab_size: usize,
    pub wrap: Option<&'a WrapIndex>,
}

impl<'a> DisplayMap<'a> {
    pub fn new(buffer: &'a Buffer, tab_size: usize, wrap: Option<&'a WrapIndex>) -> Self {
        let wrap = wrap.filter(|wrap| wrap.version == buffer.version() && wrap.tab_size == tab_size);
        Self { buffer, tab_size: tab_size.max(1), wrap }
    }

    pub fn row_count(&self) -> usize {
        match self.wrap {
            Some(wrap) => *wrap.row_starts.last().unwrap_or(&1) as usize,
            None => self.buffer.line_count(),
        }
    }

    /// The first row of `line`, or of the block above it.
    pub fn first_row_of_line(&self, line: usize) -> usize {
        match self.wrap {
            Some(wrap) => wrap.row_starts.get(self.visible_line(line)).copied().unwrap_or(0) as usize,
            None => line,
        }
    }

    /// The rows of the block above `line`.
    pub fn above(&self, line: usize) -> usize {
        self.wrap.map(|wrap| Blocks::rows(&wrap.blocks.above, line)).unwrap_or(0)
    }

    /// The rows of the block below `line`.
    pub fn below(&self, line: usize) -> usize {
        self.wrap.map(|wrap| Blocks::rows(&wrap.blocks.below, line)).unwrap_or(0)
    }

    /// The first row of `line`'s text.
    pub fn text_row_of_line(&self, line: usize) -> usize {
        let line = self.visible_line(line);
        self.first_row_of_line(line) + self.above(line)
    }

    /// What `row` shows.
    pub fn row_kind(&self, row: usize) -> RowKind {
        let Some(wrap) = self.wrap else {
            return RowKind::Text { line: row.min(self.buffer.line_count().saturating_sub(1)), sub_row: 0 };
        };
        let lines = wrap.row_starts.len() - 1;
        let line = self.visible_line(wrap.row_starts[..lines].partition_point(|start| *start as usize <= row).saturating_sub(1));
        let offset = row.saturating_sub(wrap.row_starts[line] as usize);
        let above = self.above(line);
        if offset < above {
            return RowKind::Above { line, index: offset };
        }
        let text_rows = (wrap.row_starts[line + 1] as usize - wrap.row_starts[line] as usize).saturating_sub(above + self.below(line));
        if offset - above < text_rows.max(1) {
            RowKind::Text { line, sub_row: offset - above }
        } else {
            RowKind::Below { line, index: offset - above - text_rows }
        }
    }

    /// Whether `row` is part of a block.
    pub fn is_block_row(&self, row: usize) -> bool {
        !matches!(self.row_kind(row), RowKind::Text { .. })
    }

    /// The nearest text row from `row` on, stepping down (or up).
    pub fn skip_blocks(&self, mut row: usize, down: bool) -> Option<usize> {
        let count = self.row_count();
        while row < count && self.is_block_row(row) {
            if down {
                row += 1;
            } else {
                row = row.checked_sub(1)?;
            }
        }
        (row < count).then_some(row)
    }

    /// `line`, or the header of the fold hiding it.
    pub fn visible_line(&self, line: usize) -> usize {
        match self.wrap.and_then(|wrap| wrap.hidden_range(line)) {
            Some((start, _)) => start.saturating_sub(1),
            None => line,
        }
    }

    /// The line drawn after `line`, skipping a fold that `line` heads.
    pub fn next_line(&self, line: usize) -> usize {
        match self.wrap.and_then(|wrap| wrap.hidden_range(line + 1)) {
            Some((_, end)) => end + 1,
            None => line + 1,
        }
    }

    /// The line a row belongs to, and which of the line's text rows it is (a block row counts as
    /// the text row next to it).
    pub fn row_to_line(&self, row: usize) -> (usize, usize) {
        match self.row_kind(row) {
            RowKind::Text { line, sub_row } => (line, sub_row),
            RowKind::Above { line, .. } => (line, 0),
            RowKind::Below { line, .. } => {
                let text_rows = self.line_segments(&self.buffer.line(line)).len();
                (line, text_rows - 1)
            }
        }
    }

    /// The byte ranges, within the line's text, of the rows `line` is drawn on.
    pub fn line_segments(&self, text: &str) -> Vec<Range<usize>> {
        match self.wrap.and_then(|wrap| wrap.columns) {
            Some(columns) => {
                let starts = wrap_boundaries(text, columns, self.tab_size);
                let mut segments = Vec::with_capacity(starts.len());
                for (index, start) in starts.iter().enumerate() {
                    let end = starts.get(index + 1).copied().unwrap_or(text.len());
                    segments.push(*start..end);
                }
                segments
            }
            None => vec![0..text.len()],
        }
    }

    pub fn to_display(&self, offset: usize) -> DisplayPoint {
        let mut point = self.buffer.offset_to_point(offset);
        let visible = self.visible_line(point.line);
        if visible != point.line {
            point = crate::buffer::Point { line: visible, column: self.buffer.line_end(visible) - self.buffer.line_start(visible) };
        }
        let text = self.buffer.line(point.line);
        let segments = self.line_segments(&text);
        let last = segments.len() - 1;
        let sub_row = segments.iter().position(|segment| point.column < segment.end).unwrap_or(last).min(last);
        let segment = &segments[sub_row];
        let column = display_column(&text[segment.start..], point.column - segment.start, self.tab_size);
        DisplayPoint { row: self.text_row_of_line(point.line) + sub_row, column }
    }

    /// The offset nearest to a display point; a column past the row's end clips to it.
    pub fn from_display(&self, point: DisplayPoint) -> usize {
        let row = point.row.min(self.row_count().saturating_sub(1));
        let (line, sub_row) = self.row_to_line(row);
        let text = self.buffer.line(line);
        let segments = self.line_segments(&text);
        let segment = segments.get(sub_row).cloned().unwrap_or(0..text.len());
        let mut byte = segment.start + byte_for_column(&text[segment.clone()], point.column, self.tab_size);
        // The end of a wrapped row is the start of the next one; stay on this row.
        if sub_row + 1 < segments.len() && byte >= segment.end {
            byte = text[..segment.end].char_indices().next_back().map(|(index, _)| index).unwrap_or(segment.start);
        }
        self.buffer.line_start(line) + byte
    }
}

/// The display column of byte `index` in `text`, with tabs expanded.
pub fn display_column(text: &str, index: usize, tab_size: usize) -> usize {
    let mut column = 0;
    for (byte, ch) in text.char_indices() {
        if byte >= index {
            break;
        }
        column = advance_column(column, ch, tab_size);
    }
    column
}

/// The byte in `text` at display column `column`, rounding to the nearer side of a tab.
pub fn byte_for_column(text: &str, target: usize, tab_size: usize) -> usize {
    let mut column = 0;
    for (byte, ch) in text.char_indices() {
        let next = advance_column(column, ch, tab_size);
        if next > target {
            return if target - column > (next - column) / 2 { byte + ch.len_utf8() } else { byte };
        }
        column = next;
    }
    text.len()
}

fn advance_column(column: usize, ch: char, tab_size: usize) -> usize {
    if ch == '\t' { (column / tab_size + 1) * tab_size } else { column + 1 }
}

/// `text` with its tabs replaced by spaces, and for each byte of `text` its byte in the result
/// (one extra entry maps the end).
pub fn expand_tabs(text: &str, tab_size: usize) -> (String, Option<Vec<usize>>) {
    if !text.contains('\t') {
        return (text.to_string(), None);
    }
    let mut expanded = String::with_capacity(text.len() + 16);
    let mut map = Vec::with_capacity(text.len() + 1);
    let mut column = 0;
    for ch in text.chars() {
        for _ in 0..ch.len_utf8() {
            map.push(expanded.len());
        }
        if ch == '\t' {
            let next = advance_column(column, ch, tab_size);
            expanded.extend(std::iter::repeat_n(' ', next - column));
            column = next;
        } else {
            expanded.push(ch);
            column += 1;
        }
    }
    map.push(expanded.len());
    (expanded, Some(map))
}

/// Where each row of a wrapped line starts (the first is always 0). Breaks after whitespace when
/// the row has some, otherwise mid-word.
pub fn wrap_boundaries(text: &str, columns: usize, tab_size: usize) -> Vec<usize> {
    let columns = columns.max(8);
    let mut starts = vec![0];
    let mut column = 0;
    let mut row_start = 0;
    let mut last_break: Option<usize> = None;
    let mut chars = text.char_indices().peekable();
    while let Some((byte, ch)) = chars.next() {
        let next = advance_column(column, ch, tab_size);
        if next > columns && byte > row_start {
            let start = match last_break {
                Some(after_space) if after_space > row_start => after_space,
                _ => byte,
            };
            starts.push(start);
            row_start = start;
            last_break = None;
            column = display_column(&text[start..], byte - start, tab_size);
            column = advance_column(column, ch, tab_size);
        } else {
            column = next;
        }
        if ch.is_whitespace() {
            last_break = Some(byte + ch.len_utf8());
        }
    }
    starts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabs_expand_to_stops() {
        assert_eq!(display_column("\tab", 1, 4), 4);
        assert_eq!(display_column("a\tb", 2, 4), 4);
        assert_eq!(byte_for_column("\tab", 4, 4), 1);
        assert_eq!(byte_for_column("\tab", 1, 4), 0);
        assert_eq!(byte_for_column("\tab", 3, 4), 1);
        let (text, map) = expand_tabs("a\tb", 4);
        assert_eq!(text, "a   b");
        assert_eq!(map.unwrap(), vec![0, 1, 4, 5]);
    }

    #[test]
    fn wraps_at_word_boundaries() {
        let starts = wrap_boundaries("hello world again", 10, 4);
        assert_eq!(starts, vec![0, 6, 12]);
        let starts = wrap_boundaries("abcdefghijklmnopqrstuvwxyz", 10, 4);
        assert_eq!(starts, vec![0, 10, 20]);
    }

    #[test]
    fn display_points_round_trip_with_wrap() {
        let buffer = Buffer::new("short\nhello world again\nend");
        let wrap = WrapIndex::build(&buffer, Some(10), 4, &[], 0);
        let map = DisplayMap::new(&buffer, 4, Some(&wrap));
        assert_eq!(map.row_count(), 5);
        assert_eq!(map.row_to_line(3), (1, 2));
        let offset = buffer.line_start(1) + 8; // "r" in "world"
        let point = map.to_display(offset);
        assert_eq!(point, DisplayPoint { row: 2, column: 2 });
        assert_eq!(map.from_display(point), offset);
        // A column past the end of a wrapped row stays on that row.
        let end = map.from_display(DisplayPoint { row: 1, column: 40 });
        assert_eq!(map.to_display(end).row, 1);
    }

    #[test]
    fn blocks_take_rows_between_lines() {
        let buffer = Buffer::new("zero\none\ntwo\nthree");
        let blocks = Blocks { above: vec![(1, 1)], below: vec![(2, 3)] };
        let index = WrapIndex::build_with_blocks(&buffer, None, 4, &[], 0, blocks);
        let map = DisplayMap::new(&buffer, 4, Some(&index));
        assert_eq!(map.row_count(), 8);
        assert_eq!(map.row_kind(0), RowKind::Text { line: 0, sub_row: 0 });
        assert_eq!(map.row_kind(1), RowKind::Above { line: 1, index: 0 });
        assert_eq!(map.row_kind(2), RowKind::Text { line: 1, sub_row: 0 });
        assert_eq!(map.row_kind(3), RowKind::Text { line: 2, sub_row: 0 });
        assert_eq!(map.row_kind(5), RowKind::Below { line: 2, index: 1 });
        assert_eq!(map.row_kind(7), RowKind::Text { line: 3, sub_row: 0 });
        assert_eq!(map.to_display(buffer.line_start(1)).row, 2);
        assert_eq!(map.to_display(buffer.line_start(3) + 2), DisplayPoint { row: 7, column: 2 });
        // Moving down steps over the blocks.
        assert_eq!(crate::movement::vertical(&map, 2, None, 1).0, buffer.line_start(1) + 2);
        assert_eq!(crate::movement::vertical(&map, buffer.line_start(2) + 1, None, 1).0, buffer.line_start(3) + 1);
        assert_eq!(crate::movement::vertical(&map, buffer.line_start(3), None, -1).0, buffer.line_start(2));
    }

    #[test]
    fn folded_lines_take_no_rows() {
        let buffer = Buffer::new("fn a() {\n    one\n    two\n}\nlast");
        let index = WrapIndex::build(&buffer, None, 4, &[(1, 2)], 1);
        let map = DisplayMap::new(&buffer, 4, Some(&index));
        assert_eq!(map.row_count(), 3);
        assert_eq!(map.row_to_line(0), (0, 0));
        assert_eq!(map.row_to_line(1), (3, 0));
        assert_eq!(map.row_to_line(2), (4, 0));
        assert_eq!(map.next_line(0), 3);
        assert_eq!(map.visible_line(2), 0);
        // A caret inside the fold shows at the end of its header.
        assert_eq!(map.to_display(buffer.line_start(2) + 2), DisplayPoint { row: 0, column: 8 });
        // Moving down from the header skips the hidden lines.
        assert_eq!(crate::movement::vertical(&map, 2, None, 1).0, buffer.line_end(3));
        let index = WrapIndex::build(&buffer, None, 4, &[(1, 4)], 1);
        let map = DisplayMap::new(&buffer, 4, Some(&index));
        assert_eq!(map.row_count(), 1);
        assert_eq!(map.row_to_line(0), (0, 0));
    }
}
