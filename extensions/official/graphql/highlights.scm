(comment) @comment

[
  "query"
  "mutation"
  "subscription"
  "fragment"
  "on"
  "type"
  "interface"
  "union"
  "enum"
  "input"
  "scalar"
  "schema"
  "directive"
  "extend"
  "implements"
  "repeatable"
] @keyword

(operation_definition
  name: (name) @function)

(fragment_definition
  name: (name) @function)

(fragment_spread
  name: (name) @function)

(object_type_definition
  name: (name) @type)

(interface_type_definition
  name: (name) @type)

(union_type_definition
  name: (name) @type)

(enum_type_definition
  name: (name) @type)

(input_object_type_definition
  name: (name) @type)

(scalar_type_definition
  name: (name) @type)

(named_type
  (name) @type)

(field
  name: (name) @property)

(field_definition
  name: (name) @property)

(input_value_definition
  name: (name) @property)

(alias
  (name) @property)

(argument
  name: (name) @variable.parameter)

(directive
  "@" @punctuation.special
  name: (name) @attribute)

(enum_value) @constant

(variable
  "$" @punctuation.special
  name: (name) @variable)

(string_value) @string
(int_value) @number
(float_value) @number
(boolean_value) @constant.builtin
(null_value) @constant.builtin

[
  "="
  "|"
  "&"
  "!"
  ":"
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
] @punctuation.delimiter
