; PHP highlight query compatible with php_only grammar

; Comments
(comment) @comment

; Strings
[
  (string)
  (string_content)
  (encapsed_string)
  (heredoc)
  (heredoc_body)
  (nowdoc_body)
] @string

; Numbers
(integer) @number
(float) @number

; Boolean and null
(boolean) @constant.builtin
(null) @constant.builtin

; Variables
(variable_name) @variable

((name) @variable.builtin
 (#eq? @variable.builtin "this"))

; Function definitions and calls
(function_definition
  name: (name) @function)

(method_declaration
  name: (name) @function.method)

(function_call_expression
  function: [
    (qualified_name (name))
    (relative_name (name))
    (name)
  ] @function)

(scoped_call_expression
  name: (name) @function)

(member_call_expression
  name: (name) @function.method)

(array_creation_expression "array" @function.builtin)
(list_literal "list" @function.builtin)

; Class, interface, trait declarations
(class_declaration
  name: (name) @type)

(interface_declaration
  name: (name) @type)

(trait_declaration
  name: (name) @type)

; Types
(primitive_type) @type.builtin
(cast_type) @type.builtin
(named_type [
  (name) @type
  (qualified_name (name) @type)
  (relative_name (name) @type)
])

(scoped_call_expression
  scope: [
    (name) @type
    (qualified_name (name) @type)
    (relative_name (name) @type)
  ])

; Object creation
(object_creation_expression [
  (name) @constructor
  (qualified_name (name) @constructor)
  (relative_name (name) @constructor)
])

(method_declaration name: (name) @constructor
  (#eq? @constructor "__construct"))

; Properties
(property_element
  (variable_name) @property)

(member_access_expression
  name: (variable_name (name)) @property)
(member_access_expression
  name: (name) @property)

; Namespace
(namespace_definition
  name: (namespace_name) @module)

(namespace_name (name) @module)

; Constants (UPPER_CASE names)
((name) @constant
 (#match? @constant "^_?[A-Z][A-Z0-9_]+$"))

(const_declaration (const_element (name) @constant))

; Operators
"$" @operator
