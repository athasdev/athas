//! Draws a terminal's grid: cell backgrounds, the selection, text in runs of cells that share a
//! style, and the cursor. The approach (one shaped run per stretch of same-styled cells, forced to
//! the cell width) follows Zed's `terminal_element.rs` (GPL-3.0-or-later, Zed Industries).

use alacritty_terminal::{
    term::cell::{Cell, Flags},
    vte::ansi::{Color, CursorShape, NamedColor},
};
use ui::scale::px;
use gpui::{
    App, Bounds, ContentMask, CursorStyle, DispatchPhase, Element, ElementId, Entity, FocusHandle, Font, FontFallbacks,
    FontFeatures, FontStyle, FontWeight, GlobalElementId, Hitbox, HitboxBehavior, Hsla, LayoutId, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, PaintQuad, Pixels, Point, ScrollEvent, ShapedLine, SharedString,
    StrikethroughStyle, Style, TextAlign, TextRun, UnderlineStyle, Window, fill, outline, point, relative, size,
};
use theme::ActiveTheme;
use ui::typography::MONO_FONT;

use crate::{
    colors::{Palette, dim, ensure_contrast},
    terminal_settings, terminal_zoom,
    view::{GridLayout, TerminalInputHandler, TerminalView},
};

/// The row height xterm's line height of 1 gives JetBrains Mono, as a multiple of the font size.
const LINE_HEIGHT: f32 = 1.3;

/// The font and metrics the settings ask for, at the terminal zoom level (`terminal.tsx`).
pub(crate) struct FontMetrics {
    pub font: Font,
    pub size: Pixels,
    pub line_height: f32,
    pub letter_spacing: Pixels,
    pub cursor_width: Pixels,
}

/// Nerd Font icons (powerline arrows, file and git glyphs that Neovim status lines and shell
/// prompts draw), bundled so they show with any terminal font (`SYMBOL_NERD_FONT_FALLBACKS`).
const NERD_SYMBOLS_FONT: &str = "Symbols Nerd Font Mono";

impl FontMetrics {
    pub fn from_settings(cx: &App) -> Self {
        let settings = terminal_settings(cx);
        let zoom = terminal_zoom(cx);
        let family = settings.terminal_font_family.trim();
        let family = if family.is_empty() { MONO_FONT } else { family };
        Self {
            font: Font {
                family: family.to_string().into(),
                features: FontFeatures::disable_ligatures(),
                fallbacks: Some(FontFallbacks::from_fonts(
                    [MONO_FONT, NERD_SYMBOLS_FONT].into_iter().filter(|font| *font != family).map(str::to_string).collect(),
                )),
                weight: FontWeight::NORMAL,
                style: FontStyle::Normal,
            },
            size: px(((settings.terminal_font_size as f32) * zoom * 10.).round() / 10.),
            line_height: (settings.terminal_line_height as f32).max(0.5),
            letter_spacing: px(settings.terminal_letter_spacing as f32 * zoom),
            cursor_width: px((settings.terminal_cursor_width as f32 * zoom).round().max(1.)),
        }
    }
}

pub(crate) struct TerminalElement {
    view: Entity<TerminalView>,
    focus_handle: FocusHandle,
    focused: bool,
}

impl TerminalElement {
    pub fn new(view: Entity<TerminalView>, focus_handle: FocusHandle, focused: bool) -> Self {
        Self { view, focus_handle, focused }
    }
}

pub(crate) struct LayoutState {
    hitbox: Hitbox,
    backgrounds: Vec<PaintQuad>,
    selections: Vec<PaintQuad>,
    highlights: Vec<PaintQuad>,
    link_underline: Option<PaintQuad>,
    block_cursor: Option<PaintQuad>,
    texts: Vec<(Point<Pixels>, ShapedLine)>,
    cursor: Option<PaintQuad>,
    cursor_bounds: Option<Bounds<Pixels>>,
    marked_text: Option<(Bounds<Pixels>, ShapedLine)>,
    background: Hsla,
    line_height: Pixels,
}

