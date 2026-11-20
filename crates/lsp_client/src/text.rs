//! Positions and edits between LSP (lines and UTF-16 columns) and the editor's ropes (UTF-8 byte
//! offsets).

use std::ops::Range;

use lsp_types::{Position, TextEdit};
use ropey::Rope;

/// The LSP position of a byte offset.
pub fn offset_to_position(rope: &Rope, offset: usize) -> Position {
    let offset = offset.min(rope.len_bytes());
    let line = rope.byte_to_line(offset);
    let line_start = rope.line_to_char(line);
    let char_index = rope.byte_to_char(offset);
    let column = rope.char_to_utf16_cu(char_index) - rope.char_to_utf16_cu(line_start);
    Position::new(line as u32, column as u32)
}

/// The byte offset of an LSP position, clamped to the line and the text.
pub fn position_to_offset(rope: &Rope, position: Position) -> usize {
    let line = position.line as usize;
    if line >= rope.len_lines() {
        return rope.len_bytes();
    }
    let line_start = rope.line_to_char(line);
    let line_text = rope.line(line);
    // The column may not pass the end of the line (before its newline).
    let mut line_chars = line_text.len_chars();
    if line_chars > 0 && line_text.char(line_chars - 1) == '\n' {
        line_chars -= 1;
    }
    let first_unit = rope.char_to_utf16_cu(line_start);
    let units = (position.character as usize).min(rope.char_to_utf16_cu(line_start + line_chars) - first_unit);
    let char_index = rope.utf16_cu_to_char(first_unit + units).min(line_start + line_chars);
    rope.char_to_byte(char_index)
}

pub fn range_to_offsets(rope: &Rope, range: lsp_types::Range) -> Range<usize> {
    let start = position_to_offset(rope, range.start);
    let end = position_to_offset(rope, range.end).max(start);
    start..end
}

pub fn offsets_to_range(rope: &Rope, range: Range<usize>) -> lsp_types::Range {
    lsp_types::Range::new(offset_to_position(rope, range.start), offset_to_position(rope, range.end))
}

/// One incremental change, with its range in the text as it was before this change (changes of
/// a batch apply one after another, as `textDocument/didChange` sends them).
#[derive(Clone, Debug, PartialEq)]
pub struct TextChange {
    pub range: lsp_types::Range,
    pub text: String,
}

/// Byte-offset edits for LSP text edits, sorted by start. Edits of one response all refer to the
/// same text, so they are converted against it before any is applied.
pub fn text_edits_to_offsets(rope: &Rope, edits: &[TextEdit]) -> Vec<(Range<usize>, String)> {
    let mut converted: Vec<(Range<usize>, String)> =
        edits.iter().map(|edit| (range_to_offsets(rope, edit.range), edit.new_text.replace("\r\n", "\n"))).collect();
    // Stable, so inserts at the same position keep their order.
    converted.sort_by_key(|(range, _)| range.start);
    converted
}

/// Applies LSP text edits to a whole text (a file that is not open).
pub fn apply_text_edits(text: &str, edits: &[TextEdit]) -> String {
    let crlf = text.contains("\r\n");
    let mut rope = Rope::from_str(&text.replace("\r\n", "\n"));
    let converted = text_edits_to_offsets(&rope, edits);
    for (range, new_text) in converted.into_iter().rev() {
        let start = rope.byte_to_char(range.start);
        let end = rope.byte_to_char(range.end);
        rope.remove(start..end);
        rope.insert(start, &new_text);
    }
    let result = rope.to_string();
    if crlf { result.replace('\n', "\r\n") } else { result }
}

#[cfg(test)]
mod tests {
    use lsp_types::Range as LspRange;

    use super::*;

    #[test]
    fn positions_count_utf16_units() {
        let rope = Rope::from_str("a😀b\nxé\n");
        assert_eq!(offset_to_position(&rope, 5), Position::new(0, 3));
        assert_eq!(position_to_offset(&rope, Position::new(0, 3)), 5);
        assert_eq!(offset_to_position(&rope, 8), Position::new(1, 1));
        assert_eq!(position_to_offset(&rope, Position::new(1, 2)), 10);
        // Past the end of a line or the text clamps.
        assert_eq!(position_to_offset(&rope, Position::new(1, 40)), 10);
        assert_eq!(position_to_offset(&rope, Position::new(9, 0)), rope.len_bytes());
        assert_eq!(offset_to_position(&rope, 99), Position::new(2, 0));
    }

    #[test]
    fn applies_edits_against_the_original_text() {
        let edits = vec![
            TextEdit::new(LspRange::new(Position::new(1, 0), Position::new(1, 3)), "four".into()),
            TextEdit::new(LspRange::new(Position::new(0, 0), Position::new(0, 0)), "zero\n".into()),
            TextEdit::new(LspRange::new(Position::new(0, 3), Position::new(1, 0)), " ".into()),
        ];
        assert_eq!(apply_text_edits("one\ntwo\n", &edits), "zero\none four\n");
        assert_eq!(apply_text_edits("a\r\nb", &[TextEdit::new(LspRange::new(Position::new(1, 0), Position::new(1, 1)), "c".into())]), "a\r\nc");
    }
}
