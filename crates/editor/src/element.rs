//! The text surface: gutter, rows, selections, carets and decorations. Only the visible rows are
//! shaped each frame (GPUI caches identical shaped lines between frames), so long files scroll
//! as fast as short ones.

use std::{ops::Range, sync::Arc};

use gpui::{
    AnyElement, App, AvailableSpace, Bounds, ContentMask, CursorStyle, DispatchPhase, Element, ElementId, ElementInputHandler, Entity, Font, FontFeatures,
    FontStyle, FontWeight, GlobalElementId, Hitbox, HitboxBehavior, Hsla, LayoutId, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, PaintQuad, PathBuilder, Pixels, Point, ScrollEvent, ShapedLine, SharedString, Style, TextAlign,
    TextRun, TransformationMatrix, UnderlineStyle, Window, fill, font, point, px, relative, size,
};
use theme::ActiveTheme;
use ui::IconName;

use lsp_client::Severity;

use crate::{
    Autoscroll, Drag, Editor,
    display_map::{DisplayMap, DisplayPoint, display_column, expand_tabs},
    document::Document,
    git::HunkKind,
    lsp::HighlightKind,
    peek::PEEK_ROWS,
    popover::severity_color,
    search,
    sticky::{MAX_STICKY_LINES, sticky_lines},
    syntax::SyntaxKind,
};

/// Space between the gutter and the first column.
const TEXT_PADDING: Pixels = px(6.);
/// The gutter, left to right: breakpoints (and diagnostics), folds, line numbers with git changes
/// in their right padding.
const BREAKPOINT_LANE: Pixels = px(18.);
const FOLD_LANE: Pixels = px(10.);
const NUMBER_PAD_LEFT: Pixels = px(16.);
const NUMBER_GAP: Pixels = px(12.);
const GIT_BAR: Pixels = px(3.);
const SCROLLBAR_WIDTH: Pixels = px(10.);
/// The minimap is at most this wide, and a sixth of the editor when that is narrower.
const MINIMAP_MAX_WIDTH: Pixels = px(120.);
/// The minimap draws the text this many times smaller.
const MINIMAP_SCALE: f32 = 4.;
const MINIMAP_PADDING: Pixels = px(4.);
/// Longer rows are cut when shaped (without soft wrap); minified files stay responsive.
const MAX_SHAPED_ROW: usize = 8 * 1024;
/// Highlight queries look at no more text than this per frame.
const MAX_HIGHLIGHT_RANGE: usize = 1024 * 1024;

/// Per-version results the frames reuse.
#[derive(Default)]
pub(crate) struct Caches {
    highlights: Option<HighlightCache>,
    longest_line: Option<(usize, usize)>,
    minimap: Option<MinimapCache>,
}

/// The minimap's blocks for one scroll position: (row, first column, columns, colour).
struct MinimapCache {
    version: usize,
    generation: usize,
    index_generation: usize,
    first_row: usize,
    theme: String,
    blocks: Arc<Vec<(usize, usize, usize, Hsla)>>,
}

struct HighlightCache {
    version: usize,
    generation: usize,
    range: Range<usize>,
    spans: Arc<Vec<(Range<usize>, SyntaxKind)>>,
    brackets: Arc<Vec<(usize, usize)>>,
}

/// A visible row as drawn, for hit testing and the IME.
pub(crate) struct RowHit {
    pub row: usize,
    /// Buffer offset of the row's first byte.
    pub start: usize,
    pub len: usize,
    /// The row ends its line (it is not cut by soft wrap).
    pub last_in_line: bool,
    pub shaped: ShapedLine,
    /// Buffer byte (relative to `start`) to display byte, when the row has tabs.
    pub tab_map: Option<Vec<usize>>,
    pub top: Pixels,
}

impl RowHit {
    fn display_index(&self, relative: usize) -> usize {
        match &self.tab_map {
            Some(map) => map.get(relative).copied().unwrap_or_else(|| map.last().copied().unwrap_or(0)),
            None => relative,
        }
    }

    fn buffer_index(&self, display: usize) -> usize {
        match &self.tab_map {
            Some(map) => map.partition_point(|index| *index <= display).saturating_sub(1),
            None => display,
        }
    }

    /// The x of a buffer offset in this row, relative to the row origin.
    pub fn x_for(&self, offset: usize, char_width: Pixels) -> Pixels {
        let relative = offset.saturating_sub(self.start);
        let shaped_len = self.shaped.len();
        let display = self.display_index(relative.min(self.len));
        if display <= shaped_len {
            self.shaped.x_for_index(display)
        } else {
            self.shaped.width + char_width * (display - shaped_len) as f32
        }
    }

    pub fn offset_for_x(&self, x: Pixels) -> usize {
        let display = self.shaped.closest_index_for_x(x.max(px(0.)));
        let mut relative = self.buffer_index(display).min(self.len);
        // The end of a wrapped row is drawn at the start of the next row.
        if !self.last_in_line && relative >= self.len && self.len > 0 {
            relative = self.len - 1;
        }
        self.start + relative
    }

    /// Whether a caret at `offset` is drawn on this row.
    pub fn holds(&self, offset: usize) -> bool {
        offset >= self.start && (offset < self.start + self.len || (offset == self.start + self.len && (self.last_in_line || self.len == 0)))
    }
}

/// Where the last frame put things.
pub(crate) struct HitLayout {
    pub text_bounds: Bounds<Pixels>,
    /// The x ranges of the gutter's breakpoint and fold lanes.
    pub breakpoint_lane: Range<Pixels>,
    pub fold_lane: Range<Pixels>,
    /// The `⋯` after each folded header, and its line.
    pub fold_placeholders: Vec<(Bounds<Pixels>, usize)>,
    /// The pinned scope headers and their lines.
    pub sticky: Vec<(Bounds<Pixels>, usize)>,
    /// Each code lens drawn: where, its line, and its index among the line's lenses.
    pub lenses: Vec<(Bounds<Pixels>, usize, usize)>,
    /// The inline blame annotation and its line.
    pub blame: Option<(Bounds<Pixels>, usize)>,
    /// The code action lightbulb at the start of the caret's line.
    pub lightbulb: Option<Bounds<Pixels>>,
    pub minimap: Option<MinimapLayout>,
    /// Window position of the first row's first column, after scrolling.
    pub origin: Point<Pixels>,
    pub line_height: Pixels,
    pub char_width: Pixels,
    pub viewport_rows: usize,
    pub rows: Vec<RowHit>,
    pub scrollbar: Option<ScrollbarLayout>,
    pub max_scroll: Point<Pixels>,
}

#[derive(Clone, Copy)]
pub(crate) struct ScrollbarLayout {
    pub track: Bounds<Pixels>,
    pub thumb: Bounds<Pixels>,
}

#[derive(Clone, Copy)]
pub(crate) struct MinimapLayout {
    pub bounds: Bounds<Pixels>,
    /// The box that marks the viewport.
    pub slider: Bounds<Pixels>,
    /// How far the slider moves from the top to the bottom of the scroll range.
    pub travel: Pixels,
}

impl HitLayout {
    pub fn row(&self, row: usize) -> Option<&RowHit> {
        self.rows.binary_search_by_key(&row, |hit| hit.row).ok().map(|index| &self.rows[index])
    }

    pub fn lens_at(&self, position: Point<Pixels>) -> Option<(usize, usize)> {
        self.lenses.iter().find(|(bounds, _, _)| bounds.contains(&position)).map(|(_, line, index)| (*line, *index))
    }

    pub fn row_holding(&self, offset: usize) -> Option<&RowHit> {
        self.rows.iter().find(|row| row.holds(offset))
    }
}

pub struct EditorElement {
    editor: Entity<Editor>,
}

impl EditorElement {
    pub fn new(editor: Entity<Editor>) -> Self {
        Self { editor }
    }
}

/// What prepaint hands to paint.
pub struct PaintState {
    text_hitbox: Hitbox,
    gutter_hitbox: Hitbox,
    scrollbar_hitbox: Option<Hitbox>,
    background: Hsla,
    text_bounds: Bounds<Pixels>,
    gutter_bounds: Bounds<Pixels>,
    line_height: Pixels,
    /// Drawn under the text: current line, guides, rulers, selections, matches.
    underlays: Vec<PaintQuad>,
    rows: Vec<(ShapedLine, Point<Pixels>)>,
    glyphs: Vec<(ShapedLine, Point<Pixels>)>,
    /// The lines of a multi-line AI suggestion after its first, over the rows below the caret.
    ghost_quads: Vec<PaintQuad>,
    ghost_rows: Vec<(ShapedLine, Point<Pixels>)>,
    cursors: Vec<PaintQuad>,
    gutter: Vec<(ShapedLine, Point<Pixels>)>,
    /// Diagnostic, breakpoint and git markers beside the line numbers.
    gutter_marks: Vec<PaintQuad>,
    /// Fold chevrons and the execution arrow.
    gutter_icons: Vec<(Bounds<Pixels>, SharedString, Hsla)>,
    /// Logpoint diamonds.
    gutter_paths: Vec<(Vec<Point<Pixels>>, Hsla)>,
    scrollbar: Vec<PaintQuad>,
    scrollbar_layout: Option<ScrollbarLayout>,
    minimap: Vec<PaintQuad>,
    minimap_hitbox: Option<Hitbox>,
    sticky: Option<StickyPaint>,
    /// The go-to-definition modifier is held over a word.
    link: bool,
    /// Where the references peek goes, and its content once laid out.
    peek_bounds: Option<Bounds<Pixels>>,
    peek: Option<AnyElement>,
    font: Font,
}

/// The pinned headers, drawn over the text and gutter.
struct StickyPaint {
    bounds: Bounds<Pixels>,
    quads: Vec<PaintQuad>,
    rows: Vec<(ShapedLine, Point<Pixels>)>,
}

