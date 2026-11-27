//! What makes the Markdown field behave like Athas's rich editor (`github-markdown-editor.tsx`,
//! `github-markdown-editor-controls.tsx`): the text styled as it is typed, the formatting toolbar
//! over a selection, and the `/` block commands.

use std::ops::Range;

use ui::scale::px;
use gpui::{FontStyle, FontWeight, HighlightStyle, StrikethroughStyle,};
use theme::ThemeColors;
use ui::IconName;

/// A styled piece of Markdown.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Span {
    /// `#`, `>`, `-`, `**`, the brackets of a link: drawn quietly.
    Marker,
    Heading,
    Strong,
    Emphasis,
    Strikethrough,
    Code,
    Quote,
    LinkText,
    LinkUrl,
    ListMarker,
}

fn style(span: Span, colors: &ThemeColors) -> HighlightStyle {
    let mut style = HighlightStyle::default();
    match span {
        Span::Marker => style.color = Some(colors.subtle_foreground),
        Span::Heading => style.font_weight = Some(FontWeight::BOLD),
        Span::Strong => style.font_weight = Some(FontWeight::SEMIBOLD),
        Span::Emphasis => style.font_style = Some(FontStyle::Italic),
        Span::Strikethrough => style.strikethrough = Some(StrikethroughStyle { thickness: px(1.), color: None }),
        Span::Code => {
            style.color = Some(colors.foreground);
            style.background_color = Some(colors.accent);
        }
        Span::Quote => {
            style.color = Some(colors.muted_foreground);
            style.font_style = Some(FontStyle::Italic);
        }
        Span::LinkText => style.color = Some(colors.primary),
        Span::LinkUrl => style.color = Some(colors.subtle_foreground),
        Span::ListMarker => style.color = Some(colors.primary),
    }
    style
}

/// How much larger a heading line is drawn than the body text.
pub fn line_scale(line: &str) -> f32 {
    let hashes = line.trim_start().bytes().take_while(|byte| *byte == b'#').count();
    if !line.trim_start()[hashes..].starts_with(' ') {
        return 1.;
    }
    match hashes {
        1 => 1.7,
        2 => 1.35,
        3 => 1.15,
        _ => 1.,
    }
}

/// The styles of `text` for the field, never overlapping.
pub fn highlights(text: &str, colors: &ThemeColors) -> Vec<(Range<usize>, HighlightStyle)> {
    spans(text).into_iter().map(|(range, span)| (range, style(span, colors))).collect()
}

/// The Markdown spans of `text`, sorted and never overlapping.
pub fn spans(text: &str) -> Vec<(Range<usize>, Span)> {
    let mut out = Vec::new();
    let mut offset = 0;
    let mut in_fence = false;
    for line in text.split('\n') {
        let start = offset;
        offset += line.len() + 1;
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            out.push((start..start + line.len(), Span::Code));
            continue;
        }
        if in_fence {
            if !line.is_empty() {
                out.push((start..start + line.len(), Span::Code));
            }
            continue;
        }
        let hashes = trimmed.bytes().take_while(|byte| *byte == b'#').count();
        if (1..=6).contains(&hashes) && trimmed[hashes..].starts_with(' ') {
            let marker_end = start + indent + hashes + 1;
            out.push((start + indent..marker_end, Span::Marker));
            if marker_end < start + line.len() {
                out.push((marker_end..start + line.len(), Span::Heading));
            }
            continue;
        }
        if matches!(trimmed, "---" | "***" | "___") {
            out.push((start..start + line.len(), Span::Marker));
            continue;
        }
        let mut body = start + indent;
        if let Some(rest) = trimmed.strip_prefix('>') {
            let marker = if rest.starts_with(' ') { 2 } else { 1 };
            out.push((body..body + marker, Span::Marker));
            body += marker;
            if body < start + line.len() {
                out.push((body..start + line.len(), Span::Quote));
            }
            continue;
        }
        let list_marker = ["- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "+ "]
            .iter()
            .find(|marker| trimmed.starts_with(**marker))
            .map(|marker| marker.len())
            .or_else(|| {
                let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
                (digits > 0 && trimmed[digits..].starts_with(". ")).then_some(digits + 2)
            });
        if let Some(length) = list_marker {
            out.push((body..body + length, Span::ListMarker));
            body += length;
        }
        inline_spans(&text[body..start + line.len()], body, &mut out);
    }
    out
}

