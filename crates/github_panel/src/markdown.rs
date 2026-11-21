//! A compact GitHub-flavoured Markdown renderer: pulldown-cmark events folded into blocks of
//! styled text, then drawn as GPUI elements (`github-markdown.tsx`).

use std::ops::Range;

use gpui::{
    AnyElement, App, FontStyle, FontWeight, HighlightStyle, InteractiveText, IntoElement, ParentElement, SharedString,
    StrikethroughStyle, Styled, StyledText, UnderlineStyle, div, prelude::*, px, relative,
};
use pulldown_cmark::{BlockQuoteKind, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, metrics, typography};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SpanStyle {
    pub bold: bool,
    pub italic: bool,
    pub strike: bool,
    pub code: bool,
}

/// A run of text with its inline styles and links, byte ranges into `text`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inline {
    pub text: String,
    pub spans: Vec<(Range<usize>, SpanStyle)>,
    pub links: Vec<(Range<usize>, String)>,
}

impl Inline {
    fn push(&mut self, text: &str, style: SpanStyle, link: Option<&str>) {
        if text.is_empty() {
            return;
        }
        let start = self.text.len();
        self.text.push_str(text);
        let range = start..self.text.len();
        match self.spans.last_mut() {
            Some((last, last_style)) if *last_style == style && last.end == start => last.end = range.end,
            _ => self.spans.push((range.clone(), style)),
        }
        if let Some(link) = link {
            match self.links.last_mut() {
                Some((last, url)) if url == link && last.end == start => last.end = range.end,
                _ => self.links.push((range, link.to_string())),
            }
        }
    }

    fn is_blank(&self) -> bool {
        self.text.trim().is_empty()
    }

