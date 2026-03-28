(comment) @comment

(number) @number

[
  (null)
  (true)
  (false)
] @constant.builtin

(escape_sequence) @escape

(string) @string

(pair
  key: (_) @string.special.key)

["," ":"] @punctuation.delimiter

["{" "}" "[" "]"] @punctuation.bracket