/// Code, links, strong, emphasis and strikethrough inside one line.
fn inline_spans(line: &str, base: usize, out: &mut Vec<(Range<usize>, Span)>) {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let rest = &line[index..];
        let at = base + index;
        if rest.starts_with('`')
            && let Some(close) = rest[1..].find('`')
        {
            out.push((at..at + close + 2, Span::Code));
            index += close + 2;
            continue;
        }
        if rest.starts_with('[')
            && let Some(close) = rest.find("](")
            && let Some(end) = rest[close + 2..].find(')')
            && !rest[1..close].contains('\n')
        {
            let url_start = close + 2;
            out.push((at..at + 1, Span::Marker));
            if close > 1 {
                out.push((at + 1..at + close, Span::LinkText));
            }
            out.push((at + close..at + url_start, Span::Marker));
            if end > 0 {
                out.push((at + url_start..at + url_start + end, Span::LinkUrl));
            }
            out.push((at + url_start + end..at + url_start + end + 1, Span::Marker));
            index += url_start + end + 1;
            continue;
        }
        let mut matched = false;
        for (marker, span) in [("**", Span::Strong), ("__", Span::Strong), ("~~", Span::Strikethrough), ("*", Span::Emphasis), ("_", Span::Emphasis)] {
            if !rest.starts_with(marker) || rest[marker.len()..].starts_with(' ') {
                continue;
            }
            let inner = &rest[marker.len()..];
            if let Some(close) = inner.find(marker).filter(|close| *close > 0) {
                let length = marker.len();
                out.push((at..at + length, Span::Marker));
                out.push((at + length..at + length + close, span));
                out.push((at + length + close..at + 2 * length + close, Span::Marker));
                index += 2 * length + close;
                matched = true;
                break;
            }
        }
        if !matched {
            index += rest.chars().next().map_or(1, char::len_utf8);
        }
    }
}

/// Bold, italic, strikethrough or code over a selection: wraps it in `marker`, or unwraps it
/// when the markers are already there. Returns the new text and selection.
pub fn toggle_wrap(text: &str, selection: Range<usize>, marker: &str) -> (String, Range<usize>) {
    let (start, end) = (selection.start.min(text.len()), selection.end.min(text.len()));
    let length = marker.len();
    let inner = &text[start..end];
    if inner.len() >= 2 * length && inner.starts_with(marker) && inner.ends_with(marker) {
        let unwrapped = &inner[length..inner.len() - length];
        return (format!("{}{unwrapped}{}", &text[..start], &text[end..]), start..start + unwrapped.len());
    }
    if start >= length && text[..start].ends_with(marker) && text[end..].starts_with(marker) {
        return (format!("{}{inner}{}", &text[..start - length], &text[end + length..]), start - length..end - length);
    }
    (format!("{}{marker}{inner}{marker}{}", &text[..start], &text[end..]), start + length..end + length)
}

/// A link over the selection: `[selection](url)` with `url` selected to type over.
pub fn make_link(text: &str, selection: Range<usize>) -> (String, Range<usize>) {
    let (start, end) = (selection.start.min(text.len()), selection.end.min(text.len()));
    let label = &text[start..end];
    let url_start = start + label.len() + 3;
    (format!("{}[{label}](url){}", &text[..start], &text[end..]), url_start..url_start + 3)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockCommand {
    Paragraph,
    Heading(u8),
    Quote,
    BulletList,
    NumberedList,
    TaskList,
    CodeBlock,
    Divider,
    Table,
}

pub struct CommandDefinition {
    pub command: BlockCommand,
    pub label: &'static str,
    pub group: &'static str,
    pub icon: IconName,
    keywords: &'static [&'static str],
}

