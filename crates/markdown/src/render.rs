//! One renderer for every markdown surface in Athas: the file preview, notebook cells, GitHub
//! bodies and the popovers a language server fills. The caller picks a `MarkdownStyle` preset and
//! hands over what only it can do -- highlighting a code fence, loading a web image, following a
//! link, ticking a task box, opening a block for editing -- and the drawing is the same
//! everywhere.

use std::{cell::Cell, ops::Range, rc::Rc};

use gpui::{
    AnyElement, App, ElementId, Font, FontStyle, FontWeight, Hsla, ImageSource, InteractiveText, IntoElement, ParentElement as _, SharedString,
    InteractiveElement as _, StatefulInteractiveElement as _, StrikethroughStyle, Styled as _, StyledText, TextRun, UnderlineStyle, Window, div, font, img,
    prelude::FluentBuilder as _, StyledImage as _,
    relative,
};
use theme::{ActiveTheme, ThemeColors};
use ui::scale::px;
use ui::{Icon, IconName, IconSize, metrics, typography};

use crate::parse::{Align, Block, BlockKind, Callout, Inline, ListItem, SpanStyle};

/// The Typeset `typeset-preview` preset (`typeset-presets.css`): line height and the space
/// between blocks, in ems.
pub const PREVIEW_LEADING: f32 = 1.68;
pub const PREVIEW_FLOW: f32 = 0.75;

/// The width a document reads at before its lines grow too long.
pub const PAGE_WIDTH: f32 = 768.;

/// Sizes and fonts one surface draws markdown at.
#[derive(Clone, Debug)]
pub struct MarkdownStyle {
    pub ui_font: SharedString,
    pub mono_font: SharedString,
    pub text_size: gpui::Pixels,
    pub code_size: gpui::Pixels,
    pub leading: f32,
    /// The space between blocks.
    pub block_gap: gpui::Pixels,
    /// Sizes for headings 1 to 6.
    pub headings: [gpui::Pixels; 6],
    /// A rule under the first two heading levels, as GitHub draws them.
    pub heading_rules: bool,
    /// Code fences scroll sideways instead of wrapping.
    pub code_scrolls: bool,
    pub image_max_height: gpui::Pixels,
}

impl MarkdownStyle {
    /// A document read at length: a markdown file's preview, a notebook's cells.
    pub fn document() -> Self {
        Self {
            ui_font: typography::ui_font(),
            mono_font: typography::MONO_FONT.into(),
            text_size: px(14.),
            code_size: px(12.5),
            leading: PREVIEW_LEADING,
            block_gap: px(14. * PREVIEW_FLOW),
            headings: [px(26.), px(21.), px(17.), px(15.), px(15.), px(15.)],
            heading_rules: true,
            code_scrolls: true,
            image_max_height: px(480.),
        }
    }

    /// A body written in a panel: GitHub issues, pull requests, release notes.
    pub fn comment() -> Self {
        Self {
            text_size: typography::text_base(),
            code_size: typography::text_sm(),
            leading: 1.6,
            block_gap: px(12.),
            headings: [px(20.), px(17.), typography::text_lg(), typography::text_base(), typography::text_base(), typography::text_base()],
            image_max_height: px(420.),
            ..Self::document()
        }
    }

    /// The few lines a popover holds: a hover, a completion's documentation.
    pub fn compact() -> Self {
        Self {
            text_size: typography::text_sm(),
            code_size: typography::text_sm(),
            leading: 1.45,
            block_gap: px(6.),
            headings: [typography::text_base(), typography::text_base(), typography::text_sm(), typography::text_sm(), typography::text_sm(), typography::text_sm()],
            heading_rules: false,
            image_max_height: px(220.),
            ..Self::document()
        }
    }

    fn heading(&self, level: u8) -> gpui::Pixels {
        self.headings[(level.clamp(1, 6) - 1) as usize]
    }
}

/// Highlights the matches of a query, marking the current one; `seen` counts the matches already
/// drawn this frame, so they can be told apart.
pub struct Find {
    pub query: String,
    pub current: usize,
    seen: Cell<usize>,
}

impl Find {
    pub fn new(query: impl Into<String>, current: usize) -> Self {
        Self { query: query.into(), current, seen: Cell::new(0) }
    }
}

