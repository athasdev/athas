//! The composer's text area: multi-line, wrapping, with selection, clipboard, IME and
//! grapheme-aware movement. Enter sends, Shift-Enter (or Alt-Enter) breaks the line.
//!
//! Adapted from the shared single-line `ui::TextInput`; it reads keys itself (no key bindings),
//! so the workbench reloading its keymap cannot unbind it. A multi-line field belongs in
//! `crates/ui` once another view needs one.

use std::ops::Range;

use ui::scale::px;
use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, ElementId, ElementInputHandler, Entity, EntityInputHandler,
    EventEmitter, FocusHandle, Focusable, GlobalElementId, KeyDownEvent, LayoutId, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, PaintQuad, Pixels, Point, SharedString, Style, TextRun, UTF16Selection,
    UnderlineStyle, Window, WrappedLine, div, fill, point, prelude::*, relative, size,
};
use theme::ActiveTheme;
use ui::typography;
use unicode_segmentation::UnicodeSegmentation as _;

#[derive(Clone, Debug, PartialEq)]
pub enum ComposerEvent {
    /// Enter: send what was typed.
    Submit,
    /// Cmd-Enter: send what was typed now, stopping a running turn for it.
    SubmitNow,
    /// Shift-Tab with no menu open: the next agent mode.
    CycleMode,
    /// Escape.
    Cancel,
    Changed,
    /// A key for the completion menu, while one is open.
    Menu(MenuKey),
    /// Cmd-V with an image on the clipboard.
    PastedImage(gpui::Image),
    /// Cmd-V with files on the clipboard, as Finder copies them.
    PastedPaths(Vec<std::path::PathBuf>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuKey {
    Up,
    Down,
    Accept,
    Dismiss,
}

/// A mention or command held in the text as one piece (`data-mention` and `data-slash-command`
/// badges in Athas): the cursor steps over it, Backspace removes it whole, and it is drawn as a
/// badge. `token` is what it stands for in the sent prompt, when that differs from what shows.
#[derive(Clone, Debug, PartialEq)]
pub struct Chip {
    pub range: Range<usize>,
    pub tone: ChipTone,
    pub token: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChipTone {
    Accent,
    Neutral,
}

pub fn line_height() -> Pixels { px(20.) }
const MAX_VISIBLE_LINES: usize = 12;

pub struct Composer {
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
    /// A completion menu is open: arrows, Enter, Tab and Escape go to it.
    menu_open: bool,
    chips: Vec<Chip>,
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
    wrapped: WrappedLine,
}

impl TextLayout {
    /// Where `offset` is drawn, relative to the box's top-left.
    fn position_for_offset(&self, offset: usize) -> Option<Point<Pixels>> {
        let line = self.lines.iter().rev().find(|line| line.start <= offset)?;
        let position = line.wrapped.position_for_index(offset - line.start, self.line_height)?;
        Some(point(position.x, line.top + position.y))
    }

    /// The offset nearest a point relative to the box's top-left.
    fn offset_for_position(&self, position: Point<Pixels>) -> usize {
        if position.y < self.top() {
            return 0;
        }
        let Some(line) = self.lines.iter().rev().find(|line| line.top <= position.y) else { return 0 };
        let local = point(position.x.max(px(0.)), position.y - line.top);
        match line.wrapped.closest_index_for_position(local, self.line_height) {
            Ok(index) | Err(index) => line.start + index,
        }
    }

    fn top(&self) -> Pixels {
        self.lines.first().map_or(px(0.), |line| line.top)
    }

    fn bottom(&self) -> Pixels {
        self.lines.last().map_or(px(0.), |line| line.top + line.wrapped.size(self.line_height).height.max(self.line_height))
    }
}

impl EventEmitter<ComposerEvent> for Composer {}

impl Focusable for Composer {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Composer {
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
            menu_open: false,
            chips: Vec::new(),
        }
    }

    /// Replaces `range` with `label` as a chip and a space after it.
    pub fn insert_chip(&mut self, range: Range<usize>, label: &str, tone: ChipTone, token: Option<String>, cx: &mut Context<Self>) {
        let start = range.start.min(self.content.len());
        self.replace_range(range, &format!("{label} "), cx);
        self.chips.push(Chip { range: start..start + label.len(), tone, token });
        self.chips.sort_by_key(|chip| chip.range.start);
        cx.notify();
    }

    /// The text as it is sent: each chip replaced by what it stands for.
    pub fn sent_text(&self) -> String {
        expand_chips(&self.content, &self.chips)
    }

    fn shift_chips(&mut self, edited: Range<usize>, inserted: usize) {
        shift_chips(&mut self.chips, edited, inserted);
    }

    fn chip_at(&self, offset: usize) -> Option<&Chip> {
        self.chips.iter().find(|chip| chip.range.start < offset && offset < chip.range.end)
    }

    pub fn set_menu_open(&mut self, open: bool) {
        self.menu_open = open;
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
        self.chips.clear();
        let end = self.content.len();
        self.selected_range = end..end;
        self.selection_reversed = false;
        self.marked_range = None;
        self.scroll_lines = 0;
        cx.emit(ComposerEvent::Changed);
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
        self.shift_chips(range.clone(), text.len());
        let end = range.start + text.len();
        self.selected_range = end..end;
        self.selection_reversed = false;
        self.goal_x = None;
        cx.emit(ComposerEvent::Changed);
        cx.notify();
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        if let Some(chip) = self.chips.iter().find(|chip| chip.range.start < offset && offset <= chip.range.end) {
            return chip.range.start;
        }
        self.content.grapheme_indices(true).rev().find_map(|(index, _)| (index < offset).then_some(index)).unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        if let Some(chip) = self.chips.iter().find(|chip| chip.range.start <= offset && offset < chip.range.end) {
            return chip.range.end;
        }
        self.content
            .grapheme_indices(true)
            .find_map(|(index, _)| (index > offset).then_some(index))
            .unwrap_or(self.content.len())
    }

    /// A chip removed whole takes the space after it along when nothing was typed after that
    /// space (`removeComposerToken` drops a bare separator node).
    fn with_bare_chip_space(&self, range: Range<usize>) -> Range<usize> {
        if !self.chips.iter().any(|chip| chip.range == range) {
            return range;
        }
        let rest = &self.content[range.end..];
        let bare = rest.strip_prefix(' ').is_some_and(|after| after.is_empty() || self.chips.iter().any(|chip| chip.range.start == range.end + 1));
        if bare { range.start..range.end + 1 } else { range }
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
        let line_height = self.layout.as_ref().map_or(line_height(), |layout| layout.line_height);
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
        if self.menu_open && !cmd && !ctrl && !alt {
            let key = match keystroke.key.as_str() {
                "up" => Some(MenuKey::Up),
                "down" => Some(MenuKey::Down),
                "enter" | "tab" if !shift => Some(MenuKey::Accept),
                "escape" => Some(MenuKey::Dismiss),
                _ => None,
            };
            if let Some(key) = key {
                cx.emit(ComposerEvent::Menu(key));
                cx.stop_propagation();
                return;
            }
        }
        let handled = match keystroke.key.as_str() {
            "enter" if shift || alt || (ctrl && !cmd) => {
                self.replace_selection("\n", cx);
                true
            }
            // A held Enter sends once (`e.repeat` in Athas).
            "enter" if event.is_held => true,
            "enter" => {
                cx.emit(if cmd { ComposerEvent::SubmitNow } else { ComposerEvent::Submit });
                true
            }
            "tab" if shift && !cmd && !ctrl && !alt && !self.menu_open => {
                cx.emit(ComposerEvent::CycleMode);
                true
            }
            "escape" => {
                cx.emit(ComposerEvent::Cancel);
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
                    self.selected_range = self.with_bare_chip_space(start..cursor);
                }
                self.replace_selection("", cx);
                true
            }
            "delete" => {
                if self.selected_range.is_empty() {
                    let end = if alt { self.next_word_end(cursor) } else { self.next_boundary(cursor) };
                    self.selected_range = self.with_bare_chip_space(cursor..end);
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
                let item = cx.read_from_clipboard();
                let entries = item.as_ref().map(|item| item.entries()).unwrap_or_default();
                let image = entries.iter().find_map(|entry| match entry {
                    gpui::ClipboardEntry::Image(image) => Some(image.clone()),
                    _ => None,
                });
                let paths: Vec<std::path::PathBuf> = entries
                    .iter()
                    .filter_map(|entry| match entry {
                        gpui::ClipboardEntry::ExternalPaths(paths) => Some(paths.paths().to_vec()),
                        _ => None,
                    })
                    .flatten()
                    .collect();
                if let Some(image) = image {
                    cx.emit(ComposerEvent::PastedImage(image));
                } else if !paths.is_empty() {
                    cx.emit(ComposerEvent::PastedPaths(paths));
                } else if let Some(text) = item.and_then(|item| item.text()) {
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
        let offset = self.chip_at(offset).map_or(offset, |chip| chip.range.end);
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
        self.scroll_remainder -= event.delta.pixel_delta(line_height()).y;
        let lines = (self.scroll_remainder / line_height()).trunc();
        if lines == 0. {
            cx.stop_propagation();
            return;
        }
        self.scroll_remainder -= line_height() * lines;
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

impl EntityInputHandler for Composer {
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
        let range = range_utf16
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        self.content.replace_range(range.clone(), new_text);
        self.shift_chips(range.clone(), new_text.len());
        self.marked_range = (!new_text.is_empty()).then(|| range.start..range.start + new_text.len());
        self.selected_range = new_selected_range_utf16
            .map(|selected| {
                let start = self.offset_to_utf16(range.start);
                self.range_from_utf16(&(start + selected.start..start + selected.end))
            })
            .unwrap_or_else(|| range.start + new_text.len()..range.start + new_text.len());
        self.selection_reversed = false;
        cx.emit(ComposerEvent::Changed);
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

fn expand_chips(content: &str, chips: &[Chip]) -> String {
    let mut text = String::with_capacity(content.len());
    let mut offset = 0;
    for chip in chips {
        let Some(token) = &chip.token else { continue };
        text.push_str(&content[offset..chip.range.start]);
        text.push_str(token);
        offset = chip.range.end;
    }
    text.push_str(&content[offset..]);
    text
}

/// Moves the chips after an edit of `edited` that put `inserted` bytes in its place; a chip the
/// edit touches turns back into plain text.
fn shift_chips(chips: &mut Vec<Chip>, edited: Range<usize>, inserted: usize) {
    chips.retain_mut(|chip| {
        if chip.range.end <= edited.start {
            true
        } else if chip.range.start >= edited.end {
            chip.range = chip.range.start - edited.len() + inserted..chip.range.end - edited.len() + inserted;
            true
        } else {
            false
        }
    });
}

/// Draws the text, its selection and the cursor.
struct ComposerText {
    composer: Entity<Composer>,
}

struct PrepaintState {
    chips: Vec<PaintQuad>,
    selections: Vec<PaintQuad>,
    cursor: Option<PaintQuad>,
}

fn text_runs(composer: &Composer, text: &str, window: &Window, color: gpui::Hsla, colors: &theme::ThemeColors) -> Vec<TextRun> {
    let style = window.text_style();
    let run = TextRun { len: text.len(), font: style.font(), color, background_color: None, underline: None, strikethrough: None };
    if composer.content.is_empty() {
        return vec![run];
    }
    let mut cuts = vec![0, text.len()];
    if let Some(marked) = &composer.marked_range {
        cuts.extend([marked.start, marked.end]);
    }
    for chip in &composer.chips {
        cuts.extend([chip.range.start, chip.range.end]);
    }
    cuts.retain(|cut| *cut <= text.len());
    cuts.sort_unstable();
    cuts.dedup();
    cuts.windows(2)
        .map(|pair| {
            let (start, end) = (pair[0], pair[1]);
            let chip = composer.chips.iter().find(|chip| chip.range.start <= start && end <= chip.range.end);
            let marked = composer.marked_range.as_ref().is_some_and(|marked| marked.start <= start && end <= marked.end);
            TextRun {
                len: end - start,
                color: match chip.map(|chip| chip.tone) {
                    Some(ChipTone::Accent) => colors.primary,
                    Some(ChipTone::Neutral) => colors.muted_foreground,
                    None => color,
                },
                underline: marked.then(|| UnderlineStyle { color: Some(color), thickness: px(1.), wavy: false }),
                ..run.clone()
            }
        })
        .filter(|run| run.len > 0)
        .collect()
}

/// Shapes each hard line of `text` wrapped at `width`.
fn shape(text: &str, runs: &[TextRun], width: Option<Pixels>, window: &Window) -> Vec<(usize, WrappedLine)> {
    let font_size = window.text_style().font_size.to_pixels(window.rem_size());
    let mut lines = Vec::new();
    let mut start = 0;
    for line in text.split('\n') {
        let end = start + line.len();
        let line_runs = runs_for_range(runs, start..end);
        let shaped = window
            .text_system()
            .shape_text(SharedString::from(line.to_string()), font_size, &line_runs, width, None)
            .ok()
            .and_then(|mut shaped| shaped.pop())
            .unwrap_or_default();
        lines.push((start, shaped));
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

fn rows(lines: &[(usize, WrappedLine)]) -> usize {
    lines.iter().map(|(_, line)| line.wrap_boundaries().len() + 1).sum()
}

impl Element for ComposerText {
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
        let runs = text_runs(composer, &text, window, color, &cx.theme().colors);
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        let layout_id = window.request_measured_layout(style, move |known, available, window, _| {
            let width = known.width.or(match available.width {
                gpui::AvailableSpace::Definite(width) => Some(width),
                _ => None,
            });
            let lines = shape(&text, &runs, width, window);
            let visible = rows(&lines).clamp(1, MAX_VISIBLE_LINES);
            size(width.unwrap_or(px(0.)), line_height() * visible as f32)
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
        let runs = text_runs(composer, &text, window, color, &colors);
        let shaped = shape(&text, &runs, Some(bounds.size.width), window);
        let mut top = px(0.);
        let lines: Vec<LaidOutLine> = shaped
            .into_iter()
            .map(|(start, wrapped)| {
                let line = LaidOutLine { start, top, wrapped };
                top += line.wrapped.size(line_height()).height.max(line_height());
                line
            })
            .collect();
        let selected = composer.selected_range.clone();
        let cursor_offset = if empty { 0 } else { composer.cursor_offset() };
        let mut layout = TextLayout { lines, bounds, line_height: line_height() };

        // Keep the cursor's row in view when the text is taller than the box.
        let visible_rows = (bounds.size.height / line_height()).floor().max(1.) as usize;
        let cursor_row = layout.position_for_offset(cursor_offset).map_or(0, |position| (position.y / line_height()) as usize);
        let total_rows = (top / line_height()).round().max(1.) as usize;
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
            line.top -= line_height() * scroll as f32;
        }

        let origin = bounds.origin;
        let chips = if empty {
            Vec::new()
        } else {
            composer
                .chips
                .iter()
                .flat_map(|chip| {
                    let start = layout.position_for_offset(chip.range.start).unwrap_or_default();
                    let end = layout.position_for_offset(chip.range.end).unwrap_or_default();
                    let background = match chip.tone {
                        ChipTone::Accent => colors.primary_soft,
                        ChipTone::Neutral => colors.accent,
                    };
                    let mut quads = Vec::new();
                    let mut y = start.y;
                    while y <= end.y {
                        let left = if y == start.y { start.x } else { px(0.) };
                        let right = if y == end.y { end.x } else { bounds.size.width };
                        if right > left {
                            quads.push(
                                fill(Bounds::from_corners(origin + point(left - px(3.), y + px(1.)), origin + point(right + px(3.), y + line_height() - px(1.))), background)
                                    .corner_radii(px(4.)),
                            );
                        }
                        y += line_height();
                    }
                    quads
                })
                .collect()
        };
        let mut selections = Vec::new();
        let mut cursor = None;
        if !empty && !selected.is_empty() {
            // One quad per row the selection crosses.
            let start = layout.position_for_offset(selected.start).unwrap_or_default();
            let end = layout.position_for_offset(selected.end).unwrap_or_default();
            let mut y = start.y;
            while y <= end.y {
                let left = if y == start.y { start.x } else { px(0.) };
                let right = if y == end.y { end.x } else { bounds.size.width };
                if right > left || y != end.y {
                    selections.push(fill(
                        Bounds::from_corners(origin + point(left, y), origin + point(right.max(left + px(4.)), y + line_height())),
                        colors.selection,
                    ));
                }
                y += line_height();
            }
        } else {
            let position = layout.position_for_offset(cursor_offset);
            if let Some(position) = position {
                cursor = Some(fill(Bounds::new(origin + position + point(px(0.), px(2.)), size(px(1.5), line_height() - px(4.))), colors.cursor));
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
        PrepaintState { chips, selections, cursor }
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
            for chip in prepaint.chips.drain(..) {
                window.paint_quad(chip);
            }
            for selection in prepaint.selections.drain(..) {
                window.paint_quad(selection);
            }
            let layout = self.composer.update(cx, |composer, _| composer.layout.take());
            if let Some(layout) = &layout {
                for line in &layout.lines {
                    if line.top + line_height() < px(0.) || line.top > bounds.size.height {
                        continue;
                    }
                    let origin = bounds.origin + point(px(0.), line.top);
                    line.wrapped.paint(origin, layout.line_height, gpui::TextAlign::Left, None, window, cx).ok();
                }
            }
            self.composer.update(cx, |composer, _| composer.layout = layout);
            if focus_handle.is_focused(window)
                && let Some(cursor) = prepaint.cursor.take()
            {
                window.paint_quad(cursor);
            }
        });
    }
}

impl Render for Composer {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .id("agent-composer")
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
            // A `!command` is typed in the terminal's face (`font="mono"`).
            .font_family(if self.content.trim_start().starts_with('!') { typography::MONO_FONT.into() } else { typography::ui_font() })
            .text_size(typography::text_base())
            .line_height(line_height())
            .text_color(colors.foreground)
            .child(ComposerText { composer: cx.entity() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chip(range: Range<usize>, token: Option<&str>) -> Chip {
        Chip { range, tone: ChipTone::Accent, token: token.map(str::to_string) }
    }

    #[test]
    fn chips_move_with_edits_and_break_when_touched() {
        let mut chips = vec![chip(4..10, None), chip(15..20, None)];
        shift_chips(&mut chips, 0..0, 3);
        assert_eq!(chips.iter().map(|chip| chip.range.clone()).collect::<Vec<_>>(), vec![7..13, 18..23]);
        shift_chips(&mut chips, 13..13, 1);
        assert_eq!(chips[0].range, 7..13);
        shift_chips(&mut chips, 8..9, 0);
        assert_eq!(chips.len(), 1);
        assert_eq!(chips[0].range, 18..23);
    }

    #[test]
    fn sent_text_spells_out_mentions() {
        let content = "read main.rs and /review now";
        let chips = vec![chip(5..12, Some("@src/main.rs")), chip(17..24, None)];
        assert_eq!(expand_chips(content, &chips), "read @src/main.rs and /review now");
    }
}