    /// Drops the whitespace a soft break left at the start or end.
    fn trimmed(mut self) -> Self {
        let end = self.text.trim_end().len();
        self.text.truncate(end);
        let start = self.text.len() - self.text.trim_start().len();
        if start > 0 {
            self.text.drain(..start);
        }
        let clip = |range: &Range<usize>| range.start.saturating_sub(start).min(end - start)..range.end.saturating_sub(start).min(end - start);
        self.spans = self.spans.iter().map(|(range, style)| (clip(range), *style)).filter(|(range, _)| !range.is_empty()).collect();
        self.links = self.links.iter().map(|(range, url)| (clip(range), url.clone())).filter(|(range, _)| !range.is_empty()).collect();
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Callout {
    Note,
    Tip,
    Important,
    Warning,
    Caution,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Block {
    Heading(u8, Inline),
    Paragraph(Inline),
    Code { language: Option<String>, code: String },
    Quote { callout: Option<Callout>, blocks: Vec<Block> },
    List { start: Option<u64>, items: Vec<ListItem> },
    Table { header: Vec<Inline>, rows: Vec<Vec<Inline>> },
    Rule,
    Image { src: String, alt: String },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ListItem {
    pub checked: Option<bool>,
    pub blocks: Vec<Block>,
}

enum Frame {
    Blocks(Vec<Block>),
    Quote(Option<Callout>, Vec<Block>),
    List(Option<u64>, Vec<ListItem>),
    Item(ListItem),
}

#[derive(Default)]
struct Table {
    header: Vec<Inline>,
    rows: Vec<Vec<Inline>>,
    row: Vec<Inline>,
}

struct Builder<'a> {
    frames: Vec<Frame>,
    inline: Option<Inline>,
    heading: Option<u8>,
    code: Option<(Option<String>, String)>,
    table: Option<Table>,
    style: SpanStyle,
    bold: usize,
    italic: usize,
    links: Vec<String>,
    /// An image's address and alt text, while its tag is open.
    image: Option<(String, String)>,
    repo_url: Option<&'a str>,
}

impl Builder<'_> {
    fn push_block(&mut self, block: Block) {
        match self.frames.last_mut() {
            Some(Frame::Blocks(blocks) | Frame::Quote(_, blocks) | Frame::Item(ListItem { blocks, .. })) => blocks.push(block),
            Some(Frame::List(..)) | None => {}
        }
    }

    fn flush(&mut self) {
        let Some(inline) = self.inline.take() else { return };
        if inline.is_blank() {
            return;
        }
        let inline = inline.trimmed();
        match self.heading.take() {
            Some(level) => self.push_block(Block::Heading(level, inline)),
            None => self.push_block(Block::Paragraph(inline)),
        }
    }

    fn inline(&mut self) -> &mut Inline {
        self.inline.get_or_insert_with(Inline::default)
    }

    fn style(&self) -> SpanStyle {
        SpanStyle { bold: self.bold > 0, italic: self.italic > 0, ..self.style }
    }

    /// Text, with bare URLs, `#123` and `@user` linked as GitHub links them.
    fn text(&mut self, text: &str) {
        if let Some((_, code)) = &mut self.code {
            code.push_str(text);
            return;
        }
        if let Some((_, alt)) = &mut self.image {
            alt.push_str(text);
            return;
        }
        let style = self.style();
        if let Some(link) = self.links.last().cloned() {
            self.inline().push(text, style, Some(&link));
            return;
        }
        let repo_url = self.repo_url.map(str::to_string);
        for (piece, link) in autolink(text, repo_url.as_deref()) {
            self.inline().push(piece, style, link.as_deref());
        }
    }

    fn html(&mut self, html: &str) {
        for piece in strip_html(html) {
            match piece {
                HtmlPiece::Text(text) => self.text(&text),
                HtmlPiece::Break => self.inline().push("\n", SpanStyle::default(), None),
                HtmlPiece::Image { src, alt } => {
                    self.flush();
                    self.push_block(Block::Image { src, alt });
                }
            }
        }
    }
}

/// Bare `https://` URLs, `#123` references and `@user` mentions in plain text.
fn autolink<'t>(text: &'t str, repo_url: Option<&str>) -> Vec<(&'t str, Option<String>)> {
    let mut pieces = Vec::new();
    let mut plain_start = 0;
    let mut index = 0;
    let bytes = text.as_bytes();
    while index < bytes.len() {
        let boundary = index == 0 || !(bytes[index - 1].is_ascii_alphanumeric() || bytes[index - 1] == b'/');
        let found = if text[index..].starts_with("https://") || text[index..].starts_with("http://") {
            let end = text[index..].find(|c: char| c.is_whitespace() || c == '<' || c == '>').map_or(text.len(), |end| index + end);
            let end = index + text[index..end].trim_end_matches(['.', ',', ')', ';', ':', '!', '?']).len();
            Some((end, text[index..end].to_string()))
        } else if boundary && bytes[index] == b'#' && repo_url.is_some() {
            let digits = text[index + 1..].bytes().take_while(u8::is_ascii_digit).count();
            (digits > 0).then(|| (index + 1 + digits, format!("{}/issues/{}", repo_url.unwrap_or_default(), &text[index + 1..index + 1 + digits])))
        } else if boundary && bytes[index] == b'@' {
            let name = text[index + 1..].bytes().take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'-').count();
            (name > 0).then(|| (index + 1 + name, format!("https://github.com/{}", &text[index + 1..index + 1 + name])))
        } else {
            None
        };
        match found {
            Some((end, url)) if end > index => {
                if plain_start < index {
                    pieces.push((&text[plain_start..index], None));
                }
                pieces.push((&text[index..end], Some(url)));
                index = end;
                plain_start = end;
            }
            _ => index += text[index..].chars().next().map_or(1, char::len_utf8),
        }
    }
    if plain_start < text.len() {
        pieces.push((&text[plain_start..], None));
    }
    pieces
}

#[derive(Debug, PartialEq)]
enum HtmlPiece {
    Text(String),
    Break,
    Image { src: String, alt: String },
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    // Same length as `tag` (unlike `to_lowercase`, which changes `İ`), so offsets carry over.
    let lower = tag.to_ascii_lowercase();
    let start = lower.find(&format!("{name}="))? + name.len() + 1;
    let rest = &tag[start..];
    let quote = rest.chars().next()?;
    if quote == '"' || quote == '\'' {
        let value = &rest[1..];
        Some(value[..value.find(quote)?].to_string())
    } else {
        Some(rest.split(|c: char| c.is_whitespace() || c == '>').next()?.to_string())
    }
}

/// The parts of inline or block HTML worth showing: text, line breaks and images.
fn strip_html(html: &str) -> Vec<HtmlPiece> {
    let mut pieces = Vec::new();
    let mut rest = html;
    while !rest.is_empty() {
        if let Some(comment) = rest.strip_prefix("<!--") {
            rest = comment.find("-->").map_or("", |end| &comment[end + 3..]);
            continue;
        }
        if rest.starts_with('<')
            && let Some(end) = rest.find('>')
        {
            let tag = &rest[1..end];
            let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or_default().to_lowercase();
            match name.as_str() {
                "br" => pieces.push(HtmlPiece::Break),
                "img" => {
                    if let Some(src) = attribute(tag, "src") {
                        pieces.push(HtmlPiece::Image { src, alt: attribute(tag, "alt").unwrap_or_default() });
                    }
                }
                _ => {}
            }
            rest = &rest[end + 1..];
            continue;
        }
        let skip = rest.chars().next().map_or(1, char::len_utf8);
        let end = rest[skip..].find('<').map_or(rest.len(), |end| end + skip);
        let text = rest[..end].replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">");
        if !text.is_empty() {
            pieces.push(HtmlPiece::Text(text));
        }
        rest = &rest[end..];
    }
    pieces
}

