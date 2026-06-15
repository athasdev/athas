; Literals

(integer) @number
(float) @number
(complex) @number

(string) @string
(string (string_content (escape_sequence) @string.escape))

; Comments

(comment) @comment

; Operators

[
  "?" ":=" "=" "<-" "<<-" "->" "->>"
  "~" "|>" "||" "|" "&&" "&"
  "<" "<=" ">" ">=" "==" "!="
  "+" "-" "*" "/" "::" ":::"
  "**" "^" "$" "@" ":" "!"
  "special"
] @operator

; Punctuation

[
  "(" ")"
  "{" "}"
  "[" "]"
  "[[" "]]"
] @punctuation.bracket

(comma) @punctuation.delimiter

; Variables

(identifier) @variable

; Functions

(binary_operator
  lhs: (identifier) @function
  operator: "<-"
  rhs: (function_definition))

(binary_operator
  lhs: (identifier) @function
  operator: "="
  rhs: (function_definition))

; Calls

(call function: (identifier) @function)

(
  (call function: (identifier) @keyword)
  (#eq? @keyword "return")
)

; Parameters

(parameters (parameter name: (identifier) @variable.parameter))
(arguments (argument name: (identifier) @variable.parameter))

; Namespace

(namespace_operator lhs: (identifier) @namespace)

(call
  function: (namespace_operator rhs: (identifier) @function))

; Keywords

(function_definition name: "function" @keyword.function)
(function_definition name: "\\" @operator)

[
  "in"
  (next)
  (break)
] @keyword

[
  "if"
  "else"
] @conditional

[
  "while"
  "repeat"
  "for"
] @repeat

[
  (true)
  (false)
] @boolean

[
  (null)
  (inf)
  (nan)
  (na)
  (dots)
  (dot_dot_i)
] @constant.builtin

(ERROR) @error