/// A stretch of cells on one line that draws as one shaped run.
struct TextBatch {
    line: usize,
    column: usize,
    next_column: usize,
    text: String,
    run: TextRun,
    closed: bool,
}

/// Merges adjacent same-coloured cells on a line into one rectangle.
#[derive(Default)]
struct RectBatcher {
    current: Option<(usize, usize, usize, Hsla)>,
    rects: Vec<(usize, usize, usize, Hsla)>,
}

impl RectBatcher {
    fn push(&mut self, line: usize, column: usize, width: usize, color: Hsla) {
        if let Some((current_line, _, end, current_color)) = self.current.as_mut()
            && *current_line == line
            && *end == column
            && *current_color == color
        {
            *end = column + width;
            return;
        }
        self.flush();
        self.current = Some((line, column, column + width, color));
    }

    fn flush(&mut self) {
        if let Some(rect) = self.current.take() {
            self.rects.push(rect);
        }
    }

    fn into_quads(mut self, layout: &GridLayout) -> Vec<PaintQuad> {
        self.flush();
        self.rects
            .into_iter()
            .map(|(line, start, end, color)| fill(cell_bounds(layout, line, start, end - start), color))
            .collect()
    }
}

fn cell_bounds(layout: &GridLayout, line: usize, column: usize, width: usize) -> Bounds<Pixels> {
    Bounds::new(
        point(layout.origin.x + layout.cell_width * column as f32, layout.origin.y + layout.line_height * line as f32),
        size(layout.cell_width * width as f32, layout.line_height),
    )
}

fn is_blank(cell: &Cell) -> bool {
    (cell.c == ' ' || cell.c == '\t')
        && !cell.flags.intersects(Flags::ALL_UNDERLINES | Flags::STRIKEOUT)
        && cell.zerowidth().is_none()
}

fn same_style(a: &TextRun, b: &TextRun) -> bool {
    a.font == b.font && a.color == b.color && a.underline == b.underline && a.strikethrough == b.strikethrough
}

impl Element for TerminalElement {
    type RequestLayoutState = ();
    type PrepaintState = LayoutState;

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
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = relative(1.).into();
        style.flex_grow = 1.;
        (window.request_layout(style, [], cx), ())
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
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        let palette = Palette::from_theme(cx.theme());
        let theme_colors = cx.theme().colors.clone();
        let metrics = FontMetrics::from_settings(cx);
        let settings = terminal_settings(cx);
        let minimum_contrast = settings.terminal_minimum_contrast_ratio as f32;
        let inactive_style = settings.terminal_cursor_inactive_style.clone();
        let font = metrics.font.clone();
        let font_size = metrics.size;

        let text_system = window.text_system().clone();
        let font_id = text_system.resolve_font(&font);
        let cell_width = text_system.advance(font_id, font_size, 'm').map(|advance| advance.width).unwrap_or(font_size * 0.6)
            + metrics.letter_spacing;
        // Never zero or negative (a small font with negative letter spacing, a 0 font size from
        // the file): the grid divides by these, and a 0 would ask for billions of columns.
        let cell_width = cell_width.max(px(1.));
        let line_height = (font_size * LINE_HEIGHT * metrics.line_height).round().max(px(1.));
        let layout = GridLayout {
            origin: bounds.origin,
            cell_width,
            line_height,
            columns: ((bounds.size.width / cell_width) as usize).max(2),
            lines: ((bounds.size.height / line_height) as usize).max(1),
        };

        self.view.update(cx, |view, _| view.set_layout(layout));
        let view = self.view.read(cx);
        let blink_visible = view.cursor_blink_visible;
        let marked = view.marked_text.clone();
        let search = view.find.as_ref().map(|find| (find.matches.clone(), find.active));
        let hovered_link = view.hovered_link.as_ref().map(|hovered| (hovered.row, hovered.columns.clone()));
        let term = view.terminal.term.clone();
        let term = term.lock();
        let content = term.renderable_content();
        let display_offset = content.display_offset as i32;
        let colors = content.colors;

