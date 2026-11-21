//! A multi-line text field (`ui/textarea.tsx`): wrapping, selection, clipboard, IME and
//! grapheme-aware movement. Return breaks the line; Cmd-Return submits.
//!
//! Adapted from the agent composer, which reads keys itself (no key bindings) so a keymap reload
//! cannot unbind it.

use std::{ops::Range, rc::Rc};

use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, ElementId, ElementInputHandler, Entity, EntityInputHandler,
    EventEmitter, FocusHandle, Focusable, GlobalElementId, KeyDownEvent, LayoutId, MouseButton, MouseDownEvent,
    HighlightStyle, MouseMoveEvent, MouseUpEvent, PaintQuad, Pixels, Point, SharedString, Style, TextRun, UTF16Selection,
    UnderlineStyle, Window, WrappedLine, div, fill, point, prelude::*, px, relative, size,
};
use theme::ActiveTheme;
use unicode_segmentation::UnicodeSegmentation as _;

use crate::{metrics, typography};

#[derive(Clone, Debug, PartialEq)]
pub enum TextAreaEvent {
    Changed,
    /// Cmd-Return (Ctrl-Return elsewhere).
    Submit,
    /// Escape.
    Cancelled,
}

/// How the field is drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextAreaVariant {
    /// Raised, with the focus ring.
    #[default]
    Default,
    /// No box: inside something that draws one, such as an input group.
    Ghost,
}

pub const LINE_HEIGHT: Pixels = px(18.);

/// Styles spans of the text as it is typed: weight, slant, colour, background, strikethrough.
/// Sizes stay the field's, so every line keeps its height.
/// How much larger than the body a line's text is drawn, such as a Markdown heading.
pub type TextAreaLineScale = Rc<dyn Fn(&str) -> f32>;

pub type TextAreaHighlighter = Rc<dyn Fn(&str, &App) -> Vec<(Range<usize>, HighlightStyle)>>;

pub struct TextArea {
    focus_handle: FocusHandle,
    content: String,
    placeholder: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    /// The column a run of Up and Down presses keeps to.
    goal_x: Option<Pixels>,
    layout: Option<TextLayout>,
    is_selecting: bool,
    /// Lines scrolled off the top when the text is taller than the box.
    scroll_lines: usize,
    /// Set when the wheel scrolled the text: the cursor and length it was at. While both stay
    /// the same the box keeps the user's scroll instead of following the cursor.
    manual_scroll: Option<(Range<usize>, usize)>,
    /// Part of a wheel scroll smaller than a line, kept for the next event.
    scroll_remainder: Pixels,
    /// Rows of text in all and rows the box shows, as last painted.
    rows: (usize, usize),
    min_rows: usize,
    max_rows: usize,
    variant: TextAreaVariant,
    mono: bool,
    disabled: bool,
    highlighter: Option<TextAreaHighlighter>,
    line_scale: Option<TextAreaLineScale>,
}

/// The text as last painted: one wrapped line per hard line.
struct TextLayout {
    lines: Vec<LaidOutLine>,
    bounds: Bounds<Pixels>,
    line_height: Pixels,
}

struct LaidOutLine {
    /// Byte offset of the line's start in the content.
    start: usize,
    /// Distance of its first row from the text's top.
    top: Pixels,
    /// The height of each of its rows.
    row_height: Pixels,
    wrapped: WrappedLine,
}

impl TextLayout {
    /// Where `offset` is drawn, relative to the box's top-left.
    fn position_for_offset(&self, offset: usize) -> Option<Point<Pixels>> {
        let line = self.lines.iter().rev().find(|line| line.start <= offset)?;
        let position = line.wrapped.position_for_index(offset - line.start, line.row_height)?;
        Some(point(position.x, line.top + position.y))
    }

    /// The offset nearest a point relative to the box's top-left.
    fn offset_for_position(&self, position: Point<Pixels>) -> usize {
        if position.y < self.top() {
            return 0;
        }
        let Some(line) = self.lines.iter().rev().find(|line| line.top <= position.y) else { return 0 };
        let local = point(position.x.max(px(0.)), position.y - line.top);
        match line.wrapped.closest_index_for_position(local, line.row_height) {
            Ok(index) | Err(index) => line.start + index,
        }
    }

    fn top(&self) -> Pixels {
        self.lines.first().map_or(px(0.), |line| line.top)
    }

