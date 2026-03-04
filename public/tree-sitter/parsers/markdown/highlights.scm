;From nvim-treesitter/nvim-treesitter
(atx_heading (inline) @text.title)
(setext_heading (paragraph) @text.title)

[
  (atx_h1_marker)
  (atx_h2_marker)
  (atx_h3_marker)
  (atx_h4_marker)
  (atx_h5_marker)
  (atx_h6_marker)
  (setext_h1_underline)
  (setext_h2_underline)
] @punctuation.special

[
  (link_title)
  (indented_code_block)
  (fenced_code_block)
] @text.literal

[
  (fenced_code_block_delimiter)
] @punctuation.delimiter

(code_fence_content) @none

(info_string) @label

[
  (link_destination)
] @text.uri

[
  (link_label)
] @text.reference

[
  (list_marker_plus)
  (list_marker_minus)
  (list_marker_star)
  (list_marker_dot)
  (list_marker_parenthesis)
  (thematic_break)
  (task_list_marker_unchecked)
  (task_list_marker_checked)
] @punctuation.special

[
  (block_continuation)
  (block_quote_marker)
] @punctuation.special

[
  (backslash_escape)
] @string.escape

; HTML blocks (for JSX components in MDX)
(html_block) @none

; Frontmatter (YAML front matter delimited by ---)
(minus_metadata) @comment
(plus_metadata) @comment

; Tables
(pipe_table_header) @markup.heading
(pipe_table_delimiter_row) @punctuation.delimiter
(pipe_table_delimiter_cell) @punctuation.delimiter
(pipe_table_row) @none
(pipe_table_cell) @none
