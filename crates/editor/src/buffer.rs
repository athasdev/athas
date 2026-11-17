//! The text of a file: a rope with byte offsets, its line ending, and the edits applied to it.
//!
//! Offsets are UTF-8 byte offsets everywhere (as tree-sitter and GPUI's shaped lines use them).
//! The rope only holds `\n`; a CRLF file is normalised on load and written back with CRLF.

use std::{borrow::Cow, ops::Range};

use ropey::Rope;
use crate::syntax::{InputEdit, Point as TsPoint};
use unicode_segmentation::UnicodeSegmentation as _;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineEnding {
    Lf,
    CrLf,
}

impl LineEnding {
    pub fn as_str(self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::CrLf => "\r\n",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            LineEnding::Lf => "LF",
            LineEnding::CrLf => "CRLF",
        }
    }
}

/// A line and a byte column within it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Point {
    pub line: usize,
    pub column: usize,
}

/// A replacement of `range` (in the coordinates before any edit of the batch) with `text`.
pub type Edit = (Range<usize>, String);

/// Which side of an insertion at its position an offset stays on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bias {
    Left,
    Right,
}

/// Characters that make up a word for word motions and double-click.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CharClass {
    Whitespace,
    Newline,
    Word,
    Punctuation,
}

pub fn char_class(ch: char) -> CharClass {
    if ch == '\n' {
        CharClass::Newline
    } else if ch.is_whitespace() {
        CharClass::Whitespace
    } else if ch.is_alphanumeric() || ch == '_' || ch == '$' {
        CharClass::Word
    } else {
        CharClass::Punctuation
    }
}

pub fn is_word_char(ch: char) -> bool {
    char_class(ch) == CharClass::Word
}

/// An edit as it was applied, in the offsets of the text just before it (the edits of a batch
/// follow one another), for language servers and for things kept at offsets.
#[derive(Clone, Debug)]
pub struct AppliedEdit {
    pub range: Range<usize>,
    pub new_len: usize,
    pub lsp: lsp_client::TextChange,
}

/// Where `offset` lands after `edits`, applied in order.
pub fn map_through(offset: usize, edits: &[AppliedEdit], bias: Bias) -> usize {
    edits.iter().fold(offset, |offset, edit| {
        if offset < edit.range.start || (offset == edit.range.start && bias == Bias::Left) {
            offset
        } else if offset >= edit.range.end {
            offset + edit.new_len - edit.range.len()
        } else {
            match bias {
                Bias::Left => edit.range.start,
                Bias::Right => edit.range.start + edit.new_len,
            }
        }
    })
}

#[derive(Clone)]
pub struct Buffer {
    rope: Rope,
    line_ending: LineEnding,
    /// Bumped on every change; caches key on it.
    version: usize,
    /// Edits since the last `take_changes`, while recording (from the start).
    changes: Option<Vec<AppliedEdit>>,
}

impl Default for Buffer {
    fn default() -> Self {
        Self::new("")
    }
}

impl Buffer {
    pub fn new(text: &str) -> Self {
        let line_ending = detect_line_ending(text);
        let rope = if text.contains('\r') { Rope::from_str(&normalize_line_endings(text)) } else { Rope::from_str(text) };
        Self { rope, line_ending, version: 0, changes: Some(Vec::new()) }
    }

    pub fn rope(&self) -> &Rope {
        &self.rope
    }

    pub fn version(&self) -> usize {
        self.version
    }

    pub fn line_ending(&self) -> LineEnding {
        self.line_ending
    }

    /// Numbers this buffer after `previous`, the one it replaces: caches keyed by version (the
    /// longest line, wrap rows, folds) were filled from that one and must not match this one.
    pub fn follow_version(&mut self, previous: usize) {
        self.version = previous + 1;
    }

    /// Takes the line ending of `text`, a new version of the file read from disk.
    pub fn adopt_line_ending(&mut self, text: &str) {
        self.line_ending = detect_line_ending(text);
    }

    pub fn len(&self) -> usize {
        self.rope.len_bytes()
    }

    pub fn is_empty(&self) -> bool {
        self.rope.len_bytes() == 0
    }

    /// The text with `\n` line breaks.
    pub fn text(&self) -> String {
        self.rope.to_string()
    }

