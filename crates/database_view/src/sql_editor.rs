//! The query editor: a multi-line SQL text area with highlighting, selection, clipboard, undo and
//! IME, adapted from the shared single-line `TextInput`.

use std::ops::Range;

use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, ElementId, ElementInputHandler, Entity, EntityInputHandler,
    EventEmitter, FocusHandle, Focusable, GlobalElementId, Hsla, KeyBinding, LayoutId, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, PaintQuad, Pixels, Point, ScrollHandle, ShapedLine, SharedString, Style, TextRun,
    UTF16Selection, UnderlineStyle, Window, actions, div, fill, point, prelude::*, px, relative, size,
};
use theme::ActiveTheme;
use ui::typography;
use unicode_segmentation::UnicodeSegmentation as _;
use web_time::Instant;

actions!(
    sql_editor,
    [
        Backspace,
        Delete,
        DeleteWordLeft,
        DeleteToLineStart,
        Left,
        Right,
        Up,
        Down,
        WordLeft,
        WordRight,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        SelectWordLeft,
        SelectWordRight,
        SelectAll,
        LineStart,
        LineEnd,
        SelectLineStart,
        SelectLineEnd,
        DocumentStart,
        DocumentEnd,
        Newline,
        Indent,
        Paste,
        Cut,
        Copy,
        Undo,
        Redo,
        Run,
        ShowCharacterPalette,
    ]
);

const CONTEXT: &str = "SqlEditor";

pub fn bind_keys(cx: &mut App) {
    let context = Some(CONTEXT);
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, context),
        KeyBinding::new("shift-backspace", Backspace, context),
        KeyBinding::new("delete", Delete, context),
        KeyBinding::new("alt-backspace", DeleteWordLeft, context),
        KeyBinding::new("ctrl-backspace", DeleteWordLeft, context),
        KeyBinding::new("cmd-backspace", DeleteToLineStart, context),
        KeyBinding::new("left", Left, context),
        KeyBinding::new("right", Right, context),
        KeyBinding::new("up", Up, context),
        KeyBinding::new("down", Down, context),
        KeyBinding::new("alt-left", WordLeft, context),
        KeyBinding::new("alt-right", WordRight, context),
        KeyBinding::new("ctrl-left", WordLeft, context),
        KeyBinding::new("ctrl-right", WordRight, context),
        KeyBinding::new("shift-left", SelectLeft, context),
        KeyBinding::new("shift-right", SelectRight, context),
        KeyBinding::new("shift-up", SelectUp, context),
        KeyBinding::new("shift-down", SelectDown, context),
        KeyBinding::new("alt-shift-left", SelectWordLeft, context),
        KeyBinding::new("alt-shift-right", SelectWordRight, context),
        KeyBinding::new("cmd-a", SelectAll, context),
        KeyBinding::new("ctrl-a", SelectAll, context),
        KeyBinding::new("home", LineStart, context),
        KeyBinding::new("end", LineEnd, context),
        KeyBinding::new("cmd-left", LineStart, context),
        KeyBinding::new("cmd-right", LineEnd, context),
        KeyBinding::new("shift-home", SelectLineStart, context),
        KeyBinding::new("shift-end", SelectLineEnd, context),
        KeyBinding::new("cmd-shift-left", SelectLineStart, context),
        KeyBinding::new("cmd-shift-right", SelectLineEnd, context),
        KeyBinding::new("cmd-up", DocumentStart, context),
        KeyBinding::new("cmd-down", DocumentEnd, context),
        KeyBinding::new("ctrl-home", DocumentStart, context),
        KeyBinding::new("ctrl-end", DocumentEnd, context),
        KeyBinding::new("enter", Newline, context),
        KeyBinding::new("shift-enter", Newline, context),
        KeyBinding::new("tab", Indent, context),
        KeyBinding::new("cmd-v", Paste, context),
        KeyBinding::new("ctrl-v", Paste, context),
        KeyBinding::new("cmd-c", Copy, context),
        KeyBinding::new("ctrl-c", Copy, context),
        KeyBinding::new("cmd-x", Cut, context),
        KeyBinding::new("ctrl-x", Cut, context),
        KeyBinding::new("cmd-z", Undo, context),
        KeyBinding::new("ctrl-z", Undo, context),
        KeyBinding::new("cmd-shift-z", Redo, context),
        KeyBinding::new("ctrl-y", Redo, context),
        KeyBinding::new("cmd-enter", Run, context),
        KeyBinding::new("ctrl-enter", Run, context),
        KeyBinding::new("ctrl-cmd-space", ShowCharacterPalette, context),
    ]);
}

#[derive(Clone, Debug, PartialEq)]
pub enum SqlEditorEvent {
    /// Cmd-Enter: run the selection, or everything.
    Run(String),
    Edited,
}

#[derive(Clone)]
struct Snapshot {
    content: String,
    selection: Range<usize>,
}