/// Parses `source`; `repo_url` links `#123` references to the repository.
pub fn parse(source: &str, repo_url: Option<&str>) -> Vec<Block> {
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_GFM;
    let mut builder = Builder {
        frames: vec![Frame::Blocks(Vec::new())],
        inline: None,
        heading: None,
        code: None,
        table: None,
        style: SpanStyle::default(),
        bold: 0,
        italic: 0,
        links: Vec::new(),
        image: None,
        repo_url,
    };
    for event in Parser::new_ext(source, options) {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph => {
                    builder.flush();
                    builder.inline = Some(Inline::default());
                }
                Tag::Heading { level, .. } => {
                    builder.flush();
                    builder.heading = Some(heading_level(level));
                    builder.inline = Some(Inline::default());
                }
                Tag::BlockQuote(kind) => {
                    builder.flush();
                    builder.frames.push(Frame::Quote(kind.map(callout), Vec::new()));
                }
                Tag::CodeBlock(kind) => {
                    builder.flush();
                    let language = match kind {
                        CodeBlockKind::Fenced(language) => Some(language.to_string()).filter(|language| !language.is_empty()),
                        CodeBlockKind::Indented => None,
                    };
                    builder.code = Some((language, String::new()));
                }
                Tag::List(start) => {
                    builder.flush();
                    builder.frames.push(Frame::List(start, Vec::new()));
                }
                Tag::Item => {
                    builder.flush();
                    builder.frames.push(Frame::Item(ListItem::default()));
                }
                Tag::Table(_) => {
                    builder.flush();
                    builder.table = Some(Table::default());
                }
                Tag::TableHead | Tag::TableRow => {
                    if let Some(table) = &mut builder.table {
                        table.row.clear();
                    }
                }
                Tag::TableCell => builder.inline = Some(Inline::default()),
                Tag::HtmlBlock => builder.flush(),
                Tag::Emphasis => builder.italic += 1,
                Tag::Strong => builder.bold += 1,
                Tag::Strikethrough => builder.style.strike = true,
                Tag::Link { dest_url, .. } => builder.links.push(dest_url.to_string()),
                Tag::Image { dest_url, .. } => {
                    builder.flush();
                    builder.image = Some((dest_url.to_string(), String::new()));
                }
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::HtmlBlock => builder.flush(),
                TagEnd::BlockQuote(_) => {
                    builder.flush();
                    if let Some(Frame::Quote(callout, blocks)) = builder.frames.pop() {
                        builder.push_block(Block::Quote { callout, blocks });
                    }
                }
                TagEnd::CodeBlock => {
                    if let Some((language, code)) = builder.code.take() {
                        builder.push_block(Block::Code { language, code: code.trim_end_matches('\n').to_string() });
                    }
                }
                TagEnd::List(_) => {
                    builder.flush();
                    if let Some(Frame::List(start, items)) = builder.frames.pop() {
                        builder.push_block(Block::List { start, items });
                    }
                }
                TagEnd::Item => {
                    builder.flush();
                    if let Some(Frame::Item(item)) = builder.frames.pop()
                        && let Some(Frame::List(_, items)) = builder.frames.last_mut()
                    {
                        items.push(item);
                    }
                }
                TagEnd::TableCell => {
                    let cell = builder.inline.take().unwrap_or_default().trimmed();
                    if let Some(table) = &mut builder.table {
                        table.row.push(cell);
                    }
                }
                TagEnd::TableHead => {
                    if let Some(table) = &mut builder.table {
                        table.header = std::mem::take(&mut table.row);
                    }
                }
                TagEnd::TableRow => {
                    if let Some(table) = &mut builder.table {
                        let row = std::mem::take(&mut table.row);
                        table.rows.push(row);
                    }
                }
                TagEnd::Table => {
                    if let Some(table) = builder.table.take() {
                        builder.push_block(Block::Table { header: table.header, rows: table.rows });
                    }
                }
                TagEnd::Emphasis => builder.italic = builder.italic.saturating_sub(1),
                TagEnd::Strong => builder.bold = builder.bold.saturating_sub(1),
                TagEnd::Strikethrough => builder.style.strike = false,
                TagEnd::Link => {
                    builder.links.pop();
                }
                TagEnd::Image => {
                    if let Some((src, alt)) = builder.image.take() {
                        builder.push_block(Block::Image { src, alt });
                    }
                }
                _ => {}
            },
            Event::Text(text) => builder.text(&text),
            Event::Code(code) | Event::InlineMath(code) | Event::DisplayMath(code) => {
                let style = SpanStyle { code: true, ..builder.style() };
                let link = builder.links.last().cloned();
                builder.inline().push(&code, style, link.as_deref());
            }
            Event::Html(html) | Event::InlineHtml(html) => builder.html(&html),
            Event::FootnoteReference(label) => builder.text(&format!("[{label}]")),
            Event::SoftBreak => builder.text(" "),
            Event::HardBreak => builder.inline().push("\n", SpanStyle::default(), None),
            Event::Rule => {
                builder.flush();
                builder.push_block(Block::Rule);
            }
            Event::TaskListMarker(checked) => {
                if let Some(Frame::Item(item)) = builder.frames.last_mut() {
                    item.checked = Some(checked);
                }
            }
        }
    }
    builder.flush();
    match builder.frames.into_iter().next() {
        Some(Frame::Blocks(blocks)) => blocks,
        _ => Vec::new(),
    }
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn callout(kind: BlockQuoteKind) -> Callout {
    match kind {
        BlockQuoteKind::Note => Callout::Note,
        BlockQuoteKind::Tip => Callout::Tip,
        BlockQuoteKind::Important => Callout::Important,
        BlockQuoteKind::Warning => Callout::Warning,
        BlockQuoteKind::Caution => Callout::Caution,
    }
}

