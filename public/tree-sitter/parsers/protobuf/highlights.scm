(comment) @comment

[
  "syntax"
  "package"
  "import"
  "public"
  "weak"
  "option"
  "message"
  "enum"
  "service"
  "rpc"
  "returns"
  "stream"
  "extend"
  "oneof"
  "map"
  "reserved"
  "to"
  "extensions"
  "optional"
  "required"
  "repeated"
] @keyword

(syntax) @keyword

(package
  (full_ident) @namespace)

(import
  (string) @string)

(option_name) @property

(message_name) @type
(enum_name) @type
(service_name) @type
(rpc_name) @function

(message_body
  (field
    (identifier) @property))

(enum_body
  (enum_field
    (identifier) @constant))

(type) @type.builtin

(string) @string
(int_lit) @number
(float_lit) @number

(bool) @constant.builtin

[
  "="
] @operator

[
  "{"
  "}"
  "["
  "]"
  "("
  ")"
  "<"
  ">"
] @punctuation.bracket

[
  ";"
  ","
  "."
] @punctuation.delimiter