/// What only the surface drawing the markdown can do.
#[derive(Clone, Default)]
pub struct Handlers {
    /// Follows a link. Without one, web addresses open in the browser and the rest is ignored.
    pub on_link: Option<Rc<dyn Fn(&str, &mut Window, &mut App)>>,
    /// Highlights a code fence; the font and the plain colour are the ones the block draws with.
    pub code_runs: Option<Rc<dyn Fn(Option<&str>, &str, &Font, Hsla) -> Vec<TextRun>>>,
    /// Resolves an image's address (a web image already loaded, a path beside the file).
    pub image: Option<Rc<dyn Fn(&str) -> Option<ImageSource>>>,
    /// Ticks a task box: the range of its `[ ]` in the source and what it becomes.
    pub on_toggle_task: Option<Rc<dyn Fn(Range<usize>, bool, &mut Window, &mut App)>>,
    /// Opens the block whose source is this range for editing (the editable preview).
    pub on_activate_block: Option<Rc<dyn Fn(Range<usize>, &mut Window, &mut App)>>,
}

/// Draws a parsed document.
pub struct Renderer {
    /// Keeps the element ids of different documents apart.
    pub id: SharedString,
    pub style: MarkdownStyle,
    pub handlers: Handlers,
    pub find: Option<Find>,
    counter: Cell<usize>,
}

impl Renderer {
    pub fn new(id: impl Into<SharedString>, style: MarkdownStyle) -> Self {
        Self { id: id.into(), style, handlers: Handlers::default(), find: None, counter: Cell::new(0) }
    }

    pub fn with(mut self, handlers: Handlers) -> Self {
        self.handlers = handlers;
        self
    }

    pub fn finding(mut self, find: Option<Find>) -> Self {
        self.find = find;
        self
    }

    fn next_id(&self, what: &str) -> ElementId {
        let index = self.counter.get();
        self.counter.set(index + 1);
        ElementId::Name(SharedString::from(format!("{}-{what}-{index}", self.id)))
    }

    fn ui(&self) -> Font {
        font(self.style.ui_font.clone())
    }

    fn mono(&self) -> Font {
        font(self.style.mono_font.clone())
    }

    /// The whole document, as a column of blocks.
    pub fn document(&self, blocks: &[Block], cx: &App) -> AnyElement {
        self.counter.set(0);
        div()
            .flex()
            .flex_col()
            .gap(self.style.block_gap)
            .min_w_0()
            .text_size(self.style.text_size)
            .line_height(relative(self.style.leading))
            .text_color(cx.theme().colors.foreground)
            .font_family(self.style.ui_font.clone())
            .children(blocks.iter().map(|block| self.block(block, cx)))
            .into_any_element()
    }

    /// One block of the document, with whatever is nested inside it. Only a block at this level
    /// opens for editing: a paragraph inside a list item is written as part of the list.
    pub fn block(&self, block: &Block, cx: &App) -> AnyElement {
        let body = self.nested(block, cx);
        self.editable(block.source.clone(), body, cx)
    }

    /// A block inside a quote or a list item: drawn, but not a block the caller can open.
    fn nested(&self, block: &Block, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let body = match &block.kind {
            BlockKind::Heading { level, text } => {
                let ruled = self.style.heading_rules && *level <= 2;
                div()
                    .mt(px(if *level <= 2 { 12. } else { 6. }))
                    .pb(px(if ruled { 6. } else { 0. }))
                    .when(ruled, |this| this.border_b_1().border_color(colors.border))
                    .text_size(self.style.heading(*level))
                    .line_height(relative(1.3))
                    .child(self.inline(text, Some(FontWeight::SEMIBOLD), cx))
                    .into_any_element()
            }
            BlockKind::Paragraph(text) => div().min_w_0().child(self.inline(text, None, cx)).into_any_element(),
            BlockKind::Code { language, code } => self.code(language.as_deref(), code, cx),
            BlockKind::Quote { callout, blocks } => self.quote(*callout, blocks, cx),
            BlockKind::List { start, items } => self.list(*start, items, cx),
            BlockKind::Table { alignments, header, rows } => self.table(alignments, header, rows, cx),
            BlockKind::Image { src, alt, width } => self.image(src, alt, *width, cx),
            BlockKind::Rule => div().my(px(6.)).h(px(1.)).bg(colors.divider).into_any_element(),
        };
        body
    }

    /// Wraps a block so clicking it opens its source for editing, when the surface allows it.
    fn editable(&self, source: Range<usize>, body: AnyElement, cx: &App) -> AnyElement {
        let Some(activate) = self.handlers.on_activate_block.clone() else { return body };
        let hover = cx.theme().colors.accent;
        div()
            .id(self.next_id("block"))
            .relative()
            .rounded(metrics::radius())
            .mx(px(-4.))
            .px(px(4.))
            .hover(|this| this.bg(hover))
            .on_click(move |_, window, cx| activate(source.clone(), window, cx))
            .child(body)
            .into_any_element()
    }

