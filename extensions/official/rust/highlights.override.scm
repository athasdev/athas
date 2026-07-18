; Highlight Rust doc comments on parser versions that do not expose `doc_comment`.
((line_comment) @comment.documentation
 (#match? @comment.documentation "^///|^//!"))
((block_comment) @comment.documentation
 (#match? @comment.documentation "^/\\*\\*|^/\\*!"))