        // The cursor, in viewport cells; unfocused, drawn the way `terminalCursorInactiveStyle` asks.
        let cursor_line = content.cursor.point.line.0 + display_offset;
        let cursor_column = content.cursor.point.column.0;
        let cursor_shape = match content.cursor.shape {
            CursorShape::Hidden => CursorShape::Hidden,
            _ if !self.focused => match inactive_style.as_str() {
                "block" => CursorShape::Block,
                "bar" => CursorShape::Beam,
                "underline" => CursorShape::Underline,
                "none" => CursorShape::Hidden,
                _ => CursorShape::HollowBlock,
            },
            shape => shape,
        };
        let cursor_visible = cursor_shape != CursorShape::Hidden
            && (0..layout.lines as i32).contains(&cursor_line)
            && (blink_visible || !self.focused || cursor_shape == CursorShape::HollowBlock)
            && marked.is_none();
        let cursor_wide = term.grid()[content.cursor.point].flags.contains(Flags::WIDE_CHAR);
        let cursor_color = palette.resolve(Color::Named(NamedColor::Cursor), colors);
        let block_cursor = cursor_visible && cursor_shape == CursorShape::Block;

        let mut backgrounds = RectBatcher::default();
        let mut selections = RectBatcher::default();
        let mut batches: Vec<TextBatch> = Vec::new();

        for indexed in content.display_iter {
            let line = indexed.point.line.0 + display_offset;
            if !(0..layout.lines as i32).contains(&line) {
                continue;
            }
            let line = line as usize;
            let column = indexed.point.column.0;
            let cell = indexed.cell;
            if cell.flags.intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER) {
                continue;
            }
            let width = if cell.flags.contains(Flags::WIDE_CHAR) { 2 } else { 1 };

            let (mut fg, mut bg) = (cell.fg, cell.bg);
            if cell.flags.contains(Flags::INVERSE) {
                std::mem::swap(&mut fg, &mut bg);
            }
            let background = palette.resolve(bg, colors);
            let mut foreground = palette.resolve(fg, colors);
            if cell.flags.contains(Flags::DIM) {
                foreground = dim(foreground);
            } else {
                foreground = ensure_contrast(foreground, background, minimum_contrast);
            }
            if cell.flags.contains(Flags::HIDDEN) {
                foreground = background;
            }
            if bg != Color::Named(NamedColor::Background) {
                backgrounds.push(line, column, width, background);
            }
            if content.selection.is_some_and(|selection| selection.contains(indexed.point)) {
                selections.push(line, column, width, palette.selection);
            }
            if is_blank(cell) {
                continue;
            }

            let under_cursor = block_cursor && line as i32 == cursor_line && column == cursor_column;
            if under_cursor {
                foreground = palette.background;
            }
            let run = text_run(cell, &font, foreground, &palette, colors);