    fn code(&self, language: Option<&str>, code: &str, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let mono = self.mono();
        let runs = match &self.handlers.code_runs {
            Some(highlight) => highlight(language, code, &mono, colors.foreground),
            None => vec![TextRun { len: code.len(), font: mono, color: colors.foreground, background_color: None, underline: None, strikethrough: None }],
        };
        let runs = self.mark_matches(code, runs, cx);
        div()
            .id(self.next_id("code"))
            .min_w_0()
            // A block parent stretches the text to its own width, leaving nothing to scroll; as a
            // flex item the text keeps its full line width.
            .when(self.style.code_scrolls, |this| this.flex().overflow_x_scroll().whitespace_nowrap())
            .px(px(12.))
            .py(px(10.))
            .rounded(metrics::radius_md())
            .bg(colors.field)
            .text_size(self.style.code_size)
            .line_height(relative(1.5))
            .child(StyledText::new(code.to_string()).with_runs(runs))
            .into_any_element()
    }

    fn quote(&self, callout: Option<Callout>, blocks: &[Block], cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let (accent, title) = callout_look(callout, colors);
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .pl(px(12.))
            .border_l_2()
            .border_color(accent)
            .when(callout.is_none(), |this| this.text_color(colors.muted_foreground))
            .children(title.map(|(icon, title)| {
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(accent)
                    .child(Icon::new(icon).size(IconSize::Small).color(accent))
                    .child(title)
            }))
            .children(blocks.iter().map(|block| self.nested(block, cx)))
            .into_any_element()
    }