impl Element for EditorElement {
    type RequestLayoutState = ();
    type PrepaintState = Option<PaintState>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
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
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        if bounds.size.width <= px(0.) || bounds.size.height <= px(0.) {
            return None;
        }
        let mut state = self.editor.update(cx, |editor, cx| editor.layout(bounds, window, cx));
        if let Some(peek_bounds) = state.peek_bounds {
            let font = state.font.clone();
            let line_height = state.line_height;
            if let Some(mut element) = self.editor.update(cx, |editor, cx| editor.render_references_peek(line_height, font, cx)) {
                window.with_content_mask(Some(ContentMask { bounds: state.text_bounds }), |window| {
                    element.prepaint_as_root(peek_bounds.origin, peek_bounds.size.map(AvailableSpace::Definite), window, cx);
                });
                state.peek = Some(element);
            }
        }
        Some(state)
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        state: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let Some(mut state) = state.take() else { return };
        // Rounded at the bottom like the island the editor sits in: where it reaches the island's
        // bottom edge a square fill covered the island's rounded corners; elsewhere the corner
        // shows the island's own background, the same colour.
        let radius = ui::metrics::ISLAND_RADIUS;
        window.paint_quad(fill(bounds, state.background).corner_radii(gpui::Corners { top_left: px(0.), top_right: px(0.), bottom_right: radius, bottom_left: radius }));
        let focus_handle = self.editor.read(cx).focus_handle.clone();
        window.handle_input(&focus_handle, ElementInputHandler::new(state.text_bounds, self.editor.clone()), cx);
        window.set_cursor_style(if state.link { CursorStyle::PointingHand } else { CursorStyle::IBeam }, &state.text_hitbox);
        window.set_cursor_style(CursorStyle::Arrow, &state.gutter_hitbox);
        if let Some(hitbox) = &state.scrollbar_hitbox {
            window.set_cursor_style(CursorStyle::Arrow, hitbox);
        }

        let line_height = state.line_height;
        window.with_content_mask(Some(ContentMask { bounds: state.text_bounds }), |window| {
            for quad in state.underlays {
                window.paint_quad(quad);
            }
            for (line, origin) in &state.rows {
                line.paint(*origin, line_height, TextAlign::Left, None, window, cx).ok();
            }
            for (glyph, origin) in &state.glyphs {
                glyph.paint(*origin, line_height, TextAlign::Left, None, window, cx).ok();
            }
            for quad in state.ghost_quads {
                window.paint_quad(quad);
            }
            for (line, origin) in &state.ghost_rows {
                line.paint(*origin, line_height, TextAlign::Left, None, window, cx).ok();
            }
            for quad in state.cursors {
                window.paint_quad(quad);
            }
            if let Some(peek) = &mut state.peek {
                peek.paint(window, cx);
            }
        });
        window.with_content_mask(Some(ContentMask { bounds: state.gutter_bounds }), |window| {
            for quad in state.gutter_marks {
                window.paint_quad(quad);
            }
            for (points, color) in &state.gutter_paths {
                let mut builder = PathBuilder::fill();
                for (index, point) in points.iter().enumerate() {
                    if index == 0 { builder.move_to(*point) } else { builder.line_to(*point) }
                }
                builder.close();
                if let Ok(path) = builder.build() {
                    window.paint_path(path, *color);
                }
            }
            for (bounds, path, color) in &state.gutter_icons {
                window.paint_svg(*bounds, path.clone(), None, TransformationMatrix::unit(), *color, cx).ok();
            }
            for (line, origin) in &state.gutter {
                line.paint(*origin, line_height, TextAlign::Left, None, window, cx).ok();
            }
        });
        if let Some(sticky) = state.sticky {
            window.with_content_mask(Some(ContentMask { bounds: sticky.bounds }), |window| {
                for quad in sticky.quads {
                    window.paint_quad(quad);
                }
                for (line, origin) in &sticky.rows {
                    line.paint(*origin, line_height, TextAlign::Left, None, window, cx).ok();
                }
            });
        }
        for quad in state.minimap {
            window.paint_quad(quad);
        }
        for quad in state.scrollbar {
            window.paint_quad(quad);
        }
        if let Some(hitbox) = &state.minimap_hitbox {
            window.set_cursor_style(CursorStyle::Arrow, hitbox);
        }
        self.register_mouse(bounds, &state.text_hitbox, &state.gutter_hitbox, state.scrollbar_layout, window);
    }
}

impl EditorElement {
    fn register_mouse(&self, bounds: Bounds<Pixels>, text: &Hitbox, gutter: &Hitbox, scrollbar: Option<ScrollbarLayout>, window: &mut Window) {
        window.on_mouse_event({
            let editor = self.editor.clone();
            let text = text.clone();
            let gutter = gutter.clone();
            move |event: &MouseDownEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble {
                    return;
                }
                if event.button == MouseButton::Right {
                    if text.is_hovered(window) {
                        editor.update(cx, |editor, cx| editor.deploy_context_menu(event.position, window, cx));
                        cx.stop_propagation();
                    }
                    return;
                }
                if event.button != MouseButton::Left {
                    return;
                }
                let (minimap, sticky, lens, lightbulb) = {
                    let layout = editor.read(cx).layout.as_ref();
                    let lightbulb = layout.and_then(|layout| layout.lightbulb).is_some_and(|bounds| bounds.contains(&event.position));
                    let minimap = layout.and_then(|layout| layout.minimap).filter(|minimap| minimap.bounds.contains(&event.position));
                    let sticky = layout.and_then(|layout| layout.sticky.iter().find(|(bounds, _)| bounds.contains(&event.position)).map(|(_, line)| *line));
                    let lens = layout.and_then(|layout| layout.lens_at(event.position)).filter(|_| text.is_hovered(window));
                    (minimap, sticky, lens, lightbulb)
                };
                if let Some(scrollbar) = scrollbar
                    && scrollbar.track.contains(&event.position)
                {
                    editor.update(cx, |editor, cx| editor.scrollbar_down(event.position, scrollbar, cx));
                    cx.stop_propagation();
                } else if lightbulb {
                    editor.update(cx, |editor, cx| editor.open_lightbulb(window, cx));
                    cx.stop_propagation();
                } else if let Some(minimap) = minimap {
                    editor.update(cx, |editor, cx| editor.minimap_down(event.position, minimap, cx));
                    cx.stop_propagation();
                } else if let Some(line) = sticky {
                    editor.update(cx, |editor, cx| editor.sticky_click(line, window, cx));
                    cx.stop_propagation();
                } else if let Some((line, index)) = lens {
                    editor.update(cx, |editor, cx| editor.run_code_lens(line, index, window, cx));
                    cx.stop_propagation();
                } else if text.is_hovered(window) {
                    editor.update(cx, |editor, cx| editor.mouse_down(event, false, window, cx));
                    cx.stop_propagation();
                } else if gutter.is_hovered(window) {
                    editor.update(cx, |editor, cx| editor.mouse_down(event, true, window, cx));
                    cx.stop_propagation();
                }
            }
        });
        window.on_mouse_event({
            let editor = self.editor.clone();
            let text = text.clone();
            move |event: &MouseMoveEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble {
                    return;
                }
                let over_minimap = editor.read(cx).layout.as_ref().and_then(|layout| layout.minimap).is_some_and(|minimap| minimap.bounds.contains(&event.position));
                if editor.read(cx).minimap_hovered != over_minimap {
                    editor.update(cx, |editor, cx| {
                        editor.minimap_hovered = over_minimap;
                        cx.notify();
                    });
                }
                if event.pressed_button == Some(MouseButton::Left) {
                    if editor.read(cx).drag.is_some() {
                        editor.update(cx, |editor, cx| editor.mouse_drag(event.position, cx));
                    }
                } else if event.pressed_button.is_none() {
                    let lens = editor.read(cx).layout.as_ref().and_then(|layout| layout.lens_at(event.position)).filter(|_| text.is_hovered(window));
                    if editor.read(cx).code_lens.hovered != lens {
                        editor.update(cx, |editor, cx| editor.hover_code_lens(lens, cx));
                    }
                    let blame = editor
                        .read(cx)
                        .layout
                        .as_ref()
                        .and_then(|layout| layout.blame)
                        .filter(|(bounds, _)| bounds.contains(&event.position) && text.is_hovered(window))
                        .map(|(_, line)| line);
                    editor.update(cx, |editor, cx| editor.hover_blame(blame, None, cx));
                    if text.is_hovered(window) {
                        editor.update(cx, |editor, cx| editor.mouse_moved(event.position, event.modifiers, cx));
                    } else if editor.read(cx).lsp.wants_mouse_leave() {
                        let outside = !bounds.contains(&event.position);
                        editor.update(cx, |editor, cx| editor.mouse_left_text(outside, cx));
                    }
                }
            }
        });
        window.on_mouse_event({
            let editor = self.editor.clone();
            move |event: &MouseUpEvent, phase, _, cx| {
                if phase == DispatchPhase::Bubble && event.button == MouseButton::Left && editor.read(cx).drag.is_some() {
                    editor.update(cx, |editor, cx| {
                        editor.drag = None;
                        cx.notify();
                    });
                }
            }
        });
        window.on_mouse_event({
            let editor = self.editor.clone();
            let text = text.clone();
            move |event: &ScrollEvent, phase, window, cx| {
                if phase == DispatchPhase::Bubble && text.should_handle_scroll(window) {
                    editor.update(cx, |editor, cx| editor.scroll_wheel(event, cx));
                    cx.stop_propagation();
                }
            }
        });
    }
}

/// What a row's bytes are underlined with.
#[derive(Clone, Copy, PartialEq)]
enum Mark {
    None,
    Diagnostic(Severity),
    Link,
}

/// Puts inlay hints (virtual text at buffer offsets relative to the row) into a row's display
/// text, splitting the runs around them and shifting the buffer→display map.
fn insert_inlays(
    display: String,
    runs: Vec<TextRun>,
    map: Vec<usize>,
    hints: &[(usize, &str, bool)],
    hint_run: impl Fn(usize, bool) -> TextRun,
) -> (String, Vec<TextRun>, Vec<usize>) {
    let mut text = String::with_capacity(display.len() + hints.iter().map(|(_, label, _)| label.len()).sum::<usize>());
    let mut new_runs: Vec<TextRun> = Vec::with_capacity(runs.len() + hints.len() * 2);
    let mut runs = runs.into_iter();
    let mut current = runs.next();
    let mut consumed = 0;
    let mut copy_until = |to: usize, text: &mut String, new_runs: &mut Vec<TextRun>| {
        while consumed < to {
            let Some(run) = current.as_mut() else { break };
            let piece = run.len.min(to - consumed);
            text.push_str(&display[consumed..consumed + piece]);
            new_runs.push(TextRun { len: piece, ..run.clone() });
            run.len -= piece;
            consumed += piece;
            if run.len == 0 {
                current = runs.next();
            }
        }
    };
    for (offset, label, ghost) in hints {
        let at = map.get(*offset).copied().unwrap_or(display.len()).min(display.len());
        copy_until(at, &mut text, &mut new_runs);
        text.push_str(label);
        new_runs.push(hint_run(label.len(), *ghost));
    }
    copy_until(display.len(), &mut text, &mut new_runs);
    // Hints before a byte push it right; a caret at a hint's offset stays in front of it.
    let shifted = map
        .iter()
        .enumerate()
        .map(|(index, value)| value + hints.iter().filter(|(offset, _, _)| *offset < index).map(|(_, label, _)| label.len()).sum::<usize>())
        .collect();
    (text, new_runs, shifted)
}