    /// The text as it is written to disk, with the file's own line ending.
    pub fn text_for_disk(&self) -> String {
        let text = self.rope.to_string();
        match self.line_ending {
            LineEnding::Lf => text,
            LineEnding::CrLf => text.replace('\n', "\r\n"),
        }
    }

    pub fn line_count(&self) -> usize {
        self.rope.len_lines()
    }

    /// Starts (or stops) keeping the edits for `take_changes`.
    pub fn record_changes(&mut self, record: bool) {
        self.changes = record.then(Vec::new);
    }

    pub fn take_changes(&mut self) -> Vec<AppliedEdit> {
        self.changes.as_mut().map(std::mem::take).unwrap_or_default()
    }

    pub fn line_start(&self, line: usize) -> usize {
        let line = line.min(self.line_count().saturating_sub(1));
        self.rope.line_to_byte(line)
    }

    /// The offset of the end of `line`, before its newline.
    pub fn line_end(&self, line: usize) -> usize {
        let line = line.min(self.line_count().saturating_sub(1));
        if line + 1 < self.line_count() { self.rope.line_to_byte(line + 1) - 1 } else { self.len() }
    }

    /// The text of `line` without its newline.
    pub fn line(&self, line: usize) -> Cow<'_, str> {
        let start = self.line_start(line);
        let end = self.line_end(line);
        self.rope.byte_slice(start..end).into()
    }

    pub fn slice(&self, range: Range<usize>) -> String {
        let range = self.clip(range.start)..self.clip(range.end);
        self.rope.byte_slice(range).to_string()
    }

    pub fn line_of(&self, offset: usize) -> usize {
        self.rope.byte_to_line(offset.min(self.len()))
    }

    pub fn offset_to_point(&self, offset: usize) -> Point {
        let offset = offset.min(self.len());
        let line = self.rope.byte_to_line(offset);
        Point { line, column: offset - self.rope.line_to_byte(line) }
    }

    /// Moves `offset` left onto a character boundary.
    pub fn clip(&self, offset: usize) -> usize {
        let offset = offset.min(self.len());
        let char_index = self.rope.byte_to_char(offset);
        self.rope.char_to_byte(char_index)
    }

    pub fn char_at(&self, offset: usize) -> Option<char> {
        if offset >= self.len() {
            return None;
        }
        self.rope.get_char(self.rope.byte_to_char(offset))
    }

    pub fn char_before(&self, offset: usize) -> Option<char> {
        if offset == 0 || offset > self.len() {
            return None;
        }
        let index = self.rope.byte_to_char(offset);
        if index == 0 { None } else { self.rope.get_char(index - 1) }
    }

    /// Characters from `offset` forward.
    pub fn chars_at(&self, offset: usize) -> impl Iterator<Item = char> + '_ {
        self.rope.chars_at(self.rope.byte_to_char(offset.min(self.len())))
    }

    /// Characters before `offset`, nearest first.
    pub fn reversed_chars_at(&self, offset: usize) -> impl Iterator<Item = char> + '_ {
        let mut chars = self.rope.chars_at(self.rope.byte_to_char(offset.min(self.len())));
        std::iter::from_fn(move || chars.prev())
    }

    /// The next grapheme boundary after `offset` (a newline is its own boundary).
    pub fn next_boundary(&self, offset: usize) -> usize {
        if offset >= self.len() {
            return self.len();
        }
        let point = self.offset_to_point(offset);
        let line = self.line(point.line);
        if point.column >= line.len() {
            return offset + 1;
        }
        let next = line[point.column..].graphemes(true).next().map(str::len).unwrap_or(1);
        offset + next
    }

    pub fn previous_boundary(&self, offset: usize) -> usize {
        if offset == 0 {
            return 0;
        }
        let point = self.offset_to_point(offset);
        if point.column == 0 {
            return offset - 1;
        }
        let line = self.line(point.line);
        let previous = line[..point.column].graphemes(true).next_back().map(str::len).unwrap_or(1);
        offset - previous
    }

    /// The word around `offset`, if a word character touches it.
    pub fn word_range_at(&self, offset: usize) -> Option<Range<usize>> {
        let after = self.char_at(offset).filter(|ch| is_word_char(*ch));
        let before = self.char_before(offset).filter(|ch| is_word_char(*ch));
        if after.is_none() && before.is_none() {
            return None;
        }
        let start = offset - self.reversed_chars_at(offset).take_while(|ch| is_word_char(*ch)).map(char::len_utf8).sum::<usize>();
        let end = offset + self.chars_at(offset).take_while(|ch| is_word_char(*ch)).map(char::len_utf8).sum::<usize>();
        Some(start..end)
    }

    /// The column of the first non-whitespace character of `line`.
    pub fn indent_len(&self, line: usize) -> usize {
        self.line(line).bytes().take_while(|byte| *byte == b' ' || *byte == b'\t').count()
    }

    pub fn is_blank_line(&self, line: usize) -> bool {
        self.line(line).trim().is_empty()
    }

    /// Applies `edits`, sorted by start and not overlapping, all in the current coordinates.
    /// Returns the tree-sitter edits in the order they were applied.
    pub fn apply(&mut self, edits: &[Edit]) -> Vec<InputEdit> {
        let mut input_edits = Vec::with_capacity(edits.len());
        // From the last to the first, so earlier offsets stay valid.
        for (range, text) in edits.iter().rev() {
            let start = self.clip(range.start);
            let end = self.clip(range.end.max(start));
            let start_position = self.ts_point(start);
            let old_end_position = self.ts_point(end);
            let start_char = self.rope.byte_to_char(start);
            let end_char = self.rope.byte_to_char(end);
            let lsp_range = self.changes.is_some().then(|| lsp_client::offsets_to_range(&self.rope, start..end));
            if end_char > start_char {
                self.rope.remove(start_char..end_char);
            }
            let text = if text.contains('\r') { Cow::Owned(normalize_line_endings(text)) } else { Cow::Borrowed(text.as_str()) };
            if !text.is_empty() {
                self.rope.insert(start_char, &text);
            }
            let new_end = start + text.len();
            if let (Some(changes), Some(range)) = (self.changes.as_mut(), lsp_range) {
                changes.push(AppliedEdit { range: start..end, new_len: text.len(), lsp: lsp_client::TextChange { range, text: text.to_string() } });
            }
            input_edits.push(InputEdit {
                start_byte: start,
                old_end_byte: end,
                new_end_byte: new_end,
                start_position,
                old_end_position,
                new_end_position: advance_point(start_position, &text),
            });
        }
        self.version += 1;
        input_edits
    }

    fn ts_point(&self, offset: usize) -> TsPoint {
        let point = self.offset_to_point(offset);
        TsPoint { row: point.line, column: point.column }
    }
}