    fn list(&self, start: Option<u64>, items: &[ListItem], cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .children(items.iter().enumerate().map(|(index, item)| {
                let marker = match (item.checked, start) {
                    (Some(checked), _) => self.task_box(checked, item.check_source.clone(), cx),
                    (None, Some(start)) => div().child(format!("{}.", start + index as u64)).into_any_element(),
                    (None, None) => div().child("•").into_any_element(),
                };
                div()
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .justify_end()
                            .items_center()
                            .min_w(px(14.))
                            .h(self.style.text_size * self.style.leading)
                            .text_color(colors.subtle_foreground)
                            .child(marker),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .flex_1()
                            .min_w_0()
                            .when(item.checked == Some(true), |this| this.text_color(colors.muted_foreground))
                            .children(item.blocks.iter().map(|block| self.nested(block, cx))),
                    )
            }))
            .into_any_element()
    }

    /// A task item's box: clickable where the surface can write the tick back.
    fn task_box(&self, checked: bool, source: Option<Range<usize>>, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let icon = Icon::new(if checked { IconName::CheckCircle } else { IconName::CircleDotted })
            .size(IconSize::Small)
            .color(if checked { colors.success } else { colors.subtle_foreground });
        let (Some(toggle), Some(source)) = (self.handlers.on_toggle_task.clone(), source) else {
            return icon.into_any_element();
        };
        div()
            .id(self.next_id("task"))
            .cursor_pointer()
            .child(icon)
            .on_click(move |_, window, cx| {
                cx.stop_propagation();
                toggle(source.clone(), !checked, window, cx);
            })
            .into_any_element()
    }

    fn table(&self, alignments: &[Align], header: &[Inline], rows: &[Vec<Inline>], cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let cell = |inline: &Inline, column: usize, head: bool| {
            let align = alignments.get(column).copied().unwrap_or_default();
            div()
                .flex()
                .flex_1()
                .min_w(px(60.))
                .px(px(10.))
                .py(px(4.))
                .when(align == Align::Center, |this| this.justify_center())
                .when(align == Align::Right, |this| this.justify_end())
                .child(self.inline(inline, head.then_some(FontWeight::SEMIBOLD), cx))
        };
        let row = |cells: &[Inline], head: bool| {
            div()
                .flex()
                .border_b_1()
                .border_color(colors.divider)
                .when(head, |this| this.bg(colors.field))
                .children(cells.iter().enumerate().map(|(column, inline)| cell(inline, column, head)))
        };
        div()
            .flex()
            .flex_col()
            .min_w_0()
            .overflow_hidden()
            .rounded(metrics::radius_md())
            .border_1()
            .border_color(colors.divider)
            .text_size(self.style.code_size.max(typography::text_sm()))
            .when(!header.is_empty(), |this| this.child(row(header, true)))
            .children(rows.iter().map(|cells| row(cells, false)))
            .into_any_element()
    }

    fn image(&self, src: &str, alt: &str, width: Option<f32>, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let source = self.handlers.image.as_ref().and_then(|resolve| resolve(src));
        let Some(source) = source else {
            // Nothing resolved it: show what the image was, rather than an empty gap.
            return div()
                .flex()
                .items_center()
                .gap(px(6.))
                .text_color(colors.subtle_foreground)
                .child(Icon::new(IconName::Image).size(IconSize::Small).color(colors.subtle_foreground))
                .child(SharedString::from(if alt.is_empty() { src.to_string() } else { alt.to_string() }))
                .into_any_element();
        };
        let fallback = {
            let label = SharedString::from(if alt.is_empty() { "Image".to_string() } else { alt.to_string() });
            let muted = colors.subtle_foreground;
            move || div().text_size(typography::text_sm()).text_color(muted).child(label.clone()).into_any_element()
        };
        let image = img(source).rounded(metrics::radius_md()).with_fallback(fallback);
        let image = match width {
            Some(width) => image.w(px(width)).max_w_full(),
            None => image.max_w_full().max_h(self.style.image_max_height),
        };
        div().flex().min_w_0().max_w_full().child(image).into_any_element()
    }

    /// A run of styled text, with its links clickable.
    pub fn inline(&self, inline: &Inline, weight: Option<FontWeight>, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let ui = self.ui();
        let mono = self.mono();
        let plain = |len: usize| TextRun { len, font: ui.clone(), color: colors.foreground, background_color: None, underline: None, strikethrough: None };
        let mut runs = Vec::new();
        let mut links: Vec<(Range<usize>, String)> = Vec::new();
        let mut at = 0;
        for (range, style) in &inline.spans {
            if range.start > at {
                runs.push(plain(range.start - at));
            }
            let mut text_font = if style.code { mono.clone() } else { ui.clone() };
            if style.bold {
                text_font.weight = FontWeight::BOLD;
            }
            if style.italic {
                text_font.style = FontStyle::Italic;
            }
            let mut run = TextRun { len: range.len(), font: text_font, color: colors.foreground, background_color: None, underline: None, strikethrough: None };
            if style.code {
                run.background_color = Some(colors.field);
            }
            if style.strike {
                run.strikethrough = Some(StrikethroughStyle { thickness: px(1.), color: Some(colors.muted_foreground) });
            }
            if let Some(url) = &style.link {
                run.color = colors.primary;
                run.underline = Some(UnderlineStyle { thickness: px(1.), color: Some(colors.primary.opacity(0.5)), wavy: false });
                links.push((range.clone(), url.clone()));
            }
            runs.push(run);
            at = range.end;
        }
        if at < inline.text.len() {
            runs.push(plain(inline.text.len() - at));
        }
        let mut runs = self.mark_matches(&inline.text, runs, cx);
        if let Some(weight) = weight {
            for run in &mut runs {
                if run.font.weight.0 < weight.0 {
                    run.font.weight = weight;
                }
            }
        }
        let text = StyledText::new(inline.text.clone()).with_runs(runs);
        if links.is_empty() {
            return text.into_any_element();
        }
        let ranges: Vec<Range<usize>> = links.iter().map(|(range, _)| range.clone()).collect();
        let on_link = self.handlers.on_link.clone();
        InteractiveText::new(self.next_id("text"), text)
            .on_click(ranges, move |index, window, cx| {
                let Some((_, url)) = links.get(index) else { return };
                // Following a link is not also a click on the block around it, which an editable
                // preview would take as "open this for writing".
                cx.stop_propagation();
                match &on_link {
                    Some(on_link) => on_link(url, window, cx),
                    None if is_web(url) => cx.open_url(url),
                    None => {}
                }
            })
            .into_any_element()
    }

    /// Gives Find's matches in `text` their background, counting them so the current one stands out.
    fn mark_matches(&self, text: &str, runs: Vec<TextRun>, cx: &App) -> Vec<TextRun> {
        let Some(find) = &self.find else { return runs };
        if find.query.is_empty() {
            return runs;
        }
        let colors = &cx.theme().colors;
        let highlights: Vec<(Range<usize>, Hsla)> = find_ranges(text, &find.query)
            .into_iter()
            .map(|range| {
                let index = find.seen.get();
                find.seen.set(index + 1);
                (range, if index == find.current { colors.warning.opacity(0.6) } else { colors.warning.opacity(0.25) })
            })
            .collect();
        highlight_runs(runs, &highlights)
    }
}