// Drawing.

/// Draws parsed Markdown. `id` keeps the link targets of different documents apart.
pub fn render(blocks: &[Block], id: &str, cx: &App) -> AnyElement {
    let mut counter = 0;
    div()
        .flex()
        .flex_col()
        .gap(px(10.))
        .min_w_0()
        .text_size(typography::TEXT_BASE)
        .line_height(relative(1.6))
        .text_color(cx.theme().colors.foreground)
        .children(blocks.iter().map(|block| render_block(block, id, &mut counter, cx)))
        .into_any_element()
}

fn render_block(block: &Block, id: &str, counter: &mut usize, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    match block {
        Block::Heading(level, inline) => {
            let size = match level {
                1 => px(20.),
                2 => px(17.),
                3 => typography::TEXT_LG,
                _ => typography::TEXT_BASE,
            };
            div()
                .mt(px(if *level <= 2 { 6. } else { 2. }))
                .pb(px(if *level <= 2 { 4. } else { 0. }))
                .when(*level <= 2, |this| this.border_b_1().border_color(colors.divider))
                .text_size(size)
                .line_height(relative(1.3))
                .font_weight(FontWeight::SEMIBOLD)
                .child(render_inline(inline, id, counter, cx))
                .into_any_element()
        }
        Block::Paragraph(inline) => div().min_w_0().child(render_inline(inline, id, counter, cx)).into_any_element(),
        Block::Code { code, .. } => {
            *counter += 1;
            div()
                .id(SharedString::from(format!("{id}-code-{counter}")))
                .min_w_0()
                .overflow_x_scroll()
                .px(px(12.))
                .py(px(10.))
                .rounded(metrics::RADIUS_LG)
                .bg(colors.surface)
                .font_family(typography::MONO_FONT)
                .text_size(typography::TEXT_SM)
                .line_height(relative(1.5))
                .whitespace_nowrap()
                .child(code.clone())
                .into_any_element()
        }
        Block::Quote { callout, blocks } => {
            let (accent, title) = match callout {
                Some(Callout::Note) => (colors.info, Some((IconName::Info, "Note"))),
                Some(Callout::Tip) => (colors.success, Some((IconName::Lightbulb, "Tip"))),
                Some(Callout::Important) => (colors.merged, Some((IconName::Megaphone, "Important"))),
                Some(Callout::Warning) => (colors.warning, Some((IconName::Warning, "Warning"))),
                Some(Callout::Caution) => (colors.destructive, Some((IconName::WarningCircle, "Caution"))),
                None => (colors.border_strong, None),
            };
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
                .children(blocks.iter().map(|block| render_block(block, id, counter, cx)))
                .into_any_element()
        }
        Block::List { start, items } => div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .children(items.iter().enumerate().map(|(index, item)| {
                let marker = match (item.checked, start) {
                    (Some(checked), _) => Icon::new(if checked { IconName::CheckCircle } else { IconName::CircleDotted })
                        .size(IconSize::Small)
                        .color(if checked { colors.success } else { colors.subtle_foreground })
                        .into_any_element(),
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
                            .h(px(20.))
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
                            .children(item.blocks.iter().map(|block| render_block(block, id, counter, cx))),
                    )
            }))
            .into_any_element(),
        Block::Table { header, rows } => {
            let row = |cells: &[Inline], head: bool, counter: &mut usize| {
                div()
                    .flex()
                    .when(head, |this| this.font_weight(FontWeight::SEMIBOLD).bg(colors.surface))
                    .border_b_1()
                    .border_color(colors.divider)
                    .children(cells.iter().map(|cell| {
                        div().flex_1().min_w(px(60.)).px(px(8.)).py(px(4.)).child(render_inline(cell, id, counter, cx))
                    }))
            };
            let mut table = div()
                .flex()
                .flex_col()
                .min_w_0()
                .overflow_hidden()
                .rounded(metrics::RADIUS_MD)
                .border_1()
                .border_color(colors.divider)
                .text_size(typography::TEXT_SM);
            if !header.is_empty() {
                table = table.child(row(header, true, counter));
            }
            for cells in rows {
                table = table.child(row(cells, false, counter));
            }
            table.into_any_element()
        }
        Block::Rule => div().h(px(1.)).my(px(4.)).bg(colors.divider).into_any_element(),
        Block::Image { src, alt } => div()
            .flex()
            .min_w_0()
            .child(
                gpui::img(src.clone())
                    .max_w_full()
                    .max_h(px(420.))
                    .rounded(metrics::RADIUS_MD)
                    .with_fallback({
                        let alt = SharedString::from(if alt.is_empty() { "Image".to_string() } else { alt.clone() });
                        let muted = colors.subtle_foreground;
                        move || div().text_size(typography::TEXT_SM).text_color(muted).child(alt.clone()).into_any_element()
                    }),
            )
            .into_any_element(),
    }
}

