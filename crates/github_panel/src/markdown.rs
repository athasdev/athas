//! GitHub bodies drawn by the app's shared markdown renderer: issues, pull requests, comments and
//! release notes, read with GitHub's `#123` and `@user` autolinks and drawn at the size a panel
//! reads at.

use gpui::{AnyElement, App};
use markdown::{MarkdownStyle, ParseOptions, Renderer};

pub use markdown::Block;

/// Parses `source`; `repo_url` links `#123` references to the repository.
pub fn parse(source: &str, repo_url: Option<&str>) -> Vec<Block> {
    markdown::parse_with(source, &ParseOptions::github(repo_url))
}

/// Draws parsed Markdown. `id` keeps the element ids of different documents apart.
pub fn render(blocks: &[Block], id: &str, cx: &App) -> AnyElement {
    Renderer::new(id, MarkdownStyle::comment()).document(blocks, cx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use markdown::BlockKind;

    fn text(block: &Block) -> &str {
        match &block.kind {
            BlockKind::Heading { text, .. } | BlockKind::Paragraph(text) => &text.text,
            _ => "",
        }
    }

    #[test]
    fn issue_references_and_mentions_link_to_github() {
        let blocks = parse("Fixes #42, thanks @octocat.", Some("https://github.com/athasdev/athas"));
        let BlockKind::Paragraph(inline) = &blocks[0].kind else { panic!("{blocks:?}") };
        let links: Vec<_> = inline.links().into_iter().map(|(range, url)| (inline.text[range].to_string(), url)).collect();
        assert_eq!(
            links,
            [
                ("#42".to_string(), "https://github.com/athasdev/athas/issues/42".to_string()),
                ("@octocat".to_string(), "https://github.com/octocat".to_string()),
            ]
        );
    }

    #[test]
    fn a_body_without_a_repository_leaves_hash_references_alone() {
        let blocks = parse("See #42 and https://athas.dev.", None);
        let BlockKind::Paragraph(inline) = &blocks[0].kind else { panic!("{blocks:?}") };
        let links: Vec<_> = inline.links().into_iter().map(|(range, _)| inline.text[range].to_string()).collect();
        assert_eq!(links, ["https://athas.dev".to_string()]);
        assert_eq!(text(&blocks[0]), "See #42 and https://athas.dev.");
    }
}