pub struct SqlEditor {
    focus_handle: FocusHandle,
    content: String,
    placeholder: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    /// The x a run of up/down moves keeps to.
    goal_x: Option<Pixels>,
    last_layout: Vec<ShapedLine>,
    last_bounds: Option<Bounds<Pixels>>,
    line_height: Pixels,
    is_selecting: bool,
    scroll_handle: ScrollHandle,
    scroll_to_cursor: bool,
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
    last_edit: Option<Instant>,
    /// A plain field: no highlighting, and as tall as its text up to this many lines.
    field_lines: Option<usize>,
    /// Table and column names offered as completions (`sql-completions.ts`).
    completion_tables: Vec<String>,
    completion_columns: Vec<String>,
    focused: bool,
}

/// A word the query bar offers under the editor.
#[derive(Clone, Debug, PartialEq)]
pub struct SqlCompletion {
    pub value: String,
    /// `keyword`, `function`, `table` or `column`, as the original's tooltip.
    pub detail: &'static str,
}

/// The completions for the word at the caret: `range` is replaced by the one picked.
#[derive(Clone, Debug, PartialEq)]
pub struct SqlCompletions {
    pub range: Range<usize>,
    pub items: Vec<SqlCompletion>,
}

const COMPLETION_KEYWORDS: &[&str] = &[
    "SELECT", "FROM", "WHERE", "JOIN", "LEFT JOIN", "RIGHT JOIN", "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "INSERT INTO",
    "UPDATE", "DELETE FROM", "CREATE TABLE", "ALTER TABLE", "DROP TABLE", "INNER JOIN", "FULL JOIN", "UNION", "UNION ALL",
    "WITH", "OFFSET", "DISTINCT", "RETURNING", "OVER", "PARTITION BY", "BETWEEN", "LIKE", "ILIKE", "IS NULL", "IS NOT NULL",
    "EXISTS", "CASE WHEN", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES", "TRUE", "FALSE",
];

