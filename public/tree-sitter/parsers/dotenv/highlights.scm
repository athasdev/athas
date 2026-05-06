(variable_assignment
  name: (variable_name) @property)

(variable_assignment
  value: (word) @string)

(variable_assignment
  value: (string) @string)

(variable_assignment
  value: (raw_string) @string)

(variable_assignment
  value: (concatenation) @string)

[
  "="
  "+="
] @operator

"export" @keyword

(comment) @comment

[
  (expansion)
  (simple_expansion)
  (command_substitution)
] @embedded
