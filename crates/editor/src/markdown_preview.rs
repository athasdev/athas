//! The markdown preview (`features/editor/markdown` in Athas): the buffer rendered live —
//! headings, paragraphs with emphasis and links, nested and task lists, quotes, highlighted code
//! blocks, tables, images and rules. It is its own view, so the workbench can open it in a tab
//! beside the editor; the editor can also show it in its own pane, side by side.

use std::{
    cell::Cell,
    collections::HashMap,
    ops::Range,
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

use ui::scale::px;
use gpui::{
    App, FocusHandle, KeyDownEvent, ScrollHandle, Subscription,
    AnyElement, AppContext as _, Context, Entity, Font, FontStyle, FontWeight, Hsla, InteractiveText, IntoElement, ParentElement as _,
    InteractiveElement as _, Render, SharedString, StatefulInteractiveElement as _, Styled as _, StyledText, StrikethroughStyle, TextRun, UnderlineStyle, Window, div,
    ImageSource, font, img, prelude::FluentBuilder as _, relative,
};
use pulldown_cmark::{Alignment, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use theme::{ActiveTheme, Theme};
use ui::{Button, ButtonVariant, IconName, InputAppearance, TextInput, TextInputEvent, WithScrollbar, metrics, typography};

use crate::{
    Editor,
    markdown::extension_for_language,
    remote_image::{RemoteImage, remote_image},
    syntax::{self, SyntaxState},
};

/// Inline styles in preview text.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Style {
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub strike: bool,
    /// The link's target.
    pub link: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inline {
    pub text: String,
    pub spans: Vec<(Range<usize>, Style)>,
}

impl Inline {
    fn push(&mut self, text: &str, style: &Style) {
        let start = self.text.len();
        self.text.push_str(text);
        if *style != Style::default() && !text.is_empty() {
            self.spans.push((start..self.text.len(), style.clone()));
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Right,
}

/// A block of the rendered document.
#[derive(Clone, Debug, PartialEq)]
pub enum PreviewBlock {
    Heading { level: u8, text: Inline },
    Paragraph { text: Inline, quote: usize },
    /// A list item: its nesting depth, bullet or number, and checkbox for task lists.
    Item { depth: usize, marker: String, checked: Option<bool>, text: Inline, quote: usize },
    Code { language: Option<String>, code: String, quote: usize },
    Table { alignments: Vec<Align>, header: Vec<Inline>, rows: Vec<Vec<Inline>> },
    /// `width` is an HTML `<img>`'s width attribute, in pixels.
    Image { url: String, alt: String, width: Option<f32> },
    Rule,
}

/// What is being collected while parsing.
#[derive(Default)]
struct Builder {
    blocks: Vec<PreviewBlock>,
    inline: Option<Inline>,
    style: Style,
    heading: Option<u8>,
    code: Option<(Option<String>, String)>,
    /// Each open list's next number (`None` for bullets).
    lists: Vec<Option<u64>>,
    item: Option<(usize, String, Option<bool>)>,
    quote: usize,
    table: Option<(Vec<Align>, Vec<Inline>, Vec<Vec<Inline>>, bool)>,
    cell: Option<Inline>,
    image: Option<(String, String)>,
    /// The raw HTML of an HTML block, collected until it ends.
    html: Option<String>,
}

impl Builder {
    fn text(&mut self) -> &mut Inline {
        if let Some(cell) = &mut self.cell {
            return cell;
        }
        self.inline.get_or_insert_with(Inline::default)
    }

    fn flush(&mut self) {
        let Some(text) = self.inline.take() else { return };
        if text.text.trim().is_empty() && self.item.is_none() {
            return;
        }
        let quote = self.quote;
        let block = match (self.heading, self.item.take()) {
            (_, Some((depth, marker, checked))) => PreviewBlock::Item { depth, marker, checked, text, quote },
            (Some(level), None) => PreviewBlock::Heading { level, text },
            (None, None) => PreviewBlock::Paragraph { text, quote },
        };
        self.blocks.push(block);
    }
}

fn level(heading: HeadingLevel) -> u8 {
    match heading {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

/// `&amp;` and the other entities HTML in markdown commonly uses.
fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    static ENTITY: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);").unwrap());
    ENTITY
        .replace_all(text, |captures: &regex::Captures| {
            let name = &captures[1];
            let decoded = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{a0}'),
                "copy" => Some('©'),
                "mdash" => Some('—'),
                "ndash" => Some('–'),
                "hellip" => Some('…'),
                _ => match name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok().and_then(char::from_u32),
                    None => name.strip_prefix('#').and_then(|number| number.parse().ok()).and_then(char::from_u32),
                },
            };
            decoded.map(String::from).unwrap_or_else(|| captures[0].to_string())
        })
        .into_owned()
}

/// The value of attribute `name` in a tag's attribute text.
fn html_attribute(attributes: &str, name: &str) -> Option<String> {
    static ATTRIBUTE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r#"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))"#).unwrap());
    ATTRIBUTE.captures_iter(attributes).find(|captures| captures[1].eq_ignore_ascii_case(name)).map(|captures| {
        let value = captures.get(2).or_else(|| captures.get(3)).or_else(|| captures.get(4)).map_or("", |value| value.as_str());
        decode_entities(value)
    })
}

/// HTML in markdown, as the sanitized preview showed it: text with its inline styles and links,
/// headings, line and paragraph breaks, and images; other tags only break or are dropped.
fn push_html(builder: &mut Builder, html: &str) {
    static TAG: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r#"(?s)<!--.*?-->|<(/?)([A-Za-z][A-Za-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)/?>"#).unwrap());
    let push_text = |builder: &mut Builder, raw: &str| {
        let collapsed: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        let mut text = decode_entities(&collapsed);
        if raw.starts_with(char::is_whitespace) && !text.is_empty() {
            text.insert(0, ' ');
        }
        if raw.ends_with(char::is_whitespace) && !text.is_empty() && !text.ends_with(' ') {
            text.push(' ');
        }
        let empty_paragraph = builder.inline.as_ref().is_none_or(|inline| inline.text.trim().is_empty());
        if text.trim().is_empty() && empty_paragraph {
            return;
        }
        let style = builder.style.clone();
        let text = if empty_paragraph { text.trim_start().to_string() } else { text };
        builder.text().push(&text, &style);
    };
    let mut at = 0;
    for captures in TAG.captures_iter(html) {
        let whole = captures.get(0).unwrap();
        push_text(builder, &html[at..whole.start()]);
        at = whole.end();
        let Some(name) = captures.get(2) else { continue };
        let closing = !captures[1].is_empty();
        let attributes = captures.get(3).map_or("", |attributes| attributes.as_str());
        match name.as_str().to_ascii_lowercase().as_str() {
            "br" => builder.text().push("\n", &Style::default()),
            "b" | "strong" => builder.style.bold = !closing,
            "i" | "em" => builder.style.italic = !closing,
            "s" | "del" | "strike" => builder.style.strike = !closing,
            "code" | "kbd" | "samp" | "tt" => builder.style.code = !closing,
            "a" => builder.style.link = if closing { None } else { html_attribute(attributes, "href") },
            "img" => {
                if let Some(url) = html_attribute(attributes, "src") {
                    builder.flush();
                    let alt = html_attribute(attributes, "alt").unwrap_or_default();
                    let width = html_attribute(attributes, "width").and_then(|width| width.trim_end_matches("px").parse::<f32>().ok());
                    builder.blocks.push(PreviewBlock::Image { url, alt, width });
                }
            }
            heading @ ("h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
                builder.flush();
                builder.heading = (!closing).then(|| heading[1..].parse().unwrap_or(1));
            }
            "hr" => {
                builder.flush();
                builder.blocks.push(PreviewBlock::Rule);
            }
            "p" | "div" | "details" | "summary" | "center" | "section" | "article" | "table" | "tr" | "ul" | "ol" | "li" | "blockquote" | "picture" | "pre" => {
                builder.flush()
            }
            _ => {}
        }
    }
    push_text(builder, &html[at..]);
}

/// Parses markdown into the preview's blocks.
pub fn parse_blocks(markdown: &str) -> Vec<PreviewBlock> {
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_FOOTNOTES;
    let mut builder = Builder::default();
    for event in Parser::new_ext(markdown, options) {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph => {
                    if builder.item.is_none() {
                        builder.flush();
                    }
                }
                Tag::Heading { level: heading, .. } => {
                    builder.flush();
                    builder.heading = Some(level(heading));
                }
                Tag::BlockQuote(_) => {
                    builder.flush();
                    builder.quote += 1;
                }
                Tag::CodeBlock(kind) => {
                    builder.flush();
                    let language = match kind {
                        CodeBlockKind::Fenced(info) => info.split([' ', ',', '{']).next().map(str::to_string).filter(|language| !language.is_empty()),
                        CodeBlockKind::Indented => None,
                    };
                    builder.code = Some((language, String::new()));
                }
                Tag::List(start) => {
                    builder.flush();
                    builder.lists.push(start);
                }
                Tag::Item => {
                    builder.flush();
                    let depth = builder.lists.len().saturating_sub(1);
                    let marker = match builder.lists.last_mut() {
                        Some(Some(number)) => {
                            let marker = format!("{number}.");
                            *number += 1;
                            marker
                        }
                        _ => if depth % 2 == 0 { "•" } else { "◦" }.to_string(),
                    };
                    builder.item = Some((depth, marker, None));
                }
                Tag::Table(alignments) => {
                    builder.flush();
                    let alignments = alignments
                        .into_iter()
                        .map(|alignment| match alignment {
                            Alignment::Center => Align::Center,
                            Alignment::Right => Align::Right,
                            _ => Align::Left,
                        })
                        .collect();
                    builder.table = Some((alignments, Vec::new(), Vec::new(), true));
                }
                Tag::TableHead => {}
                Tag::TableRow => {
                    if let Some(table) = &mut builder.table {
                        table.2.push(Vec::new());
                    }
                }
                Tag::TableCell => builder.cell = Some(Inline::default()),
                Tag::Emphasis => builder.style.italic = true,
                Tag::Strong => builder.style.bold = true,
                Tag::Strikethrough => builder.style.strike = true,
                Tag::Link { dest_url, .. } => builder.style.link = Some(dest_url.to_string()),
                Tag::Image { dest_url, .. } => builder.image = Some((dest_url.to_string(), String::new())),
                Tag::HtmlBlock => builder.html = Some(String::new()),
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph => {
                    if builder.item.is_none() {
                        // A paragraph that is only an image shows the image.
                        builder.flush();
                    }
                }
                TagEnd::Heading(_) => {
                    builder.flush();
                    builder.heading = None;
                }
                TagEnd::BlockQuote(_) => {
                    builder.flush();
                    builder.quote = builder.quote.saturating_sub(1);
                }
                TagEnd::CodeBlock => {
                    if let Some((language, mut code)) = builder.code.take() {
                        while code.ends_with('\n') {
                            code.pop();
                        }
                        builder.blocks.push(PreviewBlock::Code { language, code, quote: builder.quote });
                    }
                }
                TagEnd::Item => builder.flush(),
                TagEnd::List(_) => {
                    builder.flush();
                    builder.lists.pop();
                }
                TagEnd::TableHead => {
                    if let Some(table) = &mut builder.table {
                        table.1 = table.2.pop().unwrap_or_default();
                        table.3 = false;
                    }
                }
                TagEnd::TableCell => {
                    if let (Some(cell), Some(table)) = (builder.cell.take(), &mut builder.table) {
                        match table.2.last_mut() {
                            Some(row) => row.push(cell),
                            None => table.2.push(vec![cell]),
                        }
                    }
                }
                TagEnd::Table => {
                    if let Some((alignments, header, rows, _)) = builder.table.take() {
                        builder.blocks.push(PreviewBlock::Table { alignments, header, rows });
                    }
                }
                TagEnd::Emphasis => builder.style.italic = false,
                TagEnd::Strong => builder.style.bold = false,
                TagEnd::Strikethrough => builder.style.strike = false,
                TagEnd::Link => builder.style.link = None,
                TagEnd::HtmlBlock => {
                    if let Some(html) = builder.html.take() {
                        builder.flush();
                        push_html(&mut builder, &html);
                        builder.flush();
                        builder.style = Style::default();
                        builder.heading = None;
                    }
                }
                TagEnd::Image => {
                    if let Some((url, alt)) = builder.image.take() {
                        let alone = builder.inline.as_ref().is_none_or(|inline| inline.text.trim().is_empty()) && builder.item.is_none() && builder.cell.is_none();
                        if alone {
                            builder.inline = None;
                            builder.blocks.push(PreviewBlock::Image { url, alt, width: None });
                        } else {
                            let style = Style { link: Some(url), ..builder.style.clone() };
                            builder.text().push(&format!("[{alt}]"), &style);
                        }
                    }
                }
                _ => {}
            },
            Event::Text(text) => {
                if let Some((_, code)) = &mut builder.code {
                    code.push_str(&text);
                } else if let Some((_, alt)) = &mut builder.image {
                    alt.push_str(&text);
                } else {
                    let style = builder.style.clone();
                    builder.text().push(&text, &style);
                }
            }
            Event::Code(text) => {
                let style = Style { code: true, ..builder.style.clone() };
                builder.text().push(&text, &style);
            }
            Event::TaskListMarker(checked) => {
                if let Some(item) = &mut builder.item {
                    item.2 = Some(checked);
                }
            }
            Event::SoftBreak => builder.text().push(" ", &Style::default()),
            Event::HardBreak => builder.text().push("\n", &Style::default()),
            Event::Rule => {
                builder.flush();
                builder.blocks.push(PreviewBlock::Rule);
            }
            Event::Html(html) => match &mut builder.html {
                Some(block) => block.push_str(&html),
                None => push_html(&mut builder, &html),
            },
            Event::InlineHtml(html) => push_html(&mut builder, &html),
            _ => {}
        }
    }
    builder.flush();
    if let Some((language, code)) = builder.code.take() {
        builder.blocks.push(PreviewBlock::Code { language, code, quote: 0 });
    }
    builder.blocks
}

