(comment) @comment

[
  "FROM"
  "AS"
  "RUN"
  "CMD"
  "LABEL"
  "EXPOSE"
  "ENV"
  "ADD"
  "COPY"
  "ENTRYPOINT"
  "VOLUME"
  "USER"
  "WORKDIR"
  "ARG"
  "ONBUILD"
  "STOPSIGNAL"
  "HEALTHCHECK"
  "SHELL"
  "MAINTAINER"
  "CROSS_BUILD"
] @keyword

(image_spec
  (image_name) @string)

(image_spec
  (image_tag
    "/" @operator
    (image_name) @string))

(image_spec
  (image_tag) @string.special)

(image_spec
  (image_digest) @string.special)

(image_alias) @variable

(double_quoted_string) @string
(single_quoted_string) @string
(unquoted_string) @string

(expansion
  "$" @punctuation.special)
(expansion
  (variable) @variable)

(expose_port) @number

(label_pair
  key: (unquoted_string) @property)

(env_pair
  name: (unquoted_string) @variable)

(arg_instruction
  name: (unquoted_string) @variable)

(param
  "--" @operator)
(param
  (mount_param_param) @property)

(shell_command) @string

[
  "="
  ":"
] @operator

[
  "["
  "]"
] @punctuation.bracket