    fn bottom(&self) -> Pixels {
        self.lines.last().map_or(px(0.), |line| line.top + line.wrapped.size(line.row_height).height.max(line.row_height))
    }
}

impl EventEmitter<TextAreaEvent> for TextArea {}

impl Focusable for TextArea {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl TextArea {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            content: String::new(),
            placeholder: SharedString::default(),
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            goal_x: None,
            layout: None,
            is_selecting: false,
            scroll_lines: 0,
            manual_scroll: None,
            scroll_remainder: px(0.),
            rows: (0, 0),
            min_rows: 2,
            max_rows: 2,
            variant: TextAreaVariant::Default,
            mono: false,
            disabled: false,
            highlighter: None,
            line_scale: None,
        }
    }

    /// Draws some lines larger, each taking one row, or two from 1.5 times up.
    pub fn line_scale(mut self, scale: impl Fn(&str) -> f32 + 'static) -> Self {
        self.line_scale = Some(Rc::new(scale));
        self
    }

    /// Styles the text as it is typed, such as Markdown shown live.
    pub fn highlighter(mut self, highlighter: impl Fn(&str, &App) -> Vec<(Range<usize>, HighlightStyle)> + 'static) -> Self {
        self.highlighter = Some(Rc::new(highlighter));
        self
    }

    /// The selected byte range of the text.
    pub fn selected_range(&self) -> Range<usize> {
        self.selected_range.clone()
    }

    /// Selects `range` of the text (byte offsets, clamped to it).
    pub fn select_range(&mut self, range: Range<usize>, cx: &mut Context<Self>) {
        let len = self.content.len();
        self.selected_range = range.start.min(len)..range.end.min(len);
        self.selection_reversed = false;
        cx.notify();
    }

    /// A fixed height of `rows` lines.
    pub fn rows(mut self, rows: usize) -> Self {
        self.min_rows = rows.max(1);
        self.max_rows = self.min_rows;
        self
    }

    /// Grows with its text from `min` to `max` lines, then scrolls.
    pub fn auto_size(mut self, min: usize, max: usize) -> Self {
        self.min_rows = min.max(1);
        self.max_rows = max.max(self.min_rows);
        self
    }

    pub fn variant(mut self, variant: TextAreaVariant) -> Self {
        self.variant = variant;
        self
    }

    /// The editor font, as code and commit messages take.
    pub fn mono(mut self) -> Self {
        self.mono = true;
        self
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = placeholder.into();
        self
    }

    pub fn set_disabled(&mut self, disabled: bool, cx: &mut Context<Self>) {
        self.disabled = disabled;
        cx.notify();
    }

    /// Where the cursor is, as a byte offset into the text.
    pub fn cursor(&self) -> usize {
        self.cursor_offset()
    }

    /// Replaces `range` of the text and puts the cursor after the new text.
    pub fn replace_range(&mut self, range: Range<usize>, text: &str, cx: &mut Context<Self>) {
        let range = range.start.min(self.content.len())..range.end.min(self.content.len());
        self.marked_range = None;
        self.selected_range = range;
        self.replace_selection(text, cx);
    }

    pub fn set_placeholder(&mut self, placeholder: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.placeholder = placeholder.into();
        cx.notify();
    }

    pub fn text(&self) -> &str {
        &self.content
    }

    pub fn set_text(&mut self, text: impl Into<String>, cx: &mut Context<Self>) {
        self.content = text.into();
        let end = self.content.len();
        self.selected_range = end..end;
        self.selection_reversed = false;
        self.marked_range = None;
        self.scroll_lines = 0;
        cx.emit(TextAreaEvent::Changed);
        cx.notify();
    }

    /// Takes the text out, leaving the composer empty.
    pub fn take_text(&mut self, cx: &mut Context<Self>) -> String {
        let text = std::mem::take(&mut self.content);
        self.set_text(String::new(), cx);
        text
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.focus_handle, cx);
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed { self.selected_range.start } else { self.selected_range.end }
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        cx.notify();
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        if self.selection_reversed {
            self.selected_range.start = offset
        } else {
            self.selected_range.end = offset
        }
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        cx.notify();
    }

    fn move_or_select(&mut self, offset: usize, select: bool, cx: &mut Context<Self>) {
        if select { self.select_to(offset, cx) } else { self.move_to(offset, cx) }
    }

    fn replace_selection(&mut self, text: &str, cx: &mut Context<Self>) {
        let range = self.marked_range.take().unwrap_or(self.selected_range.clone());
        self.content.replace_range(range.clone(), text);
        let end = range.start + text.len();
        self.selected_range = end..end;
        self.selection_reversed = false;
        self.goal_x = None;
        cx.emit(TextAreaEvent::Changed);
        cx.notify();
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.content.grapheme_indices(true).rev().find_map(|(index, _)| (index < offset).then_some(index)).unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(index, _)| (index > offset).then_some(index))
            .unwrap_or(self.content.len())
    }

    fn previous_word_start(&self, offset: usize) -> usize {
        self.content.unicode_word_indices().rev().find_map(|(index, _)| (index < offset).then_some(index)).unwrap_or(0)
    }

    fn next_word_end(&self, offset: usize) -> usize {
        self.content
            .unicode_word_indices()
            .find_map(|(index, word)| (index + word.len() > offset).then_some(index + word.len()))
            .unwrap_or(self.content.len())
    }

    fn line_start(&self, offset: usize) -> usize {
        self.content[..offset].rfind('\n').map_or(0, |index| index + 1)
    }

    fn line_end(&self, offset: usize) -> usize {
        self.content[offset..].find('\n').map_or(self.content.len(), |index| offset + index)
    }

    fn position_for_offset(&self, offset: usize) -> Option<Point<Pixels>> {
        self.layout.as_ref()?.position_for_offset(offset)
    }

    fn offset_for_position(&self, position: Point<Pixels>) -> usize {
        self.layout.as_ref().map_or(self.content.len(), |layout| layout.offset_for_position(position).min(self.content.len()))
    }

    fn vertical_move(&mut self, rows: f32, select: bool, cx: &mut Context<Self>) {
        let cursor = self.cursor_offset();
        let Some(position) = self.position_for_offset(cursor) else { return };
        let line_height = self.layout.as_ref().map_or(LINE_HEIGHT, |layout| layout.line_height);
        let goal_x = self.goal_x.unwrap_or(position.x);
        let target_y = position.y + line_height * rows + line_height / 2.;
        let bottom = self.layout.as_ref().map_or(px(0.), TextLayout::bottom);
        let offset = if target_y < self.layout.as_ref().map_or(px(0.), TextLayout::top) {
            0
        } else if target_y >= bottom {
            self.content.len()
        } else {
            self.offset_for_position(point(goal_x, target_y))
        };
        self.move_or_select(offset, select, cx);
        self.goal_x = Some(goal_x);
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let modifiers = keystroke.modifiers;
        let shift = modifiers.shift;
        let cmd = modifiers.platform;
        let alt = modifiers.alt;
        let ctrl = modifiers.control;
        let cursor = self.cursor_offset();
        if self.disabled {
            return;
        }
        let handled = match keystroke.key.as_str() {
            "enter" if cmd || (ctrl && cfg!(not(target_os = "macos"))) => {
                cx.emit(TextAreaEvent::Submit);
                true
            }
            "enter" => {
                self.replace_selection("\n", cx);
                true
            }
            "escape" => {
                cx.emit(TextAreaEvent::Cancelled);
                false
            }
            "backspace" => {
                if self.selected_range.is_empty() {
                    let start = if cmd {
                        let start = self.line_start(cursor);
                        if start == cursor { self.previous_boundary(cursor) } else { start }
                    } else if alt || ctrl {
                        self.previous_word_start(cursor)
                    } else {
                        self.previous_boundary(cursor)
                    };
                    self.selected_range = start..cursor;
                }
                self.replace_selection("", cx);
                true
            }
            "delete" => {
                if self.selected_range.is_empty() {
                    let end = if alt { self.next_word_end(cursor) } else { self.next_boundary(cursor) };
                    self.selected_range = cursor..end;
                }
                self.replace_selection("", cx);
                true
            }
            "left" => {
                let target = if cmd {
                    self.line_start(cursor)
                } else if alt || ctrl {
                    self.previous_word_start(cursor)
                } else if !shift && !self.selected_range.is_empty() {
                    self.selected_range.start
                } else {
                    self.previous_boundary(cursor)
                };
                self.goal_x = None;
                self.move_or_select(target, shift, cx);
                true
            }
            "right" => {
                let target = if cmd {
                    self.line_end(cursor)
                } else if alt || ctrl {
                    self.next_word_end(cursor)
                } else if !shift && !self.selected_range.is_empty() {
                    self.selected_range.end
                } else {
                    self.next_boundary(cursor)
                };
                self.goal_x = None;
                self.move_or_select(target, shift, cx);
                true
            }
            "up" if cmd => {
                self.move_or_select(0, shift, cx);
                true
            }
            "down" if cmd => {
                self.move_or_select(self.content.len(), shift, cx);
                true
            }
            "up" => {
                self.vertical_move(-1., shift, cx);
                true
            }
            "down" => {
                self.vertical_move(1., shift, cx);
                true
            }
            "home" => {
                self.move_or_select(self.line_start(cursor), shift, cx);
                true
            }
            "end" => {
                self.move_or_select(self.line_end(cursor), shift, cx);
                true
            }
            "a" if cmd || (ctrl && cfg!(not(target_os = "macos"))) => {
                self.selected_range = 0..self.content.len();
                self.selection_reversed = false;
                cx.notify();
                true
            }
            "c" | "x" if cmd || (ctrl && cfg!(not(target_os = "macos"))) => {
                if !self.selected_range.is_empty() {
                    cx.write_to_clipboard(ClipboardItem::new_string(self.content[self.selected_range.clone()].to_string()));
                    if keystroke.key == "x" {
                        self.replace_selection("", cx);
                    }
                }
                true
            }
            "v" if cmd || (ctrl && cfg!(not(target_os = "macos"))) => {
                if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
                    self.replace_selection(&text.replace("\r\n", "\n"), cx);
                }
                true
            }
            "space" if ctrl && cmd => {
                window.show_character_palette();
                true
            }
            _ => false,
        };
        if handled {
            cx.stop_propagation();
        }
    }

    fn on_mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus_handle, cx);
        let Some(origin) = self.layout.as_ref().map(|layout| layout.bounds.origin) else { return };
        let offset = self.offset_for_position(event.position - origin);
        if event.click_count >= 2 {
            let start = self.previous_word_start(self.next_boundary(offset).min(self.content.len()));
            let end = self.next_word_end(offset);
            self.selected_range = start..end;
            self.selection_reversed = false;
            cx.notify();
            return;
        }
        self.is_selecting = true;
        self.goal_x = None;
        self.move_or_select(offset, event.modifiers.shift, cx);
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.is_selecting = false;
    }

    /// The wheel or trackpad scrolls text taller than the box, a line at a time.
    fn on_scroll_wheel(&mut self, event: &gpui::ScrollEvent, _: &mut Window, cx: &mut Context<Self>) {
        let (total, visible) = self.rows;
        let max = total.saturating_sub(visible);
        if max == 0 {
            return;
        }
        self.scroll_remainder -= event.delta.pixel_delta(LINE_HEIGHT).y;
        let lines = (self.scroll_remainder / LINE_HEIGHT).trunc();
        if lines == 0. {
            cx.stop_propagation();
            return;
        }
        self.scroll_remainder -= LINE_HEIGHT * lines;
        let scroll = (self.scroll_lines as isize + lines as isize).clamp(0, max as isize) as usize;
        if scroll == self.scroll_lines && self.manual_scroll.is_some() {
            return;
        }
        self.scroll_lines = scroll;
        self.manual_scroll = Some((self.selected_range.clone(), self.content.len()));
        cx.stop_propagation();
        cx.notify();
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.is_selecting {
            return;
        }
        let Some(origin) = self.layout.as_ref().map(|layout| layout.bounds.origin) else { return };
        let offset = self.offset_for_position(event.position - origin);
        self.select_to(offset, cx);
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
        self.content[..offset.min(self.content.len())].chars().map(char::len_utf16).sum()
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(range.start)..self.offset_from_utf16(range.end)
    }
}

