//! Markdown in agent messages, parsed into blocks the transcript draws: headings, paragraphs,
//! lists, code blocks, quotes, rules and tables, with inline emphasis, code and links.
//!
//! Athas renders these with `features/ai/components/messages/markdown-renderer.tsx`.

use std::ops::Range;

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

#[derive(Clone, Debug, PartialEq)]
pub enum Block {
    Heading { level: u8, text: Inline },
    Paragraph(Inline),
    Code { language: Option<String>, code: String },
    List { start: Option<u64>, items: Vec<ListItem> },
    Quote(Vec<Block>),
    Rule,
    Table { header: Vec<Inline>, rows: Vec<Vec<Inline>> },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ListItem {
    /// A task list item's box.
    pub checked: Option<bool>,
    pub blocks: Vec<Block>,
}

/// A run of text with styled ranges.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inline {
    pub text: String,
    pub spans: Vec<Span>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Span {
    pub range: Range<usize>,
    pub style: SpanStyle,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SpanStyle {
    pub bold: bool,
    pub italic: bool,
    pub strikethrough: bool,
    pub code: bool,
    pub link: Option<String>,
}

impl Inline {
    pub fn plain(text: impl Into<String>) -> Self {
        Self { text: text.into(), spans: Vec::new() }
    }

    pub fn is_empty(&self) -> bool {
        self.text.trim().is_empty()
    }

    /// Rewrites a bare link's text from `start` on to what `chat_link::text` shows for it.
    fn relabel_link(&mut self, start: usize, href: &str, style: &SpanStyle) {
        let Some(label) = self.text.get(start..) else { return };
        let shown = crate::chat_link::text(href, label);
        if shown == label {
            return;
        }
        self.text.truncate(start);
        self.spans.retain(|span| span.range.start < start);
        self.push(&shown, style);
    }

    fn push(&mut self, text: &str, style: &SpanStyle) {
        let start = self.text.len();
        self.text.push_str(text);
        if *style != SpanStyle::default() {
            self.spans.push(Span { range: start..self.text.len(), style: style.clone() });
        }
    }

    /// Text whose bare web addresses become links, read as `chat_link::text` shows them (the
    /// original's "Plain URL" rule in `markdown-renderer.tsx`).
    fn push_with_urls(&mut self, text: &str, style: &SpanStyle) {
        let mut copied = 0;
        for range in crate::chat_link::web_urls(text) {
            if copied < range.start {
                self.push(&text[copied..range.start], style);
            }
            let href = &text[range.clone()];
            let link = SpanStyle { link: Some(href.to_string()), ..style.clone() };
            self.push(&crate::chat_link::text(href, href), &link);
            copied = range.end;
        }
        if copied < text.len() || copied == 0 {
            self.push(&text[copied..], style);
        }
    }

    /// The ranges that are links, with their targets.
    pub fn links(&self) -> Vec<(Range<usize>, String)> {
        self.spans.iter().filter_map(|span| Some((span.range.clone(), span.style.link.clone()?))).collect()
    }

    /// The text with `mark` put before every link `wants`, as a span of that link, so an icon can
    /// be drawn there and clicking it follows the link; returns where each mark starts, with its
    /// link.
    pub fn with_link_marks(&self, mark: &str, wants: impl Fn(&str) -> bool) -> (Inline, Vec<(Range<usize>, String)>) {
        let mut starts = Vec::new();
        let mut previous: Option<&Span> = None;
        for span in &self.spans {
            if let Some(link) = span.style.link.as_deref()
                && wants(link)
                && !previous.is_some_and(|previous| previous.range.end == span.range.start && previous.style.link.as_deref() == Some(link))
            {
                starts.push((span.range.start, link.to_string()));
            }
            previous = Some(span);
        }
        if starts.is_empty() {
            return (self.clone(), Vec::new());
        }
        // A span starting where a mark goes begins after it; one ending there ends before it.
        let shift = |offset: usize, end: bool| offset + mark.len() * starts.iter().filter(|(start, _)| if end { *start < offset } else { *start <= offset }).count();
        let mut text = String::with_capacity(self.text.len() + mark.len() * starts.len());
        let mut marks = Vec::new();
        let mut spans = Vec::new();
        let mut copied = 0;
        for (start, link) in &starts {
            text.push_str(&self.text[copied..*start]);
            let at = text.len();
            text.push_str(mark);
            copied = *start;
            marks.push((at..at + mark.len(), link.clone()));
        }
        text.push_str(&self.text[copied..]);
        let mut pending = marks.iter().peekable();
        for span in &self.spans {
            let start = shift(span.range.start, false);
            while let Some((range, link)) = pending.next_if(|(range, _)| range.end <= start) {
                spans.push(Span { range: range.clone(), style: SpanStyle { link: Some(link.clone()), ..SpanStyle::default() } });
            }
            spans.push(Span { range: start..shift(span.range.end, true), style: span.style.clone() });
        }
        spans.extend(pending.map(|(range, link)| Span { range: range.clone(), style: SpanStyle { link: Some(link.clone()), ..SpanStyle::default() } }));
        (Inline { text, spans }, marks)
    }
}

/// A block being built: where nested blocks go.
enum Frame {
    Root(Vec<Block>),
    Quote(Vec<Block>),
    List { start: Option<u64>, items: Vec<ListItem> },
    Item(ListItem),
}

impl Frame {
    fn blocks(&mut self) -> Option<&mut Vec<Block>> {
        match self {
            Frame::Root(blocks) | Frame::Quote(blocks) => Some(blocks),
            Frame::Item(item) => Some(&mut item.blocks),
            Frame::List { .. } => None,
        }
    }
}

pub fn parse(markdown: &str) -> Vec<Block> {
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let mut stack = vec![Frame::Root(Vec::new())];
    // Inline text being gathered for a heading, paragraph or table cell.
    let mut inline: Option<Inline> = None;
    let mut style = SpanStyle::default();
    // Where the open link's text starts in `inline`.
    let mut link_start: Option<usize> = None;
    let mut code: Option<(Option<String>, String)> = None;
    let mut table: Option<(Vec<Inline>, Vec<Vec<Inline>>, bool)> = None;
    let mut row: Vec<Inline> = Vec::new();

    fn push_block(stack: &mut [Frame], block: Block) {
        for frame in stack.iter_mut().rev() {
            if let Some(blocks) = frame.blocks() {
                blocks.push(block);
                return;
            }
        }
    }

    // A list item's loose text (no paragraph around it) becomes a paragraph of its own.
    fn flush_inline(stack: &mut [Frame], inline: &mut Option<Inline>) {
        if let Some(text) = inline.take()
            && !text.is_empty()
        {
            push_block(stack, Block::Paragraph(text));
        }
    }

    for event in Parser::new_ext(markdown, options) {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph | Tag::Heading { .. } => {
                    flush_inline(&mut stack, &mut inline);
                    inline = Some(Inline::default());
                }
                Tag::CodeBlock(kind) => {
                    flush_inline(&mut stack, &mut inline);
                    let language = match kind {
                        CodeBlockKind::Fenced(info) => info.split_whitespace().next().map(str::to_string).filter(|lang| !lang.is_empty()),
                        CodeBlockKind::Indented => None,
                    };
                    code = Some((language, String::new()));
                }
                Tag::BlockQuote(_) => {
                    flush_inline(&mut stack, &mut inline);
                    stack.push(Frame::Quote(Vec::new()));
                }
                Tag::List(start) => {
                    flush_inline(&mut stack, &mut inline);
                    stack.push(Frame::List { start, items: Vec::new() });
                }
                Tag::Item => stack.push(Frame::Item(ListItem::default())),
                Tag::Table(_) => table = Some((Vec::new(), Vec::new(), true)),
                Tag::TableHead | Tag::TableRow => row = Vec::new(),
                Tag::TableCell => inline = Some(Inline::default()),
                Tag::Emphasis => style.italic = true,
                Tag::Strong => style.bold = true,
                Tag::Strikethrough => style.strikethrough = true,
                Tag::Link { dest_url, .. } => {
                    style.link = Some(dest_url.to_string());
                    link_start = Some(inline.as_ref().map_or(0, |inline| inline.text.len()));
                }
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph => flush_inline(&mut stack, &mut inline),
                TagEnd::Heading(level) => {
                    if let Some(text) = inline.take() {
                        push_block(&mut stack, Block::Heading { level: heading_level(level), text });
                    }
                }
                TagEnd::CodeBlock => {
                    if let Some((language, mut text)) = code.take() {
                        if text.ends_with('\n') {
                            text.pop();
                        }
                        push_block(&mut stack, Block::Code { language, code: text });
                    }
                }
                TagEnd::BlockQuote(_) => {
                    flush_inline(&mut stack, &mut inline);
                    if let Some(Frame::Quote(blocks)) = stack.pop() {
                        push_block(&mut stack, Block::Quote(blocks));
                    }
                }
                TagEnd::Item => {
                    flush_inline(&mut stack, &mut inline);
                    if let Some(Frame::Item(item)) = stack.pop()
                        && let Some(Frame::List { items, .. }) = stack.last_mut()
                    {
                        items.push(item);
                    }
                }
                TagEnd::List(_) => {
                    if let Some(Frame::List { start, items }) = stack.pop() {
                        push_block(&mut stack, Block::List { start, items });
                    }
                }
                TagEnd::TableCell => row.push(inline.take().unwrap_or_default()),
                TagEnd::TableHead => {
                    if let Some((header, _, in_head)) = &mut table {
                        *header = std::mem::take(&mut row);
                        *in_head = false;
                    }
                }
                TagEnd::TableRow => {
                    if let Some((_, rows, _)) = &mut table {
                        rows.push(std::mem::take(&mut row));
                    }
                }
                TagEnd::Table => {
                    if let Some((header, rows, _)) = table.take() {
                        push_block(&mut stack, Block::Table { header, rows });
                    }
                }
                TagEnd::Emphasis => style.italic = false,
                TagEnd::Strong => style.bold = false,
                TagEnd::Strikethrough => style.strikethrough = false,
                TagEnd::Link => {
                    if let (Some(start), Some(href), Some(current)) = (link_start.take(), style.link.clone(), inline.as_mut()) {
                        current.relabel_link(start, &href, &style);
                    }
                    style.link = None;
                }
                _ => {}
            },
            Event::Text(text) => {
                if let Some((_, code)) = &mut code {
                    code.push_str(&text);
                } else if style.link.is_some() {
                    inline.get_or_insert_with(Inline::default).push(&text, &style);
                } else {
                    inline.get_or_insert_with(Inline::default).push_with_urls(&text, &style);
                }
            }
            Event::Code(text) => {
                let code_style = SpanStyle { code: true, ..style.clone() };
                inline.get_or_insert_with(Inline::default).push(&text, &code_style);
            }
            Event::SoftBreak => inline.get_or_insert_with(Inline::default).push(" ", &SpanStyle::default()),
            Event::HardBreak => inline.get_or_insert_with(Inline::default).push("\n", &SpanStyle::default()),
            Event::Rule => push_block(&mut stack, Block::Rule),
            Event::TaskListMarker(checked) => {
                if let Some(Frame::Item(item)) = stack.last_mut() {
                    item.checked = Some(checked);
                }
            }
            Event::Html(html) | Event::InlineHtml(html) => inline.get_or_insert_with(Inline::default).push(&html, &style),
            _ => {}
        }
    }
    flush_inline(&mut stack, &mut inline);
    // An unterminated code fence while the agent is still streaming.
    if let Some((language, code)) = code.take() {
        push_block(&mut stack, Block::Code { language, code });
    }
    while stack.len() > 1 {
        match stack.pop() {
            Some(Frame::Quote(blocks)) => push_block(&mut stack, Block::Quote(blocks)),
            Some(Frame::Item(item)) => {
                if let Some(Frame::List { items, .. }) = stack.last_mut() {
                    items.push(item);
                }
            }
            Some(Frame::List { start, items }) => push_block(&mut stack, Block::List { start, items }),
            _ => {}
        }
    }
    match stack.pop() {
        Some(Frame::Root(blocks)) => blocks,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_web_addresses_become_links() {
        let blocks = parse("Landed in https://github.com/athasdev/athas/pull/412.");
        let Block::Paragraph(inline) = &blocks[0] else { panic!("a paragraph") };
        assert_eq!(inline.text, "Landed in athasdev/athas#412.");
        assert_eq!(inline.links(), vec![(10..28, "https://github.com/athasdev/athas/pull/412".to_string())]);
    }

    #[test]
    fn link_marks_go_before_the_links_asked_for() {
        let link = |href: &str| SpanStyle { link: Some(href.to_string()), ..SpanStyle::default() };
        let bold_link = SpanStyle { bold: true, ..link("gh") };
        let inline = Inline {
            text: "see ab and cd".to_string(),
            spans: vec![
                Span { range: 4..5, style: link("gh") },
                Span { range: 5..6, style: bold_link.clone() },
                Span { range: 11..13, style: link("web") },
            ],
        };
        let (marked, marks) = inline.with_link_marks("##", |href| href == "gh");
        assert_eq!(marked.text, "see ##ab and cd");
        assert_eq!(marks, vec![(4..6, "gh".to_string())]);
        assert_eq!(
            marked.spans,
            vec![
                Span { range: 4..6, style: link("gh") },
                Span { range: 6..7, style: link("gh") },
                Span { range: 7..8, style: bold_link },
                Span { range: 13..15, style: link("web") },
            ]
        );
        assert_eq!(inline.with_link_marks("##", |_| false).0, inline);
    }

    fn paragraph(text: &str) -> Block {
        Block::Paragraph(Inline::plain(text))
    }

    #[test]
    fn parses_headings_paragraphs_and_code() {
        let blocks = parse("# Plan\n\nFirst line\nsame paragraph.\n\n```rust\nfn main() {}\n```\n\n---\n");
        assert_eq!(
            blocks,
            vec![
                Block::Heading { level: 1, text: Inline::plain("Plan") },
                paragraph("First line same paragraph."),
                Block::Code { language: Some("rust".into()), code: "fn main() {}".into() },
                Block::Rule,
            ]
        );
    }

    #[test]
    fn styles_inline_code_emphasis_and_links() {
        let blocks = parse("Run `cargo test` **now**, see [docs](https://athas.dev).");
        let Block::Paragraph(inline) = &blocks[0] else { panic!("{blocks:?}") };
        assert_eq!(inline.text, "Run cargo test now, see docs.");
        let code = &inline.spans[0];
        assert_eq!(&inline.text[code.range.clone()], "cargo test");
        assert!(code.style.code);
        assert!(inline.spans[1].style.bold);
        assert_eq!(inline.links(), vec![(24..28, "https://athas.dev".to_string())]);
    }

    #[test]
    fn nests_lists_and_quotes() {
        let blocks = parse("1. one\n2. two\n   - inner\n- [x] done\n\n> quoted\n");
        let Block::List { start: Some(1), items } = &blocks[0] else { panic!("{blocks:?}") };
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].blocks, vec![paragraph("one")]);
        let Block::List { start: None, items: inner } = &items[1].blocks[1] else { panic!("{:?}", items[1]) };
        assert_eq!(inner[0].blocks, vec![paragraph("inner")]);
        let Block::List { items: tasks, .. } = &blocks[1] else { panic!("{blocks:?}") };
        assert_eq!(tasks[0].checked, Some(true));
        assert_eq!(blocks[2], Block::Quote(vec![paragraph("quoted")]));
    }

    #[test]
    fn parses_tables() {
        let blocks = parse("| a | b |\n|---|---|\n| 1 | `2` |\n");
        let Block::Table { header, rows } = &blocks[0] else { panic!("{blocks:?}") };
        assert_eq!(header.iter().map(|cell| cell.text.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(rows[0][1].text, "2");
        assert!(rows[0][1].spans[0].style.code);
    }

    #[test]
    fn an_open_code_fence_still_shows_while_streaming() {
        let blocks = parse("Here:\n```sh\nls -la\n");
        assert_eq!(blocks[1], Block::Code { language: Some("sh".into()), code: "ls -la".into() });
    }
}
