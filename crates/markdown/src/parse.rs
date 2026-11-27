//! Markdown parsed into the block tree every preview in Athas draws: headings, paragraphs, lists
//! (nested, numbered and task), quotes and GitHub's alerts, code, tables, images and rules, with
//! inline emphasis, code, strikethrough and links.
//!
//! Each block keeps the byte range it came from, so an editable preview can edit the source a
//! block was written as and put it back where it was.

use std::ops::Range;

use pulldown_cmark::{Alignment, BlockQuoteKind, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

/// Inline styling of a run of text.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SpanStyle {
    pub bold: bool,
    pub italic: bool,
    pub strike: bool,
    pub code: bool,
    /// Where a link goes.
    pub link: Option<String>,
}

impl SpanStyle {
    pub fn is_plain(&self) -> bool {
        *self == Self::default()
    }
}

/// A run of text with its styled ranges, as byte ranges into `text`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inline {
    pub text: String,
    pub spans: Vec<(Range<usize>, SpanStyle)>,
}

impl Inline {
    pub fn plain(text: impl Into<String>) -> Self {
        Self { text: text.into(), spans: Vec::new() }
    }

    pub fn is_blank(&self) -> bool {
        self.text.trim().is_empty()
    }

    fn push(&mut self, text: &str, style: &SpanStyle) {
        if text.is_empty() {
            return;
        }
        let start = self.text.len();
        self.text.push_str(text);
        if style.is_plain() {
            return;
        }
        match self.spans.last_mut() {
            Some((last, last_style)) if last.end == start && last_style == style => last.end = self.text.len(),
            _ => self.spans.push((start..self.text.len(), style.clone())),
        }
    }

    /// Drops the whitespace a soft break left at either end, carrying the spans with it.
    fn trimmed(mut self) -> Self {
        let end = self.text.trim_end().len();
        self.text.truncate(end);
        let start = self.text.len() - self.text.trim_start().len();
        if start > 0 {
            self.text.drain(..start);
        }
        let len = self.text.len();
        self.spans = self
            .spans
            .into_iter()
            .map(|(range, style)| (range.start.saturating_sub(start).min(len)..range.end.saturating_sub(start).min(len), style))
            .filter(|(range, _)| !range.is_empty())
            .collect();
        self
    }

    /// The ranges that are links, with their targets.
    pub fn links(&self) -> Vec<(Range<usize>, String)> {
        self.spans.iter().filter_map(|(range, style)| Some((range.clone(), style.link.clone()?))).collect()
    }
}

/// A table column's alignment.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Align {
    #[default]
    Left,
    Center,
    Right,
}

/// GitHub's alert quotes (`> [!NOTE]`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Callout {
    Note,
    Tip,
    Important,
    Warning,
    Caution,
}

impl Callout {
    /// The word the alert is written with, for an editor that rewrites one.
    pub fn keyword(self) -> &'static str {
        match self {
            Self::Note => "NOTE",
            Self::Tip => "TIP",
            Self::Important => "IMPORTANT",
            Self::Warning => "WARNING",
            Self::Caution => "CAUTION",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum BlockKind {
    Heading { level: u8, text: Inline },
    Paragraph(Inline),
    Code { language: Option<String>, code: String },
    Quote { callout: Option<Callout>, blocks: Vec<Block> },
    List { start: Option<u64>, items: Vec<ListItem> },
    Table { alignments: Vec<Align>, header: Vec<Inline>, rows: Vec<Vec<Inline>> },
    /// An image on its own, from `![alt](src)` or an HTML `<img>`; `width` is the tag's attribute.
    Image { src: String, alt: String, width: Option<f32> },
    Rule,
}

/// A block and the source it was written as.
#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    pub kind: BlockKind,
    /// Byte range in the document the block was parsed from.
    pub source: Range<usize>,
}

impl Block {
    pub fn new(kind: BlockKind, source: Range<usize>) -> Self {
        Self { kind, source }
    }