impl EntityInputHandler for TextArea {
    fn text_for_range(&mut self, range_utf16: Range<usize>, actual: &mut Option<Range<usize>>, _: &mut Window, _: &mut Context<Self>) -> Option<String> {
        let range = self.range_from_utf16(&range_utf16);
        actual.replace(self.range_to_utf16(&range));
        Some(self.content[range].to_string())
    }

    fn selected_text_range(&mut self, _: bool, _: &mut Window, _: &mut Context<Self>) -> Option<UTF16Selection> {
        Some(UTF16Selection { range: self.range_to_utf16(&self.selected_range), reversed: self.selection_reversed })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked_range.as_ref().map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.marked_range = None;
    }

    fn replace_text_in_range(&mut self, range_utf16: Option<Range<usize>>, text: &str, _: &mut Window, cx: &mut Context<Self>) {
        if self.disabled {
            return;
        }
        let range = range_utf16
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        self.marked_range = None;
        self.selected_range = range;
        // The return key reaches here as text when the IME passes it on.
        let text = text.replace('\r', "\n");
        self.replace_selection(&text, cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.disabled {
            return;
        }
        let range = range_utf16
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        self.content.replace_range(range.clone(), new_text);
        self.marked_range = (!new_text.is_empty()).then(|| range.start..range.start + new_text.len());
        self.selected_range = new_selected_range_utf16
            .map(|selected| {
                let start = self.offset_to_utf16(range.start);
                self.range_from_utf16(&(start + selected.start..start + selected.end))
            })
            .unwrap_or_else(|| range.start + new_text.len()..range.start + new_text.len());
        self.selection_reversed = false;
        cx.emit(TextAreaEvent::Changed);
        cx.notify();
    }

    fn bounds_for_range(&mut self, range_utf16: Range<usize>, bounds: Bounds<Pixels>, _: &mut Window, _: &mut Context<Self>) -> Option<Bounds<Pixels>> {
        let range = self.range_from_utf16(&range_utf16);
        let line_height = self.layout.as_ref()?.line_height;
        let start = self.position_for_offset(range.start)?;
        let end = self.position_for_offset(range.end)?;
        Some(Bounds::from_corners(
            bounds.origin + start,
            bounds.origin + point(end.x.max(start.x), end.y + line_height),
        ))
    }

    fn character_index_for_point(&mut self, point: Point<Pixels>, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        let origin = self.layout.as_ref()?.bounds.origin;
        Some(self.offset_to_utf16(self.offset_for_position(point - origin)))
    }

    fn accepts_text_input(&self, _: &mut Window, _: &mut Context<Self>) -> bool {
        true
    }
}

/// Draws the text, its selection and the cursor.
struct TextAreaText {
    composer: Entity<TextArea>,
}

struct PrepaintState {
    selections: Vec<PaintQuad>,
    cursor: Option<PaintQuad>,
}

fn text_runs(composer: &TextArea, text: &str, window: &Window, color: gpui::Hsla, cx: &App) -> Vec<TextRun> {
    let style = window.text_style();
    let run = TextRun { len: text.len(), font: style.font(), color, background_color: None, underline: None, strikethrough: None };
    if let Some(highlighter) = composer.highlighter.as_ref().filter(|_| composer.marked_range.is_none() && !composer.content.is_empty()) {
        return highlighted_runs(&run, text.len(), highlighter(text, cx));
    }
    match &composer.marked_range {
        Some(marked) if !composer.content.is_empty() => vec![
            TextRun { len: marked.start, ..run.clone() },
            TextRun {
                len: marked.end - marked.start,
                underline: Some(UnderlineStyle { color: Some(color), thickness: px(1.), wavy: false }),
                ..run.clone()
            },
            TextRun { len: text.len() - marked.end, ..run },
        ]
        .into_iter()
        .filter(|run| run.len > 0)
        .collect(),
        _ => vec![run],
    }
}

/// `base` cut at the highlights, each piece styled by the one over it.
fn highlighted_runs(base: &TextRun, len: usize, mut highlights: Vec<(Range<usize>, HighlightStyle)>) -> Vec<TextRun> {
    highlights.retain(|(range, _)| range.start < range.end && range.end <= len);
    highlights.sort_by_key(|(range, _)| range.start);
    let mut runs = Vec::new();
    let mut offset = 0;
    for (range, style) in highlights {
        if range.start < offset {
            continue;
        }
        if range.start > offset {
            runs.push(TextRun { len: range.start - offset, ..base.clone() });
        }
        let mut run = TextRun { len: range.end - range.start, ..base.clone() };
        if let Some(weight) = style.font_weight {
            run.font.weight = weight;
        }
        if let Some(font_style) = style.font_style {
            run.font.style = font_style;
        }
        if let Some(color) = style.color {
            run.color = color;
        }
        run.background_color = style.background_color.or(run.background_color);
        run.strikethrough = style.strikethrough.or(run.strikethrough);
        run.underline = style.underline.or(run.underline);
        runs.push(run);
        offset = range.end;
    }
    if offset < len || runs.is_empty() {
        runs.push(TextRun { len: len - offset, ..base.clone() });
    }
    runs
}

/// Shapes each hard line of `text` wrapped at `width`.
fn shape(text: &str, runs: &[TextRun], width: Option<Pixels>, scale: Option<&TextAreaLineScale>, window: &Window) -> Vec<(usize, WrappedLine, f32)> {
    let base_size = window.text_style().font_size.to_pixels(window.rem_size());
    let mut lines = Vec::new();
    let mut start = 0;
    for line in text.split('\n') {
        let end = start + line.len();
        let line_runs = runs_for_range(runs, start..end);
        let line_scale = scale.map_or(1., |scale| scale(line));
        let multiple = if line_scale >= 1.5 { 2. } else { 1. };
        let font_size = base_size * line_scale;
        let shaped = window
            .text_system()
            .shape_text(SharedString::from(line.to_string()), font_size, &line_runs, width, None)
            .ok()
            .and_then(|mut shaped| shaped.pop())
            .unwrap_or_default();
        lines.push((start, shaped, multiple));
        start = end + 1;
    }
    lines
}

/// The runs covering `range` of the text, trimmed to it.
fn runs_for_range(runs: &[TextRun], range: Range<usize>) -> Vec<TextRun> {
    let mut result = Vec::new();
    let mut offset = 0;
    for run in runs {
        let run_range = offset..offset + run.len;
        offset += run.len;
        let start = run_range.start.max(range.start);
        let end = run_range.end.min(range.end);
        if start < end {
            result.push(TextRun { len: end - start, ..run.clone() });
        }
    }
    if result.is_empty()
        && let Some(run) = runs.first()
    {
        result.push(TextRun { len: 0, ..run.clone() });
    }
    result
}

fn rows(lines: &[(usize, WrappedLine, f32)]) -> usize {
    lines.iter().map(|(_, line, multiple)| (line.wrap_boundaries().len() + 1) * *multiple as usize).sum()
}

impl Element for TextAreaText {
    type RequestLayoutState = ();
    type PrepaintState = PrepaintState;

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
        let composer = self.composer.read(cx);
        let text = if composer.content.is_empty() { composer.placeholder.to_string() } else { composer.content.clone() };
        let color = window.text_style().color;
        let runs = text_runs(composer, &text, window, color, cx);
        let (min_rows, max_rows) = (composer.min_rows, composer.max_rows);
        let line_scale = composer.line_scale.clone();
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        let layout_id = window.request_measured_layout(style, move |known, available, window, _| {
            let width = known.width.or(match available.width {
                gpui::AvailableSpace::Definite(width) => Some(width),
                _ => None,
            });
            let lines = shape(&text, &runs, width, line_scale.as_ref(), window);
            let visible = rows(&lines).clamp(min_rows, max_rows);
            size(width.unwrap_or(px(0.)), LINE_HEIGHT * visible as f32)
        });
        (layout_id, ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let colors = cx.theme().colors.clone();
        let composer = self.composer.read(cx);
        let empty = composer.content.is_empty();
        let (text, color) = if empty {
            (composer.placeholder.to_string(), colors.subtle_foreground)
        } else {
            (composer.content.clone(), window.text_style().color)
        };
        let runs = text_runs(composer, &text, window, color, cx);
        let shaped = shape(&text, &runs, Some(bounds.size.width), composer.line_scale.as_ref(), window);
        let mut top = px(0.);
        let lines: Vec<LaidOutLine> = shaped
            .into_iter()
            .map(|(start, wrapped, multiple)| {
                let row_height = LINE_HEIGHT * multiple;
                let line = LaidOutLine { start, top, row_height, wrapped };
                top += line.wrapped.size(row_height).height.max(row_height);
                line
            })
            .collect();
        let selected = composer.selected_range.clone();
        let cursor_offset = if empty { 0 } else { composer.cursor_offset() };
        let mut layout = TextLayout { lines, bounds, line_height: LINE_HEIGHT };

        // Keep the cursor's row in view when the text is taller than the box.
        let visible_rows = (bounds.size.height / LINE_HEIGHT).floor().max(1.) as usize;
        let cursor_row = layout.position_for_offset(cursor_offset).map_or(0, |position| (position.y / LINE_HEIGHT) as usize);
        let total_rows = (top / LINE_HEIGHT).round().max(1.) as usize;
        let manual = composer.manual_scroll.as_ref().is_some_and(|(range, len)| *range == composer.selected_range && *len == composer.content.len());
        let scroll = if manual {
            composer.scroll_lines.min(total_rows.saturating_sub(visible_rows))
        } else if cursor_row < composer.scroll_lines {
            cursor_row
        } else if cursor_row >= composer.scroll_lines + visible_rows {
            cursor_row + 1 - visible_rows
        } else {
            composer.scroll_lines
        };
        for line in &mut layout.lines {
            line.top -= LINE_HEIGHT * scroll as f32;
        }

        let origin = bounds.origin;
        let mut selections = Vec::new();
        let mut cursor = None;
        if !empty && !selected.is_empty() {
            // One quad per row the selection crosses.
            let start = layout.position_for_offset(selected.start).unwrap_or_default();
            let end = layout.position_for_offset(selected.end).unwrap_or_default();
            let row_at = |y: Pixels| layout.lines.iter().rev().find(|line| line.top <= y).map_or(LINE_HEIGHT, |line| line.row_height);
            let mut y = start.y;
            while y <= end.y {
                let row = row_at(y);
                let left = if y == start.y { start.x } else { px(0.) };
                let right = if y == end.y { end.x } else { bounds.size.width };
                if right > left || y != end.y {
                    selections.push(fill(
                        Bounds::from_corners(origin + point(left, y), origin + point(right.max(left + px(4.)), y + row)),
                        colors.selection,
                    ));
                }
                y += row;
            }
        } else {
            let position = layout.position_for_offset(cursor_offset);
            if let Some(position) = position {
                let row = layout.lines.iter().rev().find(|line| line.top <= position.y).map_or(LINE_HEIGHT, |line| line.row_height);
                cursor = Some(fill(Bounds::new(origin + position + point(px(0.), px(2.)), size(px(1.5), row - px(4.))), colors.cursor));
            }
        }
        self.composer.update(cx, |composer, _| {
            composer.layout = Some(layout);
            composer.scroll_lines = scroll;
            composer.rows = (total_rows, visible_rows);
            if !manual {
                composer.manual_scroll = None;
            }
        });
        PrepaintState { selections, cursor }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus_handle = self.composer.read(cx).focus_handle.clone();
        window.handle_input(&focus_handle, ElementInputHandler::new(bounds, self.composer.clone()), cx);
        window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
            for selection in prepaint.selections.drain(..) {
                window.paint_quad(selection);
            }
            let layout = self.composer.update(cx, |composer, _| composer.layout.take());
            if let Some(layout) = &layout {
                for line in &layout.lines {
                    if line.top + LINE_HEIGHT < px(0.) || line.top > bounds.size.height {
                        continue;
                    }
                    let origin = bounds.origin + point(px(0.), line.top);
                    line.wrapped.paint(origin, line.row_height, gpui::TextAlign::Left, None, window, cx).ok();
                }
            }
            self.composer.update(cx, |composer, _| composer.layout = layout);
            if focus_handle.is_focused(window) && window.is_window_active()
                && let Some(cursor) = prepaint.cursor.take()
            {
                window.paint_quad(cursor);
            }
        });
    }
}