fn render_inline(inline: &Inline, id: &str, counter: &mut usize, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    let link_ranges: Vec<Range<usize>> = inline.links.iter().map(|(range, _)| range.clone()).collect();
    let mut highlights: Vec<(Range<usize>, HighlightStyle)> = Vec::new();
    let mut fonts: Vec<(Range<usize>, SharedString)> = Vec::new();
    // Split style spans at link edges so every piece takes one style.
    let mut cuts: Vec<usize> = inline.spans.iter().flat_map(|(range, _)| [range.start, range.end]).collect();
    cuts.extend(link_ranges.iter().flat_map(|range| [range.start, range.end]));
    cuts.sort_unstable();
    cuts.dedup();
    for window in cuts.windows(2) {
        let range = window[0]..window[1];
        let style = inline.spans.iter().find(|(span, _)| span.start <= range.start && range.end <= span.end).map(|(_, style)| *style).unwrap_or_default();
        let link = link_ranges.iter().any(|link| link.start <= range.start && range.end <= link.end);
        let mut highlight = HighlightStyle::default();
        if style.bold {
            highlight.font_weight = Some(FontWeight::SEMIBOLD);
        }
        if style.italic {
            highlight.font_style = Some(FontStyle::Italic);
        }
        if style.strike {
            highlight.strikethrough = Some(StrikethroughStyle { thickness: px(1.), color: None });
        }
        if style.code {
            highlight.background_color = Some(colors.selected);
            fonts.push((range.clone(), typography::MONO_FONT.into()));
        }
        if link {
            highlight.color = Some(colors.primary);
            highlight.underline = Some(UnderlineStyle { thickness: px(1.), color: Some(colors.primary.opacity(0.4)), wavy: false });
        }
        if highlight != HighlightStyle::default() {
            highlights.push((range, highlight));
        }
    }
    let text = StyledText::new(SharedString::from(inline.text.clone())).with_highlights(highlights).with_font_family_overrides(fonts);
    if inline.links.is_empty() {
        return text.into_any_element();
    }
    *counter += 1;
    let urls: Vec<String> = inline.links.iter().map(|(_, url)| url.clone()).collect();
    InteractiveText::new(SharedString::from(format!("{id}-text-{counter}")), text)
        .on_click(link_ranges, move |index, _, cx| {
            if let Some(url) = urls.get(index) {
                crate::links::open(cx, url);
            }
        })
        .into_any_element()
}

