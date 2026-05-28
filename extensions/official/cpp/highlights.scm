; Preprocessor

(preproc_include
  "#include" @keyword)

(system_lib_string) @string

; Functions

(function_declarator
  declarator: (identifier) @function)

(function_declarator
  declarator: (field_identifier) @function)

(function_declarator
  declarator: (qualified_identifier
    name: (identifier) @function))

(call_expression
  function: (identifier) @function.call)

(call_expression
  function: (qualified_identifier
    name: (identifier) @function.call))

(call_expression
  function: (field_expression
    field: (field_identifier) @function.call))

(template_function
  name: (identifier) @function)

(template_method
  name: (field_identifier) @function)

; Types

(primitive_type) @type.builtin
(sized_type_specifier) @type.builtin
(auto) @type.builtin
(type_identifier) @type
(namespace_identifier) @type

; Constants and literals

(this) @variable.builtin

(number_literal) @number

; Strings and comments

(string_literal) @string
(raw_string_literal) @string
(char_literal) @string
(comment) @comment