impl Render for TextArea {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let focused = self.focus_handle.is_focused(window) && window.is_window_active();
        let boxed = self.variant == TextAreaVariant::Default;
        div()
            .id("text-area")
            .w_full()
            .min_w_0()
            .track_focus(&self.focus_handle)
            .cursor(CursorStyle::IBeam)
            .on_key_down(cx.listener(Self::on_key_down))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_scroll(cx.listener(Self::on_scroll_wheel))
            .font_family(if self.mono { typography::MONO_FONT } else { typography::UI_FONT })
            .text_size(typography::TEXT_SM)
            .line_height(LINE_HEIGHT)
            .text_color(colors.foreground)
            .when(self.disabled, |this| this.opacity(0.5))
            .when(boxed, |this| {
                // A browser textarea of n rows is n lines, its padding and 2px more (64px for
                // three rows); the extra sits under the text.
                this.min_h(LINE_HEIGHT * self.min_rows as f32 + px(10.))
                    .px(px(8.))
                    .py(px(4.))
                    .rounded(metrics::RADIUS)
                    .bg(colors.raised)
                    .shadow(theme.shadows.raised.clone())
                    .when(focused, |this| this.border_1().border_color(colors.focus_ring).px(px(6.)).py(px(2.)))
            })
            .child(TextAreaText { composer: cx.entity() })
    }
}
