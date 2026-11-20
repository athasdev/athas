//! The markdown language servers send for hovers, completion docs and signatures, parsed into
//! the few blocks a popover draws: paragraphs, headings, list items, code blocks and rules.

use std::ops::Range;

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

#[derive(Clone, Debug, PartialEq)]
pub enum Block {
    Paragraph(Inline),
    Heading(Inline),
    /// A list item's text, with its bullet or number.
    Item { marker: String, text: Inline },
    Code { language: Option<String>, code: String },
    Rule,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inline {
    pub text: String,
    pub spans: Vec<(Range<usize>, Style)>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Style {
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub link: bool,
}

impl Inline {
    pub fn plain(text: impl Into<String>) -> Self {
        Self { text: text.into(), spans: Vec::new() }
    }

    fn push(&mut self, text: &str, style: Style) {
        let start = self.text.len();
        self.text.push_str(text);
        if style != Style::default() && !text.is_empty() {
            self.spans.push((start..self.text.len(), style));
        }
    }
}

pub fn parse(markdown: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut inline: Option<Inline> = None;
    let mut style = Style::default();
    let mut code: Option<(Option<String>, String)> = None;
    let mut heading = false;
    // Each open list's next number (`None` for bullets).
    let mut lists: Vec<Option<u64>> = Vec::new();
    let mut item_marker: Option<String> = None;

    let flush = |blocks: &mut Vec<Block>, inline: &mut Option<Inline>, heading: bool, item_marker: &mut Option<String>| {
        let Some(text) = inline.take() else { return };
        if text.text.trim().is_empty() {
            return;
        }
        let block = match item_marker.take() {
            Some(marker) => Block::Item { marker, text },
            None if heading => Block::Heading(text),
            None => Block::Paragraph(text),
        };
        blocks.push(block);
    };

    for event in Parser::new_ext(markdown, Options::ENABLE_STRIKETHROUGH) {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph => {
                    if item_marker.is_none() {
                        flush(&mut blocks, &mut inline, heading, &mut item_marker);
                    }
                }
                Tag::Heading { .. } => {
                    flush(&mut blocks, &mut inline, heading, &mut item_marker);
                    heading = true;
                }
                Tag::CodeBlock(kind) => {
                    flush(&mut blocks, &mut inline, heading, &mut item_marker);
                    let language = match kind {
                        CodeBlockKind::Fenced(info) => info.split([' ', ',']).next().map(str::to_string).filter(|language| !language.is_empty()),
                        CodeBlockKind::Indented => None,
                    };
                    code = Some((language, String::new()));
                }
                Tag::List(start) => {
                    flush(&mut blocks, &mut inline, heading, &mut item_marker);
                    lists.push(start);
                }
                Tag::Item => {
                    flush(&mut blocks, &mut inline, heading, &mut item_marker);
                    let depth = lists.len().saturating_sub(1);
                    let marker = match lists.last_mut() {
                        Some(Some(number)) => {
                            let marker = format!("{number}.");
                            *number += 1;
                            marker
                        }
                        _ => "•".to_string(),
                    };
                    item_marker = Some(format!("{}{marker}", "  ".repeat(depth)));
                }
                Tag::Emphasis => style.italic = true,
                Tag::Strong => style.bold = true,
                Tag::Link { .. } => style.link = true,
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph => {
                    if item_marker.is_none() {
                        flush(&mut blocks, &mut inline, heading, &mut item_marker);
                    }
                }
                TagEnd::Heading(_) => {
                    flush(&mut blocks, &mut inline, heading, &mut item_marker);
                    heading = false;
                }
                TagEnd::CodeBlock => {
                    if let Some((language, mut text)) = code.take() {
                        while text.ends_with('\n') {
                            text.pop();
                        }
                        blocks.push(Block::Code { language, code: text });
                    }
                }
                TagEnd::Item => flush(&mut blocks, &mut inline, heading, &mut item_marker),
                TagEnd::List(_) => {
                    lists.pop();
                }
                TagEnd::Emphasis => style.italic = false,
                TagEnd::Strong => style.bold = false,
                TagEnd::Link => style.link = false,
                _ => {}
            },
            Event::Text(text) => match &mut code {
                Some((_, code)) => code.push_str(&text),
                None => inline.get_or_insert_with(Inline::default).push(&text, style),
            },
            Event::Code(text) => inline.get_or_insert_with(Inline::default).push(&text, Style { code: true, ..style }),
            Event::SoftBreak => inline.get_or_insert_with(Inline::default).push(" ", Style::default()),
            Event::HardBreak => inline.get_or_insert_with(Inline::default).push("\n", Style::default()),
            Event::Rule => {
                flush(&mut blocks, &mut inline, heading, &mut item_marker);
                blocks.push(Block::Rule);
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                // Servers send `<br>` and the odd tag; keep the text, drop the markup.
                if !html.trim_start().starts_with('<') {
                    inline.get_or_insert_with(Inline::default).push(&html, style);
                }
            }
            _ => {}
        }
    }
    flush(&mut blocks, &mut inline, heading, &mut item_marker);
    if let Some((language, code)) = code {
        blocks.push(Block::Code { language, code });
    }
    blocks
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

    #[test]
    fn parses_hover_markdown() {
        let blocks = parse("```rust\nfn main()\n```\n\n---\n\nRuns **the** `app`.\n\n- one\n- two\n\n# Examples");
        assert_eq!(blocks[0], Block::Code { language: Some("rust".into()), code: "fn main()".into() });
        assert_eq!(blocks[1], Block::Rule);
        let Block::Paragraph(text) = &blocks[2] else { panic!("{blocks:?}") };
        assert_eq!(text.text, "Runs the app.");
        assert_eq!(text.spans, vec![(5..8, Style { bold: true, ..Style::default() }), (9..12, Style { code: true, ..Style::default() })]);
        assert_eq!(blocks[3], Block::Item { marker: "•".into(), text: Inline::plain("one") });
        assert_eq!(blocks[5], Block::Heading(Inline::plain("Examples")));
    }

    #[test]
    fn numbered_lists_and_open_fences() {
        let blocks = parse("3. a\n4. b\n\n```\nx");
        assert_eq!(blocks[0], Block::Item { marker: "3.".into(), text: Inline::plain("a") });
        assert_eq!(blocks[1], Block::Item { marker: "4.".into(), text: Inline::plain("b") });
        assert_eq!(blocks[2], Block::Code { language: None, code: "x".into() });
    }
}
