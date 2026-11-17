//! Mouse, scroll wheel and text input (typing and IME composition through GPUI's
//! `EntityInputHandler`).

use std::ops::Range;

use gpui::{Bounds, Context, EntityInputHandler, MouseDownEvent, Pixels, Point, ScrollEvent, UTF16Selection, Window, point, px, size};

use crate::{Autoscroll, Drag, Editor, buffer::char_class, element::ScrollbarLayout, history::EditKind, selection::Selection};

impl Editor {
    pub(crate) fn mouse_down(&mut self, event: &MouseDownEvent, in_gutter: bool, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus_handle, cx);
        self.dismiss_lsp_popovers(cx);
        let offset = self.offset_for_position(event.position);
        if !in_gutter && event.click_count == 1 && self.definition_modifier(event.modifiers, cx) && self.definition_click(offset, window, cx) {
            self.document.set_cursor(offset);
            self.pause_blink(cx);
            cx.notify();
            return;
        }
        let add_caret = match settings::get(cx).editor_multi_cursor_modifier.as_str() {
            "ctrlCmd" => event.modifiers.platform || event.modifiers.control,
            _ => event.modifiers.alt,
        };
        if in_gutter && event.click_count == 1 && self.gutter_click(event.position, cx) {
            return;
        }
        if !in_gutter && event.click_count == 1 && self.placeholder_click(event.position, cx) {
            return;
        }
        self.document.reset_occurrence_mode();
        self.marked_range = None;
        let buffer = &self.document.buffer;