/// Text runs for a code block, highlighted with the editor's grammars.
pub(crate) fn code_runs(language: Option<&str>, code: &str, mono: &Font, foreground: Hsla, theme: &Theme) -> Vec<TextRun> {
    let extension = extension_for_language(language.unwrap_or_default());
    let config = syntax::language_for_path(Path::new(&format!("snippet.{extension}")));
    let rope = ropey::Rope::from_str(code);
    let mut state = SyntaxState::new(config.clone());
    if let Some(language) = config.ts_language() {
        state.tree = syntax::parse(&language, &rope, None);
    }
    let spans = state.highlights(&rope, 0..code.len());
    let run = |len: usize, font: Font, color: Hsla| TextRun { len, font, color, background_color: None, underline: None, strikethrough: None };
    let mut runs = Vec::new();
    let mut at = 0;
    for (range, kind) in spans {
        if range.start < at || range.end > code.len() {
            continue;
        }
        if range.start > at {
            runs.push(run(range.start - at, mono.clone(), foreground));
        }
        runs.push(run(range.len(), Font { weight: kind.weight(), style: kind.style(false), ..mono.clone() }, kind.color(theme)));
        at = range.end;
    }
    if at < code.len() {
        runs.push(run(code.len() - at, mono.clone(), foreground));
    }
    runs
}

