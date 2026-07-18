(comment) @comment

(identifier) @variable

(string_lit) @string
(heredoc_template
  (heredoc_start) @string
  (template_literal) @string
  (heredoc_identifier) @string)

(numeric_lit) @number

(bool_lit) @constant.builtin

(null_lit) @constant.builtin

(template_interpolation
  "${" @punctuation.special
  "}" @punctuation.special)

(template_directive
  "%{" @punctuation.special
  "}" @punctuation.special)

(block
  (identifier) @keyword)

(block
  (identifier) @keyword
  (string_lit) @type)

(attribute
  (identifier) @property)

(function_call
  (identifier) @function)

(expression
  (variable_expr
    (identifier) @variable))

(for_expr
  "for" @keyword
  "in" @keyword
  "endfor" @keyword)

(conditional
  "if" @keyword
  "else" @keyword
  "endif" @keyword)

[
  "="
  "=="
  "!="
  "<"
  ">"
  "<="
  ">="
  "+"
  "-"
  "*"
  "/"
  "%"
  "&&"
  "||"
  "!"
  "?"
  ":"
  "=>"
  "..."
] @operator

[
  "{"
  "}"
  "["
  "]"
  "("
  ")"
] @punctuation.bracket

[
  ","
  "."
] @punctuation.delimiter