/// What a row's bytes are drawn with.
#[derive(Clone, Copy, PartialEq)]
enum Paint {
    Plain,
    Syntax(SyntaxKind),
    Bracket(usize),
}

/// The settings a frame reads.
struct FrameSettings {
    font: Font,
    font_size: Pixels,
    line_height_factor: f32,
    line_numbers: bool,
    relative_numbers: bool,
    indent_guides: bool,
    whitespace: String,
    rulers: Vec<usize>,
    cursor_style: String,
    italic_comments: bool,
    bracket_colors: bool,
    occurrences: bool,
    scroll_beyond_last_line: bool,
    smooth_scrolling: bool,
    minimap: bool,
    sticky_scroll: bool,
    inline_blame: bool,
}

impl FrameSettings {
    fn read(cx: &App) -> Self {
        let settings = settings::get(cx);
        let mut base = font(SharedString::from(settings.font_family.clone()));
        if !settings.editor_font_ligatures {
            base.features = FontFeatures(Arc::new(vec![("calt".into(), 0), ("liga".into(), 0)]));
        }
        Self {
            font: base,
            font_size: px((settings.font_size as f32).clamp(6., 72.) * crate::zoom_level(cx)),
            line_height_factor: (settings.editor_line_height as f32).clamp(1., 3.),
            line_numbers: settings.line_numbers,
            relative_numbers: settings.vim_mode && settings.vim_relative_line_numbers,
            indent_guides: settings.render_indent_guides,
            whitespace: settings.render_whitespace.clone(),
            rulers: settings.editor_rulers.iter().filter(|column| **column > 0.).map(|column| *column as usize).collect(),
            cursor_style: settings.editor_cursor_style.clone(),
            italic_comments: settings.editor_italic_comments,
            bracket_colors: settings.editor_bracket_pair_colorization,
            occurrences: settings.highlight_occurrences,
            scroll_beyond_last_line: settings.editor_scroll_beyond_last_line,
            smooth_scrolling: settings.editor_smooth_scrolling,
            minimap: settings.show_minimap || crate::demo("minimap"),
            sticky_scroll: settings.editor_sticky_scroll || crate::demo("sticky"),
            inline_blame: settings.enable_inline_git_blame,
        }
    }
}

/// A visible row before shaping.
struct RowPlan {
    row: usize,
    line: usize,
    first_in_line: bool,
    last_in_line: bool,
    start: usize,
    text: String,
}

impl Editor {
    /// Lays out the visible rows and everything drawn with them.
    fn layout(&mut self, bounds: Bounds<Pixels>, window: &mut Window, cx: &mut gpui::Context<Self>) -> PaintState {
        let mut frame = FrameSettings::read(cx);
        // A window in the background shows no caret and a grey selection, as a page in an
        // inactive WebKit window does.
        let window_active = window.is_window_active();
        if let Some(relative) = self.vim_relative_numbers(cx) {
            frame.relative_numbers = relative;
        }
        if let Some(style) = self.vim_cursor_style() {
            frame.cursor_style = style.to_string();
        }
        self.reveal_carets();
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let text_system = window.text_system().clone();
        let font_size = frame.font_size;
        let line_height = px((f32::from(font_size) * frame.line_height_factor).round());
        let char_width = text_system
            .advance(text_system.resolve_font(&frame.font), font_size, 'm')
            .map(|advance| advance.width)
            .unwrap_or(font_size * 0.6);
        let tab_size = self.document.tab_size;

        let buffer = self.document.buffer.clone();
        let line_count = buffer.line_count();
        let digits = line_count.to_string().len().max(2);
        let numbers_width = if frame.line_numbers { NUMBER_PAD_LEFT + char_width * digits as f32 + NUMBER_GAP } else { GIT_BAR * 2. };
        let gutter_width = BREAKPOINT_LANE + FOLD_LANE + numbers_width;
        let gutter_bounds = Bounds::new(bounds.origin, size(gutter_width, bounds.size.height));
        let fold_left = gutter_bounds.left() + BREAKPOINT_LANE;
        let numbers_right = gutter_bounds.right() - if frame.line_numbers { NUMBER_GAP } else { GIT_BAR * 2. };
        let git_left = gutter_bounds.right() - GIT_BAR * 2.;
        let minimap_width = if frame.minimap && bounds.size.width > px(240.) { MINIMAP_MAX_WIDTH.min(bounds.size.width / 6.).round() } else { px(0.) };
        let text_right = bounds.right() - if minimap_width > px(0.) { minimap_width + SCROLLBAR_WIDTH } else { px(0.) };
        let text_bounds = Bounds::from_corners(point(bounds.left() + gutter_width, bounds.top()), point(text_right, bounds.bottom()));
        let text_width = text_bounds.size.width - TEXT_PADDING - if minimap_width > px(0.) { px(0.) } else { SCROLLBAR_WIDTH };
        let viewport_height = bounds.size.height;

        let wrap = self.soft_wrap(cx);
        let columns = wrap.then(|| ((text_width / char_width).floor() as usize).max(20));
        if wrap {
            self.scroll.x = px(0.);
        }
        let wrap_index = self.row_index(columns);
        let map = DisplayMap::new(&buffer, tab_size, wrap_index.as_deref());
        let row_count = map.row_count();
        let viewport_rows = (viewport_height / line_height).floor() as usize;

        // Vertical scrolling and autoscroll.
        let bottom_space = if frame.scroll_beyond_last_line { viewport_height - line_height } else { line_height * 2. };
        let content_height = line_height * row_count as f32 + bottom_space.max(px(0.));
        let max_scroll_y = (content_height - viewport_height).max(px(0.));
        let newest_head = self.document.newest_selection().head;
        let autoscroll = self.autoscroll.take();
        // Where a jump starts: a page key's offset before it moved, or the glide's current one.
        let jump_from = self.smooth_from.take().unwrap_or(self.scroll.y);
        if let Some((_, to, _)) = self.scroll_animation
            && autoscroll.is_none()
        {
            self.scroll.y = to;
        }
        if let Some(mode) = autoscroll {
            let head_row = map.to_display(newest_head).row;
            let y = line_height * head_row as f32;
            match mode {
                Autoscroll::Fit => {
                    let margin = (line_height * 3.).min(line_height * (viewport_rows / 4) as f32);
                    if y < self.scroll.y + margin {
                        self.scroll.y = y - margin;
                    } else if y + line_height > self.scroll.y + viewport_height - margin {
                        self.scroll.y = y + line_height - viewport_height + margin;
                    }
                }
                Autoscroll::Center => {
                    if y < self.scroll.y || y + line_height > self.scroll.y + viewport_height {
                        self.scroll.y = y - (viewport_height - line_height) / 2.;
                    }
                }
            }
        }
        if let Some(line) = self.peek_line()
            && let Some(peek) = &mut self.peek
            && peek.reveal
        {
            peek.reveal = false;
            let top = line_height * map.text_row_of_line(line) as f32;
            let bottom = line_height * (map.first_row_of_line(map.next_line(line)) as f32);
            if bottom > self.scroll.y + viewport_height {
                self.scroll.y = bottom - viewport_height;
            }
            if top < self.scroll.y {
                self.scroll.y = top;
            }
        }
        self.scroll.y = self.scroll.y.clamp(px(0.), max_scroll_y);
        // Smooth Scrolling: a jump of more than a couple of lines (go to line, a search result,
        // page up/down) glides there over 180ms instead of landing at once; the wheel stops it.
        if frame.smooth_scrolling {
            let jumped = (self.scroll.y - jump_from).abs() > line_height * 2.;
            if jumped && self.scroll_animation.is_none_or(|(_, to, _)| to != self.scroll.y) {
                self.scroll_animation = Some((jump_from, self.scroll.y, web_time::Instant::now()));
            }
            if let Some((from, to, started)) = self.scroll_animation {
                let t = (started.elapsed().as_secs_f32() / 0.18).min(1.);
                let eased = 1. - (1. - t).powi(3);
                self.scroll.y = (from + (to - from) * eased).clamp(px(0.), max_scroll_y);
                if t >= 1. {
                    self.scroll_animation = None;
                } else {
                    window.request_animation_frame();
                }
            }
        } else {
            self.scroll_animation = None;
        }

        // The rows on screen.
        let first_row = (self.scroll.y / line_height).floor() as usize;
        let last_row = (((self.scroll.y + viewport_height) / line_height).ceil() as usize + 1).min(row_count);
        let mut plans: Vec<RowPlan> = Vec::new();
        // The first row of each visible block: lens rows above lines, the peek below one.
        let mut lens_rows: Vec<(usize, usize)> = Vec::new();
        let mut below_rows: Vec<(usize, usize)> = Vec::new();
        if first_row < last_row {
            let mut line = map.row_to_line(first_row).0;
            let mut row = map.first_row_of_line(line);
            'lines: while row < last_row && line < line_count {
                let above = map.above(line);
                if above > 0 {
                    if row + above > first_row {
                        lens_rows.push((line, row));
                    }
                    row += above;
                }
                let text = buffer.line(line);
                let line_start = buffer.line_start(line);
                let segments = map.line_segments(&text);
                for (index, segment) in segments.iter().enumerate() {
                    if row >= last_row {
                        break 'lines;
                    }
                    if row < first_row {
                        row += 1;
                        continue;
                    }
                    let mut end = segment.end;
                    if !wrap && end - segment.start > MAX_SHAPED_ROW {
                        end = segment.start + MAX_SHAPED_ROW;
                        while !text.is_char_boundary(end) {
                            end -= 1;
                        }
                    }
                    plans.push(RowPlan {
                        row,
                        line,
                        first_in_line: index == 0,
                        last_in_line: index + 1 == segments.len(),
                        start: line_start + segment.start,
                        text: text[segment.start..end].to_string(),
                    });
                    row += 1;
                }
                let below = map.below(line);
                if below > 0 {
                    if row < last_row && row + below > first_row {
                        below_rows.push((line, row));
                    }
                    row += below;
                }
                line = map.next_line(line);
            }
        }
        let visible = match (plans.first(), plans.last()) {
            (Some(first), Some(last)) => first.start..(last.start + last.text.len()).min(buffer.len()),
            _ => 0..0,
        };