pub struct MarkdownPreview {
    editor: Entity<Editor>,
    /// Blocks for a buffer version and length (a loaded file starts again at version 0).
    cache: Option<((usize, usize), Arc<Vec<PreviewBlock>>)>,
    scroll: ScrollHandle,
    focus_handle: FocusHandle,
    find: Option<PreviewFind>,
    /// A block to bring into view (an `#anchor` link, the current match), and where the last
    /// frame drew it.
    reveal: Option<usize>,
    reveal_bounds: Rc<Cell<Option<gpui::Bounds<gpui::Pixels>>>>,
    /// Frames waited for the block to reveal to be drawn; a block that no longer exists (the
    /// document shrank, the query changed) is given up on instead of redrawing forever.
    reveal_frames: u8,
}

/// Find in the preview (`SearchPopover` over `markdown-preview.tsx`): matches of the query in the
/// rendered text, case-insensitive, with the current one marked and scrolled to.
struct PreviewFind {
    input: Entity<TextInput>,
    current: usize,
    _subscription: Subscription,
}

impl MarkdownPreview {
    /// A preview of `editor`'s buffer that follows its edits.
    pub fn new(editor: Entity<Editor>, cx: &mut Context<Self>) -> Self {
        cx.observe(&editor, |_, _, cx| cx.notify()).detach();
        Self { editor, cache: None, scroll: ScrollHandle::new(), focus_handle: cx.focus_handle(), find: None, reveal: None, reveal_bounds: Rc::default(), reveal_frames: 0 }
    }