    /// The blocks nested inside this one (a quote's, a list item's).
    pub fn children(&self) -> &[Block] {
        match &self.kind {
            BlockKind::Quote { blocks, .. } => blocks,
            _ => &[],
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ListItem {
    /// A task item's box, and the range of the `[ ]` that writes it.
    pub checked: Option<bool>,
    pub check_source: Option<Range<usize>>,
    pub blocks: Vec<Block>,
    pub source: Range<usize>,
}

/// What a document is read with.
#[derive(Clone, Debug, Default)]
pub struct ParseOptions {
    /// Links `#123` to this repository's issues (GitHub bodies).
    pub repo_url: Option<String>,
    /// Links `@user` to their GitHub profile.
    pub mentions: bool,
    /// Links bare `https://` addresses found in plain text.
    pub autolink: bool,
}

impl ParseOptions {
    /// What a file, a comment or a reply is read with: bare addresses link, nothing else.
    pub fn document() -> Self {
        Self { autolink: true, ..Self::default() }
    }

    /// GitHub's bodies: `#123` and `@user` link as they do there.
    pub fn github(repo_url: Option<&str>) -> Self {
        Self { repo_url: repo_url.map(str::to_string), mentions: true, autolink: true }
    }
}

enum Frame {
    Blocks(Vec<Block>),
    Quote(Option<Callout>, Vec<Block>, Range<usize>),
    List(Option<u64>, Vec<ListItem>, Range<usize>),
    Item(ListItem),
}

#[derive(Default)]
struct Table {
    alignments: Vec<Align>,
    header: Vec<Inline>,
    rows: Vec<Vec<Inline>>,
    row: Vec<Inline>,
    in_head: bool,
}

struct Builder<'a> {
    frames: Vec<Frame>,
    inline: Option<Inline>,
    /// Where the paragraph or heading being collected started.
    span: Range<usize>,
    heading: Option<u8>,
    code: Option<(Option<String>, String, Range<usize>)>,
    table: Option<(Table, Range<usize>)>,
    style: SpanStyle,
    bold: usize,
    italic: usize,
    links: Vec<String>,
    /// An image's address, alt text and range, while its tag is open.
    image: Option<(String, String, Range<usize>)>,
    /// What an open HTML tag styles the text with (`<b>` until `</b>`). Kept on the builder, not
    /// inside one chunk of HTML: a server or a README writes `<kbd>Ctrl</kbd>` as three events.
    html_style: SpanStyle,
    options: &'a ParseOptions,
}

impl Builder<'_> {
    fn push_block(&mut self, kind: BlockKind, source: Range<usize>) {
        let block = Block::new(kind, source);
        match self.frames.last_mut() {
            Some(Frame::Blocks(blocks) | Frame::Quote(_, blocks, _) | Frame::Item(ListItem { blocks, .. })) => blocks.push(block),
            Some(Frame::List(..)) | None => {}
        }
    }

    fn flush(&mut self) {
        let Some(inline) = self.inline.take() else { return };
        if inline.is_blank() {
            return;
        }
        let source = self.span.clone();
        let inline = inline.trimmed();
        match self.heading.take() {
            Some(level) => self.push_block(BlockKind::Heading { level, text: inline }, source),
            None => self.push_block(BlockKind::Paragraph(inline), source),
        }
    }

    fn inline(&mut self) -> &mut Inline {
        self.inline.get_or_insert_with(Inline::default)
    }

    fn style(&self) -> SpanStyle {
        SpanStyle {
            bold: self.bold > 0 || self.html_style.bold,
            italic: self.italic > 0 || self.html_style.italic,
            strike: self.style.strike || self.html_style.strike,
            code: self.style.code || self.html_style.code,
            link: self.links.last().cloned(),
        }
    }

    fn text(&mut self, text: &str) {
        if let Some((_, code, _)) = &mut self.code {
            code.push_str(text);
            return;
        }
        if let Some((_, alt, _)) = &mut self.image {
            alt.push_str(text);
            return;
        }
        let style = self.style();
        // Inside a link the whole run is that link already; autolinking would nest one.
        if style.link.is_some() {
            self.inline().push(text, &style);
            return;
        }
        for (piece, link) in autolink(text, self.options) {
            let style = SpanStyle { link, ..style.clone() };
            self.inline().push(piece, &style);
        }
    }

    fn html(&mut self, html: &str, range: Range<usize>) {
        let mut style = std::mem::take(&mut self.html_style);
        let pieces = strip_html(html, &mut style);
        self.html_style = style;
        for piece in pieces {
            match piece {
                HtmlPiece::Text(text) => self.text(&text),
                HtmlPiece::Break => {
                    let style = self.style();
                    self.inline().push("\n", &SpanStyle { link: style.link, ..SpanStyle::default() });
                }
                HtmlPiece::Heading(level, text) => {
                    self.flush();
                    self.push_block(BlockKind::Heading { level, text: Inline::plain(text) }, range.clone());
                }
                HtmlPiece::Image { src, alt, width } => {
                    self.flush();
                    self.push_block(BlockKind::Image { src, alt, width }, range.clone());
                }
            }
        }
    }
}

/// Reads a document with the defaults: bare addresses link, nothing else does.
pub fn parse(source: &str) -> Vec<Block> {
    parse_with(source, &ParseOptions::document())
}

pub fn parse_with(source: &str, options: &ParseOptions) -> Vec<Block> {
    let parser_options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_GFM;
    let mut builder = Builder {
        frames: vec![Frame::Blocks(Vec::new())],
        inline: None,
        span: 0..0,
        heading: None,
        code: None,
        table: None,
        style: SpanStyle::default(),
        bold: 0,
        italic: 0,
        links: Vec::new(),
        image: None,
        html_style: SpanStyle::default(),
        options,
    };
    for (event, range) in Parser::new_ext(source, parser_options).into_offset_iter() {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph => {
                    builder.flush();
                    builder.span = range;
                    builder.inline = Some(Inline::default());
                }
                Tag::Heading { level, .. } => {
                    builder.flush();
                    builder.span = range;
                    builder.heading = Some(heading_level(level));
                    builder.inline = Some(Inline::default());
                }
                Tag::BlockQuote(kind) => {
                    builder.flush();
                    builder.frames.push(Frame::Quote(kind.map(callout), Vec::new(), range));
                }
                Tag::CodeBlock(kind) => {
                    builder.flush();
                    let language = match kind {
                        CodeBlockKind::Fenced(language) => {
                            Some(language.split([' ', ',']).next().unwrap_or_default().to_string()).filter(|language| !language.is_empty())
                        }
                        CodeBlockKind::Indented => None,
                    };
                    builder.code = Some((language, String::new(), range));
                }
                Tag::List(start) => {
                    builder.flush();
                    builder.frames.push(Frame::List(start, Vec::new(), range));
                }
                Tag::Item => {
                    builder.flush();
                    builder.frames.push(Frame::Item(ListItem { source: range, ..ListItem::default() }));
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
                    builder.table = Some((Table { alignments, ..Table::default() }, range));
                }
                Tag::TableHead => {
                    if let Some((table, _)) = &mut builder.table {
                        table.row.clear();
                        table.in_head = true;
                    }
                }
                Tag::TableRow => {
                    if let Some((table, _)) = &mut builder.table {
                        table.row.clear();
                    }
                }
                Tag::TableCell => builder.inline = Some(Inline::default()),
                Tag::HtmlBlock => builder.flush(),
                Tag::Emphasis => builder.italic += 1,
                Tag::Strong => builder.bold += 1,
                Tag::Strikethrough => builder.style.strike = true,
                Tag::Link { dest_url, .. } => builder.links.push(dest_url.to_string()),
                Tag::Image { dest_url, .. } => builder.image = Some((dest_url.to_string(), String::new(), range)),
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::HtmlBlock => builder.flush(),
                TagEnd::BlockQuote(_) => {
                    builder.flush();
                    if let Some(Frame::Quote(callout, blocks, source)) = builder.frames.pop() {
                        builder.push_block(BlockKind::Quote { callout, blocks }, source);
                    }
                }
                TagEnd::CodeBlock => {
                    if let Some((language, code, source)) = builder.code.take() {
                        builder.push_block(BlockKind::Code { language, code: code.trim_end_matches('\n').to_string() }, source);
                    }
                }
                TagEnd::List(_) => {
                    builder.flush();
                    if let Some(Frame::List(start, items, source)) = builder.frames.pop() {
                        builder.push_block(BlockKind::List { start, items }, source);
                    }
                }
                TagEnd::Item => {
                    builder.flush();
                    if let Some(Frame::Item(item)) = builder.frames.pop()
                        && let Some(Frame::List(_, items, _)) = builder.frames.last_mut()
                    {
                        items.push(item);
                    }
                }
                TagEnd::TableCell => {
                    let cell = builder.inline.take().unwrap_or_default().trimmed();
                    if let Some((table, _)) = &mut builder.table {
                        table.row.push(cell);
                    }
                }
                TagEnd::TableHead => {
                    if let Some((table, _)) = &mut builder.table {
                        table.header = std::mem::take(&mut table.row);
                        table.in_head = false;
                    }
                }
                TagEnd::TableRow => {
                    if let Some((table, _)) = &mut builder.table {
                        let row = std::mem::take(&mut table.row);
                        if !table.in_head {
                            table.rows.push(row);
                        }
                    }
                }
                TagEnd::Table => {
                    if let Some((table, source)) = builder.table.take() {
                        builder.push_block(BlockKind::Table { alignments: table.alignments, header: table.header, rows: table.rows }, source);
                    }
                }
                TagEnd::Emphasis => builder.italic = builder.italic.saturating_sub(1),
                TagEnd::Strong => builder.bold = builder.bold.saturating_sub(1),
                TagEnd::Strikethrough => builder.style.strike = false,
                TagEnd::Link => {
                    builder.links.pop();
                }
                TagEnd::Image => {
                    if let Some((src, alt, source)) = builder.image.take() {
                        // An image alone in its paragraph is a block; one among words stays inline.
                        let alone = builder.inline.as_ref().is_none_or(Inline::is_blank);
                        if alone {
                            builder.inline = None;
                            builder.push_block(BlockKind::Image { src, alt, width: None }, source);
                        } else {
                            let style = builder.style();
                            let label = if alt.is_empty() { "image".to_string() } else { alt };
                            builder.inline().push(&format!("[{label}]"), &style);
                        }
                    }
                }
                _ => {}
            },
            Event::Text(text) => builder.text(&text),
            Event::Code(code) | Event::InlineMath(code) | Event::DisplayMath(code) => {
                let style = SpanStyle { code: true, ..builder.style() };
                builder.inline().push(&code, &style);
            }
            Event::Html(html) | Event::InlineHtml(html) => builder.html(&html, range),
            Event::FootnoteReference(label) => builder.text(&format!("[{label}]")),
            Event::SoftBreak => builder.text(" "),
            Event::HardBreak => {
                let style = builder.style();
                builder.inline().push("\n", &SpanStyle { link: style.link, ..SpanStyle::default() });
            }
            Event::Rule => {
                builder.flush();
                builder.push_block(BlockKind::Rule, range);
            }
            Event::TaskListMarker(checked) => {
                if let Some(Frame::Item(item)) = builder.frames.last_mut() {
                    item.checked = Some(checked);
                    item.check_source = Some(range);
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

/// Bare `https://` addresses, `#123` references and `@user` mentions in plain text.
fn autolink<'t>(text: &'t str, options: &ParseOptions) -> Vec<(&'t str, Option<String>)> {
    if !options.autolink {
        return vec![(text, None)];
    }
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
        } else if boundary && bytes[index] == b'#' && options.repo_url.is_some() {
            let digits = text[index + 1..].bytes().take_while(u8::is_ascii_digit).count();
            (digits > 0).then(|| (index + 1 + digits, format!("{}/issues/{}", options.repo_url.clone().unwrap_or_default(), &text[index + 1..index + 1 + digits])))
        } else if boundary && options.mentions && bytes[index] == b'@' {
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
    if pieces.is_empty() { vec![(text, None)] } else { pieces }
}

#[derive(Debug, PartialEq)]
enum HtmlPiece {
    Text(String),
    Break,
    Heading(u8, String),
    Image { src: String, alt: String, width: Option<f32> },
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

/// `&amp;` and the other entities markdown's HTML commonly uses.
pub fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find(';').filter(|end| *end <= 10);
        let decoded = end.and_then(|end| {
            let name = &after[..end];
            match name {
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
            }
        });
        match (decoded, end) {
            (Some(character), Some(end)) => {
                out.push(character);
                rest = &after[end + 1..];
            }
            _ => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The parts of inline or block HTML worth showing: text with the few tags that style it, line
/// breaks, headings and images.
fn strip_html(html: &str, style: &mut SpanStyle) -> Vec<HtmlPiece> {
    let mut pieces = Vec::new();
    let mut rest = html;
    let mut heading: Option<(u8, String)> = None;
    while !rest.is_empty() {
        if let Some(comment) = rest.strip_prefix("<!--") {
            rest = comment.find("-->").map_or("", |end| &comment[end + 3..]);
            continue;
        }
        if rest.starts_with('<')
            && let Some(end) = rest.find('>')
        {
            let tag = &rest[1..end];
            let closing = tag.starts_with('/');
            let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or_default().to_ascii_lowercase();
            match name.as_str() {
                "br" => pieces.push(HtmlPiece::Break),
                "img" => {
                    if let Some(src) = attribute(tag, "src") {
                        let width = attribute(tag, "width").and_then(|width| width.trim_end_matches("px").parse().ok());
                        pieces.push(HtmlPiece::Image { src, alt: attribute(tag, "alt").unwrap_or_default(), width });
                    }
                }
                "b" | "strong" => style.bold = !closing,
                "i" | "em" => style.italic = !closing,
                "s" | "del" | "strike" => style.strike = !closing,
                "code" | "kbd" | "tt" => style.code = !closing,
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    let level = name[1..].parse().unwrap_or(1);
                    match closing {
                        false => heading = Some((level, String::new())),
                        true => {
                            if let Some((level, text)) = heading.take() {
                                pieces.push(HtmlPiece::Heading(level, text.trim().to_string()));
                            }
                        }
                    }
                }
                _ => {}
            }
            rest = &rest[end + 1..];
            continue;
        }
        let skip = rest.chars().next().map_or(1, char::len_utf8);
        let end = rest[skip..].find('<').map_or(rest.len(), |end| end + skip);
        let text = decode_entities(&rest[..end]);
        if !text.is_empty() {
            match &mut heading {
                Some((_, collected)) => collected.push_str(&text),
                None => pieces.push(HtmlPiece::Text(text)),
            }
        }
        rest = &rest[end..];
    }
    if let Some((level, text)) = heading {
        let text = text.trim().to_string();
        if !text.is_empty() {
            pieces.push(HtmlPiece::Heading(level, text));
        }
    }
    pieces
}

/// A heading's anchor as GitHub writes it: lower case, punctuation dropped, spaces as dashes.
pub fn slug(text: &str) -> String {
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

/// The extension the editor's syntax table knows for a code fence's language.
pub fn extension_for_language(language: &str) -> &str {
    match language {
        "rust" => "rs",
        "typescript" | "ts" => "ts",
        "typescriptreact" | "tsx" => "tsx",
        "javascript" | "js" => "js",
        "javascriptreact" | "jsx" => "jsx",
        "python" | "py" => "py",
        "go" => "go",
        "json" | "jsonc" => "json",
        "css" | "scss" => "css",
        "html" => "html",
        "bash" | "sh" | "shell" | "zsh" => "sh",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "markdown" | "md" => "md",
        "c" => "c",
        "cpp" | "c++" => "cpp",
        "ruby" => "rb",
        "kotlin" => "kt",
        "csharp" | "c#" => "cs",
        "elixir" => "ex",
        "perl" => "pl",
        "haskell" => "hs",
        "clojure" => "clj",
        "terraform" => "tf",
        "solidity" => "sol",
        "protobuf" => "proto",
        "makefile" | "make" => "mk",
        "docker" => "dockerfile",
        "dotenv" => "env",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(blocks: &[Block]) -> Vec<&BlockKind> {
        blocks.iter().map(|block| &block.kind).collect()
    }

    fn text(block: &Block) -> &str {
        match &block.kind {
            BlockKind::Heading { text, .. } | BlockKind::Paragraph(text) => &text.text,
            _ => "",
        }
    }

    fn styled(inline: &Inline) -> Vec<(&str, SpanStyle)> {
        inline.spans.iter().map(|(range, style)| (&inline.text[range.clone()], style.clone())).collect()
    }

    #[test]
    fn headings_paragraphs_and_inline_styles() {
        let blocks = parse("# Title\n\nSome **bold**, *it*, `code`, ~~gone~~ and [a link](https://x.dev).\n");
        assert_eq!(blocks[0].kind, BlockKind::Heading { level: 1, text: Inline::plain("Title") });
        let BlockKind::Paragraph(inline) = &blocks[1].kind else { panic!("{blocks:?}") };
        assert_eq!(inline.text, "Some bold, it, code, gone and a link.");
        assert_eq!(
            styled(inline),
            [
                ("bold", SpanStyle { bold: true, ..Default::default() }),
                ("it", SpanStyle { italic: true, ..Default::default() }),
                ("code", SpanStyle { code: true, ..Default::default() }),
                ("gone", SpanStyle { strike: true, ..Default::default() }),
                ("a link", SpanStyle { link: Some("https://x.dev".into()), ..Default::default() }),
            ]
        );
    }

    #[test]
    fn a_block_remembers_the_source_it_was_written_as() {
        let source = "# Title\n\nA paragraph.\n\n- one\n- two\n";
        let blocks = parse(source);
        assert_eq!(&source[blocks[0].source.clone()], "# Title\n");
        assert_eq!(&source[blocks[1].source.clone()], "A paragraph.\n");
        assert_eq!(&source[blocks[2].source.clone()], "- one\n- two\n");
    }

    #[test]
    fn a_task_box_remembers_where_its_marker_is() {
        let source = "- [ ] todo\n- [x] done\n";
        let blocks = parse(source);
        let BlockKind::List { items, .. } = &blocks[0].kind else { panic!("{blocks:?}") };
        assert_eq!(items[0].checked, Some(false));
        assert_eq!(&source[items[0].check_source.clone().unwrap()], "[ ]");
        assert_eq!(items[1].checked, Some(true));
        assert_eq!(&source[items[1].check_source.clone().unwrap()], "[x]");
    }

    #[test]
    fn lists_nest_and_keep_their_numbering() {
        let blocks = parse("- one\n  - inner\n- two\n\n3. three\n4. four\n");
        let BlockKind::List { start: None, items } = &blocks[0].kind else { panic!("{blocks:?}") };
        assert_eq!(items.len(), 2);
        assert_eq!(text(&items[0].blocks[0]), "one");
        assert!(matches!(&items[0].blocks[1].kind, BlockKind::List { items, .. } if text(&items[0].blocks[0]) == "inner"));
        assert!(matches!(&blocks[1].kind, BlockKind::List { start: Some(3), items } if items.len() == 2));
    }

    #[test]
    fn code_blocks_quotes_alerts_and_rules() {
        let blocks = parse("```rust\nfn main() {}\n```\n\n> quoted\n\n> [!WARNING]\n> Careful\n\n---\n");
        assert_eq!(blocks[0].kind, BlockKind::Code { language: Some("rust".into()), code: "fn main() {}".into() });
        assert!(matches!(&blocks[1].kind, BlockKind::Quote { callout: None, blocks } if text(&blocks[0]) == "quoted"));
        assert!(matches!(&blocks[2].kind, BlockKind::Quote { callout: Some(Callout::Warning), blocks } if text(&blocks[0]) == "Careful"));
        assert_eq!(blocks[3].kind, BlockKind::Rule);
    }

    #[test]
    fn tables_keep_their_alignment_and_rows() {
        let blocks = parse("| Name | Size |\n|:-----|-----:|\n| a | 1 |\n| b | 22 |\n");
        let BlockKind::Table { alignments, header, rows } = &blocks[0].kind else { panic!("{blocks:?}") };
        assert_eq!(alignments, &vec![Align::Left, Align::Right]);
        assert_eq!(header.iter().map(|cell| cell.text.as_str()).collect::<Vec<_>>(), vec!["Name", "Size"]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1][1].text, "22");
    }

    #[test]
    fn html_blocks_and_inline_html() {
        let blocks = parse(
            "<p align=\"center\">\n  <img src=\"https://example.com/logo.png\" alt=\"Logo\" width=\"120\">\n</p>\n\n<h2>Install &amp; run</h2>\n\nPress <kbd>Ctrl</kbd> then<br>go <b>now</b>.\n",
        );
        assert_eq!(blocks[0].kind, BlockKind::Image { src: "https://example.com/logo.png".into(), alt: "Logo".into(), width: Some(120.) });
        assert_eq!(blocks[1].kind, BlockKind::Heading { level: 2, text: Inline::plain("Install & run") });
        let BlockKind::Paragraph(inline) = &blocks[2].kind else { panic!("{:?}", blocks[2]) };
        assert_eq!(inline.text, "Press Ctrl then\ngo now.");
        assert!(inline.spans.iter().any(|(range, style)| style.code && &inline.text[range.clone()] == "Ctrl"));
        assert!(inline.spans.iter().any(|(range, style)| style.bold && &inline.text[range.clone()] == "now"));
        assert_eq!(blocks.len(), 3);
    }

    #[test]
    fn html_with_non_ascii_text_after_tags() {
        let mut style = SpanStyle::default();
        let _ = strip_html("<summary>📸 Screenshots</summary>", &mut style);
        let _ = strip_html("<p align=\"center\">Özet</p>", &mut style);
        let _ = strip_html("<img title=\"İİ\" src=\"ğx.png\">", &mut style);
        assert_eq!(decode_entities("&lt;a&gt; &#169; &#x41; &bogus;"), "<a> © A &bogus;");
    }

    #[test]
    fn images_alone_or_inline() {
        let blocks = parse("![Logo](assets/logo.png)\n\nSee ![icon](i.png) here.\n");
        assert_eq!(blocks[0].kind, BlockKind::Image { src: "assets/logo.png".into(), alt: "Logo".into(), width: None });
        assert_eq!(text(&blocks[1]), "See [icon] here.");
    }

    #[test]
    fn bare_addresses_link_and_the_rest_is_left_alone() {
        let blocks = parse("Read https://athas.dev, then #5 and @someone.");
        let BlockKind::Paragraph(inline) = &blocks[0].kind else { panic!("{blocks:?}") };
        let links: Vec<_> = inline.links().into_iter().map(|(range, url)| (inline.text[range].to_string(), url)).collect();
        assert_eq!(links, [("https://athas.dev".to_string(), "https://athas.dev".to_string())]);
    }

    #[test]
    fn a_heading_slug_reads_as_github_writes_it() {
        assert_eq!(slug("Getting Started!"), "getting-started");
        assert_eq!(kinds(&parse("")).len(), 0);
    }
}