            let appended = batches.last_mut().is_some_and(|batch| {
                if batch.closed || batch.line != line || batch.next_column > column || width > 1 || !same_style(&batch.run, &run) {
                    return false;
                }
                for _ in batch.next_column..column {
                    batch.text.push(' ');
                }
                push_cell_text(&mut batch.text, cell);
                batch.next_column = column + 1;
                batch.run.len = batch.text.len();
                true
            });
            if !appended {
                let mut text = String::new();
                push_cell_text(&mut text, cell);
                batches.push(TextBatch {
                    line,
                    column,
                    next_column: column + width,
                    run: TextRun { len: text.len(), ..run },
                    text,
                    closed: width > 1,
                });
            }
        }

        let texts = batches
            .into_iter()
            .map(|batch| {
                let origin = cell_bounds(&layout, batch.line, batch.column, 1).origin;
                let shaped = text_system.shape_line(SharedString::from(batch.text), font_size, &[batch.run], Some(cell_width));
                (origin, shaped)
            })
            .collect();

        let cursor_cell = (0..layout.lines as i32)
            .contains(&cursor_line)
            .then(|| cell_bounds(&layout, cursor_line as usize, cursor_column, if cursor_wide { 2 } else { 1 }));
        let (block_cursor_quad, cursor) = match (cursor_visible, cursor_cell) {
            (true, Some(cell)) => match cursor_shape {
                CursorShape::Block => (Some(fill(cell, cursor_color)), None),
                CursorShape::Beam => (None, Some(fill(Bounds::new(cell.origin, size(metrics.cursor_width, cell.size.height)), cursor_color))),
                CursorShape::Underline => (
                    None,
                    Some(fill(
                        Bounds::new(point(cell.origin.x, cell.bottom() - metrics.cursor_width), size(cell.size.width, metrics.cursor_width)),
                        cursor_color,
                    )),
                ),
                CursorShape::HollowBlock => (None, Some(outline(cell, cursor_color, gpui::BorderStyle::Solid))),
                CursorShape::Hidden => (None, None),
            },
            _ => (None, None),
        };

        let marked_text = marked.zip(cursor_cell).map(|(text, cell)| {
            let run = TextRun {
                len: text.len(),
                font: font.clone(),
                color: palette.foreground,
                background_color: None,
                underline: Some(UnderlineStyle { color: Some(palette.foreground), thickness: px(1.), wavy: false }),
                strikethrough: None,
            };
            let shaped = text_system.shape_line(SharedString::from(text), font_size, &[run], None);
            let bounds = Bounds::new(cell.origin, size(shaped.width.max(layout.cell_width), layout.line_height));
            (bounds, shaped)
        });

        let mut highlights = RectBatcher::default();
        if let Some((matches, active)) = search {
            let top = -display_offset;
            let bottom = top + layout.lines as i32 - 1;
            for (index, found) in matches.iter().enumerate() {
                let (start, end) = (*found.start(), *found.end());
                if end.line.0 < top || start.line.0 > bottom {
                    continue;
                }
                let color = if Some(index) == active { theme_colors.primary.opacity(0.5) } else { theme_colors.selected };
                for line in start.line.0.max(top)..=end.line.0.min(bottom) {
                    let first = if line == start.line.0 { start.column.0 } else { 0 };
                    let last = if line == end.line.0 { end.column.0 } else { layout.columns.saturating_sub(1) };
                    if last >= first {
                        highlights.push((line + display_offset) as usize, first, last - first + 1, color);
                    }
                }
                highlights.flush();
            }
        }
        let link_underline = hovered_link.filter(|(row, _)| *row < layout.lines).map(|(row, columns)| {
            let cell = cell_bounds(&layout, row, columns.start, columns.end.saturating_sub(columns.start).max(1));
            fill(Bounds::new(point(cell.origin.x, cell.bottom() - px(2.)), size(cell.size.width, px(1.))), theme_colors.primary)
        });

        LayoutState {
            hitbox,
            backgrounds: backgrounds.into_quads(&layout),
            selections: selections.into_quads(&layout),
            highlights: highlights.into_quads(&layout),
            link_underline,
            block_cursor: block_cursor_quad,
            texts,
            cursor,
            cursor_bounds: cursor_cell,
            marked_text,
            background: palette.background,
            line_height,
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        layout: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        window.set_cursor_style(CursorStyle::IBeam, &layout.hitbox);
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            for quad in layout
                .backgrounds
                .drain(..)
                .chain(layout.selections.drain(..))
                .chain(layout.highlights.drain(..))
                .chain(layout.block_cursor.take())
            {
                window.paint_quad(quad);
            }
            for (origin, line) in &layout.texts {
                line.paint(*origin, layout.line_height, TextAlign::Left, None, window, cx).ok();
            }
            if let Some(underline) = layout.link_underline.take() {
                window.paint_quad(underline);
            }
            if let Some(cursor) = layout.cursor.take() {
                window.paint_quad(cursor);
            }
            if let Some((marked_bounds, line)) = &layout.marked_text {
                window.paint_quad(fill(*marked_bounds, layout.background));
                line.paint(marked_bounds.origin, layout.line_height, TextAlign::Left, None, window, cx).ok();
            }
        });

        window.handle_input(
            &self.focus_handle,
            TerminalInputHandler { view: self.view.downgrade(), cursor_bounds: layout.cursor_bounds },
            cx,
        );
        self.register_mouse_listeners(layout.hitbox.clone(), window);
    }
}

