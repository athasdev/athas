//! Gutter, minimap and sticky-scroll interaction: breakpoints, fold chevrons, minimap dragging.

use gpui::{Context, Pixels, Point, Window, px};

use crate::{Autoscroll, Drag, Editor, element::MinimapLayout};

impl Editor {
    /// A click in the gutter: the breakpoint lane toggles a breakpoint, the fold lane a fold.
    /// Returns whether the click was handled.
    pub(crate) fn gutter_click(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) -> bool {
        let Some(layout) = &self.layout else { return false };
        let in_breakpoints = layout.breakpoint_lane.contains(&position.x);
        let in_folds = layout.fold_lane.contains(&position.x);
        if !in_breakpoints && !in_folds {
            return false;
        }
        let offset = self.offset_for_position(position);
        let line = self.document.buffer.line_of(offset);
        if in_breakpoints {
            self.toggle_breakpoint_at(line, cx);
            return true;
        }
        if self.folds.is_folded(line) || self.fold_ranges().iter().any(|range| range.start == line) {
            self.toggle_fold_at(line, cx);
            return true;
        }
        false
    }

    /// A click on the `⋯` after a folded header opens it. Returns whether one was hit.
    pub(crate) fn placeholder_click(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) -> bool {
        let Some(line) = self.layout.as_ref().and_then(|layout| layout.fold_placeholders.iter().find(|(bounds, _)| bounds.contains(&position)).map(|(_, line)| *line))
        else {
            return false;
        };
        self.unfold_line(line, cx);
        true
    }

    fn toggle_breakpoint_at(&mut self, line: usize, cx: &mut Context<Self>) {
        if !self.path.is_absolute() {
            return;
        }
        let path = self.path.clone();
        self.breakpoints.update(cx, |store, cx| {
            store.toggle(&path, line as u32, cx);
        });
        cx.notify();
    }

    pub(crate) fn toggle_breakpoint(&mut self, _: &crate::ToggleBreakpoint, _: &mut Window, cx: &mut Context<Self>) {
        let line = self.document.buffer.line_of(self.document.newest_selection().head);
        self.toggle_breakpoint_at(line, cx);
    }

    /// Keeps breakpoints on their code after lines were added or removed.
    pub(crate) fn shift_breakpoints(&mut self, shifts: &[(usize, isize)], cx: &mut Context<Self>) {
        if shifts.is_empty() || self.breakpoints.read(cx).breakpoints_for(&self.path).is_empty() {
            return;
        }
        let path = self.path.clone();
        let shifts = shifts.to_vec();
        self.breakpoints.update(cx, |store, cx| {
            for (from, delta) in shifts {
                store.shift_rows(&path, from as u32, delta as i64, cx);
            }
        });
    }

    pub(crate) fn minimap_down(&mut self, position: Point<Pixels>, minimap: MinimapLayout, cx: &mut Context<Self>) {
        let grab = if minimap.slider.contains(&position) { position.y - minimap.slider.top() } else { minimap.slider.size.height / 2. };
        self.drag = Some(Drag::Minimap { grab });
        self.minimap_drag(position, grab, cx);
    }

    pub(crate) fn minimap_drag(&mut self, position: Point<Pixels>, grab: Pixels, cx: &mut Context<Self>) {
        let Some(layout) = &self.layout else { return };
        let Some(minimap) = layout.minimap else { return };
        if minimap.travel <= px(0.) {
            return;
        }
        let fraction = ((position.y - grab - minimap.bounds.top()) / minimap.travel).clamp(0., 1.);
        self.scroll.y = layout.max_scroll.y * fraction;
        cx.notify();
    }

    /// A click on a pinned header goes to that line.
    pub(crate) fn sticky_click(&mut self, line: usize, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus_handle, cx);
        let buffer = &self.document.buffer;
        let offset = buffer.line_start(line) + buffer.indent_len(line);
        self.document.set_cursor(offset);
        let index = self.current_row_index();
        if let Some(line_height) = self.layout.as_ref().map(|layout| layout.line_height) {
            let map = crate::display_map::DisplayMap::new(&self.document.buffer, self.document.tab_size, index.as_deref());
            self.scroll.y = line_height * map.first_row_of_line(line) as f32;
        }
        self.autoscroll = Some(Autoscroll::Fit);
        self.pause_blink(cx);
        cx.notify();
    }
}