/// The `/` commands (`GITHUB_MARKDOWN_COMMANDS`).
pub const COMMANDS: &[CommandDefinition] = &[
    CommandDefinition { command: BlockCommand::Paragraph, label: "text", group: "basic blocks", icon: IconName::Text, keywords: &["paragraph", "plain", "text"] },
    CommandDefinition { command: BlockCommand::Heading(1), label: "heading 1", group: "basic blocks", icon: IconName::Text, keywords: &["h1", "title", "heading"] },
    CommandDefinition { command: BlockCommand::Heading(2), label: "heading 2", group: "basic blocks", icon: IconName::Text, keywords: &["h2", "subtitle", "heading"] },
    CommandDefinition { command: BlockCommand::Heading(3), label: "heading 3", group: "basic blocks", icon: IconName::Text, keywords: &["h3", "subheading", "heading"] },
    CommandDefinition { command: BlockCommand::Quote, label: "quote", group: "basic blocks", icon: IconName::ChatBubbleText, keywords: &["blockquote", "citation", "quote"] },
    CommandDefinition { command: BlockCommand::BulletList, label: "bulleted list", group: "lists", icon: IconName::List, keywords: &["bullet", "unordered", "list"] },
    CommandDefinition { command: BlockCommand::NumberedList, label: "numbered list", group: "lists", icon: IconName::List, keywords: &["number", "numbered", "ordered", "list"] },
    CommandDefinition { command: BlockCommand::TaskList, label: "task list", group: "lists", icon: IconName::ListChecks, keywords: &["todo", "task", "check", "checkbox", "list"] },
    CommandDefinition { command: BlockCommand::CodeBlock, label: "code block", group: "insert", icon: IconName::CodeBlock, keywords: &["code", "fence", "snippet", "pre", "syntax"] },
    CommandDefinition { command: BlockCommand::Divider, label: "divider", group: "insert", icon: IconName::Minus, keywords: &["divider", "separator", "rule", "horizontal"] },
    CommandDefinition { command: BlockCommand::Table, label: "table", group: "insert", icon: IconName::Table, keywords: &["table", "grid", "columns", "rows"] },
];

/// The commands matching what follows the `/` (`filterGitHubMarkdownCommands`).
pub fn filter_commands(query: &str) -> Vec<&'static CommandDefinition> {
    let query = query.trim().trim_start_matches('/').to_lowercase();
    COMMANDS
        .iter()
        .filter(|command| query.is_empty() || std::iter::once(&command.label).chain(command.keywords).any(|candidate| candidate.contains(&query)))
        .collect()
}

/// A `/` typed at the start of a line or after a space, and what follows it up to the cursor:
/// the range to replace and the query.
pub fn slash_query(text: &str, cursor: usize) -> Option<(Range<usize>, String)> {
    let before = text.get(..cursor)?;
    let slash = before.rfind('/')?;
    let query = &before[slash + 1..];
    if query.len() > 40 || query.chars().any(char::is_whitespace) || query.contains('/') {
        return None;
    }
    let preceded = before[..slash].chars().next_back().is_none_or(char::is_whitespace);
    preceded.then(|| (slash..cursor, query.to_string()))
}

fn line_bounds(text: &str, at: usize) -> Range<usize> {
    let start = text[..at].rfind('\n').map_or(0, |index| index + 1);
    let end = text[at..].find('\n').map_or(text.len(), |index| at + index);
    start..end
}

/// The line's text without a heading, quote or list prefix.
fn strip_block_prefix(line: &str) -> &str {
    let trimmed = line.trim_start();
    let hashes = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    if (1..=6).contains(&hashes) && trimmed[hashes..].starts_with(' ') {
        return &trimmed[hashes + 1..];
    }
    for prefix in ["> ", ">", "- [ ] ", "- [x] ", "- ", "* ", "+ "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return rest;
        }
    }
    let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 && trimmed[digits..].starts_with(". ") {
        return &trimmed[digits + 2..];
    }
    trimmed
}