const COMPLETION_FUNCTIONS: &[&str] = &["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "LOWER", "ROW_NUMBER", "UPPER"];

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// Whether `cursor` sits in a string, quoted name or comment (`--`, `#`, `/* */`, `$$`), where
/// nothing is offered.
fn inside_string_or_comment(text: &str, cursor: usize) -> bool {
    let bytes = text.as_bytes();
    let cursor = cursor.min(bytes.len());
    let mut index = 0;
    let closing = |from: usize, quote: u8| {
        let mut end = from + 1;
        while end < bytes.len() {
            if bytes[end] == quote && bytes.get(end + 1) == Some(&quote) {
                end += 2;
                continue;
            }
            if bytes[end] == quote {
                return end + 1;
            }
            end += 1;
        }
        bytes.len()
    };
    while index < cursor {
        let rest = &text[index..];
        let end = if rest.starts_with("--") || rest.starts_with('#') {
            rest.find('\n').map_or(bytes.len(), |line| index + line)
        } else if rest.starts_with("/*") {
            rest[2..].find("*/").map_or(bytes.len(), |close| index + 2 + close + 2)
        } else if rest.starts_with('$') {
            let tag_len = rest[1..].find('$').filter(|len| rest[1..1 + len].bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_'));
            match tag_len {
                Some(len) if len == 0 || !rest.as_bytes()[1].is_ascii_digit() => {
                    let tag = &rest[..len + 2];
                    rest[tag.len()..].find(tag).map_or(bytes.len(), |close| index + tag.len() + close + tag.len())
                }
                _ => {
                    index += 1;
                    continue;
                }
            }
        } else if matches!(bytes[index], b'\'' | b'"' | b'`') {
            closing(index, bytes[index])
        } else {
            index += rest.chars().next().map_or(1, char::len_utf8);
            continue;
        };
        if cursor > index && cursor <= end {
            return true;
        }
        index = end.max(index + 1);
    }
    false
}

/// `getSqlCompletions`: keywords, functions, tables and columns starting with the word at
/// `cursor` (only columns after a `.`), at most eight.
pub fn sql_completions(text: &str, cursor: usize, tables: &[String], columns: &[String]) -> SqlCompletions {
    let bytes = text.as_bytes();
    let cursor = cursor.min(bytes.len());
    let mut start = cursor;
    while start > 0 && is_word_byte(bytes[start - 1]) {
        start -= 1;
    }
    let mut end = cursor;
    while end < bytes.len() && is_word_byte(bytes[end]) {
        end += 1;
    }
    let range = start..end;
    let prefix = text[start..cursor].to_lowercase();
    let member = start > 0 && bytes[start - 1] == b'.';
    if inside_string_or_comment(text, cursor) || (prefix.is_empty() && !member) {
        return SqlCompletions { range, items: Vec::new() };
    }
    let column = |name: &String| SqlCompletion { value: name.clone(), detail: "column" };
    let candidates: Vec<SqlCompletion> = if member {
        columns.iter().map(column).collect()
    } else {
        COMPLETION_KEYWORDS
            .iter()
            .map(|keyword| SqlCompletion { value: keyword.to_string(), detail: "keyword" })
            .chain(COMPLETION_FUNCTIONS.iter().map(|function| SqlCompletion { value: function.to_string(), detail: "function" }))
            .chain(tables.iter().map(|table| SqlCompletion { value: table.clone(), detail: "table" }))
            .chain(columns.iter().map(column))
            .collect()
    };
    let mut seen = std::collections::HashSet::new();
    let items = candidates
        .into_iter()
        .filter(|item| seen.insert((item.detail, item.value.to_lowercase())))
        .filter(|item| item.value.to_lowercase().starts_with(&prefix))
        .take(8)
        .collect();
    SqlCompletions { range, items }
}

impl EventEmitter<SqlEditorEvent> for SqlEditor {}

impl SqlEditor {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            content: String::new(),
            placeholder: SharedString::default(),
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            goal_x: None,
            last_layout: Vec::new(),
            last_bounds: None,
            line_height: px(18.),
            is_selecting: false,
            scroll_handle: ScrollHandle::new(),
            scroll_to_cursor: false,
            undo: Vec::new(),
            redo: Vec::new(),
            last_edit: None,
            field_lines: None,
            completion_tables: Vec::new(),
            completion_columns: Vec::new(),
            focused: false,
        }
    }

    /// The tables and columns completions may offer.
    pub fn set_completion_source(&mut self, tables: Vec<String>, columns: Vec<String>) {
        self.completion_tables = tables;
        self.completion_columns = columns;
    }

    /// What to offer for the word at the caret while the editor has focus.
    pub fn completions(&self) -> Option<SqlCompletions> {
        if !self.focused || self.field_lines.is_some() || self.marked_range.is_some() {
            return None;
        }
        let completions = sql_completions(&self.content, self.cursor_offset(), &self.completion_tables, &self.completion_columns);
        (!completions.items.is_empty()).then_some(completions)
    }

    /// `applySqlCompletion`: the word at the caret becomes the completion, the caret after it.
    pub fn apply_completion(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(completions) = self.completions() else { return };
        let Some(item) = completions.items.get(index) else { return };
        self.push_undo(false);
        self.content.replace_range(completions.range.clone(), &item.value);
        let end = completions.range.start + item.value.len();
        self.selected_range = end..end;
        self.selection_reversed = false;
        self.goal_x = None;
        self.scroll_to_cursor = true;
        window.focus(&self.focus_handle, cx);
        cx.emit(SqlEditorEvent::Edited);
        cx.notify();
    }

    /// A value field rather than a query: plain text, growing to `max_lines`.
    pub fn plain(mut self, max_lines: usize) -> Self {
        self.field_lines = Some(max_lines);
        self
    }

    pub fn clear_undo(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = placeholder.into();
        self
    }

    pub fn text(&self) -> &str {
        &self.content
    }

    /// The selected text, or all of it when nothing is selected.
    pub fn runnable_text(&self) -> String {
        if self.selected_range.is_empty() {
            self.content.clone()
        } else {
            self.content[self.selected_range.clone()].to_string()
        }
    }

    pub fn set_text(&mut self, text: impl Into<String>, cx: &mut Context<Self>) {
        self.push_undo(false);
        self.content = text.into();
        let end = self.content.len();
        self.selected_range = end..end;
        self.selection_reversed = false;
        self.marked_range = None;
        self.scroll_to_cursor = true;
        cx.notify();
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.focus_handle, cx);
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed { self.selected_range.start } else { self.selected_range.end }
    }

    fn line_starts(&self) -> Vec<usize> {
        line_starts(&self.content)
    }

    /// The row and the byte offset in it of `offset`.
    fn position(&self, offset: usize) -> (usize, usize) {
        let starts = self.line_starts();
        let row = starts.partition_point(|start| *start <= offset).saturating_sub(1);
        (row, offset - starts[row])
    }

    fn line_range(&self, row: usize) -> Range<usize> {
        let starts = self.line_starts();
        let start = starts[row];
        let end = starts.get(row + 1).map_or(self.content.len(), |next| next - 1);
        start..end
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.scroll_to_cursor = true;
        cx.notify();
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        if self.selection_reversed {
            self.selected_range.start = offset
        } else {
            self.selected_range.end = offset
        };
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        self.scroll_to_cursor = true;
        cx.notify();
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .rev()
            .find_map(|(index, _)| (index < offset).then_some(index))
            .unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(index, _)| (index > offset).then_some(index))
            .unwrap_or(self.content.len())
    }

    fn previous_word_start(&self, offset: usize) -> usize {
        self.content
            .unicode_word_indices()
            .rev()
            .find_map(|(index, _)| (index < offset).then_some(index))
            .unwrap_or(0)
    }

    fn next_word_end(&self, offset: usize) -> usize {
        self.content
            .unicode_word_indices()
            .find_map(|(index, word)| (index + word.len() > offset).then_some(index + word.len()))
            .unwrap_or(self.content.len())
    }

    /// The offset one row above or below the cursor, at the same x.
    fn vertical(&mut self, delta: isize) -> usize {
        let cursor = self.cursor_offset();
        let (row, column) = self.position(cursor);
        let rows = self.line_starts().len();
        let target = row as isize + delta;
        if target < 0 {
            return 0;
        }
        if target as usize >= rows {
            return self.content.len();
        }
        let target = target as usize;
        let x = self.goal_x.unwrap_or_else(|| {
            self.last_layout.get(row).map_or(px(0.), |line| line.x_for_index(column))
        });
        self.goal_x = Some(x);
        let range = self.line_range(target);
        let column = self
            .last_layout
            .get(target)
            .filter(|line| line.text.len() == range.len())
            .map_or(column.min(range.len()), |line| line.closest_index_for_x(x));
        range.start + column
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        if self.selected_range.is_empty() {
            self.move_to(self.previous_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.start, cx)
        }
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        if self.selected_range.is_empty() {
            self.move_to(self.next_boundary(self.selected_range.end), cx);
        } else {
            self.move_to(self.selected_range.end, cx)
        }
    }

    fn up(&mut self, _: &Up, _: &mut Window, cx: &mut Context<Self>) {
        let offset = self.vertical(-1);
        self.move_to(offset, cx);
    }

    fn down(&mut self, _: &Down, _: &mut Window, cx: &mut Context<Self>) {
        let offset = self.vertical(1);
        self.move_to(offset, cx);
    }

    fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        let offset = self.vertical(-1);
        self.select_to(offset, cx);
    }

    fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        let offset = self.vertical(1);
        self.select_to(offset, cx);
    }

    fn word_left(&mut self, _: &WordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.move_to(self.previous_word_start(self.cursor_offset()), cx);
    }

    fn word_right(&mut self, _: &WordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.move_to(self.next_word_end(self.cursor_offset()), cx);
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    fn select_word_left(&mut self, _: &SelectWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.select_to(self.previous_word_start(self.cursor_offset()), cx);
    }

    fn select_word_right(&mut self, _: &SelectWordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.select_to(self.next_word_end(self.cursor_offset()), cx);
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.selected_range = 0..self.content.len();
        self.selection_reversed = false;
        cx.notify();
    }

    fn line_start(&mut self, _: &LineStart, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        let (row, _) = self.position(self.cursor_offset());
        self.move_to(self.line_range(row).start, cx);
    }

    fn line_end(&mut self, _: &LineEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        let (row, _) = self.position(self.cursor_offset());
        self.move_to(self.line_range(row).end, cx);
    }

    fn select_line_start(&mut self, _: &SelectLineStart, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        let (row, _) = self.position(self.cursor_offset());
        self.select_to(self.line_range(row).start, cx);
    }

    fn select_line_end(&mut self, _: &SelectLineEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        let (row, _) = self.position(self.cursor_offset());
        self.select_to(self.line_range(row).end, cx);
    }

    fn document_start(&mut self, _: &DocumentStart, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.move_to(0, cx);
    }

    fn document_end(&mut self, _: &DocumentEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.move_to(self.content.len(), cx);
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let previous = self.previous_boundary(self.cursor_offset());
            if self.cursor_offset() == previous {
                return;
            }
            self.select_to(previous, cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let next = self.next_boundary(self.cursor_offset());
            if self.cursor_offset() == next {
                return;
            }
            self.select_to(next, cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    fn delete_word_left(&mut self, _: &DeleteWordLeft, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.previous_word_start(self.cursor_offset()), cx);
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    fn delete_to_line_start(&mut self, _: &DeleteToLineStart, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let (row, _) = self.position(self.cursor_offset());
            self.select_to(self.line_range(row).start, cx);
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    /// A new line that keeps the current line's indent.
    fn newline(&mut self, _: &Newline, window: &mut Window, cx: &mut Context<Self>) {
        let (row, _) = self.position(self.cursor_offset());
        let line = &self.content[self.line_range(row)];
        let indent: String = line.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
        self.replace_text_in_range(None, &format!("\n{indent}"), window, cx);
    }

    /// Tab takes the first completion when there is one, as the query bar does.
    fn indent(&mut self, _: &Indent, window: &mut Window, cx: &mut Context<Self>) {
        if self.completions().is_some() {
            self.apply_completion(0, window, cx);
            return;
        }
        self.replace_text_in_range(None, "  ", window, cx);
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.push_undo(false);
            self.replace_text_in_range(None, &text.replace("\r\n", "\n"), window, cx);
        }
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(self.content[self.selected_range.clone()].to_string()));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(self.content[self.selected_range.clone()].to_string()));
            self.push_undo(false);
            self.replace_text_in_range(None, "", window, cx)
        }
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot { content: self.content.clone(), selection: self.selected_range.clone() }
    }

    /// Records the text before an edit. Typing in a burst is one step.
    fn push_undo(&mut self, typing: bool) {
        let now = Instant::now();
        let coalesce = typing && self.last_edit.is_some_and(|last| now.duration_since(last).as_millis() < 800);
        self.last_edit = typing.then_some(now);
        if coalesce {
            return;
        }
        self.undo.push(self.snapshot());
        if self.undo.len() > 200 {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    fn restore(&mut self, snapshot: Snapshot, cx: &mut Context<Self>) {
        self.content = snapshot.content;
        self.selected_range = snapshot.selection.start.min(self.content.len())..snapshot.selection.end.min(self.content.len());
        self.selection_reversed = false;
        self.marked_range = None;
        self.last_edit = None;
        self.scroll_to_cursor = true;
        cx.emit(SqlEditorEvent::Edited);
        cx.notify();
    }

    fn undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(snapshot) = self.undo.pop() {
            self.redo.push(self.snapshot());
            self.restore(snapshot, cx);
        }
    }

    fn redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(snapshot) = self.redo.pop() {
            self.undo.push(self.snapshot());
            self.restore(snapshot, cx);
        }
    }

    fn run(&mut self, _: &Run, _: &mut Window, cx: &mut Context<Self>) {
        cx.emit(SqlEditorEvent::Run(self.runnable_text()));
    }

    fn show_character_palette(&mut self, _: &ShowCharacterPalette, window: &mut Window, _: &mut Context<Self>) {
        window.show_character_palette();
    }

    fn index_for_point(&self, position: Point<Pixels>) -> usize {
        let Some(bounds) = self.last_bounds else { return self.content.len() };
        if position.y < bounds.top() {
            return 0;
        }
        let row = ((position.y - bounds.top()) / self.line_height).floor() as usize;
        let starts = self.line_starts();
        if row >= starts.len() {
            return self.content.len();
        }
        let range = self.line_range(row);
        let column = self
            .last_layout
            .get(row)
            .filter(|line| line.text.len() == range.len())
            .map_or(0, |line| line.closest_index_for_x(position.x - bounds.left()));
        range.start + column
    }

    fn on_mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus_handle, cx);
        self.goal_x = None;
        let offset = self.index_for_point(event.position);
        if event.click_count == 2 {
            let start = self.previous_word_start(offset.min(self.content.len()).saturating_add(1).min(self.content.len()));
            let end = self.next_word_end(start);
            self.selected_range = start..end;
            self.selection_reversed = false;
            cx.notify();
            return;
        }
        if event.click_count >= 3 {
            let (row, _) = self.position(offset);
            self.selected_range = self.line_range(row);
            self.selection_reversed = false;
            cx.notify();
            return;
        }
        self.is_selecting = true;
        if event.modifiers.shift {
            self.select_to(offset, cx);
        } else {
            self.move_to(offset, cx)
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.is_selecting = false;
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.is_selecting {
            self.select_to(self.index_for_point(event.position), cx);
        }
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf8_offset = 0;
        let mut utf16_count = 0;
        for ch in self.content.chars() {
            if utf16_count >= offset {
                break;
            }
            utf16_count += ch.len_utf16();
            utf8_offset += ch.len_utf8();
        }
        utf8_offset
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let mut utf16_offset = 0;
        let mut utf8_count = 0;
        for ch in self.content.chars() {
            if utf8_count >= offset {
                break;
            }
            utf8_count += ch.len_utf8();
            utf16_offset += ch.len_utf16();
        }
        utf16_offset
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range_utf16: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(range_utf16.start)..self.offset_from_utf16(range_utf16.end)
    }

    /// Where `offset` is drawn, relative to the text's origin.
    fn point_for_offset(&self, offset: usize) -> Point<Pixels> {
        let (row, column) = self.position(offset);
        let x = self.last_layout.get(row).map_or(px(0.), |line| line.x_for_index(column));
        point(x, self.line_height * row as f32)
    }
}