    /// Opens Find over the preview, or focuses it again with its text selected.
    pub fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.find.is_none() {
            let input = cx.new(|cx| TextInput::new(window, cx).appearance(InputAppearance::Field).placeholder("Find in Markdown preview"));
            let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => {
                    if let Some(find) = &mut this.find {
                        find.current = 0;
                    }
                    this.reveal_current(cx);
                }
                TextInputEvent::Confirmed => {
                    let back = window.modifiers().shift;
                    this.step_find(if back { -1 } else { 1 }, cx);
                }
                TextInputEvent::Cancelled => this.close_find(window, cx),
                _ => {}
            });
            self.find = Some(PreviewFind { input, current: 0, _subscription: subscription });
        }
        if let Some(find) = &self.find {
            find.input.update(cx, |input, cx| {
                input.focus(window, cx);
                input.select_all_text(cx);
            });
        }
        cx.notify();
    }

    fn close_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.find = None;
        window.focus(&self.focus_handle, cx);
        cx.notify();
    }

    fn query(&self, cx: &App) -> String {
        self.find.as_ref().map(|find| find.input.read(cx).text().to_string()).unwrap_or_default()
    }

    /// Matches per block, in the order the blocks draw them.
    fn match_counts(&mut self, cx: &App) -> Vec<usize> {
        let query = self.query(cx);
        self.blocks(cx).iter().map(|block| block_texts(block).iter().map(|text| find_ranges(text, &query).len()).sum()).collect()
    }

    fn step_find(&mut self, direction: isize, cx: &mut Context<Self>) {
        let total: usize = self.match_counts(cx).iter().sum();
        if total == 0 {
            return;
        }
        if let Some(find) = &mut self.find {
            find.current = (find.current as isize + direction).rem_euclid(total as isize) as usize;
        }
        self.reveal_current(cx);
    }

    /// Scrolls the current match's block into view.
    fn reveal_current(&mut self, cx: &mut Context<Self>) {
        let current = self.find.as_ref().map_or(0, |find| find.current);
        let mut seen = 0;
        for (index, count) in self.match_counts(cx).into_iter().enumerate() {
            if current < seen + count {
                self.reveal = Some(index);
                self.reveal_frames = 0;
                break;
            }
            seen += count;
        }
        cx.notify();
    }

    /// Follows an `#anchor` link: the heading whose slug (GitHub's, as `#setup` for "Setup") or
    /// footnote it names.
    fn follow_anchor(&mut self, anchor: &str, cx: &mut Context<Self>) {
        let anchor = anchor.trim_start_matches('#').to_lowercase();
        let blocks = self.blocks(cx);
        let mut seen: HashMap<String, usize> = HashMap::new();
        let target = blocks.iter().position(|block| {
            let PreviewBlock::Heading { text, .. } = block else { return false };
            let base = slug(&text.text);
            let count = seen.entry(base.clone()).or_insert(0);
            let id = if *count == 0 { base } else { format!("{base}-{count}") };
            *count += 1;
            id == anchor
        });
        if let Some(index) = target {
            self.reveal = Some(index);
                self.reveal_frames = 0;
            cx.notify();
        }
    }

    pub fn editor(&self) -> &Entity<Editor> {
        &self.editor
    }

    /// The tab title: "Preview README.md".
    pub fn title(&self, cx: &gpui::App) -> String {
        let path = self.editor.read(cx).path();
        format!("Preview {}", path.file_name().and_then(|name| name.to_str()).unwrap_or("markdown"))
    }

    fn blocks(&mut self, cx: &gpui::App) -> Arc<Vec<PreviewBlock>> {
        let editor = self.editor.read(cx);
        let version = (editor.buffer_version(), editor.document.buffer.len());
        if let Some((cached, blocks)) = &self.cache
            && *cached == version
        {
            return blocks.clone();
        }
        let blocks = Arc::new(parse_blocks(&editor.text()));
        self.cache = Some((version, blocks.clone()));
        blocks
    }
}

/// A heading's anchor as GitHub writes it: lower case, punctuation dropped, spaces as dashes.
fn slug(text: &str) -> String {
    text.trim()
        .to_lowercase()
        .chars()
        .filter_map(|ch| match ch {
            ' ' => Some('-'),
            ch if ch.is_alphanumeric() || ch == '-' || ch == '_' => Some(ch),
            _ => None,
        })
        .collect()
}

