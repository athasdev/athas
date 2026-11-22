//! Release notes drawn from their markdown (`release-notes-content.tsx`): headings, paragraphs,
//! lists, code blocks, tables and links, which open in the browser.

use ui::scale::px;
use gpui::{AnyElement, App, FontWeight, Hsla, SharedString, div, prelude::*, relative};
use pulldown_cmark::{Alignment, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use theme::ActiveTheme;
use ui::typography;

#[derive(Clone, Debug, PartialEq)]
pub struct Span {
    pub text: String,
    pub link: Option<String>,
    pub strong: bool,
    pub code: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Block {
    Heading(u8, Vec<Span>),
    Paragraph(Vec<Span>),
    Item(Vec<Span>),
    /// A fenced or indented code block's text.
    Code(String),
    /// A GitHub table: column alignments, the header cells, then the body rows.
    Table { alignments: Vec<CellAlign>, header: Vec<Vec<Span>>, rows: Vec<Vec<Vec<Span>>> },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CellAlign {
    Start,
    Center,
    End,
}

/// The blocks of a markdown text, inline styling kept as spans.
pub fn parse(markdown: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut spans: Vec<Span> = Vec::new();
    let mut link: Option<String> = None;
    let mut strong = 0usize;
    let mut code: Option<String> = None;
    // The table being read: alignments, header, rows, and whether the header is still open.
    let mut table: Option<(Vec<CellAlign>, Vec<Vec<Span>>, Vec<Vec<Vec<Span>>>, bool)> = None;
    let push = |spans: &mut Vec<Span>, text: &str, link: &Option<String>, strong: bool, code: bool| {
        if let Some(last) = spans.last_mut()
            && last.link == *link
            && last.strong == strong
            && last.code == code
        {
            last.text.push_str(text);
            return;
        }
        spans.push(Span { text: text.to_string(), link: link.clone(), strong, code });
    };
    for event in Parser::new_ext(markdown, Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH) {
        if let Some(text) = &mut code {
            match event {
                Event::Text(chunk) => text.push_str(&chunk),
                Event::End(TagEnd::CodeBlock) => {
                    let text = code.take().unwrap_or_default();
                    blocks.push(Block::Code(text.trim_end_matches('\n').to_string()));
                }
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(Tag::Table(alignments)) => {
                if !spans.is_empty() {
                    blocks.push(Block::Paragraph(std::mem::take(&mut spans)));
                }
                let alignments = alignments
                    .iter()
                    .map(|alignment| match alignment {
                        Alignment::Center => CellAlign::Center,
                        Alignment::Right => CellAlign::End,
                        _ => CellAlign::Start,
                    })
                    .collect();
                table = Some((alignments, Vec::new(), Vec::new(), true));
            }
            Event::End(TagEnd::TableHead) => {
                if let Some(table) = &mut table {
                    table.3 = false;
                }
            }
            Event::Start(Tag::TableRow) => {
                if let Some(table) = &mut table {
                    table.2.push(Vec::new());
                }
            }
            Event::End(TagEnd::TableCell) => {
                if let Some((_, header, rows, in_head)) = &mut table {
                    let cell = std::mem::take(&mut spans);
                    match (*in_head, rows.last_mut()) {
                        (true, _) => header.push(cell),
                        (false, Some(row)) => row.push(cell),
                        (false, None) => rows.push(vec![cell]),
                    }
                }
            }
            Event::End(TagEnd::Table) => {
                if let Some((alignments, header, rows, _)) = table.take() {
                    blocks.push(Block::Table { alignments, header, rows });
                }
            }
            Event::Start(Tag::CodeBlock(_)) => {
                if !spans.is_empty() {
                    blocks.push(Block::Paragraph(std::mem::take(&mut spans)));
                }
                code = Some(String::new());
            }
            Event::Start(Tag::Link { dest_url, .. }) => link = Some(dest_url.to_string()),
            Event::End(TagEnd::Link) => link = None,
            Event::Start(Tag::Strong) => strong += 1,
            Event::End(TagEnd::Strong) => strong = strong.saturating_sub(1),
            Event::Text(text) => push(&mut spans, &text, &link, strong > 0, false),
            Event::Code(text) => push(&mut spans, &text, &link, strong > 0, true),
            Event::SoftBreak | Event::HardBreak => push(&mut spans, " ", &link, strong > 0, false),
            Event::End(TagEnd::Heading(level)) => {
                let level = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    _ => 3,
                };
                blocks.push(Block::Heading(level, std::mem::take(&mut spans)));
            }
            Event::End(TagEnd::Paragraph) if !spans.is_empty() => blocks.push(Block::Paragraph(std::mem::take(&mut spans))),
            Event::End(TagEnd::Item) if !spans.is_empty() => blocks.push(Block::Item(std::mem::take(&mut spans))),
            _ => {}
        }
    }
    if !spans.is_empty() {
        blocks.push(Block::Paragraph(spans));
    }
    blocks
}

fn inline(id: SharedString, spans: &[Span], size: gpui::Pixels, weight: FontWeight, text: Hsla, link_color: Hsla) -> AnyElement {
    let mut words = Vec::new();
    for (span_index, span) in spans.iter().enumerate() {
        for (word_index, word) in span.text.split_inclusive(' ').enumerate() {
            let element = div()
                .whitespace_nowrap()
                .when(span.strong, |this| this.font_weight(typography::SEMIBOLD))
                .when(span.code, |this| this.font_family(typography::MONO_FONT))
                .child(word.replace(' ', "\u{a0}"));
            words.push(match &span.link {
                Some(url) => {
                    let url = url.clone();
                    element
                        .id(SharedString::from(format!("{id}-{span_index}-{word_index}")))
                        .text_color(link_color)
                        .hover(|style| style.underline())
                        .on_click(move |_, _, cx| cx.open_url(&url))
                        .into_any_element()
                }
                None => element.into_any_element(),
            });
        }
    }
    div().flex().flex_wrap().text_size(size).font_weight(weight).text_color(text).line_height(gpui::relative(1.6)).children(words).into_any_element()
}

/// A table as `typeset.css` draws one: full width, medium header cells (0.65em 1em), body cells
/// 0.75em 1em under a rule, the first column flush, a rule under the last row.
fn table(id: SharedString, alignments: &[CellAlign], header: &[Vec<Span>], rows: &[Vec<Vec<Span>>], colors: (Hsla, Hsla, Hsla, Hsla)) -> AnyElement {
    let (foreground, muted, link, rule) = colors;
    let em = f32::from(typography::text_sm());
    let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
    let cell = |row: usize, column: usize, spans: Option<&Vec<Span>>, head: bool| {
        let align = alignments.get(column).copied().unwrap_or(CellAlign::Start);
        let (weight, text) = if head { (typography::MEDIUM, foreground) } else { (FontWeight::NORMAL, muted) };
        div()
            .flex()
            .flex_1()
            .flex_basis(px(0.))
            .min_w_0()
            .px(px(em))
            .py(px(em * if head { 0.65 } else { 0.75 }))
            .when(column == 0, |this| this.pl_0())
            .when(!head, |this| this.border_t_1().border_color(rule))
            .when(align == CellAlign::Center, |this| this.justify_center())
            .when(align == CellAlign::End, |this| this.justify_end())
            .children(spans.map(|spans| inline(format!("{id}-{row}-{column}").into(), spans, typography::text_sm(), weight, text, link)))
    };
    let row = |index: usize, cells: &[Vec<Span>], head: bool| div().flex().w_full().children((0..columns).map(|column| cell(index, column, cells.get(column), head)));
    div()
        .flex()
        .flex_col()
        .w_full()
        .border_b_1()
        .border_color(rule)
        .child(row(0, header, true))
        .children(rows.iter().enumerate().map(|(index, cells)| row(index + 1, cells, false)))
        .into_any_element()
}

pub fn render(markdown: &str, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    let (foreground, muted, link, code_background) = (colors.foreground, colors.muted_foreground, colors.primary, colors.field);
    let rule = colors.border;
    // The `typeset-preview` preset: leading 1.68, 0.75 em between blocks.
    div()
        .flex()
        .flex_col()
        .gap(typography::text_sm() * 0.75)
        .line_height(relative(1.68))
        .min_w_0()
        .children(parse(markdown).into_iter().enumerate().map(|(index, block)| {
            let id = SharedString::from(format!("release-notes-{index}"));
            match block {
                Block::Heading(level, spans) => {
                    let size = if level == 1 { typography::text_lg() } else { typography::text_base() };
                    div().pt(px(6.)).child(inline(id, &spans, size, typography::SEMIBOLD, foreground, link)).into_any_element()
                }
                Block::Paragraph(spans) => inline(id, &spans, typography::text_sm(), FontWeight::NORMAL, muted, link),
                Block::Item(spans) => div()
                    .flex()
                    .gap(px(8.))
                    .child(div().flex_none().text_size(typography::text_sm()).text_color(muted).child("•"))
                    .child(div().flex_1().min_w_0().child(inline(id, &spans, typography::text_sm(), FontWeight::NORMAL, muted, link)))
                    .into_any_element(),
                Block::Code(text) => div()
                    .id(id)
                    .overflow_x_scroll()
                    .px(px(12.))
                    .py(px(10.))
                    .rounded(ui::metrics::radius_md())
                    .bg(code_background)
                    .font_family(typography::MONO_FONT)
                    .text_size(px(12.))
                    .line_height(relative(1.5))
                    .text_color(foreground)
                    .child(text)
                    .into_any_element(),
                Block::Table { alignments, header, rows } => table(id, &alignments, &header, &rows, (foreground, muted, link, rule)),
            }
        }))
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_headings_items_and_links() {
        let blocks = parse("## What's Changed\n- [Add tabs](https://x/pull/1) — @ana\n\n**Full changelog:** [Compare](https://x/compare)");
        assert!(matches!(&blocks[0], Block::Heading(2, spans) if spans[0].text == "What's Changed"));
        let Block::Item(item) = &blocks[1] else { panic!("expected an item: {blocks:?}") };
        assert_eq!(item[0], Span { text: "Add tabs".into(), link: Some("https://x/pull/1".into()), strong: false, code: false });
        assert_eq!(item[1].text, " — @ana");
        let Block::Paragraph(paragraph) = &blocks[2] else { panic!("expected a paragraph") };
        assert!(paragraph[0].strong && paragraph.last().unwrap().link.as_deref() == Some("https://x/compare"));
    }

    #[test]
    fn keeps_tables() {
        let blocks = parse("Before\n\n| Name | Count |\n| :-- | --: |\n| **tabs** | 3 |\n| splits | 12 |\n\nAfter");
        assert!(matches!(&blocks[0], Block::Paragraph(_)));
        let Block::Table { alignments, header, rows } = &blocks[1] else { panic!("expected a table: {blocks:?}") };
        assert_eq!(alignments, &vec![CellAlign::Start, CellAlign::End]);
        assert_eq!(header[1][0].text, "Count");
        assert_eq!(rows.len(), 2);
        assert!(rows[0][0][0].strong);
        assert_eq!(rows[1][1][0].text, "12");
        assert!(matches!(&blocks[2], Block::Paragraph(spans) if spans[0].text == "After"));
    }

    #[test]
    fn keeps_code_blocks() {
        let blocks = parse("Run this:\n\n```sh\nathas .\nathas --wait\n```\n\n- done");
        assert_eq!(blocks[1], Block::Code("athas .\nathas --wait".into()));
        assert!(matches!(&blocks[2], Block::Item(_)));
    }
}