impl EntityInputHandler for SqlEditor {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range_utf16);
        actual_range.replace(self.range_to_utf16(&range));
        Some(self.content[range].to_string())
    }

    fn selected_text_range(&mut self, _: bool, _: &mut Window, _: &mut Context<Self>) -> Option<UTF16Selection> {
        Some(UTF16Selection { range: self.range_to_utf16(&self.selected_range), reversed: self.selection_reversed })
    }

    fn set_selected_text_range(&mut self, range_utf16: Range<usize>, _: &mut Window, cx: &mut Context<Self>) {
        self.selected_range = self.range_from_utf16(&range_utf16);
        self.selection_reversed = false;
        cx.notify();
    }

    fn text_length_utf16(&mut self, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        Some(self.content.encode_utf16().count())
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked_range.as_ref().map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.marked_range = None;
        cx.notify();
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        let typing = range.is_empty() && new_text.chars().count() == 1 && !new_text.contains('\n');
        self.push_undo(typing);
        self.content.replace_range(range.clone(), new_text);
        let end = range.start + new_text.len();
        self.selected_range = end..end;
        self.selection_reversed = false;
        self.marked_range = None;
        self.goal_x = None;
        self.scroll_to_cursor = true;
        cx.emit(SqlEditorEvent::Edited);
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        self.content.replace_range(range.clone(), new_text);
        self.marked_range = (!new_text.is_empty()).then(|| range.start..range.start + new_text.len());
        let insertion_start_utf16 = self.offset_to_utf16(range.start);
        let inserted_length_utf16 = new_text.encode_utf16().count();
        self.selected_range = new_selected_range_utf16
            .map(|selected| {
                self.range_from_utf16(
                    &(insertion_start_utf16 + selected.start.min(inserted_length_utf16)
                        ..insertion_start_utf16 + selected.end.min(inserted_length_utf16)),
                )
            })
            .unwrap_or_else(|| range.start + new_text.len()..range.start + new_text.len());
        self.selection_reversed = false;
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.range_from_utf16(&range_utf16);
        let start = self.point_for_offset(range.start);
        let end = self.point_for_offset(range.end);
        Some(Bounds::from_corners(
            bounds.origin + start,
            bounds.origin + point(end.x, end.y + self.line_height),
        ))
    }

    fn character_index_for_point(&mut self, point: Point<Pixels>, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        Some(self.offset_to_utf16(self.index_for_point(point)))
    }
}