        // Highlights for the visible text.
        let (spans, brackets) = self.visible_highlights(visible.clone(), frame.bracket_colors);
        let bracket_palette = [SyntaxKind::Type, SyntaxKind::Keyword, SyntaxKind::Function];
        let style_for = |paint: Paint| -> (Hsla, FontWeight, FontStyle) {
            match paint {
                Paint::Plain => (colors.foreground, FontWeight::NORMAL, FontStyle::Normal),
                Paint::Syntax(kind) => (kind.color(&theme), kind.weight(), kind.style(frame.italic_comments)),
                Paint::Bracket(depth) => (bracket_palette[depth % 3].color(&theme), FontWeight::NORMAL, FontStyle::Normal),
            }
        };
        let marked = self.marked_range.clone();
        // Squiggles under diagnostics (an empty range marks the character at it) and the link.
        let mut squiggles: Vec<(Range<usize>, Severity)> = self
            .lsp
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.range.end >= visible.start && diagnostic.range.start <= visible.end)
            .map(|diagnostic| {
                let mut range = diagnostic.range.clone();
                if range.is_empty() {
                    let line_end = buffer.line_end(buffer.line_of(range.start));
                    range = if range.start < line_end {
                        range.start..buffer.next_boundary(range.start)
                    } else {
                        buffer.previous_boundary(range.start).max(buffer.line_start(buffer.line_of(range.start)))..range.start
                    };
                }
                (range, diagnostic.severity)
            })
            .collect();
        // The most severe last, so it paints over the others.
        squiggles.sort_by_key(|(_, severity)| std::cmp::Reverse(*severity));
        let link = self.lsp.link.clone();
        let hints = self.lsp.inlay_hints.clone();
        let ghost = self.ghost().map(|ghost| (ghost.pos, ghost.text.replace('\t', &" ".repeat(tab_size.max(1)))));
        let ghost_first = ghost.as_ref().map(|(_, text)| text.split('\n').next().unwrap_or_default().to_string());
        let mut ghost_row: Option<(usize, usize)> = None;
        let semantic_from = self.semantic.spans.partition_point(|span| span.range.end <= visible.start);
        let semantic: Vec<_> = self.semantic.spans[semantic_from..].iter().take_while(|span| span.range.start < visible.end).cloned().collect();
        let underline_for = |mark: Mark| -> Option<UnderlineStyle> {
            match mark {
                Mark::None => None,
                Mark::Link => Some(UnderlineStyle { color: Some(colors.primary), thickness: px(1.), wavy: false }),
                Mark::Diagnostic(Severity::Hint) => Some(UnderlineStyle { color: Some(colors.subtle_foreground.opacity(0.6)), thickness: px(1.), wavy: false }),
                Mark::Diagnostic(severity) => Some(UnderlineStyle { color: Some(severity_color(severity, &theme)), thickness: px(1.), wavy: true }),
            }
        };

        let mut rows: Vec<RowHit> = Vec::with_capacity(plans.len());
        for plan in &plans {
            let len = plan.text.len();
            let mut paints = vec![Paint::Plain; len];
            let span_start = spans.partition_point(|(range, _)| range.end <= plan.start);
            for (range, kind) in &spans[span_start..] {
                if range.start >= plan.start + len {
                    break;
                }
                let from = range.start.max(plan.start) - plan.start;
                let to = range.end.min(plan.start + len) - plan.start;
                paints[from..to].fill(Paint::Syntax(*kind));
            }
            let mut struck = vec![false; len];
            let semantic_start = semantic.partition_point(|span| span.range.end <= plan.start);
            for span in &semantic[semantic_start..] {
                if span.range.start >= plan.start + len {
                    break;
                }
                let (from, to) = (span.range.start.max(plan.start) - plan.start, span.range.end.min(plan.start + len) - plan.start);
                paints[from..to].fill(Paint::Syntax(span.kind));
                if span.deprecated {
                    struck[from..to].fill(true);
                }
            }
            let bracket_start = brackets.partition_point(|(offset, _)| *offset < plan.start);
            for (offset, depth) in &brackets[bracket_start..] {
                if *offset >= plan.start + len {
                    break;
                }
                paints[offset - plan.start] = Paint::Bracket(*depth);
            }
            let mut marks = vec![Mark::None; len];
            for (range, severity) in &squiggles {
                if range.end <= plan.start || range.start >= plan.start + len {
                    continue;
                }
                marks[range.start.max(plan.start) - plan.start..range.end.min(plan.start + len) - plan.start].fill(Mark::Diagnostic(*severity));
            }
            if let Some(link) = &link
                && link.start < plan.start + len
                && link.end > plan.start
            {
                marks[link.start.max(plan.start) - plan.start..link.end.min(plan.start + len) - plan.start].fill(Mark::Link);
            }
            let (display, tab_map) = expand_tabs(&plan.text, tab_size);
            let display_at = |index: usize| tab_map.as_ref().map(|map| map[index]).unwrap_or(index);
            let mut runs: Vec<TextRun> = Vec::new();
            let mut index = 0;
            while index < len {
                let paint = paints[index];
                let mark = marks[index];
                let underlined = marked.as_ref().is_some_and(|marked| marked.contains(&(plan.start + index)));
                let mut end = index + 1;
                while end < len
                    && paints[end] == paint
                    && marks[end] == mark
                    && struck[end] == struck[index]
                    && marked.as_ref().is_some_and(|marked| marked.contains(&(plan.start + end))) == underlined
                {
                    end += 1;
                }
                while end < len && !plan.text.is_char_boundary(end) {
                    end += 1;
                }
                let (color, weight, style) = style_for(paint);
                runs.push(TextRun {
                    len: display_at(end) - display_at(index),
                    font: Font { weight, style, ..frame.font.clone() },
                    color,
                    background_color: None,
                    underline: if underlined { Some(UnderlineStyle { color: Some(color), thickness: px(1.), wavy: false }) } else { underline_for(mark) },
                    strikethrough: struck[index].then_some(gpui::StrikethroughStyle { color: Some(color), thickness: px(1.) }),
                });
                index = end;
            }
            let row_end = plan.start + len;
            let in_row = |offset: usize| offset >= plan.start && (offset < row_end || (offset == row_end && plan.last_in_line));
            let mut row_hints: Vec<(usize, &str, bool)> =
                hints.iter().filter(|hint| in_row(hint.offset)).map(|hint| (hint.offset - plan.start, hint.label.as_str(), false)).collect();
            if let (Some((pos, _)), Some(first)) = (&ghost, &ghost_first)
                && in_row(*pos)
            {
                ghost_row = Some((plan.row, *pos));
                if !first.is_empty() {
                    let at = row_hints.partition_point(|(offset, _, _)| *offset <= pos - plan.start);
                    row_hints.insert(at, (pos - plan.start, first.as_str(), true));
                }
            }
            let (display, runs, tab_map) = if row_hints.is_empty() {
                (display, runs, tab_map)
            } else {
                let map = tab_map.unwrap_or_else(|| (0..=len).collect());
                let hint_run = |len: usize, ghost: bool| TextRun {
                    len,
                    font: frame.font.clone(),
                    color: if ghost { colors.subtle_foreground.opacity(0.7) } else { colors.subtle_foreground },
                    background_color: if ghost { None } else { Some(colors.field) },
                    underline: None,
                    strikethrough: None,
                };
                let (display, runs, map) = insert_inlays(display, runs, map, &row_hints, hint_run);
                (display, runs, Some(map))
            };
            let shaped = text_system.shape_line(SharedString::from(display), font_size, &runs, None);
            rows.push(RowHit {
                row: plan.row,
                start: plan.start,
                len: buffer.line_end(plan.line).min(plan.start + len) - plan.start,
                last_in_line: plan.last_in_line,
                shaped,
                tab_map,
                top: text_bounds.top() + line_height * plan.row as f32 - self.scroll.y,
            });
        }
        // Soft-wrapped rows end where the next one starts, not at the cut.
        for (row, plan) in rows.iter_mut().zip(&plans) {
            if !plan.last_in_line {
                row.len = plan.text.len();
            }
        }

        // Horizontal scrolling.
        let max_scroll_x = if wrap {
            px(0.)
        } else {
            let longest = self.longest_line(&buffer);
            (char_width * longest as f32 + char_width * 4. - text_width).max(px(0.))
        };
        if autoscroll.is_some()
            && !wrap
            && let Some(row) = rows.iter().find(|row| row.holds(newest_head))
        {
            let x = row.x_for(newest_head, char_width);
            let margin = char_width * 4.;
            if x < self.scroll.x + margin {
                self.scroll.x = x - margin;
            } else if x + margin > self.scroll.x + text_width {
                self.scroll.x = x + margin - text_width;
            }
        }
        self.scroll.x = self.scroll.x.clamp(px(0.), max_scroll_x.max(self.scroll.x.min(px(0.))));
        let origin = point(text_bounds.left() + TEXT_PADDING - self.scroll.x, text_bounds.top() - self.scroll.y);
        let row_origin = |row: &RowHit| point(origin.x, row.top);

        // Decorations under the text.
        let mut underlays: Vec<PaintQuad> = Vec::new();
        let full_row = |top: Pixels| Bounds::new(point(text_bounds.left(), top), size(text_bounds.size.width, line_height));
        let span_quads = |range: &Range<usize>, color: Hsla, border: Option<Hsla>, out: &mut Vec<PaintQuad>| {
            for row in &rows {
                let row_end = row.start + row.len;
                if range.end < row.start || range.start > row_end || (range.start == row_end && !range.is_empty()) {
                    continue;
                }
                let from = range.start.max(row.start);
                let to = range.end.min(row_end);
                let mut right = row.x_for(to, char_width);
                if range.end > row_end && row.last_in_line {
                    right += char_width * 0.5;
                }
                let left = row.x_for(from, char_width);
                if right <= left {
                    continue;
                }
                let bounds = Bounds::from_corners(point(origin.x + left, row.top), point(origin.x + right, row.top + line_height));
                let mut quad = fill(bounds, color);
                if let Some(border) = border {
                    quad = quad.border_widths(px(1.)).border_color(border);
                }
                out.push(quad);
            }
        };

        let selections = self.document.selections.clone();
        let mut cursor_lines: Vec<usize> = Vec::new();
        for selection in &selections {
            let line = buffer.line_of(selection.head);
            cursor_lines.push(line);
            if selection.is_empty()
                && let Some(row) = rows.iter().find(|row| row.holds(selection.head))
            {
                underlays.push(fill(full_row(row.top), colors.accent));
            }
        }

        // The line a paused debug session stopped on.
        let breakpoints = self.breakpoints.read(cx);
        let execution_line = breakpoints.execution_position().filter(|position| position.path == self.path).map(|position| position.row as usize);
        let file_breakpoints: Vec<dap::Breakpoint> = breakpoints.breakpoints_for(&self.path).to_vec();
        if let Some(line) = execution_line {
            for row in rows.iter().zip(&plans).filter(|(_, plan)| plan.line == line).map(|(row, _)| row) {
                underlays.push(fill(full_row(row.top), colors.warning.opacity(0.16)));
            }
        }

        // `⋯` after folded headers.
        let mut fold_placeholders = Vec::new();
        let mut placeholder_glyphs = Vec::new();
        if !self.folds.folded.is_empty() {
            let dots = text_system.shape_line(
                SharedString::from("⋯"),
                font_size,
                &[TextRun { len: "⋯".len(), font: frame.font.clone(), color: colors.muted_foreground, background_color: None, underline: None, strikethrough: None }],
                None,
            );
            for (row, plan) in rows.iter().zip(&plans) {
                if !plan.last_in_line || !self.folds.is_folded(plan.line) {
                    continue;
                }
                let left = origin.x + row.shaped.width + char_width;
                let pill = Bounds::new(point(left, row.top + px(2.)), size(char_width * 3., line_height - px(4.)));
                underlays.push(fill(pill, colors.field).corner_radii(px(3.)).border_widths(px(1.)).border_color(colors.border));
                placeholder_glyphs.push((dots.clone(), point(pill.left() + (pill.size.width - dots.width) / 2., row.top)));
                fold_placeholders.push((pill, plan.line));
            }
        }

        if frame.indent_guides {
            self.indent_guides(&rows, &plans, &buffer, origin.x, char_width, line_height, colors.border.opacity(0.7), &mut underlays);
        }
        for column in &frame.rulers {
            let x = origin.x + char_width * *column as f32;
            underlays.push(fill(Bounds::new(point(x, text_bounds.top()), size(px(1.), viewport_height)), colors.border));
        }
        let inline_preview = self.inline_preview();
        if let Some(preview) = &inline_preview {
            for (row, plan) in rows.iter().zip(&plans) {
                if (preview.lines.0..=preview.lines.1).contains(&plan.line) {
                    underlays.push(fill(Bounds::new(point(text_bounds.left(), row.top), size(text_bounds.size.width, line_height)), colors.git_deleted.opacity(0.14)));
                }
            }
        }
        for hunk in self.agent_hunks() {
            let lines = hunk.lines();
            for (row, plan) in rows.iter().zip(&plans) {
                if lines.contains(&plan.line) {
                    underlays.push(fill(Bounds::new(point(text_bounds.left(), row.top), size(text_bounds.size.width, line_height)), colors.git_added.opacity(0.12)));
                }
            }
        }

        // The server's highlights of the symbol at the caret, or else words like it.
        if frame.occurrences && self.focused && !self.lsp.highlights.is_empty() {
            for (range, kind) in &self.lsp.highlights {
                if range.end < visible.start || range.start > visible.end {
                    continue;
                }
                let border = (*kind == HighlightKind::Write).then_some(colors.border_strong);
                span_quads(range, colors.selected, border, &mut underlays);
            }
        } else if frame.occurrences && self.focused && !visible.is_empty() && visible.len() <= MAX_HIGHLIGHT_RANGE {
            let newest = self.document.newest_selection().clone();
            let caret_word = newest.is_empty().then(|| buffer.word_range_at(newest.head)).flatten();
            let needle = if newest.is_empty() {
                caret_word.clone().map(|range| (buffer.slice(range), true))
            } else if newest.end() - newest.start() <= 200 && buffer.line_of(newest.start()) == buffer.line_of(newest.end()) {
                Some((buffer.slice(newest.range()), false)).filter(|(text, _)| !text.trim().is_empty())
            } else {
                None
            };
            if let Some((needle, whole_word)) = needle {
                let text = buffer.slice(visible.clone());
                let found: Vec<Range<usize>> = if whole_word {
                    search::word_occurrences(&text, visible.start, &needle)
                } else {
                    text.match_indices(needle.as_str()).map(|(index, _)| visible.start + index..visible.start + index + needle.len()).collect()
                };
                if found.len() > 1 || !newest.is_empty() {
                    for range in found.iter().filter(|range| **range != newest.range() && Some(*range) != caret_word.as_ref()) {
                        span_quads(range, colors.selected, None, &mut underlays);
                    }
                }
            }
        }

        for range in self.vim_search_matches(visible.clone()) {
            span_quads(&range, colors.primary.opacity(0.26), None, &mut underlays);
        }

        // Find matches.
        if self.find_open
            && let Some(find) = &self.find
            && find.version == buffer.version()
        {
            let current = self.document.newest_selection().range();
            for range in find.visible(visible.clone()) {
                let border = (*range == current).then(|| colors.primary.opacity(0.75));
                span_quads(range, colors.primary.opacity(0.26), border, &mut underlays);
            }
        }

        for selection in &selections {
            if !selection.is_empty() && selection.end() >= visible.start && selection.start() <= visible.end {
                span_quads(&selection.range(), if window_active { colors.selection } else { gpui::Hsla { s: 0., ..colors.selection } }, None, &mut underlays);
            }
        }

        if let Some((open, close)) = matching_bracket(&self.document, newest_head) {
            for offset in [open, close] {
                span_quads(&(offset..offset + 1), colors.selected, Some(colors.border_strong), &mut underlays);
            }
        }

        // Text, invisibles and carets.
        let text_rows: Vec<(ShapedLine, Point<Pixels>)> = rows.iter().map(|row| (row.shaped.clone(), row_origin(row))).collect();
        let mut glyphs = placeholder_glyphs;
        if frame.whitespace != "none" {
            let invisible = colors.subtle_foreground.opacity(0.45);
            let shape = |glyph: &str| {
                text_system.shape_line(
                    SharedString::from(glyph.to_string()),
                    font_size,
                    &[TextRun { len: glyph.len(), font: frame.font.clone(), color: invisible, background_color: None, underline: None, strikethrough: None }],
                    None,
                )
            };
            let dot = shape("·");
            let arrow = shape("→");
            for (row, plan) in rows.iter().zip(&plans) {
                let text = &plan.text;
                let trailing_from = text.trim_end_matches([' ', '\t']).len();
                let bytes = text.as_bytes();
                for (index, byte) in bytes.iter().enumerate() {
                    if *byte != b' ' && *byte != b'\t' {
                        continue;
                    }
                    let show = match frame.whitespace.as_str() {
                        "trailing" => index >= trailing_from && plan.last_in_line,
                        "boundary" => {
                            let lone = *byte == b' '
                                && index > 0
                                && index + 1 < bytes.len()
                                && !matches!(bytes[index - 1], b' ' | b'\t')
                                && !matches!(bytes[index + 1], b' ' | b'\t');
                            !lone
                        }
                        _ => true,
                    };
                    if !show {
                        continue;
                    }
                    let glyph = if *byte == b'\t' { &arrow } else { &dot };
                    let x = row.x_for(row.start + index, char_width);
                    let offset = if *byte == b' ' { (char_width - glyph.width) / 2. } else { px(0.) };
                    glyphs.push((glyph.clone(), point(origin.x + x + offset, row.top)));
                }
            }
        }

        let mut cursors = Vec::new();
        if self.focused && self.cursor_visible && window_active {
            for selection in &selections {
                let head = self.caret_head(selection);
                let Some(row) = rows.iter().find(|row| row.holds(head)) else { continue };
                let x = origin.x + row.x_for(head, char_width);
                let next = buffer.char_at(head).filter(|ch| *ch != '\n');
                let cell = next
                    .filter(|ch| !ch.is_whitespace())
                    .map(|_| row.x_for(buffer.next_boundary(head), char_width) + origin.x - x)
                    .unwrap_or(char_width)
                    .max(char_width * 0.5);
                let top = row.top;
                let color = colors.cursor;
                match frame.cursor_style.as_str() {
                    "block" | "block-outline" => {
                        let bounds = Bounds::new(point(x, top), size(cell, line_height));
                        if frame.cursor_style == "block" {
                            cursors.push(fill(bounds, color));
                            if let Some(ch) = next.filter(|ch| !ch.is_whitespace()) {
                                let text = ch.to_string();
                                let glyph = text_system.shape_line(
                                    SharedString::from(text.clone()),
                                    font_size,
                                    &[TextRun {
                                        len: text.len(),
                                        font: frame.font.clone(),
                                        color: colors.background,
                                        background_color: None,
                                        underline: None,
                                        strikethrough: None,
                                    }],
                                    None,
                                );
                                glyphs.push((glyph, point(x, top)));
                            }
                        } else {
                            cursors.push(fill(bounds, gpui::transparent_black()).border_widths(px(1.)).border_color(color));
                        }
                    }
                    "underline" | "underline-thin" => {
                        let height = if frame.cursor_style == "underline" { px(2.) } else { px(1.) };
                        cursors.push(fill(Bounds::new(point(x, top + line_height - height), size(cell, height)), color));
                    }
                    style => {
                        let width = if style == "line-thin" { px(1.) } else { px(2.) };
                        cursors.push(fill(Bounds::new(point(x - px(0.5), top), size(width, line_height)), color));
                    }
                }
            }
        }

        // The gutter: diagnostics or breakpoints, the execution arrow, line numbers, git changes
        // and fold chevrons.
        let mut gutter_marks = Vec::new();
        let mut gutter_icons: Vec<(Bounds<Pixels>, SharedString, Hsla)> = Vec::new();
        let mut gutter_paths: Vec<(Vec<Point<Pixels>>, Hsla)> = Vec::new();
        let fold_ranges = self.fold_ranges();
        let lane_center = gutter_bounds.left() + BREAKPOINT_LANE / 2.;
        let mut lightbulb_hit = None;
        for (row, plan) in rows.iter().zip(&plans) {
            if !plan.first_in_line {
                continue;
            }
            let middle = row.top + line_height / 2.;
            let has_breakpoint = file_breakpoints.iter().any(|breakpoint| breakpoint.row as usize == plan.line);
            if let Some(bulb) = self.lsp.lightbulb.as_ref().filter(|bulb| bulb.line == plan.line && !has_breakpoint) {
                let icon = px(14.);
                let bounds = Bounds::new(point(lane_center - icon / 2., middle - icon / 2.), size(icon, icon));
                let color = if bulb.has_quick_fix() { colors.warning } else { colors.muted_foreground };
                gutter_icons.push((bounds, IconName::Lightbulb.path().into(), color));
                lightbulb_hit = Some(Bounds::new(point(gutter_bounds.left(), row.top), size(BREAKPOINT_LANE, line_height)));
            } else if let Some(breakpoint) = file_breakpoints.iter().find(|breakpoint| breakpoint.row as usize == plan.line) {
                let dot = px(10.);
                let color = if breakpoint.enabled { colors.destructive } else { colors.subtle_foreground };
                let bounds = Bounds::new(point(lane_center - dot / 2., middle - dot / 2.), size(dot, dot));
                if breakpoint.log_message.is_some() {
                    let half = dot / 2. + px(1.);
                    let diamond = vec![
                        point(lane_center, middle - half),
                        point(lane_center + half, middle),
                        point(lane_center, middle + half),
                        point(lane_center - half, middle),
                    ];
                    gutter_paths.push((diamond, color));
                } else if breakpoint.state.verified == Some(false) {
                    gutter_marks.push(fill(bounds, gpui::transparent_black()).corner_radii(dot / 2.).border_widths(px(1.5)).border_color(color));
                } else {
                    gutter_marks.push(fill(bounds, color).corner_radii(dot / 2.));
                }
                if breakpoint.condition.is_some() || breakpoint.hit_condition.is_some() {
                    // A conditional breakpoint carries an `=`.
                    for offset in [px(-1.5), px(1.)] {
                        gutter_marks.push(fill(Bounds::new(point(lane_center - px(2.5), middle + offset), size(px(5.), px(1.))), colors.background));
                    }
                }
            } else {
                let line_start = buffer.line_start(plan.line);
                let line_end = buffer.line_end(plan.line);
                let severity = self
                    .lsp
                    .diagnostics
                    .iter()
                    .filter(|diagnostic| diagnostic.range.start >= line_start && diagnostic.range.start <= line_end)
                    .map(|diagnostic| diagnostic.severity)
                    .min();
                if let Some(severity) = severity.filter(|severity| *severity != Severity::Hint) {
                    let dot = px(6.);
                    let origin = point(lane_center - dot / 2., middle - dot / 2.);
                    gutter_marks.push(fill(Bounds::new(origin, size(dot, dot)), severity_color(severity, &theme)).corner_radii(dot / 2.));
                }
            }
            if execution_line == Some(plan.line) {
                let icon = px(12.);
                gutter_icons.push((Bounds::new(point(lane_center - icon / 2., middle - icon / 2.), size(icon, icon)), IconName::ArrowRight.path().into(), colors.warning));
            }
            let folded = self.folds.is_folded(plan.line);
            if folded || fold_ranges.iter().any(|range| range.start == plan.line) {
                let icon = px(12.);
                let path = if folded { IconName::ChevronRight } else { IconName::ChevronDown }.path();
                let color = if folded { colors.foreground } else { colors.subtle_foreground };
                gutter_icons.push((Bounds::new(point(fold_left + (FOLD_LANE - icon) / 2., middle - icon / 2.), size(icon, icon)), path.into(), color));
            }
        }
        for hunk in &self.git.hunks {
            let color = match hunk.kind {
                HunkKind::Added => colors.git_added,
                HunkKind::Modified => colors.git_modified,
                HunkKind::Deleted => colors.git_deleted,
            };
            if hunk.kind == HunkKind::Deleted {
                // A wedge on the boundary where lines were removed.
                let row = rows.iter().zip(&plans).find(|(_, plan)| plan.line == hunk.lines.start && plan.first_in_line).map(|(row, _)| row.top);
                let row = row.or_else(|| {
                    rows.iter().zip(&plans).filter(|(_, plan)| plan.line + 1 == hunk.lines.start && plan.last_in_line).map(|(row, _)| row.top + line_height).next()
                });
                if let Some(y) = row {
                    gutter_paths.push((vec![point(git_left, y - px(4.)), point(git_left + px(6.), y), point(git_left, y + px(4.))], color));
                }
                continue;
            }
            for (row, plan) in rows.iter().zip(&plans) {
                if hunk.lines.contains(&plan.line) {
                    gutter_marks.push(fill(Bounds::new(point(git_left, row.top), size(GIT_BAR, line_height)), color));
                }
            }
        }

        // Line numbers.
        let mut gutter = Vec::new();
        let relative_from = buffer.line_of(newest_head);
        let shape_number = |line: usize, current: bool| {
            let number = if frame.relative_numbers && line != relative_from { line.abs_diff(relative_from).to_string() } else { (line + 1).to_string() };
            let color = if current { colors.foreground } else { colors.subtle_foreground };
            text_system.shape_line(
                SharedString::from(number.clone()),
                font_size,
                &[TextRun { len: number.len(), font: frame.font.clone(), color, background_color: None, underline: None, strikethrough: None }],
                None,
            )
        };
        if frame.line_numbers {
            for (row, plan) in rows.iter().zip(&plans) {
                if !plan.first_in_line {
                    continue;
                }
                let shaped = shape_number(plan.line, cursor_lines.contains(&plan.line));
                let x = numbers_right - shaped.width;
                gutter.push((shaped, point(x, row.top)));
            }
        }

        let mut ghost_quads = Vec::new();
        let mut ghost_rows = Vec::new();
        if let (Some((_, text)), Some((row, _))) = (&ghost, ghost_row)
            && let Some(hit) = rows.iter().find(|hit| hit.row == row)
        {
            let rest: Vec<&str> = text.split('\n').skip(1).collect();
            if !rest.is_empty() {
                // The display map leaves rows for the other lines below the ghost's line (see
                // `blocks`), unless the peek holds that spot: then they are drawn over the code.
                let reserved = self.ghost_block().is_some() && self.peek_line().is_none();
                let last = rows.iter().skip_while(|other| other.row != hit.row).find(|other| other.last_in_line).unwrap_or(hit);
                let top = if reserved { last.top + line_height } else { hit.top + line_height };
                if !reserved {
                    let width = rest.iter().map(|line| line.chars().count()).max().unwrap_or(0) as f32 * char_width + char_width * 2.;
                    ghost_quads.push(fill(Bounds::new(point(text_bounds.left(), top), size(origin.x + width - text_bounds.left(), line_height * rest.len() as f32)), colors.background));
                }
                for (index, line) in rest.iter().enumerate() {
                    if line.is_empty() {
                        continue;
                    }
                    let shaped = text_system.shape_line(
                        SharedString::from(line.to_string()),
                        font_size,
                        &[TextRun {
                            len: line.len(),
                            font: frame.font.clone(),
                            color: colors.subtle_foreground.opacity(0.7),
                            background_color: None,
                            underline: None,
                            strikethrough: None,
                        }],
                        None,
                    );
                    ghost_rows.push((shaped, point(origin.x, top + line_height * index as f32)));
                }
            }
        }

        // The proposed lines of an inline edit, in the rows below the lines it replaces.
        if let Some(preview) = &inline_preview
            && self.peek_line().is_none()
            && let Some(last) = rows.iter().zip(&plans).find(|(_, plan)| plan.line == preview.lines.1 && plan.last_in_line).map(|(row, _)| row)
        {
            let top = last.top + line_height;
            let block = Bounds::new(point(text_bounds.left(), top), size(text_bounds.size.width, line_height * preview.proposed.len() as f32));
            ghost_quads.push(fill(block, colors.background));
            ghost_quads.push(fill(block, colors.git_added.opacity(0.14)));
            ghost_quads.push(fill(Bounds::new(block.origin, size(px(2.), block.size.height)), colors.git_added));
            for (index, line) in preview.proposed.iter().enumerate() {
                if line.is_empty() {
                    continue;
                }
                let (line, map) = crate::display_map::expand_tabs(line, self.document.tab_size);
                let at = |offset: usize| map.as_ref().map_or(offset.min(line.len()), |map| map.get(offset).copied().unwrap_or(line.len()));
                let run = |len: usize, color| TextRun { len, font: frame.font.clone(), color, background_color: None, underline: None, strikethrough: None };
                let mut runs = Vec::new();
                let mut cursor = 0;
                for (range, kind) in preview.spans.get(index).map(Vec::as_slice).unwrap_or_default() {
                    let (start, end) = (at(range.start).max(cursor), at(range.end));
                    if start > cursor {
                        runs.push(run(start - cursor, colors.foreground));
                    }
                    if end > start {
                        runs.push(run(end - start, kind.color(&theme)));
                        cursor = end;
                    }
                }
                if cursor < line.len() {
                    runs.push(run(line.len() - cursor, colors.foreground));
                }
                let shaped = text_system.shape_line(SharedString::from(line.clone()), font_size, &runs, None);
                ghost_rows.push((shaped, point(origin.x, top + line_height * index as f32)));
            }
        }

        // Inline blame at the end of the caret line.
        let mut blame_hit = None;
        if frame.inline_blame
            && self.focused
            && selections.len() == 1
            && selections[0].is_empty()
            && let Some((row, _)) = rows.iter().zip(&plans).rfind(|(_, plan)| plan.line == relative_from && plan.last_in_line)
            && let Some(text) = self.inline_blame_text(buffer.line_of(newest_head))
        {
            let shaped = text_system.shape_line(
                SharedString::from(text.clone()),
                font_size,
                &[TextRun {
                    len: text.len(),
                    font: Font { style: FontStyle::Italic, ..frame.font.clone() },
                    color: colors.subtle_foreground.opacity(0.7),
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                }],
                None,
            );
            let at = point(origin.x + row.shaped.width + char_width * 4., row.top);
            blame_hit = Some((Bounds::new(at, size(shaped.width, line_height)), relative_from));
            glyphs.push((shaped, at));
        }

        // Code lenses, in a row above their lines at the line's indent.
        let mut lens_hits = Vec::new();
        if !lens_rows.is_empty() {
            let lens_lines = self.code_lens_lines();
            let lens_size = font_size * 0.85;
            let ui_font = font(SharedString::from(ui::typography::UI_FONT));
            let shape = |text: &str, color: Hsla, hovered: bool| {
                text_system.shape_line(
                    SharedString::from(text.to_string()),
                    lens_size,
                    &[TextRun {
                        len: text.len(),
                        font: ui_font.clone(),
                        color,
                        background_color: None,
                        underline: hovered.then_some(UnderlineStyle { color: Some(color), thickness: px(1.), wavy: false }),
                        strikethrough: None,
                    }],
                    None,
                )
            };
            let gap = lens_size * 0.4;
            for (line, row) in &lens_rows {
                let Some((_, lenses)) = lens_lines.iter().find(|(lens_line, _)| lens_line == line) else { continue };
                let text = buffer.line(*line);
                let indent = display_column(&text, buffer.indent_len(*line), tab_size);
                let top = text_bounds.top() + line_height * *row as f32 - self.scroll.y;
                let mut x = origin.x + char_width * indent as f32;
                for (index, lens) in lenses.iter().enumerate() {
                    if index > 0 {
                        let separator = shape("|", colors.subtle_foreground, false);
                        let width = separator.width;
                        glyphs.push((separator, point(x + gap, top)));
                        x += width + gap * 2.;
                    }
                    let hovered = self.code_lens.hovered == Some((*line, index));
                    let shaped = shape(&lens.title, if hovered { colors.primary } else { colors.subtle_foreground }, hovered);
                    let width = shaped.width;
                    lens_hits.push((Bounds::new(point(x, top), size(width, line_height)), *line, index));
                    glyphs.push((shaped, point(x, top)));
                    x += width;
                }
            }
        }
        // The lines an agent removed, in rows above where they were (`AgentHunkWidget`), drawn as
        // a diff's removed lines: tinted, with a bar on the left.
        if !lens_rows.is_empty() && !self.agent_hunks().is_empty() {
            let lens_lines: Vec<usize> = self.code_lens_lines().into_iter().map(|(line, _)| line).collect();
            for (line, row) in &lens_rows {
                let removed = self.agent_removed_lines(*line);
                if removed.is_empty() {
                    continue;
                }
                // After the code lens row and each hunk's Keep / Undo row.
                let row = row + usize::from(lens_lines.contains(line)) + self.agent_lens_rows(*line);
                let top = text_bounds.top() + line_height * row as f32 - self.scroll.y;
                let block = Bounds::new(point(text_bounds.left(), top), size(text_bounds.size.width, line_height * removed.len() as f32));
                ghost_quads.push(fill(block, colors.background));
                ghost_quads.push(fill(block, colors.git_deleted.opacity(0.12)));
                ghost_quads.push(fill(Bounds::new(block.origin, size(px(2.), block.size.height)), colors.git_deleted));
                for (index, text) in removed.iter().enumerate() {
                    if text.is_empty() {
                        continue;
                    }
                    let (text, _) = expand_tabs(text, tab_size);
                    let run = TextRun { len: text.len(), font: frame.font.clone(), color: colors.subtle_foreground, background_color: None, underline: None, strikethrough: None };
                    let shaped = text_system.shape_line(SharedString::from(text), font_size, &[run], None);
                    ghost_rows.push((shaped, point(origin.x, top + line_height * index as f32)));
                }
            }
        }
        let peek_bounds = self.peek_line().and_then(|line| below_rows.iter().find(|(below_line, _)| *below_line == line)).map(|(_, row)| {
            let top = text_bounds.top() + line_height * *row as f32 - self.scroll.y;
            Bounds::new(point(text_bounds.left(), top), size(text_bounds.size.width, line_height * PEEK_ROWS as f32))
        });

        // Sticky scroll: the headers of the scopes around the top row, pinned.
        let mut sticky = None;
        let mut sticky_hits = Vec::new();
        if frame.sticky_scroll && viewport_rows > 6 && self.scroll.y > px(0.) {
            let pinned = sticky_lines(
                &fold_ranges,
                |line| buffer.line(line).into_owned(),
                |count| map.row_to_line((first_row + count).min(row_count.saturating_sub(1))).0,
                MAX_STICKY_LINES.min(viewport_rows / 3),
            );
            if !pinned.is_empty() {
                let height = line_height * pinned.len() as f32;
                let area = Bounds::new(bounds.origin, size(text_bounds.right() - bounds.left(), height + px(1.)));
                let mut quads = vec![fill(Bounds::new(area.origin, size(area.size.width, height)), colors.background)];
                quads.push(fill(Bounds::new(point(area.left(), area.top() + height), size(area.size.width, px(1.))), colors.border));
                let mut sticky_rows = Vec::new();
                for (index, line) in pinned.iter().enumerate() {
                    let top = text_bounds.top() + line_height * index as f32;
                    let start = buffer.line_start(*line);
                    let text = buffer.line(*line).into_owned();
                    let line_spans = self.document.syntax.highlights(buffer.rope(), start..start + text.len());
                    let (display, tab_map) = expand_tabs(&text, tab_size);
                    let display_at = |index: usize| tab_map.as_ref().map(|map| map[index]).unwrap_or(index);
                    let mut runs = Vec::new();
                    let mut at = 0;
                    for (range, kind) in &line_spans {
                        let (from, to) = (range.start - start, range.end - start);
                        if from > at {
                            runs.push(TextRun { len: display_at(from) - display_at(at), font: frame.font.clone(), color: colors.foreground, background_color: None, underline: None, strikethrough: None });
                        }
                        let (color, weight, style) = style_for(Paint::Syntax(*kind));
                        runs.push(TextRun { len: display_at(to) - display_at(from), font: Font { weight, style, ..frame.font.clone() }, color, background_color: None, underline: None, strikethrough: None });
                        at = to;
                    }
                    if at < text.len() {
                        runs.push(TextRun { len: display_at(text.len()) - display_at(at), font: frame.font.clone(), color: colors.foreground, background_color: None, underline: None, strikethrough: None });
                    }
                    let shaped = text_system.shape_line(SharedString::from(display), font_size, &runs, None);
                    sticky_rows.push((shaped, point(text_bounds.left() + TEXT_PADDING - self.scroll.x, top)));
                    if frame.line_numbers {
                        let number = shape_number(*line, false);
                        sticky_rows.push((number.clone(), point(numbers_right - number.width, top)));
                    }
                    sticky_hits.push((Bounds::new(point(area.left(), top), size(area.size.width, line_height)), *line));
                }
                sticky = Some(StickyPaint { bounds: area, quads, rows: sticky_rows });
            }
        }

        // The minimap: the text as coloured blocks, with the viewport marked.
        let mut minimap = Vec::new();
        let mut minimap_layout = None;
        if minimap_width > px(0.) {
            let pitch = (line_height / MINIMAP_SCALE).round().max(px(2.));
            let minimap_char = char_width / MINIMAP_SCALE;
            let area = Bounds::new(point(text_right, bounds.top()), size(minimap_width, viewport_height));
            let visible_rows = (viewport_height / pitch).floor() as usize;
            let scroll_rows = row_count.saturating_sub(visible_rows);
            let fraction = if max_scroll_y > px(0.) { self.scroll.y / max_scroll_y } else { 0. };
            let minimap_first = (scroll_rows as f32 * fraction).round() as usize;
            let max_scroll_rows = max_scroll_y / line_height;
            let travel = pitch * (max_scroll_rows - scroll_rows as f32).max(0.);
            let slider_top = area.top() + pitch * (self.scroll.y / line_height - minimap_first as f32);
            let slider = Bounds::new(point(area.left(), slider_top), size(minimap_width, pitch * viewport_rows as f32));
            minimap.push(fill(area, colors.background));
            let blocks = self.minimap_blocks(&map, minimap_first, visible_rows, &theme);
            for (row, column, len, color) in blocks.iter() {
                let top = area.top() + pitch * (*row - minimap_first) as f32;
                let left = area.left() + MINIMAP_PADDING + minimap_char * *column as f32;
                let width = (minimap_char * *len as f32).min(area.right() - left);
                if width > px(0.) {
                    minimap.push(fill(Bounds::new(point(left, top), size(width, (pitch - px(1.)).max(px(1.)))), *color));
                }
            }
            let dragging = matches!(self.drag, Some(Drag::Minimap { .. }));
            if dragging || self.minimap_hovered {
                minimap.push(fill(slider, colors.foreground.opacity(if dragging { 0.16 } else { 0.08 })));
            }
            minimap_layout = Some(MinimapLayout { bounds: area, slider, travel });
        }

        // The scrollbar, with marks for matches and carets.
        let mut scrollbar = Vec::new();
        let mut scrollbar_layout = None;
        if content_height > viewport_height && max_scroll_y > px(0.) {
            let track = Bounds::new(point(bounds.right() - SCROLLBAR_WIDTH, bounds.top()), size(SCROLLBAR_WIDTH, viewport_height));
            let thumb_height = (viewport_height * (viewport_height / content_height)).max(px(24.)).min(viewport_height);
            let thumb_top = track.top() + (viewport_height - thumb_height) * (self.scroll.y / max_scroll_y);
            let thumb = Bounds::new(point(track.left() + px(2.), thumb_top), size(SCROLLBAR_WIDTH - px(4.), thumb_height));
            let dragging = matches!(self.drag, Some(Drag::Scrollbar { .. }));
            let mark_y = |offset: usize| track.top() + viewport_height * (map.to_display(offset).row as f32 / row_count.max(1) as f32);
            if self.find_open
                && let Some(find) = &self.find
            {
                for range in find.matches.iter().step_by((find.matches.len() / 2000).max(1)) {
                    scrollbar.push(fill(Bounds::new(point(track.left() + px(2.), mark_y(range.start)), size(SCROLLBAR_WIDTH - px(4.), px(2.))), colors.primary.opacity(0.7)));
                }
            }
            for diagnostic in self.lsp.diagnostics.iter().filter(|diagnostic| diagnostic.severity <= Severity::Warning).take(2000) {
                let color = severity_color(diagnostic.severity, &theme);
                scrollbar.push(fill(Bounds::new(point(track.left() + SCROLLBAR_WIDTH / 2., mark_y(diagnostic.range.start)), size(SCROLLBAR_WIDTH / 2., px(2.))), color));
            }
            for hunk in &self.git.hunks {
                let color = match hunk.kind {
                    HunkKind::Added => colors.git_added,
                    HunkKind::Modified => colors.git_modified,
                    HunkKind::Deleted => colors.git_deleted,
                };
                let top = track.top() + viewport_height * (map.first_row_of_line(hunk.lines.start) as f32 / row_count.max(1) as f32);
                let lines = hunk.lines.len().max(1);
                let height = (viewport_height * (lines as f32 / row_count.max(1) as f32)).max(px(2.));
                scrollbar.push(fill(Bounds::new(point(track.left(), top), size(px(3.), height)), color));
            }
            for selection in selections.iter().take(500) {
                scrollbar.push(fill(Bounds::new(point(track.left(), mark_y(selection.head)), size(SCROLLBAR_WIDTH, px(2.))), colors.foreground.opacity(0.35)));
            }
            scrollbar.push(fill(thumb, colors.foreground.opacity(if dragging { 0.28 } else { 0.14 })).corner_radii(px(3.)));
            scrollbar_layout = Some(ScrollbarLayout { track, thumb });
        }

        let text_hitbox = window.insert_hitbox(text_bounds, HitboxBehavior::Normal);
        let gutter_hitbox = window.insert_hitbox(gutter_bounds, HitboxBehavior::Normal);
        let scrollbar_hitbox = scrollbar_layout.map(|layout| window.insert_hitbox(layout.track, HitboxBehavior::Normal));
        let minimap_hitbox = minimap_layout.map(|layout| window.insert_hitbox(layout.bounds, HitboxBehavior::Normal));

        self.layout = Some(HitLayout {
            text_bounds,
            breakpoint_lane: gutter_bounds.left()..gutter_bounds.left() + BREAKPOINT_LANE,
            fold_lane: fold_left..fold_left + FOLD_LANE,
            fold_placeholders,
            sticky: sticky_hits,
            lenses: lens_hits,
            blame: blame_hit,
            lightbulb: lightbulb_hit,
            minimap: minimap_layout,
            origin,
            line_height,
            char_width,
            viewport_rows,
            rows,
            scrollbar: scrollbar_layout,
            max_scroll: point(max_scroll_x, max_scroll_y),
        });

        PaintState {
            text_hitbox,
            gutter_hitbox,
            scrollbar_hitbox,
            background: colors.background,
            text_bounds,
            gutter_bounds,
            line_height,
            underlays,
            rows: text_rows,
            glyphs,
            ghost_quads,
            ghost_rows,
            cursors,
            gutter,
            gutter_marks,
            gutter_icons,
            gutter_paths,
            scrollbar,
            scrollbar_layout,
            minimap,
            minimap_hitbox,
            sticky,
            link: self.lsp.link.is_some(),
            peek_bounds,
            peek: None,
            font: frame.font.clone(),
        }
    }

    /// Syntax spans and bracket depths for `range`, cached until the text or tree changes.
    fn visible_highlights(&mut self, range: Range<usize>, bracket_colors: bool) -> (Arc<Vec<(Range<usize>, SyntaxKind)>>, Arc<Vec<(usize, usize)>>) {
        let syntax = &self.document.syntax;
        if (syntax.tree.is_none() && crate::stream_highlight::syntax_for(syntax.language.name).is_none()) || range.is_empty() {
            return Default::default();
        }
        let version = self.document.buffer.version();
        if let Some(cache) = &self.caches.highlights
            && cache.version == version
            && cache.generation == syntax.generation
            && cache.range == range
        {
            return (cache.spans.clone(), cache.brackets.clone());
        }
        let limited = range.start..range.end.min(range.start + MAX_HIGHLIGHT_RANGE);
        let spans = Arc::new(syntax.highlights(self.document.buffer.rope(), limited.clone()));
        let brackets = Arc::new(if bracket_colors { syntax.bracket_depths(limited) } else { Vec::new() });
        self.caches.highlights =
            Some(HighlightCache { version, generation: syntax.generation, range, spans: spans.clone(), brackets: brackets.clone() });
        (spans, brackets)
    }

    /// The minimap's blocks for `count` rows from `first_row`: runs of non-blank characters in
    /// their syntax colour, cached until the text, tree, folds or scroll position change.
    fn minimap_blocks(&mut self, map: &DisplayMap, first_row: usize, count: usize, theme: &theme::Theme) -> Arc<Vec<(usize, usize, usize, Hsla)>> {
        let version = self.document.buffer.version();
        let generation = self.document.syntax.generation;
        let index_generation = self.folds.generation;
        if let Some(cache) = &self.caches.minimap
            && cache.version == version
            && cache.generation == generation
            && cache.index_generation == index_generation
            && cache.first_row == first_row
            && cache.theme == theme.id
        {
            return cache.blocks.clone();
        }
        let buffer = map.buffer;
        let last_row = (first_row + count).min(map.row_count());
        let mut rows = Vec::new();
        if first_row < last_row {
            let mut line = map.row_to_line(first_row).0;
            let mut row = map.first_row_of_line(line);
            'lines: while row < last_row && line < buffer.line_count() {
                row += map.above(line);
                let text = buffer.line(line);
                let start = buffer.line_start(line);
                for segment in map.line_segments(&text) {
                    if row >= last_row {
                        break 'lines;
                    }
                    if row >= first_row {
                        rows.push((row, start + segment.start, text[segment.start..segment.end.min(segment.start + 400)].to_string()));
                    }
                    row += 1;
                }
                row += map.below(line);
                line = map.next_line(line);
            }
        }
        let range = match (rows.first(), rows.last()) {
            (Some(first), Some(last)) => first.1..last.1 + last.2.len(),
            _ => 0..0,
        };
        let spans = if range.is_empty() || range.len() > MAX_HIGHLIGHT_RANGE {
            Vec::new()
        } else {
            self.document.syntax.highlights(buffer.rope(), range)
        };
        let plain = theme.colors.foreground.opacity(0.45);
        let mut blocks = Vec::new();
        for (row, start, text) in &rows {
            let first_span = spans.partition_point(|(range, _)| range.end <= *start);
            let color_at = |offset: usize| {
                spans[first_span..]
                    .iter()
                    .take_while(|(range, _)| range.start <= offset)
                    .find(|(range, _)| range.contains(&offset))
                    .map(|(_, kind)| kind.color(theme).opacity(0.75))
                    .unwrap_or(plain)
            };
            let mut column = 0;
            let mut run: Option<(usize, usize, Hsla)> = None;
            for (index, ch) in text.char_indices() {
                let width = if ch == '\t' { self.document.tab_size - column % self.document.tab_size } else { 1 };
                if ch.is_whitespace() {
                    if let Some((from, len, color)) = run.take() {
                        blocks.push((*row, from, len, color));
                    }
                } else {
                    let color = color_at(start + index);
                    match &mut run {
                        Some((_, len, run_color)) if *run_color == color => *len += width,
                        _ => {
                            if let Some((from, len, color)) = run.take() {
                                blocks.push((*row, from, len, color));
                            }
                            run = Some((column, width, color));
                        }
                    }
                }
                column += width;
            }
            if let Some((from, len, color)) = run {
                blocks.push((*row, from, len, color));
            }
        }
        let blocks = Arc::new(blocks);
        self.caches.minimap = Some(MinimapCache { version, generation, index_generation, first_row, theme: theme.id.clone(), blocks: blocks.clone() });
        blocks
    }

    /// The longest line in characters, for the horizontal scroll range.
    fn longest_line(&mut self, buffer: &crate::buffer::Buffer) -> usize {
        if let Some((version, longest)) = self.caches.longest_line
            && version == buffer.version()
        {
            return longest;
        }
        let longest = buffer.rope().lines().map(|line| line.len_chars()).max().unwrap_or(0);
        self.caches.longest_line = Some((buffer.version(), longest));
        longest
    }

    /// Vertical guides at each indent level; blank lines take the deeper of their neighbours.
    #[allow(clippy::too_many_arguments)]
    fn indent_guides(
        &self,
        rows: &[RowHit],
        plans: &[RowPlan],
        buffer: &crate::buffer::Buffer,
        left: Pixels,
        char_width: Pixels,
        line_height: Pixels,
        color: Hsla,
        out: &mut Vec<PaintQuad>,
    ) {
        let tab_size = self.document.tab_size;
        let indent_of = |line: usize| -> Option<usize> {
            let text = buffer.line(line);
            if text.trim().is_empty() {
                return None;
            }
            Some(crate::display_map::display_column(&text, text.len() - text.trim_start().len(), tab_size))
        };
        let neighbour = |line: usize, step: isize| -> usize {
            let mut current = line as isize + step;
            for _ in 0..200 {
                if current < 0 || current as usize >= buffer.line_count() {
                    return 0;
                }
                if let Some(indent) = indent_of(current as usize) {
                    return indent;
                }
                current += step;
            }
            0
        };
        let mut last_line = usize::MAX;
        let mut columns = 0;
        for (row, plan) in rows.iter().zip(plans) {
            if plan.line != last_line {
                last_line = plan.line;
                columns = indent_of(plan.line).unwrap_or_else(|| neighbour(plan.line, -1).max(neighbour(plan.line, 1)));
            }
            let levels = columns.div_ceil(tab_size);
            for level in 0..levels {
                let x = left + char_width * (level * tab_size) as f32;
                out.push(fill(Bounds::new(point(x, row.top), size(px(1.), line_height)), color));
            }
        }
    }
}

