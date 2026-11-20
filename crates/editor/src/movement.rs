//! Cursor motions: by character, word, line, row and page.

use crate::{
    buffer::{Buffer, CharClass, char_class},
    display_map::{DisplayMap, DisplayPoint},
};

pub fn left(buffer: &Buffer, offset: usize) -> usize {
    buffer.previous_boundary(offset)
}

pub fn right(buffer: &Buffer, offset: usize) -> usize {
    buffer.next_boundary(offset)
}

/// The start of the word before `offset`: skips whitespace, then a run of one character class.
/// Stops at a line start, as most editors do.
pub fn previous_word_start(buffer: &Buffer, offset: usize) -> usize {
    let mut offset = offset;
    let mut chars = buffer.reversed_chars_at(offset).peekable();
    if chars.peek() == Some(&'\n') {
        return offset - 1;
    }
    while let Some(&ch) = chars.peek() {
        if char_class(ch) != CharClass::Whitespace {
            break;
        }
        offset -= ch.len_utf8();
        chars.next();
    }
    let Some(&first) = chars.peek() else { return offset };
    let class = char_class(first);
    if class == CharClass::Newline {
        return offset;
    }
    while let Some(&ch) = chars.peek() {
        if char_class(ch) != class {
            break;
        }
        offset -= ch.len_utf8();
        chars.next();
    }
    offset
}

/// The end of the word after `offset`.
pub fn next_word_end(buffer: &Buffer, offset: usize) -> usize {
    let mut offset = offset;
    let mut chars = buffer.chars_at(offset).peekable();
    if chars.peek() == Some(&'\n') {
        return offset + 1;
    }
    while let Some(&ch) = chars.peek() {
        if char_class(ch) != CharClass::Whitespace {
            break;
        }
        offset += ch.len_utf8();
        chars.next();
    }
    let Some(&first) = chars.peek() else { return offset };
    let class = char_class(first);
    if class == CharClass::Newline {
        return offset;
    }
    while let Some(&ch) = chars.peek() {
        if char_class(ch) != class {
            break;
        }
        offset += ch.len_utf8();
        chars.next();
    }
    offset
}

/// Home: the first non-blank character of the line, or the line start when already there.
pub fn smart_line_start(buffer: &Buffer, offset: usize) -> usize {
    let line = buffer.line_of(offset);
    let start = buffer.line_start(line);
    let indented = start + buffer.indent_len(line);
    if offset == indented { start } else { indented }
}

pub fn line_end(buffer: &Buffer, offset: usize) -> usize {
    buffer.line_end(buffer.line_of(offset))
}

/// Moves `rows` display rows up (negative) or down, keeping the goal column. Returns the new
/// offset and the goal to keep.
pub fn vertical(map: &DisplayMap, offset: usize, goal: Option<usize>, rows: isize) -> (usize, usize) {
    let point = map.to_display(offset);
    let goal = goal.unwrap_or(point.column);
    let target = point.row as isize + rows;
    if target < 0 {
        return (0, goal);
    }
    let last_row = map.row_count().saturating_sub(1);
    if target as usize > last_row {
        return (map.buffer.len(), goal);
    }
    let Some(target) = map.skip_blocks(target as usize, rows > 0) else {
        return (if rows > 0 { map.buffer.len() } else { 0 }, goal);
    };
    (map.from_display(DisplayPoint { row: target, column: goal }), goal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_motions() {
        let buffer = Buffer::new("let foo_bar = baz(1);\n  next");
        assert_eq!(next_word_end(&buffer, 0), 3);
        assert_eq!(next_word_end(&buffer, 3), 11);
        assert_eq!(next_word_end(&buffer, 11), 13);
        assert_eq!(previous_word_start(&buffer, 11), 4);
        assert_eq!(previous_word_start(&buffer, 4), 0);
        let line_end = buffer.line_end(0);
        assert_eq!(next_word_end(&buffer, line_end), line_end + 1);
        assert_eq!(previous_word_start(&buffer, line_end + 1), line_end);
        assert_eq!(previous_word_start(&buffer, line_end + 3), line_end + 1);
    }

    #[test]
    fn smart_home_toggles() {
        let buffer = Buffer::new("    indented");
        assert_eq!(smart_line_start(&buffer, 8), 4);
        assert_eq!(smart_line_start(&buffer, 4), 0);
        assert_eq!(smart_line_start(&buffer, 0), 4);
    }

    #[test]
    fn vertical_keeps_goal_column() {
        let buffer = Buffer::new("long line here\nab\nanother long line");
        let map = DisplayMap::new(&buffer, 4, None);
        let (offset, goal) = vertical(&map, 10, None, 1);
        assert_eq!(offset, buffer.line_end(1));
        let (offset, _) = vertical(&map, offset, Some(goal), 1);
        assert_eq!(offset, buffer.line_start(2) + 10);
        assert_eq!(vertical(&map, 3, None, -1).0, 0);
        assert_eq!(vertical(&map, buffer.line_start(2), None, 5).0, buffer.len());
    }
}