/// Case-insensitive matches of `query` in `text`, as byte ranges of `text`.
fn find_ranges(text: &str, query: &str) -> Vec<Range<usize>> {
    if query.is_empty() {
        return Vec::new();
    }
    let haystack = text.to_ascii_lowercase();
    let needle = query.to_ascii_lowercase();
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

/// A block's runs of text, in the order they draw.
fn block_inlines(block: &PreviewBlock) -> Vec<&Inline> {
    match block {
        PreviewBlock::Heading { text, .. } | PreviewBlock::Paragraph { text, .. } | PreviewBlock::Item { text, .. } => vec![text],
        PreviewBlock::Table { header, rows, .. } => header.iter().chain(rows.iter().flatten()).collect(),
        _ => Vec::new(),
    }
}

/// A block's searchable text, in the order Find counts it: the inlines, or a code block's code.
fn block_texts(block: &PreviewBlock) -> Vec<&str> {
    match block {
        PreviewBlock::Code { code, .. } => vec![code.as_str()],
        _ => block_inlines(block).into_iter().map(|inline| inline.text.as_str()).collect(),
    }
}

/// Splits `runs` at the highlighted ranges and gives those parts their background.
fn highlight_runs(runs: Vec<TextRun>, highlights: &[(Range<usize>, Hsla)]) -> Vec<TextRun> {
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

/// The query and colours Find marks matches with during one render; `seen` counts the matches
/// drawn so far, so the current one can be told apart.
struct FindLook {
    query: String,
    current: usize,
    seen: Cell<usize>,
    matched: Hsla,
    current_color: Hsla,
}

/// Fonts and colours for one render.
struct Look {
    ui: Font,
    mono: Font,
    foreground: Hsla,
    muted: Hsla,
    code_background: Hsla,
    link: Hsla,
    border: Hsla,
    base_dir: PathBuf,
    /// Web images the blocks show, as far as they have loaded.
    remote: HashMap<String, RemoteImage>,
    find: Option<FindLook>,
    /// Follows an `#anchor` link in the preview that draws these blocks.
    on_anchor: Option<Rc<dyn Fn(&str, &mut App)>>,
}

impl Look {
    fn inline(&self, id: impl Into<SharedString>, inline: &Inline, size_font: Option<FontWeight>) -> AnyElement {
        let mut runs = Vec::new();
        let mut links = Vec::new();
        let mut at = 0;
        let plain = |len: usize| TextRun { len, font: self.ui.clone(), color: self.foreground, background_color: None, underline: None, strikethrough: None };
        for (range, style) in &inline.spans {
            if range.start > at {
                runs.push(plain(range.start - at));
            }
            let mut font = if style.code { self.mono.clone() } else { self.ui.clone() };
            if style.bold {
                font.weight = FontWeight::BOLD;
            }
            if style.italic {
                font.style = FontStyle::Italic;
            }
            let mut run = TextRun { len: range.len(), font, color: self.foreground, background_color: None, underline: None, strikethrough: None };
            if style.code {
                run.background_color = Some(self.code_background);
            }
            if style.strike {
                run.strikethrough = Some(StrikethroughStyle { thickness: px(1.), color: Some(self.muted) });
            }
            if let Some(url) = &style.link {
                run.color = self.link;
                run.underline = Some(UnderlineStyle { thickness: px(1.), color: Some(self.link.opacity(0.5)), wavy: false });
                links.push((range.clone(), url.clone()));
            }
            runs.push(run);
            at = range.end;
        }
        if at < inline.text.len() {
            runs.push(plain(inline.text.len() - at));
        }
        runs = self.mark_matches(&inline.text, runs);
        if let Some(weight) = size_font {
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
        let ranges = links.iter().map(|(range, _)| range.clone()).collect();
        let base = self.base_dir.clone();
        let on_anchor = self.on_anchor.clone();
        InteractiveText::new(gpui::ElementId::Name(id.into()), text)
            .on_click(ranges, move |index, _, cx| {
                let url = &links[index].1;
                if url.contains("://") || url.starts_with("mailto:") || url.starts_with("tel:") || url.starts_with("//") {
                    cx.open_url(url);
                } else if let Some(anchor) = url.strip_prefix('#') {
                    if let Some(on_anchor) = &on_anchor {
                        on_anchor(anchor, cx);
                    }
                } else {
                    // A file link opens in Athas (`handleFileSelect`), trying `.md` after it.
                    let root = workbench_api::projects(cx).active.map(std::path::PathBuf::from);
                    if let Some(path) = resolve_link(url, &base, root.as_deref()) {
                        workbench_api::open_file(cx, path, None);
                    }
                }
            })
            .into_any_element()
    }

    /// Gives Find's matches in `text` their background, counting them so the current one stands out.
    fn mark_matches(&self, text: &str, runs: Vec<TextRun>) -> Vec<TextRun> {
        let Some(find) = &self.find else { return runs };
        let highlights: Vec<(Range<usize>, Hsla)> = find_ranges(text, &find.query)
            .into_iter()
            .map(|range| {
                let index = find.seen.get();
                find.seen.set(index + 1);
                (range, if index == find.current { find.current_color } else { find.matched })
            })
            .collect();
        highlight_runs(runs, &highlights)
    }

    fn quoted(&self, quote: usize, child: AnyElement) -> AnyElement {
        if quote == 0 {
            return child;
        }
        div().pl(px(12. * quote as f32)).border_l(px(3.)).border_color(self.border).text_color(self.muted).child(child).into_any_element()
    }

    fn block(&self, index: usize, block: &PreviewBlock, theme: &Theme) -> AnyElement {
        let id = format!("md-{index}");
        match block {
            PreviewBlock::Heading { level, text } => {
                let size = match level {
                    1 => px(26.),
                    2 => px(21.),
                    3 => px(17.),
                    _ => px(15.),
                };
                div()
                    .mt(px(if *level <= 2 { 12. } else { 6. }))
                    .pb(px(if *level <= 2 { 6. } else { 0. }))
                    .when(*level <= 2, |this| this.border_b_1().border_color(self.border))
                    .text_size(size)
                    .line_height(relative(1.3))
                    .child(self.inline(id, text, Some(FontWeight::SEMIBOLD)))
                    .into_any_element()
            }
            PreviewBlock::Paragraph { text, quote } => self.quoted(*quote, div().child(self.inline(id, text, None)).into_any_element()),
            PreviewBlock::Item { depth, marker, checked, text, quote } => {
                let marker = match checked {
                    Some(true) => "☑".to_string(),
                    Some(false) => "☐".to_string(),
                    None => marker.clone(),
                };
                let item = div()
                    .flex()
                    .gap(px(8.))
                    .pl(px(18. * *depth as f32 + 4.))
                    .child(div().flex_none().min_w(px(14.)).text_color(self.muted).child(marker))
                    .child(div().flex_1().min_w_0().when(*checked == Some(true), |this| this.text_color(self.muted)).child(self.inline(id, text, None)));
                self.quoted(*quote, item.into_any_element())
            }
            PreviewBlock::Code { language, code, quote } => {
                let runs = self.mark_matches(code, code_runs(language.as_deref(), code, &self.mono, self.foreground, theme));
                let block = div()
                    .id(SharedString::from(id))
                    .overflow_x_scroll()
                    .px(px(12.))
                    .py(px(10.))
                    .rounded(metrics::radius_md())
                    .bg(self.code_background)
                    .text_size(px(12.5))
                    .child(StyledText::new(code.clone()).with_runs(runs));
                self.quoted(*quote, block.into_any_element())
            }
            PreviewBlock::Table { alignments, header, rows } => {
                let cell = |row: usize, column: usize, inline: &Inline, head: bool| {
                    let align = alignments.get(column).copied().unwrap_or(Align::Left);
                    div()
                        .flex()
                        .flex_1()
                        .min_w(px(60.))
                        .px(px(10.))
                        .py(px(4.))
                        .border_r_1()
                        .border_color(self.border)
                        .when(align == Align::Center, |this| this.justify_center())
                        .when(align == Align::Right, |this| this.justify_end())
                        .child(self.inline(format!("{id}-{row}-{column}"), inline, head.then_some(FontWeight::SEMIBOLD)))
                };
                let row_element = |row: usize, cells: &[Inline], head: bool| {
                    div()
                        .flex()
                        .border_b_1()
                        .border_color(self.border)
                        .when(head, |this| this.bg(self.code_background))
                        .children(cells.iter().enumerate().map(|(column, inline)| cell(row, column, inline, head)))
                };
                div()
                    .flex()
                    .flex_col()
                    .border_1()
                    .border_color(self.border)
                    .rounded(metrics::radius())
                    .child(row_element(0, header, true))
                    .children(rows.iter().enumerate().map(|(index, row)| row_element(index + 1, row, false)))
                    .into_any_element()
            }
            PreviewBlock::Image { url, alt, width } => {
                let sized = |image: gpui::Img| match width {
                    Some(width) => image.w(px(*width)).max_w_full(),
                    None => image.max_w_full().max_h(px(480.)),
                };
                if let Some(RemoteImage::Ready(image)) = self.remote.get(url) {
                    div().max_w_full().child(sized(img(ImageSource::Image(image.clone())))).into_any_element()
                } else if url.contains("://") {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .text_color(self.muted)
                        .child(ui::Icon::new(IconName::Image).color(self.muted))
                        .child(if alt.is_empty() { url.clone() } else { alt.clone() })
                        .into_any_element()
                } else {
                    let path = self.base_dir.join(url);
                    div().max_w_full().child(sized(img(path))).into_any_element()
                }
            }
            PreviewBlock::Rule => div().my(px(6.)).h(px(1.)).bg(self.border).into_any_element(),
        }
    }
}

impl Render for MarkdownPreview {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let blocks = self.blocks(cx);
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let base_dir = self.editor.read(cx).path().parent().map(Path::to_path_buf).unwrap_or_default();
        let mut remote = HashMap::new();
        for block in blocks.iter() {
            if let PreviewBlock::Image { url, .. } = block
                && url.starts_with("http")
                && url.contains("://")
            {
                remote.insert(url.clone(), remote_image(url, cx));
            }
        }
        let query = self.query(cx);
        let total: usize = if query.is_empty() { 0 } else { self.match_counts(cx).iter().sum() };
        if let Some(find) = &mut self.find {
            find.current = find.current.min(total.saturating_sub(1));
        }
        let current = self.find.as_ref().map_or(0, |find| find.current);
        // A block to reveal is measured on one frame and scrolled to the top on the next.
        if self.reveal.is_some() {
            if let Some(bounds) = self.reveal_bounds.take() {
                let viewport = self.scroll.bounds();
                let offset = self.scroll.offset();
                let top = (bounds.top() - viewport.top() - offset.y - px(12.)).max(px(0.));
                self.scroll.set_offset(gpui::point(offset.x, -top));
                self.reveal = None;
                self.reveal_frames = 0;
            } else if self.reveal_frames < 3 {
                self.reveal_frames += 1;
                window.request_animation_frame();
            } else {
                self.reveal = None;
                self.reveal_frames = 0;
            }
        }
        let reveal = self.reveal;
        let reveal_bounds = self.reveal_bounds.clone();
        let weak = cx.weak_entity();
        let look = Look {
            ui: font(typography::UI_FONT),
            mono: font(SharedString::from(settings::get(cx).font_family.clone())),
            foreground: colors.foreground,
            muted: colors.muted_foreground,
            code_background: colors.field,
            link: colors.primary,
            border: colors.border,
            base_dir,
            remote,
            find: (!query.is_empty()).then(|| FindLook {
                query: query.clone(),
                current,
                seen: Cell::new(0),
                matched: colors.warning.opacity(0.25),
                current_color: colors.warning.opacity(0.6),
            }),
            on_anchor: Some(Rc::new(move |anchor: &str, cx: &mut App| {
                let anchor = anchor.to_string();
                weak.update(cx, |this, cx| this.follow_anchor(&anchor, cx)).ok();
            })),
        };
        let find_bar = self.find.as_ref().map(|find| {
            let label = if query.is_empty() {
                None
            } else if total == 0 {
                Some("No results".to_string())
            } else {
                Some(format!("{} of {total}", current + 1))
            };
            let weak = cx.weak_entity();
            let step = move |direction: isize| {
                let weak = weak.clone();
                move |_: &gpui::ClickEvent, _: &mut Window, cx: &mut App| {
                    weak.update(cx, |this, cx| this.step_find(direction, cx)).ok();
                }
            };
            let weak = cx.weak_entity();
            div()
                .absolute()
                .top(px(8.))
                .right(px(8.))
                .w(px(320.))
                .p(px(8.))
                .flex()
                .flex_col()
                .gap(px(6.))
                .rounded(metrics::radius_lg())
                .bg(colors.overlay)
                .shadow(theme.shadows.popover.clone())
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(div().flex_1().min_w_0().child(find.input.clone()))
                        .children(label.map(|label| div().flex_none().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(label)))
                        .child(Button::icon("markdown-find-close", IconName::X).variant(ButtonVariant::Ghost).tooltip("Close search").on_click(move |_, window, cx| {
                            weak.update(cx, |this, cx| this.close_find(window, cx)).ok();
                        })),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_end()
                        .gap(px(4.))
                        .child(Button::icon("markdown-find-previous", IconName::ArrowUp).variant(ButtonVariant::Ghost).tooltip("Previous match").disabled(total == 0).on_click(step(-1)))
                        .child(Button::icon("markdown-find-next", IconName::ArrowDown).variant(ButtonVariant::Ghost).tooltip("Next match").disabled(total == 0).on_click(step(1))),
                )
        });
        div()
            .id("markdown-preview-root")
            .relative()
            .size_full()
            .key_context("MarkdownPreview")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(|this, _: &crate::Find, window, cx| this.open_find(window, cx)))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if event.keystroke.key == "escape" && this.find.is_some() {
                    this.close_find(window, cx);
                    cx.stop_propagation();
                }
            }))
            .on_mouse_down(gpui::MouseButton::Left, cx.listener(|this, _, window, cx| {
                if !this.focus_handle.contains_focused(window, cx) {
                    window.focus(&this.focus_handle, cx);
                }
            }))
            .child(
                div()
                    .id("markdown-preview")
                    .size_full()
                    .overflow_y_scroll()
                    .bg(colors.background)
                    .text_color(colors.foreground)
                    .font_family(typography::UI_FONT)
                    .text_size(px(14.))
                    .line_height(relative(TYPESET_PREVIEW_LEADING))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(14. * TYPESET_PREVIEW_FLOW))
                            .max_w(px(768.))
                            .px(px(24.))
                            .py(px(20.))
                            .children(blocks.iter().enumerate().map(|(index, block)| {
                                let element = look.block(index, block, &theme);
                                if reveal != Some(index) {
                                    return element;
                                }
                                let bounds = reveal_bounds.clone();
                                div()
                                    .relative()
                                    .child(element)
                                    .child(gpui::canvas(move |area, _, _| bounds.set(Some(area)), |_, _, _, _| {}).absolute().size_full())
                                    .into_any_element()
                            })),
                    )
                    .scrollbar_with(&self.scroll),
            )
            .children(find_bar)
    }
}