impl TerminalElement {
    fn register_mouse_listeners(&self, hitbox: Hitbox, window: &mut Window) {
        let view = self.view.clone();
        let down_hitbox = hitbox.clone();
        window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
            if phase == DispatchPhase::Bubble && down_hitbox.is_hovered(window) {
                view.update(cx, |view, cx| view.mouse_down(event, window, cx));
            }
        });

        let view = self.view.clone();
        let move_hitbox = hitbox.clone();
        window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
            if phase == DispatchPhase::Bubble {
                let hovered = move_hitbox.is_hovered(window);
                view.update(cx, |view, cx| view.mouse_move(event, hovered, cx));
            }
        });

        let view = self.view.clone();
        window.on_mouse_event(move |event: &MouseUpEvent, phase, _, cx| {
            if phase == DispatchPhase::Bubble {
                view.update(cx, |view, cx| view.mouse_up(event, cx));
            }
        });

        let view = self.view.clone();
        window.on_mouse_event(move |event: &ScrollEvent, phase, window, cx| {
            if phase == DispatchPhase::Bubble && hitbox.should_handle_scroll(window) {
                view.update(cx, |view, cx| view.scroll_wheel(event, cx));
            }
        });
    }
}

fn push_cell_text(text: &mut String, cell: &Cell) {
    text.push(cell.c);
    if let Some(zero_width) = cell.zerowidth() {
        text.extend(zero_width);
    }
}

fn text_run(cell: &Cell, font: &Font, color: Hsla, palette: &Palette, colors: &alacritty_terminal::term::color::Colors) -> TextRun {
    let flags = cell.flags;
    let mut font = font.clone();
    if flags.intersects(Flags::BOLD) {
        font.weight = FontWeight::BOLD;
    }
    if flags.intersects(Flags::ITALIC) {
        font.style = FontStyle::Italic;
    }
    let underline = flags.intersects(Flags::ALL_UNDERLINES).then(|| UnderlineStyle {
        color: Some(cell.underline_color().map_or(color, |underline| palette.resolve(underline, colors))),
        thickness: px(1.),
        wavy: flags.contains(Flags::UNDERCURL),
    });
    let strikethrough = flags
        .contains(Flags::STRIKEOUT)
        .then(|| StrikethroughStyle { thickness: px(1.), color: Some(color) });
    TextRun { len: 0, font, color, background_color: None, underline, strikethrough }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> GridLayout {
        GridLayout { origin: point(px(10.), px(20.)), cell_width: px(8.), line_height: px(16.), columns: 80, lines: 24 }
    }

    #[test]
    fn rect_batcher_merges_adjacent_cells_of_one_colour() {
        let red = gpui::red();
        let blue = gpui::blue();
        let mut batcher = RectBatcher::default();
        batcher.push(0, 0, 1, red);
        batcher.push(0, 1, 2, red);
        batcher.push(0, 3, 1, blue);
        batcher.push(0, 5, 1, blue);
        batcher.push(1, 6, 1, blue);
        let quads = batcher.into_quads(&layout());
        let bounds: Vec<_> = quads.iter().map(|quad| quad.bounds).collect();
        assert_eq!(bounds.len(), 4);
        assert_eq!(bounds[0], Bounds::new(point(px(10.), px(20.)), size(px(24.), px(16.))));
        assert_eq!(bounds[1].origin.x, px(34.));
        assert_eq!(bounds[3].origin.y, px(36.));
    }
}