        if in_gutter {
            let line = buffer.line_of(offset);
            let range = line_range(buffer, line);
            if event.modifiers.shift {
                let anchor = self.document.newest_selection().anchor;
                let start = range.start.min(anchor);
                let end = range.end.max(anchor);
                self.select_single(start..end, anchor > range.start);
            } else {
                self.select_single(range.clone(), false);
            }
            self.drag = Some(Drag::Line(range));
        } else if event.click_count >= 3 {
            let range = line_range(buffer, buffer.line_of(offset));
            self.select_single(range.clone(), false);
            self.drag = Some(Drag::Line(range));
        } else if event.click_count == 2 {
            let range = word_or_run(buffer, offset);
            if add_caret {
                self.add_selection(range.clone());
            } else {
                self.select_single(range.clone(), false);
            }
            self.drag = Some(Drag::Word(range));
        } else if event.modifiers.shift {
            let mut newest = self.document.newest_selection().clone();
            newest.select_to(offset);
            let mut others: Vec<Selection> = self.document.selections.iter().filter(|selection| selection.id != newest.id).cloned().collect();
            others.push(newest);
            self.document.set_selections(others);
            self.drag = Some(Drag::Char);
        } else if add_caret {
            // Alt-click on an existing caret removes it.
            let existing = self.document.selections.iter().position(|selection| selection.is_empty() && selection.head == offset);
            match existing {
                Some(index) if self.document.selections.len() > 1 => {
                    let mut selections = self.document.selections.clone();
                    selections.remove(index);
                    self.document.set_selections(selections);
                }
                _ => self.add_selection(offset..offset),
            }
            self.drag = Some(Drag::Char);
        } else {
            self.document.set_cursor(offset);
            self.drag = Some(Drag::Char);
        }
        self.document.history.break_group();
        self.pause_blink(cx);
        cx.notify();
    }

    fn select_single(&mut self, range: Range<usize>, reversed: bool) {
        let id = self.document.new_selection_id();
        let mut selection = Selection::cursor(id, 0);
        selection.set_range(range, reversed);
        self.document.set_selections(vec![selection]);
    }

    fn add_selection(&mut self, range: Range<usize>) {
        let id = self.document.new_selection_id();
        let mut selection = Selection::cursor(id, 0);
        selection.set_range(range, false);
        let mut selections = self.document.selections.clone();
        selections.push(selection);
        self.document.set_selections(selections);
    }

    pub(crate) fn mouse_drag(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(drag) = self.drag.clone() else { return };
        if let Drag::Scrollbar { grab } = drag {
            self.scrollbar_drag(position, grab, cx);
            return;
        }
        if let Drag::Minimap { grab } = drag {
            self.minimap_drag(position, grab, cx);
            return;
        }
        let offset = self.offset_for_position(position);
        let buffer = &self.document.buffer;
        let mut newest = self.document.newest_selection().clone();
        match drag {
            Drag::Char => newest.select_to(offset),
            Drag::Word(origin) => {
                let word = word_or_run(buffer, offset);
                if offset < origin.start {
                    newest.set_range(word.start..origin.end, true);
                } else {
                    newest.set_range(origin.start..word.end.max(origin.end), false);
                }
            }
            Drag::Line(origin) => {
                let line = line_range(buffer, buffer.line_of(offset));
                if line.start < origin.start {
                    newest.set_range(line.start..origin.end, true);
                } else {
                    newest.set_range(origin.start..line.end.max(origin.end), false);
                }
            }
            Drag::Scrollbar { .. } | Drag::Minimap { .. } => {}
        }
        let mut selections: Vec<Selection> = self.document.selections.iter().filter(|selection| selection.id != newest.id).cloned().collect();
        selections.push(newest);
        self.document.set_selections(selections);
        // Dragging past the top or bottom scrolls toward the pointer.
        if let Some(layout) = &self.layout
            && (position.y < layout.text_bounds.top() || position.y > layout.text_bounds.bottom())
        {
            self.autoscroll = Some(Autoscroll::Fit);
        }
        self.pause_blink(cx);
        cx.notify();
    }

    pub(crate) fn scrollbar_down(&mut self, position: Point<Pixels>, scrollbar: ScrollbarLayout, cx: &mut Context<Self>) {
        let grab = if scrollbar.thumb.contains(&position) {
            position.y - scrollbar.thumb.top()
        } else {
            let grab = scrollbar.thumb.size.height / 2.;
            self.drag = Some(Drag::Scrollbar { grab });
            self.scrollbar_drag(position, grab, cx);
            grab
        };
        self.drag = Some(Drag::Scrollbar { grab });
        cx.notify();
    }

    fn scrollbar_drag(&mut self, position: Point<Pixels>, grab: Pixels, cx: &mut Context<Self>) {
        let Some(layout) = &self.layout else { return };
        let Some(scrollbar) = layout.scrollbar else { return };
        let travel = scrollbar.track.size.height - scrollbar.thumb.size.height;
        if travel <= px(0.) {
            return;
        }
        let fraction = ((position.y - grab - scrollbar.track.top()) / travel).clamp(0., 1.);
        self.scroll.y = layout.max_scroll.y * fraction;
        cx.notify();
    }

    pub(crate) fn scroll_wheel(&mut self, event: &ScrollEvent, cx: &mut Context<Self>) {
        self.lsp.hover = None;
        self.scroll_animation = None;
        self.smooth_from = None;
        let Some(layout) = &self.layout else { return };
        let delta = event.delta.pixel_delta(layout.line_height);
        let max = layout.max_scroll;
        let (mut dx, dy) = (delta.x, delta.y);
        // A vertical wheel with shift scrolls sideways (mice without a horizontal wheel).
        if event.modifiers.shift && dx == px(0.) {
            dx = dy;
            self.scroll.x = (self.scroll.x - dx).clamp(px(0.), max.x);
        } else {
            self.scroll.y = (self.scroll.y - dy).clamp(px(0.), max.y);
            self.scroll.x = (self.scroll.x - dx).clamp(px(0.), max.x);
        }
        cx.notify();
    }

    fn to_utf16(&self, offset: usize) -> usize {
        let rope = self.document.buffer.rope();
        rope.char_to_utf16_cu(rope.byte_to_char(offset.min(rope.len_bytes())))
    }

    fn from_utf16(&self, offset: usize) -> usize {
        let rope = self.document.buffer.rope();
        rope.char_to_byte(rope.utf16_cu_to_char(offset.min(rope.len_utf16_cu())))
    }

    fn range_from_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.from_utf16(range.start)..self.from_utf16(range.end)
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.to_utf16(range.start)..self.to_utf16(range.end)
    }
}