/// Runs a `/` command: the `/query` goes, then the line becomes the block, or the block is
/// inserted on a line of its own. Returns the new text and where the cursor goes.
pub fn apply_command(text: &str, slash: Range<usize>, command: BlockCommand) -> (String, usize) {
    let text = format!("{}{}", &text[..slash.start], &text[slash.end.min(text.len())..]);
    let line = line_bounds(&text, slash.start);
    let content = strip_block_prefix(&text[line.clone()]).to_string();
    let (before, after) = (&text[..line.start], &text[line.end..]);
    let prefix = match command {
        BlockCommand::Paragraph => Some(String::new()),
        BlockCommand::Heading(level) => Some(format!("{} ", "#".repeat(level as usize))),
        BlockCommand::Quote => Some("> ".into()),
        BlockCommand::BulletList => Some("- ".into()),
        BlockCommand::NumberedList => Some("1. ".into()),
        BlockCommand::TaskList => Some("- [ ] ".into()),
        _ => None,
    };
    if let Some(prefix) = prefix {
        let cursor = line.start + prefix.len() + content.len();
        return (format!("{before}{prefix}{content}{after}"), cursor);
    }
    let lead = if content.trim().is_empty() { String::new() } else { format!("{content}\n") };
    let (block, cursor_in_block) = match command {
        BlockCommand::CodeBlock => ("```text\n\n```".to_string(), 8),
        BlockCommand::Divider => ("---\n".to_string(), 4),
        _ => {
            let table = "|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |".to_string();
            (table, 2)
        }
    };
    let cursor = line.start + lead.len() + cursor_in_block;
    (format!("{before}{lead}{block}{after}"), cursor)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(text: &str) -> Vec<(&str, Span)> {
        spans(text).into_iter().map(|(range, span)| (&text[range], span)).collect()
    }

    #[test]
    fn styles_markdown() {
        assert_eq!(kinds("## Title"), vec![("## ", Span::Marker), ("Title", Span::Heading)]);
        assert_eq!(kinds("> said"), vec![("> ", Span::Marker), ("said", Span::Quote)]);
        assert_eq!(
            kinds("- a **b** _c_ `d` ~~e~~"),
            vec![
                ("- ", Span::ListMarker),
                ("**", Span::Marker),
                ("b", Span::Strong),
                ("**", Span::Marker),
                ("_", Span::Marker),
                ("c", Span::Emphasis),
                ("_", Span::Marker),
                ("`d`", Span::Code),
                ("~~", Span::Marker),
                ("e", Span::Strikethrough),
                ("~~", Span::Marker),
            ]
        );
        assert_eq!(kinds("[x](u)"), vec![("[", Span::Marker), ("x", Span::LinkText), ("](", Span::Marker), ("u", Span::LinkUrl), (")", Span::Marker)]);
        assert_eq!(kinds("```\nlet a\n```").len(), 3);
        assert!(kinds("2 * 3 * 4").is_empty() || kinds("2 * 3 * 4").iter().all(|(_, span)| *span != Span::Emphasis));
        let all = spans("# a\n- [ ] b **c**\n1. d");
        assert!(all.windows(2).all(|pair| pair[0].0.end <= pair[1].0.start));
    }

    #[test]
    fn wraps_and_unwraps() {
        assert_eq!(toggle_wrap("a b c", 2..3, "**"), ("a **b** c".to_string(), 4..5));
        assert_eq!(toggle_wrap("a **b** c", 4..5, "**"), ("a b c".to_string(), 2..3));
        assert_eq!(toggle_wrap("a **b** c", 2..7, "**"), ("a b c".to_string(), 2..3));
        assert_eq!(make_link("see docs", 4..8), ("see [docs](url)".to_string(), 11..14));
    }

    #[test]
    fn slash_commands() {
        assert_eq!(slash_query("/he", 3), Some((0..3, "he".into())));
        assert_eq!(slash_query("a /", 3), Some((2..3, String::new())));
        assert_eq!(slash_query("a/b", 3), None);
        assert_eq!(slash_query("/a b", 4), None);
        assert_eq!(filter_commands("head").len(), 3);
        assert_eq!(filter_commands("/list").len(), 3);
        assert_eq!(filter_commands("").len(), COMMANDS.len());
        assert_eq!(apply_command("Title /h1", 6..9, BlockCommand::Heading(1)), ("# Title ".to_string(), 8));
        assert_eq!(apply_command("- item\n/quote", 7..13, BlockCommand::Quote), ("- item\n> ".to_string(), 9));
        assert_eq!(apply_command("## x /text", 5..10, BlockCommand::Paragraph), ("x ".to_string(), 2));
        assert_eq!(apply_command("/code", 0..5, BlockCommand::CodeBlock), ("```text\n\n```".to_string(), 8));
        let (table, _) = apply_command("/table", 0..6, BlockCommand::Table);
        assert_eq!(table.lines().count(), 4);
    }
}
