(comment) @comment

(tag_name) @tag

(attribute_name) @attribute
(quoted_attribute_value) @string

(element
  (start_tag
    (tag_name) @tag))

(element
  (self_closing_tag
    (tag_name) @tag))

(script_element
  (start_tag
    (tag_name) @tag))

(style_element
  (start_tag
    (tag_name) @tag))

(expression) @variable

(text) @string

[
  "{"
  "}"
] @punctuation.bracket

[
  "<"
  ">"
  "</"
  "/>"
] @punctuation.bracket

"=" @operator

(if_statement
  ["#if" "/if" ":else" ":else if"] @keyword)

(each_statement
  ["#each" "/each" ":else"] @keyword)

(await_statement
  ["#await" "/await" ":then" ":catch"] @keyword)

(key_statement
  ["#key" "/key"] @keyword)

(snippet_statement
  ["#snippet" "/snippet"] @keyword)