#[cfg(test)]
mod tests {
    #[test]
    fn html_with_non_ascii_text_after_tags() {
        let _ = super::strip_html("<summary>📸 Screenshots</summary>");
        let _ = super::strip_html("<p align=\"center\">Özet</p>");
        let _ = super::strip_html("<img title=\"İİ\" src=\"ğx.png\">");
    }

    use super::*;

    fn text(block: &Block) -> &str {
        match block {
            Block::Heading(_, inline) | Block::Paragraph(inline) => &inline.text,
            _ => "",
        }
    }

    #[test]
    fn parses_headings_paragraphs_and_inline_styles() {
        let blocks = parse("# Title\n\nSome **bold** and `code`,\nwrapped *here*.", None);
        assert_eq!(blocks.len(), 2);
        assert!(matches!(&blocks[0], Block::Heading(1, inline) if inline.text == "Title"));
        let Block::Paragraph(inline) = &blocks[1] else { panic!("{blocks:?}") };
        assert_eq!(inline.text, "Some bold and code, wrapped here.");
        let styled: Vec<_> = inline.spans.iter().filter(|(_, style)| *style != SpanStyle::default()).map(|(range, style)| (&inline.text[range.clone()], *style)).collect();
        assert_eq!(
            styled,
            [
                ("bold", SpanStyle { bold: true, ..Default::default() }),
                ("code", SpanStyle { code: true, ..Default::default() }),
                ("here", SpanStyle { italic: true, ..Default::default() }),
            ]
        );
    }

    #[test]
    fn parses_lists_tasks_and_nesting() {
        let blocks = parse("- [x] done\n- [ ] todo\n  1. nested\n\n3. three\n4. four", None);
        let Block::List { start: None, items } = &blocks[0] else { panic!("{blocks:?}") };
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].checked, Some(true));
        assert_eq!(text(&items[0].blocks[0]), "done");
        assert_eq!(items[1].checked, Some(false));
        assert!(matches!(&items[1].blocks[1], Block::List { start: Some(1), items } if items.len() == 1));
        assert!(matches!(&blocks[1], Block::List { start: Some(3), items } if items.len() == 2));
    }

    #[test]
    fn parses_code_quotes_tables_and_rules() {
        let source = "```rust\nfn main() {}\n```\n\n> [!WARNING]\n> Careful\n\n> plain\n\n| a | b |\n|---|---|\n| 1 | **2** |\n\n---";
        let blocks = parse(source, None);
        assert_eq!(blocks[0], Block::Code { language: Some("rust".into()), code: "fn main() {}".into() });
        assert!(matches!(&blocks[1], Block::Quote { callout: Some(Callout::Warning), blocks } if text(&blocks[0]) == "Careful"));
        assert!(matches!(&blocks[2], Block::Quote { callout: None, .. }));
        let Block::Table { header, rows } = &blocks[3] else { panic!("{blocks:?}") };
        assert_eq!(header.iter().map(|cell| cell.text.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(rows[0][1].text, "2");
        assert_eq!(blocks[4], Block::Rule);
    }

    #[test]
    fn links_urls_references_and_images() {
        let blocks = parse("See [docs](https://a.dev), fixes #12 by @mehmet. https://x.io/y.\n\n![logo](https://img/l.png)", Some("https://github.com/o/r"));
        let Block::Paragraph(inline) = &blocks[0] else { panic!() };
        let links: Vec<_> = inline.links.iter().map(|(range, url)| (&inline.text[range.clone()], url.as_str())).collect();
        assert_eq!(
            links,
            [
                ("docs", "https://a.dev"),
                ("#12", "https://github.com/o/r/issues/12"),
                ("@mehmet", "https://github.com/mehmet"),
                ("https://x.io/y", "https://x.io/y"),
            ]
        );
        assert_eq!(blocks[1], Block::Image { src: "https://img/l.png".into(), alt: "logo".into() });
    }

    #[test]
    fn strips_html_but_keeps_images_and_breaks() {
        let blocks = parse("<!-- template -->\n<p align=\"center\"><img src=\"https://i/a.png\" alt=\"Shot\"></p>\n\nline<br>next", None);
        assert_eq!(blocks[0], Block::Image { src: "https://i/a.png".into(), alt: "Shot".into() });
        assert_eq!(text(&blocks[1]), "line\nnext");
    }
}