/// A line with its newline, as triple-click selects it.
fn line_range(buffer: &crate::buffer::Buffer, line: usize) -> Range<usize> {
    let start = buffer.line_start(line);
    let end = if line + 1 < buffer.line_count() { buffer.line_start(line + 1) } else { buffer.len() };
    start..end
}

/// What double-click selects: the word, else the run of whitespace or the punctuation char.
fn word_or_run(buffer: &crate::buffer::Buffer, offset: usize) -> Range<usize> {
    if let Some(word) = buffer.word_range_at(offset) {
        return word;
    }
    let Some(ch) = buffer.char_at(offset).filter(|ch| *ch != '\n') else { return offset..offset };
    let class = char_class(ch);
    if ch.is_whitespace() {
        let start = offset - buffer.reversed_chars_at(offset).take_while(|other| char_class(*other) == class).map(char::len_utf8).sum::<usize>();
        let end = offset + buffer.chars_at(offset).take_while(|other| char_class(*other) == class).map(char::len_utf8).sum::<usize>();
        return start..end;
    }
    offset..offset + ch.len_utf8()
}

impl EntityInputHandler for Editor {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range_utf16);
        actual_range.replace(self.range_to_utf16(&range));
        Some(self.document.buffer.slice(range))
    }

    fn selected_text_range(&mut self, _: bool, _: &mut Window, _: &mut Context<Self>) -> Option<UTF16Selection> {
        let newest = self.document.newest_selection();
        Some(UTF16Selection { range: self.range_to_utf16(&newest.range()), reversed: newest.reversed() })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked_range.as_ref().map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.marked_range = None;
        cx.notify();
    }

    fn replace_text_in_range(&mut self, range_utf16: Option<Range<usize>>, text: &str, window: &mut Window, cx: &mut Context<Self>) {
        if range_utf16.is_none() && self.marked_range.is_none() && self.vim_typed(text, window, cx) {
            return;
        }
        let range = range_utf16.map(|range| self.range_from_utf16(&range)).or(self.marked_range.take());
        self.marked_range = None;
        match range {
            Some(range) => self.update_document(cx, |document| {
                document.select_range(range);
                document.insert_plain(text, EditKind::Insert);
            }),
            None => {
                self.update_document(cx, |document| document.insert(text));
                self.lsp_typed(text, cx);
                self.format_on_type(text, cx);
            }
        }
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .map(|range| self.range_from_utf16(&range))
            .or(self.marked_range.clone())
            .unwrap_or_else(|| self.document.newest_selection().range());
        let start = range.start;
        self.update_document(cx, |document| {
            document.select_range(range);
            document.insert_plain(text, EditKind::Insert);
        });
        self.marked_range = (!text.is_empty()).then(|| start..start + text.len());
        if let Some(selected) = new_selected_range_utf16 {
            let byte_at = |utf16: usize| {
                let mut count = 0;
                for (index, ch) in text.char_indices() {
                    if count >= utf16 {
                        return index;
                    }
                    count += ch.len_utf16();
                }
                text.len()
            };
            self.document.select_range(start + byte_at(selected.start)..start + byte_at(selected.end));
        }
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.range_from_utf16(&range_utf16);
        let layout = self.layout.as_ref()?;
        let row = layout.row_holding(range.start)?;
        let x = layout.origin.x + row.x_for(range.start, layout.char_width);
        let end_x = if row.holds(range.end) { layout.origin.x + row.x_for(range.end, layout.char_width) } else { x + layout.char_width };
        Some(Bounds::new(point(x, row.top), size((end_x - x).max(px(1.)), layout.line_height)))
    }

    fn character_index_for_point(&mut self, point: Point<Pixels>, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        let offset = self.offset_for_position(point);
        Some(self.to_utf16(offset))
    }
}