pub fn line_starts(text: &str) -> Vec<usize> {
    std::iter::once(0).chain(text.match_indices('\n').map(|(ix, _)| ix + 1)).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Token {
    Keyword,
    String,
    Number,
    Comment,
    Identifier,
    Function,
    Operator,
}

const KEYWORDS: &[&str] = &[
    "add", "all", "alter", "analyze", "and", "as", "asc", "attach", "autoincrement", "begin", "between", "by", "case",
    "cascade", "cast", "check", "collate", "column", "commit", "constraint", "create", "cross", "current_date",
    "current_time", "current_timestamp", "database", "default", "delete", "desc", "describe", "detach", "distinct",
    "drop", "else", "end", "escape", "except", "exists", "explain", "false", "foreign", "from", "full", "glob",
    "group", "having", "if", "ignore", "in", "index", "inner", "insert", "intersect", "into", "is", "join", "key",
    "left", "like", "limit", "not", "null", "offset", "on", "or", "order", "outer", "over", "partition", "pragma",
    "primary", "references", "rename", "replace", "returning", "right", "rollback", "schema", "select", "set", "show",
    "table", "temp", "temporary", "then", "to", "transaction", "trigger", "true", "union", "unique", "update",
    "using", "vacuum", "values", "view", "when", "where", "window", "with", "without", "integer", "int", "text",
    "real", "blob", "numeric", "varchar", "char", "boolean", "bigint", "smallint", "date", "timestamp", "float",
    "double", "decimal", "serial", "json", "jsonb", "uuid",
];

/// Splits one line into highlighted spans. `in_comment` carries a `/* … */` across lines; the
/// returned flag says whether the line ends inside one.
pub fn highlight_line(line: &str, mut in_comment: bool) -> (Vec<(Range<usize>, Token)>, bool) {
    let bytes = line.as_bytes();
    let mut spans = Vec::new();
    let mut ix = 0;
    while ix < bytes.len() {
        if in_comment {
            let start = ix;
            match line[ix..].find("*/") {
                Some(end) => {
                    ix += end + 2;
                    in_comment = false;
                }
                None => ix = bytes.len(),
            }
            spans.push((start..ix, Token::Comment));
            continue;
        }
        let c = bytes[ix];
        let start = ix;
        if c == b'-' && bytes.get(ix + 1) == Some(&b'-') || c == b'#' {
            spans.push((ix..bytes.len(), Token::Comment));
            break;
        }
        if c == b'/' && bytes.get(ix + 1) == Some(&b'*') {
            in_comment = true;
            continue;
        }
        if c == b'\'' || c == b'"' || c == b'`' {
            ix += 1;
            while ix < bytes.len() {
                if bytes[ix] == c {
                    if bytes.get(ix + 1) == Some(&c) {
                        ix += 2;
                        continue;
                    }
                    ix += 1;
                    break;
                }
                ix += 1;
            }
            spans.push((start..ix, if c == b'\'' { Token::String } else { Token::Identifier }));
            continue;
        }
        if c.is_ascii_digit() {
            while ix < bytes.len() && (bytes[ix].is_ascii_alphanumeric() || bytes[ix] == b'.') {
                ix += 1;
            }
            spans.push((start..ix, Token::Number));
            continue;
        }
        if c.is_ascii_alphabetic() || c == b'_' {
            while ix < bytes.len() && (bytes[ix].is_ascii_alphanumeric() || bytes[ix] == b'_') {
                ix += 1;
            }
            let word = line[start..ix].to_ascii_lowercase();
            if KEYWORDS.contains(&word.as_str()) {
                spans.push((start..ix, Token::Keyword));
            } else if bytes.get(ix) == Some(&b'(') {
                spans.push((start..ix, Token::Function));
            }
            continue;
        }
        if b"=<>!+-*/%|".contains(&c) {
            spans.push((ix..ix + 1, Token::Operator));
        }
        ix += line[ix..].chars().next().map_or(1, char::len_utf8);
    }
    (spans, in_comment)
}

fn token_color(token: Token, cx: &App) -> Hsla {
    let theme = cx.theme();
    let key = match token {
        Token::Keyword => "keyword",
        Token::String => "string",
        Token::Number => "number",
        Token::Comment => "comment",
        Token::Identifier => "property",
        Token::Function => "function",
        Token::Operator => "operator",
    };
    theme.colors.syntax.get(key).copied().unwrap_or(theme.colors.foreground)
}

struct EditorElement {
    editor: Entity<SqlEditor>,
}

struct Layout {
    lines: Vec<ShapedLine>,
    line_height: Pixels,
}

struct Prepaint {
    selections: Vec<PaintQuad>,
    cursor: Option<PaintQuad>,
}

impl Element for EditorElement {
    type RequestLayoutState = Layout;
    type PrepaintState = Prepaint;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let editor = self.editor.read(cx);
        let style = window.text_style();
        let font_size = style.font_size.to_pixels(window.rem_size());
        let line_height = window.line_height();
        let placeholder = editor.content.is_empty();
        let highlight = editor.field_lines.is_none();
        let text = if placeholder { editor.placeholder.to_string() } else { editor.content.clone() };
        let marked = editor.marked_range.clone();
        let subtle = cx.theme().colors.subtle_foreground;

        let mut lines = Vec::new();
        let mut in_comment = false;
        let mut line_start = 0;
        for line in text.split('\n') {
            let base = TextRun {
                len: 0,
                font: style.font(),
                color: if placeholder { subtle } else { style.color },
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            let mut runs = Vec::new();
            if placeholder || !highlight {
                runs.push(TextRun { len: line.len(), ..base.clone() });
                if let Some(marked) = marked.as_ref().filter(|_| !placeholder) {
                    runs = underline_marked(runs, line_start, marked);
                }
            } else {
                let (spans, still_in_comment) = highlight_line(line, in_comment);
                in_comment = still_in_comment;
                let mut cursor = 0;
                for (range, token) in spans {
                    if range.start > cursor {
                        runs.push(TextRun { len: range.start - cursor, ..base.clone() });
                    }
                    runs.push(TextRun { len: range.len(), color: token_color(token, cx), ..base.clone() });
                    cursor = range.end;
                }
                if cursor < line.len() {
                    runs.push(TextRun { len: line.len() - cursor, ..base.clone() });
                }
                if let Some(marked) = marked.as_ref() {
                    runs = underline_marked(runs, line_start, marked);
                }
            }
            let runs: Vec<TextRun> = runs.into_iter().filter(|run| run.len > 0).collect();
            lines.push(window.text_system().shape_line(SharedString::from(line.to_string()), font_size, &runs, None));
            line_start += line.len() + 1;
        }

        let width = lines.iter().map(|line| line.width).fold(px(0.), Pixels::max) + px(8.);
        let mut layout_style = Style::default();
        layout_style.size.width = width.into();
        layout_style.min_size.width = relative(1.).into();
        layout_style.size.height = (line_height * lines.len() as f32).into();
        (window.request_layout(layout_style, [], cx), Layout { lines, line_height })
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let colors = cx.theme().colors.clone();
        let editor = self.editor.read(cx);
        let line_height = layout.line_height;
        let starts = editor.line_starts();
        let placeholder = editor.content.is_empty();
        let selection = editor.selected_range.clone();
        let x_at = |row: usize, column: usize| {
            if placeholder { px(0.) } else { layout.lines.get(row).map_or(px(0.), |line| line.x_for_index(column)) }
        };
        let position = |offset: usize| {
            let row = starts.partition_point(|start| *start <= offset).saturating_sub(1);
            (row, offset - starts[row])
        };

        let mut selections = Vec::new();
        if !selection.is_empty() {
            let (first, first_column) = position(selection.start);
            let (last, last_column) = position(selection.end);
            for row in first..=last {
                let start_x = if row == first { x_at(row, first_column) } else { px(0.) };
                let end_x = if row == last {
                    x_at(row, last_column)
                } else {
                    layout.lines.get(row).map_or(px(0.), |line| line.width) + px(6.)
                };
                let top = bounds.top() + line_height * row as f32;
                selections.push(fill(
                    Bounds::from_corners(point(bounds.left() + start_x, top), point(bounds.left() + end_x, top + line_height)),
                    colors.selection,
                ));
            }
        }
        let (row, column) = position(editor.cursor_offset());
        let cursor_origin = point(bounds.left() + x_at(row, column), bounds.top() + line_height * row as f32);
        let cursor = selection.is_empty().then(|| fill(Bounds::new(cursor_origin, size(px(1.5), line_height)), colors.cursor));

        if editor.scroll_to_cursor {
            let scroll = editor.scroll_handle.clone();
            let viewport = scroll.bounds();
            let mut offset = scroll.offset();
            let padding = px(8.);
            if cursor_origin.y < viewport.top() {
                offset.y += viewport.top() - cursor_origin.y;
            } else if cursor_origin.y + line_height > viewport.bottom() {
                offset.y -= cursor_origin.y + line_height - viewport.bottom();
            }
            if cursor_origin.x < viewport.left() + padding {
                offset.x = (offset.x + viewport.left() + padding - cursor_origin.x).min(px(0.));
            } else if cursor_origin.x > viewport.right() - padding {
                offset.x -= cursor_origin.x - (viewport.right() - padding);
            }
            if offset != scroll.offset() {
                scroll.set_offset(offset);
                window.refresh();
            }
            self.editor.update(cx, |editor, _| editor.scroll_to_cursor = false);
        }
        Prepaint { selections, cursor }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus_handle = self.editor.read(cx).focus_handle.clone();
        window.handle_input(&focus_handle, ElementInputHandler::new(bounds, self.editor.clone()), cx);
        for selection in prepaint.selections.drain(..) {
            window.paint_quad(selection);
        }
        for (row, line) in layout.lines.iter().enumerate() {
            let origin = point(bounds.left(), bounds.top() + layout.line_height * row as f32);
            line.paint(origin, layout.line_height, gpui::TextAlign::Left, None, window, cx).ok();
        }
        if focus_handle.is_focused(window)
            && let Some(cursor) = prepaint.cursor.take()
        {
            window.paint_quad(cursor);
        }
        let placeholder = self.editor.read(cx).content.is_empty();
        let lines = std::mem::take(&mut layout.lines);
        let line_height = layout.line_height;
        self.editor.update(cx, |editor, _| {
            editor.last_layout = if placeholder { Vec::new() } else { lines };
            editor.last_bounds = Some(bounds);
            editor.line_height = line_height;
        });
    }
}

/// Underlines the IME's marked text within one line's runs.
fn underline_marked(runs: Vec<TextRun>, line_start: usize, marked: &Range<usize>) -> Vec<TextRun> {
    let mut out = Vec::new();
    let mut offset = line_start;
    for run in runs {
        let run_range = offset..offset + run.len;
        offset += run.len;
        let start = marked.start.clamp(run_range.start, run_range.end);
        let end = marked.end.clamp(run_range.start, run_range.end);
        if start >= end {
            out.push(run);
            continue;
        }
        let underline = Some(UnderlineStyle { color: Some(run.color), thickness: px(1.), wavy: false });
        out.push(TextRun { len: start - run_range.start, ..run.clone() });
        out.push(TextRun { len: end - start, underline, ..run.clone() });
        out.push(TextRun { len: run_range.end - end, ..run });
    }
    out
}

impl Render for SqlEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Completions show only while the editor has focus (the original hides them on blur).
        let focused = self.focus_handle.is_focused(window);
        if focused != self.focused {
            self.focused = focused;
            cx.notify();
        }
        let colors = &cx.theme().colors;
        let field_height = self.field_lines.map(|max_lines| {
            let lines = self.content.matches('\n').count() + 1;
            px(18.) * lines.clamp(1, max_lines) as f32 + px(10.)
        });
        div()
            .id("sql-editor")
            .key_context(CONTEXT)
            .track_focus(&self.focus_handle)
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::delete_word_left))
            .on_action(cx.listener(Self::delete_to_line_start))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::up))
            .on_action(cx.listener(Self::down))
            .on_action(cx.listener(Self::word_left))
            .on_action(cx.listener(Self::word_right))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_up))
            .on_action(cx.listener(Self::select_down))
            .on_action(cx.listener(Self::select_word_left))
            .on_action(cx.listener(Self::select_word_right))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::line_start))
            .on_action(cx.listener(Self::line_end))
            .on_action(cx.listener(Self::select_line_start))
            .on_action(cx.listener(Self::select_line_end))
            .on_action(cx.listener(Self::document_start))
            .on_action(cx.listener(Self::document_end))
            .on_action(cx.listener(Self::newline))
            .on_action(cx.listener(Self::indent))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::undo))
            .on_action(cx.listener(Self::redo))
            .on_action(cx.listener(Self::run))
            .on_action(cx.listener(Self::show_character_palette))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .w_full()
            .when_some(field_height, |this, height| this.h(height).px(px(10.)).py(px(5.)))
            .when(field_height.is_none(), |this| this.size_full().px(px(12.)).py(px(8.)))
            .overflow_scroll()
            .track_scroll(&self.scroll_handle)
            .font_family(typography::MONO_FONT)
            .text_size(typography::TEXT_SM)
            .line_height(px(18.))
            .text_color(colors.foreground)
            .child(EditorElement { editor: cx.entity() })
    }
}