impl gpui::Focusable for MarkdownPreview {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// The Typeset `typeset-preview` preset (`typeset-presets.css`): line height and the space
/// between blocks, in ems.
const TYPESET_PREVIEW_LEADING: f32 = 1.68;
const TYPESET_PREVIEW_FLOW: f32 = 0.75;

/// Rendered markdown without the preview's page: notebook cells and outputs.
pub(crate) fn markdown_element(markdown: &str, base_dir: PathBuf, cx: &gpui::App) -> AnyElement {
    let theme = cx.theme().clone();
    let colors = &theme.colors;
    let look = Look {
        ui: font(typography::UI_FONT),
        mono: font(SharedString::from(settings::get(cx).font_family.clone())),
        foreground: colors.foreground,
        muted: colors.muted_foreground,
        code_background: colors.field,
        link: colors.primary,
        border: colors.border,
        base_dir,
        remote: HashMap::new(),
        find: None,
        on_anchor: None,
    };
    let blocks = parse_blocks(markdown);
    div()
        .flex()
        .flex_col()
        .gap(px(14. * TYPESET_PREVIEW_FLOW))
        .min_w_0()
        .line_height(relative(TYPESET_PREVIEW_LEADING))
        .children(blocks.iter().enumerate().map(|(index, block)| look.block(index, block, &theme)))
        .into_any_element()
}

/// The preview shown beside the text inside the editor pane.
pub(crate) struct PreviewPane {
    pub preview: Entity<MarkdownPreview>,
}

/// The file a relative link in the preview points at (`resolvePath`): beside the document, or
/// from the project's root for a link starting with `/`; `name.md` when `name` is missing.
fn resolve_link(url: &str, base: &std::path::Path, root: Option<&std::path::Path>) -> Option<std::path::PathBuf> {
    let href = url.split(['#', '?']).next().unwrap_or_default();
    if href.is_empty() {
        return None;
    }
    let decoded = href.replace("%20", " ");
    let target = match decoded.strip_prefix('/') {
        Some(rooted) => root.map_or_else(|| std::path::PathBuf::from(&decoded), |root| root.join(rooted)),
        None => base.join(&decoded),
    };
    if target.exists() {
        return Some(target);
    }
    let with_md = if decoded.ends_with(".md") { target } else { std::path::PathBuf::from(format!("{}.md", target.display())) };
    with_md.exists().then_some(with_md)
}

impl Editor {
    /// A preview of this editor's buffer, for the workbench to open beside it (in a tab).
    pub fn markdown_preview(&self, cx: &mut Context<Self>) -> Entity<MarkdownPreview> {
        let editor = cx.entity();
        cx.new(|cx| MarkdownPreview::new(editor, cx))
    }