/// The bracket at (or just before) `offset` and its partner: by the syntax tree, or by counting
/// brackets in the text when there is no tree.
pub(crate) fn matching_bracket(document: &Document, offset: usize) -> Option<(usize, usize)> {
    if document.syntax.tree.is_some() {
        return document.syntax.matching_bracket(offset);
    }
    let buffer = &document.buffer;
    for at in [Some(offset), offset.checked_sub(1)].into_iter().flatten() {
        let Some(ch) = buffer.char_at(at) else { continue };
        let (open, close, forward) = match ch {
            '(' => ('(', ')', true),
            '[' => ('[', ']', true),
            '{' => ('{', '}', true),
            ')' => ('(', ')', false),
            ']' => ('[', ']', false),
            '}' => ('{', '}', false),
            _ => continue,
        };
        let mut depth = 0usize;
        if forward {
            let mut position = at;
            for ch in buffer.chars_at(at).take(50_000) {
                if ch == open {
                    depth += 1;
                } else if ch == close {
                    depth -= 1;
                    if depth == 0 {
                        return Some((at, position));
                    }
                }
                position += ch.len_utf8();
            }
        } else {
            let mut position = at + 1;
            for ch in buffer.reversed_chars_at(at + 1).take(50_000) {
                position -= ch.len_utf8();
                if ch == close {
                    depth += 1;
                } else if ch == open {
                    depth -= 1;
                    if depth == 0 {
                        return Some((at, position));
                    }
                }
            }
        }
    }
    None
}

impl Editor {
    /// The buffer offset under a window position.
    pub(crate) fn offset_for_position(&self, position: Point<Pixels>) -> usize {
        let Some(layout) = &self.layout else { return 0 };
        let y = position.y - layout.origin.y;
        let row = if y < px(0.) { 0 } else { (y / layout.line_height).floor() as usize };
        let x = position.x - layout.origin.x;
        if let Some(hit) = layout.row(row) {
            return hit.offset_for_x(x);
        }
        let buffer = &self.document.buffer;
        let map = DisplayMap::new(buffer, self.document.tab_size, self.wrap_index.as_deref());
        if y < px(0.) {
            return 0;
        }
        if row >= map.row_count() {
            return buffer.len();
        }
        let column = (x / layout.char_width).round().max(0.) as usize;
        map.from_display(DisplayPoint { row, column })
    }
}