impl Focusable for SqlEditor {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

#[cfg(test)]
mod completion_tests {
    use super::*;

    fn values(completions: &SqlCompletions) -> Vec<&str> {
        completions.items.iter().map(|item| item.value.as_str()).collect()
    }

    #[test]
    fn offers_keywords_functions_tables_and_columns_by_prefix() {
        let tables = vec!["users".to_string(), "uploads".to_string()];
        let columns = vec!["updated_at".to_string(), "id".to_string()];
        let text = "SELECT * FROM u";
        let completions = sql_completions(text, text.len(), &tables, &columns);
        assert_eq!(values(&completions), ["UPDATE", "UNION", "UNION ALL", "UPPER", "users", "uploads", "updated_at"]);
        assert_eq!(completions.range, 14..15);
        let member = "SELECT users.";
        assert_eq!(values(&sql_completions(member, member.len(), &tables, &columns)), ["updated_at", "id"]);
        assert!(sql_completions("SELECT ", 7, &tables, &columns).items.is_empty(), "nothing without a prefix");
    }

    #[test]
    fn nothing_inside_strings_or_comments() {
        let tables = vec!["users".to_string()];
        for text in ["SELECT 'us", "-- us", "/* us", "SELECT \"us", "SELECT $$ us"] {
            assert!(sql_completions(text, text.len(), &tables, &[]).items.is_empty(), "{text}");
        }
        let closed = "SELECT 'a' FROM us";
        assert_eq!(values(&sql_completions(closed, closed.len(), &tables, &[])), ["users"]);
    }
}