fn advance_point(start: TsPoint, text: &str) -> TsPoint {
    match text.rfind('\n') {
        Some(last) => TsPoint { row: start.row + text.matches('\n').count(), column: text.len() - last - 1 },
        None => TsPoint { row: start.row, column: start.column + text.len() },
    }
}

fn detect_line_ending(text: &str) -> LineEnding {
    let sample = &text.as_bytes()[..text.len().min(64 * 1024)];
    let crlf = sample.windows(2).filter(|pair| pair == b"\r\n").count();
    let lf = sample.iter().filter(|byte| **byte == b'\n').count();
    if crlf > 0 && crlf * 2 >= lf { LineEnding::CrLf } else { LineEnding::Lf }
}

fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// Sorts `edits` and merges overlapping ones, so a batch can be applied at once.
pub fn normalize_edits(mut edits: Vec<Edit>) -> Vec<Edit> {
    edits.sort_by_key(|(range, _)| (range.start, range.end));
    let mut merged: Vec<Edit> = Vec::with_capacity(edits.len());
    for (range, text) in edits {
        if let Some((last, last_text)) = merged.last_mut()
            && range.start < last.end
        {
            last.end = last.end.max(range.end);
            last_text.push_str(&text);
            continue;
        }
        merged.push((range, text));
    }
    merged
}