/// Whether a link leaves the app.
pub fn is_web(url: &str) -> bool {
    url.contains("://") || url.starts_with("mailto:") || url.starts_with("tel:") || url.starts_with("//")
}

fn callout_look(callout: Option<Callout>, colors: &ThemeColors) -> (Hsla, Option<(IconName, &'static str)>) {
    match callout {
        Some(Callout::Note) => (colors.info, Some((IconName::Info, "Note"))),
        Some(Callout::Tip) => (colors.success, Some((IconName::Lightbulb, "Tip"))),
        Some(Callout::Important) => (colors.merged, Some((IconName::Megaphone, "Important"))),
        Some(Callout::Warning) => (colors.warning, Some((IconName::Warning, "Warning"))),
        Some(Callout::Caution) => (colors.destructive, Some((IconName::WarningCircle, "Caution"))),
        None => (colors.border_strong, None),
    }
}

/// Case-insensitive matches of `query` in `text`, as byte ranges of `text`.
pub fn find_ranges(text: &str, query: &str) -> Vec<Range<usize>> {
    if query.is_empty() {
        return Vec::new();
    }
    let haystack = text.to_lowercase();
    let needle = query.to_lowercase();
    // `to_lowercase` can change a string's length; without the same offsets the ranges would not
    // land on the text being drawn.
    if haystack.len() != text.len() {
        return Vec::new();
    }
    let mut ranges = Vec::new();
    let mut from = 0;
    while let Some(found) = haystack[from..].find(&needle) {
        let start = from + found;
        ranges.push(start..start + needle.len());
        from = start + needle.len().max(1);
        while from < haystack.len() && !haystack.is_char_boundary(from) {
            from += 1;
        }
    }
    ranges
}

/// Splits `runs` at the highlighted ranges and gives those parts their background.
pub fn highlight_runs(runs: Vec<TextRun>, highlights: &[(Range<usize>, Hsla)]) -> Vec<TextRun> {
    if highlights.is_empty() {
        return runs;
    }
    let mut out = Vec::new();
    let mut at = 0;
    for run in runs {
        let end = at + run.len;
        let mut cursor = at;
        let mut cuts: Vec<(usize, usize, Option<Hsla>)> = Vec::new();
        for (range, color) in highlights {
            let (start, stop) = (range.start.max(at), range.end.min(end));
            if start >= stop {
                continue;
            }
            if start > cursor {
                cuts.push((cursor, start, None));
            }
            cuts.push((start, stop, Some(*color)));
            cursor = stop;
        }
        if cursor < end {
            cuts.push((cursor, end, None));
        }
        for (start, stop, color) in cuts {
            let mut part = run.clone();
            part.len = stop - start;
            if let Some(color) = color {
                part.background_color = Some(color);
            }
            out.push(part);
        }
        at = end;
    }
    out
}

/// The text a block draws, in the order Find counts it.
pub fn block_texts<'b>(block: &'b Block, out: &mut Vec<&'b str>) {
    match &block.kind {
        BlockKind::Heading { text, .. } | BlockKind::Paragraph(text) => out.push(&text.text),
        BlockKind::Code { code, .. } => out.push(code),
        BlockKind::Quote { blocks, .. } => blocks.iter().for_each(|block| block_texts(block, out)),
        BlockKind::List { items, .. } => items.iter().flat_map(|item| item.blocks.iter()).for_each(|block| block_texts(block, out)),
        BlockKind::Table { header, rows, .. } => {
            out.extend(header.iter().map(|cell| cell.text.as_str()));
            out.extend(rows.iter().flatten().map(|cell| cell.text.as_str()));
        }
        BlockKind::Image { .. } | BlockKind::Rule => {}
    }
}

/// How many of `query` a block draws.
pub fn block_matches(block: &Block, query: &str) -> usize {
    let mut texts = Vec::new();
    block_texts(block, &mut texts);
    texts.iter().map(|text| find_ranges(text, query).len()).sum()
}

/// Styles a span for a surface drawing its own text (the agent transcript's selectable runs).
pub fn span_font(style: &SpanStyle, ui: &Font, mono: &Font) -> Font {
    let mut font = if style.code { mono.clone() } else { ui.clone() };
    if style.bold {
        font.weight = FontWeight::BOLD;
    }
    if style.italic {
        font.style = FontStyle::Italic;
    }
    font
}