    /// Whether the file is markdown (the preview action applies).
    pub fn is_markdown(&self) -> bool {
        self.document.syntax.language.name == "Markdown"
    }

    pub(crate) fn open_preview_pane(&mut self, cx: &mut Context<Self>) {
        let preview = self.markdown_preview(cx);
        self.preview = Some(PreviewPane { preview });
        cx.notify();
    }

    /// Shows or hides the rendered markdown to the right of the text.
    pub(crate) fn toggle_markdown_preview(&mut self, _: &crate::ToggleMarkdownPreview, _: &mut Window, cx: &mut Context<Self>) {
        if self.preview.take().is_none() && self.is_markdown() {
            self.open_preview_pane(cx);
        }
        cx.notify();
    }

    pub(crate) fn render_preview_pane(&self, cx: &Context<Self>) -> Option<AnyElement> {
        let pane = self.preview.as_ref()?;
        Some(div().flex_none().w(relative(0.5)).h_full().border_l_1().border_color(cx.theme().colors.border).child(pane.preview.clone()).into_any_element())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(text: &str) -> Inline {
        Inline { text: text.into(), spans: Vec::new() }
    }

    #[test]
    fn links_resolve_beside_the_document_or_from_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let docs = dir.path().join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::write(docs.join("guide.md"), "").unwrap();
        std::fs::write(dir.path().join("README.md"), "").unwrap();
        assert_eq!(resolve_link("guide.md#setup", &docs, None), Some(docs.join("guide.md")));
        assert_eq!(resolve_link("guide", &docs, None), Some(docs.join("guide.md")), "the .md fallback");
        assert_eq!(resolve_link("/README.md", &docs, Some(dir.path())), Some(dir.path().join("README.md")));
        assert_eq!(resolve_link("missing.md", &docs, None), None);
        assert_eq!(resolve_link("#top", &docs, None), None);
    }