/// Where `offset` lands after `edits` (sorted, in the old coordinates) are applied.
pub fn map_offset(offset: usize, edits: &[Edit], bias: Bias) -> usize {
    let mut delta: isize = 0;
    for (range, text) in edits {
        if range.start > offset {
            break;
        }
        let inserted = text.len() as isize;
        let removed = (range.end - range.start) as isize;
        if range.end < offset {
            delta += inserted - removed;
            continue;
        }
        // The offset is inside the edited range or touches it.
        let start = range.start as isize + delta;
        let after = (start + inserted) as usize;
        return match (offset == range.start, offset == range.end, bias) {
            (_, true, _) if range.end > range.start => after,
            (true, _, Bias::Left) => start as usize,
            (true, _, Bias::Right) => after,
            (_, _, Bias::Left) => start as usize,
            (_, _, Bias::Right) => after,
        };
    }
    (offset as isize + delta) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_and_points() {
        let buffer = Buffer::new("one\ntwo\n\nfour");
        assert_eq!(buffer.line_count(), 4);
        assert_eq!(buffer.line(1), "two");
        assert_eq!(buffer.line(2), "");
        assert_eq!(buffer.line_end(0), 3);
        assert_eq!(buffer.offset_to_point(5), Point { line: 1, column: 1 });
        assert_eq!(Buffer::new("a\n").line_count(), 2);
    }

    #[test]
    fn crlf_is_kept_for_disk() {
        let buffer = Buffer::new("a\r\nb\r\n");
        assert_eq!(buffer.line_ending(), LineEnding::CrLf);
        assert_eq!(buffer.text(), "a\nb\n");
        assert_eq!(buffer.text_for_disk(), "a\r\nb\r\n");
    }

    #[test]
    fn apply_batches_and_reports_tree_edits() {
        let mut buffer = Buffer::new("hello world");
        let edits = vec![(0..5, "goodbye".to_string()), (6..11, "moon\nrise".to_string())];
        let input = buffer.apply(&edits);
        assert_eq!(buffer.text(), "goodbye moon\nrise");
        assert_eq!(input.len(), 2);
        assert_eq!(input[0].new_end_position, TsPoint { row: 1, column: 4 });
    }

    #[test]
    fn graphemes_and_words() {
        let buffer = Buffer::new("e\u{301}x foo_bar.baz");
        assert_eq!(buffer.next_boundary(0), 3);
        assert_eq!(buffer.previous_boundary(3), 0);
        assert_eq!(buffer.word_range_at(7), Some(5..12));
        assert_eq!(buffer.word_range_at(4), Some(3..4));
        assert_eq!(Buffer::new("a  b").word_range_at(2), None);
    }

    #[test]
    fn records_changes_for_language_servers() {
        let mut buffer = Buffer::new("héllo\nworld");
        buffer.record_changes(true);
        buffer.apply(&[(1..3, "e".to_string()), (7..12, "there".to_string())]);
        let changes = buffer.take_changes();
        // Applied from the last edit to the first, each in the text before it.
        assert_eq!(changes.iter().map(|change| (change.range.clone(), change.new_len)).collect::<Vec<_>>(), vec![(7..12, 5), (1..3, 1)]);
        assert_eq!(changes[1].lsp.range, lsp_client::lsp::Range::new(lsp_client::lsp::Position::new(0, 1), lsp_client::lsp::Position::new(0, 2)));
        assert_eq!(changes[0].lsp.range.start, lsp_client::lsp::Position::new(1, 0));
        assert!(buffer.take_changes().is_empty());
        assert_eq!(map_through(9, &changes, Bias::Left), 6);
        assert_eq!(map_through(4, &changes, Bias::Right), 3);
        assert_eq!(map_through(2, &changes, Bias::Left), 1);
    }

    #[test]
    fn offsets_map_through_edits() {
        let edits = vec![(2..2, "xx".to_string()), (5..7, String::new())];
        assert_eq!(map_offset(1, &edits, Bias::Right), 1);
        assert_eq!(map_offset(2, &edits, Bias::Left), 2);
        assert_eq!(map_offset(2, &edits, Bias::Right), 4);
        assert_eq!(map_offset(6, &edits, Bias::Left), 7);
        assert_eq!(map_offset(9, &edits, Bias::Left), 9);
        let merged = normalize_edits(vec![(4..8, String::new()), (0..5, String::new())]);
        assert_eq!(merged, vec![(0..8, String::new())]);
    }
}
