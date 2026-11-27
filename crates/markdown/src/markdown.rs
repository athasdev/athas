//! The markdown Athas shows: one parser and one renderer, shared by the file preview, notebook
//! cells, GitHub bodies and the popovers language servers fill, so a heading, a task list or a
//! code fence reads the same wherever it is drawn.
//!
//! `parse` turns a document into blocks that remember the source they were written as; `Renderer`
//! draws them at the size the surface asks for, with whatever it alone can do (highlighting,
//! images, links, editing) passed in as `Handlers`.

pub mod field;
mod parse;
mod render;
pub mod rich;

pub use parse::{
    Align, Block, BlockKind, Callout, Inline, ListItem, ParseOptions, SpanStyle, decode_entities, extension_for_language, parse, parse_with, slug,
};
pub use field::{FieldEvent, MarkdownField};
pub use render::{
    Find, Handlers, MarkdownStyle, PAGE_WIDTH, PREVIEW_FLOW, PREVIEW_LEADING, Renderer, block_matches, block_texts, find_ranges, highlight_runs, is_web,
    span_font,
};