    #[test]
    fn headings_paragraphs_and_inline_styles() {
        let blocks = parse_blocks("# Title\n\nSome **bold**, *it*, `code`, ~~gone~~ and [a link](https://x.dev).\n");
        assert_eq!(blocks[0], PreviewBlock::Heading { level: 1, text: plain("Title") });
        let PreviewBlock::Paragraph { text, quote: 0 } = &blocks[1] else { panic!("{blocks:?}") };
        assert_eq!(text.text, "Some bold, it, code, gone and a link.");
        let styles: Vec<_> = text.spans.iter().map(|(range, style)| (&text.text[range.clone()], style.clone())).collect();
        assert_eq!(styles[0], ("bold", Style { bold: true, ..Default::default() }));
        assert_eq!(styles[1], ("it", Style { italic: true, ..Default::default() }));
        assert_eq!(styles[2], ("code", Style { code: true, ..Default::default() }));
        assert_eq!(styles[3], ("gone", Style { strike: true, ..Default::default() }));
        assert_eq!(styles[4], ("a link", Style { link: Some("https://x.dev".into()), ..Default::default() }));
    }

    #[test]
    fn nested_numbered_and_task_lists() {
        let blocks = parse_blocks("- one\n  - inner\n- two\n\n3. three\n4. four\n\n- [x] done\n- [ ] todo\n");
        let items: Vec<_> = blocks
            .iter()
            .map(|block| match block {
                PreviewBlock::Item { depth, marker, checked, text, .. } => (*depth, marker.clone(), *checked, text.text.clone()),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(
            items,
            vec![
                (0, "•".into(), None, "one".into()),
                (1, "◦".into(), None, "inner".into()),
                (0, "•".into(), None, "two".into()),
                (0, "3.".into(), None, "three".into()),
                (0, "4.".into(), None, "four".into()),
                (0, "•".into(), Some(true), "done".into()),
                (0, "•".into(), Some(false), "todo".into()),
            ]
        );
    }

    #[test]
    fn code_blocks_quotes_and_rules() {
        let blocks = parse_blocks("```rust\nfn main() {}\n```\n\n> quoted\n\n---\n");
        assert_eq!(blocks[0], PreviewBlock::Code { language: Some("rust".into()), code: "fn main() {}".into(), quote: 0 });
        assert_eq!(blocks[1], PreviewBlock::Paragraph { text: plain("quoted"), quote: 1 });
        assert_eq!(blocks[2], PreviewBlock::Rule);
    }

    #[test]
    fn find_counts_matches_inside_code_blocks() {
        let blocks = parse_blocks("Run main\n\n```rust\nfn main() { main2() }\n```\n");
        let counts: Vec<usize> = blocks.iter().map(|block| block_texts(block).iter().map(|text| find_ranges(text, "MAIN").len()).sum()).collect();
        assert_eq!(counts, vec![1, 2]);
    }

    #[test]
    fn tables_with_alignment() {
        let blocks = parse_blocks("| Name | Size |\n|:-----|-----:|\n| a | 1 |\n| b | 22 |\n");
        let PreviewBlock::Table { alignments, header, rows } = &blocks[0] else { panic!("{blocks:?}") };
        assert_eq!(alignments, &vec![Align::Left, Align::Right]);
        assert_eq!(header.iter().map(|cell| cell.text.as_str()).collect::<Vec<_>>(), vec!["Name", "Size"]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1][1].text, "22");
    }

    #[test]
    fn html_blocks_and_inline_html() {
        let blocks = parse_blocks(
            "<p align=\"center\">\n  <img src=\"https://example.com/logo.png\" alt=\"Logo\" width=\"120\">\n</p>\n\n<h2>Install &amp; run</h2>\n\nPress <kbd>Ctrl</kbd> then<br>go <b>now</b>.\n",
        );
        assert_eq!(blocks[0], PreviewBlock::Image { url: "https://example.com/logo.png".into(), alt: "Logo".into(), width: Some(120.) });
        assert_eq!(blocks[1], PreviewBlock::Heading { level: 2, text: plain("Install & run") });
        let PreviewBlock::Paragraph { text, .. } = &blocks[2] else { panic!("{:?}", blocks[2]) };
        assert_eq!(text.text, "Press Ctrl then\ngo now.");
        assert!(text.spans.iter().any(|(range, style)| style.code && &text.text[range.clone()] == "Ctrl"));
        assert!(text.spans.iter().any(|(range, style)| style.bold && &text.text[range.clone()] == "now"));
        assert_eq!(blocks.len(), 3);
        assert_eq!(decode_entities("&lt;a&gt; &#169; &#x41; &bogus;"), "<a> © A &bogus;");
    }

    #[test]
    fn images_alone_or_inline() {
        let blocks = parse_blocks("![Logo](assets/logo.png)\n\nSee ![icon](i.png) here.\n");
        assert_eq!(blocks[0], PreviewBlock::Image { url: "assets/logo.png".into(), alt: "Logo".into(), width: None });
        let PreviewBlock::Paragraph { text, .. } = &blocks[1] else { panic!("{blocks:?}") };
        assert_eq!(text.text, "See [icon] here.");
    }
}
