//! Token highlighting for languages without a tree-sitter grammar (`languages/*.ts`,
//! `stream-tokens.ts` and the legacy CodeMirror modes): comments, strings, numbers, keywords,
//! built-in constants and types, calls, annotations and sigil variables, read line by line.

use std::ops::Range;

use ropey::Rope;

use crate::syntax::SyntaxKind;

/// How far before the asked range lexing starts, so a block comment or string opened above is
/// still known.
const LOOKBEHIND_LINES: usize = 400;

pub(crate) struct StreamSyntax {
    line_comments: &'static [&'static str],
    block_comment: Option<(&'static str, &'static str)>,
    quotes: &'static [char],
    keywords: &'static [&'static str],
    types: &'static [&'static str],
    constants: &'static [&'static str],
    /// Capitalised words are types; all-caps words are constants.
    capitalized_types: bool,
    /// Characters that start a variable (`$name`, `@name`).
    sigils: &'static [char],
    /// The character an annotation or decorator starts with.
    annotation: Option<char>,
    /// Keywords match whatever their case (SQL).
    case_insensitive: bool,
    /// `key = value` files: the key before `=` or `:` is a property, `[section]` a heading.
    key_value: bool,
    /// Characters besides letters, digits and `_` that words may hold (`defined?`, `let*`).
    word_chars: &'static str,
    /// Lines starting with one of these prefixes take that kind whole (`diff`, reStructuredText).
    line_styles: &'static [(&'static str, SyntaxKind)],
    /// The character a command word starts with, shown as a keyword (`\section`).
    command_prefix: Option<char>,
}

const BASE: StreamSyntax = StreamSyntax {
    line_comments: &["//"],
    block_comment: Some(("/*", "*/")),
    quotes: &['"', '\''],
    keywords: &[],
    types: &[],
    constants: &["true", "false", "null"],
    capitalized_types: true,
    sigils: &[],
    annotation: None,
    case_insensitive: false,
    key_value: false,
    word_chars: "",
    line_styles: &[],
    command_prefix: None,
};

const C_TYPES: &[&str] = &[
    "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "bool", "size_t", "ssize_t", "int8_t", "int16_t", "int32_t", "int64_t",
    "uint8_t", "uint16_t", "uint32_t", "uint64_t", "wchar_t", "auto",
];
const C_KEYWORDS: &[&str] = &[
    "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return", "goto", "struct", "union", "enum", "typedef", "const", "static",
    "extern", "volatile", "register", "inline", "sizeof", "restrict", "#include", "#define", "#ifdef", "#ifndef", "#endif", "#if", "#else", "#elif", "#pragma",
    "#undef",
];
const CPP_KEYWORDS: &[&str] = &[
    "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return", "goto", "struct", "union", "enum", "typedef", "const", "static",
    "extern", "volatile", "inline", "sizeof", "class", "namespace", "using", "template", "typename", "public", "private", "protected", "virtual", "override",
    "final", "friend", "operator", "new", "delete", "this", "throw", "try", "catch", "noexcept", "constexpr", "consteval", "explicit", "mutable", "static_cast",
    "dynamic_cast", "reinterpret_cast", "const_cast", "co_await", "co_return", "co_yield", "concept", "requires", "decltype", "#include", "#define", "#ifdef",
    "#ifndef", "#endif", "#if", "#else", "#elif", "#pragma",
];
const JAVA_KEYWORDS: &[&str] = &[
    "abstract", "assert", "break", "case", "catch", "class", "continue", "default", "do", "else", "enum", "extends", "final", "finally", "for", "if", "implements",
    "import", "instanceof", "interface", "native", "new", "package", "private", "protected", "public", "record", "return", "sealed", "permits", "static",
    "strictfp", "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try", "var", "volatile", "while", "yield",
];
const JAVA_TYPES: &[&str] = &["boolean", "byte", "char", "short", "int", "long", "float", "double", "void"];
const KOTLIN_KEYWORDS: &[&str] = &[
    "as", "break", "class", "continue", "do", "else", "for", "fun", "if", "in", "interface", "is", "object", "package", "return", "super", "this", "throw", "try",
    "typealias", "typeof", "val", "var", "when", "while", "by", "catch", "constructor", "delegate", "dynamic", "field", "file", "finally", "get", "import", "init",
    "set", "where", "abstract", "annotation", "companion", "const", "crossinline", "data", "enum", "expect", "actual", "external", "final", "infix", "inline",
    "inner", "internal", "lateinit", "noinline", "open", "operator", "out", "override", "private", "protected", "public", "reified", "sealed", "suspend",
    "tailrec", "vararg", "value",
];
const SWIFT_KEYWORDS: &[&str] = &[
    "associatedtype", "class", "deinit", "enum", "extension", "fileprivate", "func", "import", "init", "inout", "internal", "let", "open", "operator", "private",
    "protocol", "public", "rethrows", "static", "struct", "subscript", "typealias", "var", "break", "case", "continue", "default", "defer", "do", "else",
    "fallthrough", "for", "guard", "if", "in", "repeat", "return", "switch", "where", "while", "as", "catch", "is", "self", "Self", "super", "throw", "throws",
    "try", "async", "await", "actor", "some", "any", "mutating", "nonmutating", "override", "final", "lazy", "weak", "unowned", "convenience", "required",
    "dynamic", "indirect", "optional", "get", "set", "willSet", "didSet",
];
const CSHARP_KEYWORDS: &[&str] = &[
    "abstract", "as", "base", "break", "case", "catch", "checked", "class", "const", "continue", "default", "delegate", "do", "else", "enum", "event",
    "explicit", "extern", "finally", "fixed", "for", "foreach", "goto", "if", "implicit", "in", "interface", "internal", "is", "lock", "namespace", "new",
    "operator", "out", "override", "params", "private", "protected", "public", "readonly", "record", "ref", "return", "sealed", "sizeof", "stackalloc",
    "static", "struct", "switch", "this", "throw", "try", "typeof", "unchecked", "unsafe", "using", "virtual", "volatile", "while", "async", "await", "var",
    "get", "set", "init", "yield", "where", "partial", "when",
];
const CSHARP_TYPES: &[&str] = &[
    "bool", "byte", "sbyte", "char", "decimal", "double", "float", "int", "uint", "long", "ulong", "short", "ushort", "object", "string", "void", "dynamic", "nint",
    "nuint",
];
const SCALA_KEYWORDS: &[&str] = &[
    "abstract", "case", "catch", "class", "def", "do", "else", "extends", "final", "finally", "for", "forSome", "if", "implicit", "import", "lazy", "match", "new",
    "object", "override", "package", "private", "protected", "return", "sealed", "super", "this", "throw", "trait", "try", "type", "val", "var", "while", "with",
    "yield", "given", "using", "enum", "then", "end", "extension", "export",
];
const DART_KEYWORDS: &[&str] = &[
    "abstract", "as", "assert", "async", "await", "base", "break", "case", "catch", "class", "const", "continue", "covariant", "default", "deferred", "do",
    "dynamic", "else", "enum", "export", "extends", "extension", "external", "factory", "final", "finally", "for", "get", "hide", "if", "implements", "import",
    "in", "interface", "is", "late", "library", "mixin", "new", "on", "operator", "part", "required", "rethrow", "return", "sealed", "set", "show", "static",
    "super", "switch", "sync", "this", "throw", "try", "typedef", "var", "when", "while", "with", "yield",
];
const DART_TYPES: &[&str] = &["void", "int", "double", "num", "bool", "dynamic"];
const PHP_KEYWORDS: &[&str] = &[
    "abstract", "and", "array", "as", "break", "callable", "case", "catch", "class", "clone", "const", "continue", "declare", "default", "do", "echo", "else",
    "elseif", "empty", "enddeclare", "endfor", "endforeach", "endif", "endswitch", "endwhile", "enum", "extends", "final", "finally", "fn", "for", "foreach",
    "function", "global", "goto", "if", "implements", "include", "include_once", "instanceof", "insteadof", "interface", "isset", "list", "match", "namespace",
    "new", "or", "print", "private", "protected", "public", "readonly", "require", "require_once", "return", "static", "switch", "throw", "trait", "try", "unset",
    "use", "var", "while", "xor", "yield", "<?php", "?>",
];
const ZIG_KEYWORDS: &[&str] = &[
    "addrspace", "align", "allowzero", "and", "anyframe", "anytype", "asm", "async", "await", "break", "callconv", "catch", "comptime", "const", "continue",
    "defer", "else", "enum", "errdefer", "error", "export", "extern", "fn", "for", "if", "inline", "linksection", "noalias", "noinline", "nosuspend", "opaque",
    "or", "orelse", "packed", "pub", "resume", "return", "struct", "suspend", "switch", "test", "threadlocal", "try", "union", "unreachable", "usingnamespace",
    "var", "volatile", "while",
];
const ZIG_TYPES: &[&str] = &[
    "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64", "i128", "u128", "isize", "usize", "f16", "f32", "f64", "f80", "f128", "bool", "void", "noreturn", "type",
    "anyerror", "anyopaque", "comptime_int", "comptime_float",
];
const SOLIDITY_KEYWORDS: &[&str] = &[
    "pragma", "solidity", "import", "contract", "interface", "library", "abstract", "is", "function", "modifier", "event", "emit", "struct", "enum", "mapping",
    "public", "private", "internal", "external", "pure", "view", "payable", "constant", "immutable", "virtual", "override", "returns", "return", "if", "else",
    "for", "while", "do", "break", "continue", "new", "delete", "memory", "storage", "calldata", "using", "error", "revert", "require", "assert", "constructor",
    "fallback", "receive", "unchecked", "try", "catch", "assembly", "type",
];
const SOLIDITY_TYPES: &[&str] = &[
    "address", "bool", "string", "bytes", "byte", "int", "uint", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128",
    "int256", "uint256", "bytes1", "bytes4", "bytes8", "bytes16", "bytes32", "fixed", "ufixed",
];
const PROTO_KEYWORDS: &[&str] = &[
    "syntax", "edition", "package", "import", "option", "message", "enum", "service", "rpc", "returns", "stream", "repeated", "optional", "required", "oneof",
    "map", "reserved", "extensions", "extend", "to", "max", "public", "weak",
];
const PROTO_TYPES: &[&str] = &[
    "double", "float", "int32", "int64", "uint32", "uint64", "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64", "bool", "string", "bytes",
];
const GROOVY_KEYWORDS: &[&str] = &[
    "abstract", "as", "assert", "break", "case", "catch", "class", "const", "continue", "def", "default", "do", "else", "enum", "extends", "final", "finally",
    "for", "goto", "if", "implements", "import", "in", "instanceof", "interface", "new", "package", "private", "protected", "public", "return", "static",
    "super", "switch", "this", "throw", "throws", "trait", "try", "var", "while",
];
const RUBY_KEYWORDS: &[&str] = &[
    "alias", "and", "begin", "break", "case", "class", "def", "defined?", "do", "else", "elsif", "end", "ensure", "for", "if", "in", "module", "next", "not", "or",
    "redo", "rescue", "retry", "return", "self", "super", "then", "undef", "unless", "until", "when", "while", "yield", "require", "require_relative", "include",
    "extend", "attr_accessor", "attr_reader", "attr_writer", "private", "protected", "public", "lambda", "proc", "raise",
];
const PERL_KEYWORDS: &[&str] = &[
    "my", "our", "local", "sub", "if", "elsif", "else", "unless", "while", "until", "for", "foreach", "last", "next", "redo", "return", "use", "no", "require",
    "package", "do", "eval", "and", "or", "not", "print", "die", "warn",
];
const R_KEYWORDS: &[&str] = &["if", "else", "repeat", "while", "function", "for", "in", "next", "break", "return", "library", "require", "source"];
const ELIXIR_KEYWORDS: &[&str] = &[
    "def", "defp", "defmodule", "defmacro", "defmacrop", "defstruct", "defprotocol", "defimpl", "defguard", "defdelegate", "defexception", "do", "end", "fn",
    "if", "else", "unless", "case", "cond", "with", "for", "try", "catch", "rescue", "after", "raise", "receive", "when", "and", "or", "not", "in", "import",
    "alias", "require", "use", "quote", "unquote",
];
const NIX_KEYWORDS: &[&str] = &["let", "in", "with", "rec", "inherit", "if", "then", "else", "assert", "or", "import", "builtins"];
const HCL_KEYWORDS: &[&str] = &[
    "resource", "data", "variable", "output", "locals", "module", "provider", "terraform", "for", "in", "if", "for_each", "count", "depends_on", "lifecycle",
    "dynamic", "content",
];
const HCL_TYPES: &[&str] = &["string", "number", "bool", "list", "map", "set", "object", "tuple", "any"];
const LUA_KEYWORDS: &[&str] =
    &["and", "break", "do", "else", "elseif", "end", "for", "function", "goto", "if", "in", "local", "not", "or", "repeat", "return", "then", "until", "while"];
const SQL_KEYWORDS: &[&str] = &[
    "select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set", "delete", "create", "table", "drop", "alter", "add", "column",
    "index", "view", "join", "inner", "left", "right", "outer", "full", "cross", "on", "as", "group", "by", "order", "having", "limit", "offset", "union", "all",
    "distinct", "case", "when", "then", "else", "end", "in", "is", "like", "between", "exists", "primary", "key", "foreign", "references", "default", "unique",
    "constraint", "with", "returning", "asc", "desc", "begin", "commit", "rollback", "transaction", "if", "cascade", "database", "schema", "trigger", "function",
    "procedure", "return", "returns", "declare",
];
const SQL_TYPES: &[&str] = &[
    "int", "integer", "bigint", "smallint", "serial", "bigserial", "text", "varchar", "char", "boolean", "bool", "date", "time", "timestamp", "timestamptz",
    "numeric", "decimal", "real", "float", "double", "json", "jsonb", "uuid", "blob", "bytea",
];
const HASKELL_KEYWORDS: &[&str] = &[
    "case", "class", "data", "default", "deriving", "do", "else", "foreign", "if", "import", "in", "infix", "infixl", "infixr", "instance", "let", "module",
    "newtype", "of", "then", "type", "where", "qualified", "as", "hiding", "exposing", "port",
];
const LISP_KEYWORDS: &[&str] = &[
    "defn", "defn-", "def", "defmacro", "defun", "defvar", "defparameter", "defconst", "defcustom", "define", "lambda", "fn", "let", "let*", "letrec", "if",
    "when", "unless", "cond", "case", "do", "loop", "recur", "ns", "require", "import", "quote", "setq", "progn", "and", "or", "not",
];
const MAKE_KEYWORDS: &[&str] = &[
    "ifeq", "ifneq", "ifdef", "ifndef", "else", "endif", "include", "-include", "define", "endef", "export", "unexport", "override", "vpath", ".PHONY",
];
const DOCKER_KEYWORDS: &[&str] = &[
    "FROM", "AS", "RUN", "CMD", "LABEL", "MAINTAINER", "EXPOSE", "ENV", "ADD", "COPY", "ENTRYPOINT", "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD", "STOPSIGNAL",
    "HEALTHCHECK", "SHELL",
];
const CMAKE_KEYWORDS: &[&str] = &[
    "if", "elseif", "else", "endif", "foreach", "endforeach", "while", "endwhile", "function", "endfunction", "macro", "endmacro", "set", "unset", "option",
    "project", "cmake_minimum_required", "add_executable", "add_library", "target_link_libraries", "target_include_directories", "include", "find_package",
    "add_subdirectory", "message", "install", "list", "return",
];

const OCAML_KEYWORDS: &[&str] = &[
    "and", "as", "assert", "begin", "class", "constraint", "do", "done", "downto", "else", "end", "exception", "external", "for", "fun", "function", "functor",
    "if", "in", "include", "inherit", "initializer", "lazy", "let", "match", "method", "module", "mutable", "new", "nonrec", "object", "of", "open", "private",
    "rec", "sig", "struct", "then", "to", "try", "type", "val", "virtual", "when", "while", "with", "land", "lor", "lxor", "lsl", "lsr", "asr", "mod",
];
const ML_TYPES: &[&str] = &["int", "float", "bool", "char", "string", "unit", "list", "array", "option", "ref", "exn", "bytes", "seq"];
const FSHARP_KEYWORDS: &[&str] = &[
    "abstract", "and", "as", "assert", "base", "begin", "class", "default", "delegate", "do", "done", "downcast", "downto", "elif", "else", "end", "exception",
    "extern", "for", "fun", "function", "global", "if", "in", "inherit", "inline", "interface", "internal", "lazy", "let", "match", "member", "module", "mutable",
    "namespace", "new", "of", "open", "override", "private", "public", "rec", "return", "static", "struct", "then", "to", "try", "type", "upcast", "use", "val",
    "when", "while", "with", "yield", "async", "task", "seq",
];
const ERLANG_KEYWORDS: &[&str] = &[
    "after", "and", "andalso", "band", "begin", "bnot", "bor", "bsl", "bsr", "bxor", "case", "catch", "cond", "div", "end", "fun", "if", "let", "maybe", "not",
    "of", "or", "orelse", "receive", "rem", "try", "when", "xor", "module", "export", "import", "record", "define", "include", "spec", "type", "behaviour",
];
const JULIA_KEYWORDS: &[&str] = &[
    "baremodule", "begin", "break", "catch", "const", "continue", "do", "else", "elseif", "end", "export", "finally", "for", "function", "global", "if", "import",
    "let", "local", "macro", "module", "quote", "return", "struct", "try", "using", "while", "where", "mutable", "abstract", "primitive", "type", "in", "isa",
];
const POWERSHELL_KEYWORDS: &[&str] = &[
    "begin", "break", "catch", "class", "continue", "data", "define", "do", "dynamicparam", "else", "elseif", "end", "enum", "exit", "filter", "finally", "for",
    "foreach", "from", "function", "if", "in", "param", "process", "return", "switch", "throw", "trap", "try", "until", "using", "var", "while", "workflow",
];
const BATCH_KEYWORDS: &[&str] = &[
    "echo", "set", "if", "else", "for", "in", "do", "goto", "call", "exit", "not", "exist", "defined", "errorlevel", "setlocal", "endlocal", "shift", "pause",
    "start", "cd", "pushd", "popd", "equ", "neq", "lss", "leq", "gtr", "geq", "off", "on",
];
const VERILOG_KEYWORDS: &[&str] = &[
    "module", "endmodule", "input", "output", "inout", "wire", "reg", "logic", "assign", "always", "always_ff", "always_comb", "always_latch", "initial", "begin",
    "end", "if", "else", "case", "casez", "casex", "endcase", "default", "for", "while", "repeat", "forever", "function", "endfunction", "task", "endtask",
    "parameter", "localparam", "generate", "endgenerate", "genvar", "posedge", "negedge", "or", "and", "not", "integer", "real", "time", "signed", "unsigned",
    "typedef", "struct", "enum", "interface", "endinterface", "package", "endpackage", "import", "class", "endclass", "return",
];
const VIM_KEYWORDS: &[&str] = &[
    "let", "unlet", "const", "if", "elseif", "else", "endif", "for", "endfor", "while", "endwhile", "try", "catch", "finally", "endtry", "function", "function!",
    "endfunction", "return", "call", "execute", "echo", "echom", "set", "setlocal", "map", "nmap", "vmap", "imap", "noremap", "nnoremap", "vnoremap",
    "inoremap", "autocmd", "augroup", "command", "command!", "source", "syntax", "highlight", "filetype", "silent", "normal", "abort", "range",
];
const GRAPHQL_KEYWORDS: &[&str] = &[
    "query", "mutation", "subscription", "fragment", "on", "type", "interface", "union", "enum", "input", "scalar", "schema", "extend", "directive", "implements",
    "repeatable",
];
const NGINX_KEYWORDS: &[&str] = &[
    "server", "location", "listen", "server_name", "root", "index", "return", "rewrite", "proxy_pass", "proxy_set_header", "include", "upstream", "http",
    "events", "worker_processes", "worker_connections", "error_page", "access_log", "error_log", "try_files", "ssl_certificate", "ssl_certificate_key", "if",
    "set", "add_header", "gzip", "client_max_body_size", "alias", "allow", "deny", "map", "types", "default_type", "sendfile", "keepalive_timeout",
];
const OBJC_KEYWORDS: &[&str] = &[
    "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return", "goto", "struct", "union", "enum", "typedef", "const",
    "static", "extern", "volatile", "inline", "sizeof", "self", "super", "in", "out", "inout", "bycopy", "byref", "oneway", "nonatomic", "atomic", "strong",
    "weak", "copy", "assign", "retain", "readonly", "readwrite", "nullable", "nonnull", "#import", "#include", "#define", "#ifdef", "#ifndef", "#endif", "#if",
    "#else", "#pragma",
];
const OBJC_TYPES: &[&str] = &["void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "BOOL", "id", "SEL", "IMP", "Class", "instancetype"];
const SCSS_KEYWORDS: &[&str] = &["!important", "!default", "!global", "from", "through", "to", "in", "and", "or", "not"];
const DIFF_LINES: &[(&str, SyntaxKind)] = &[
    ("+++", SyntaxKind::Heading),
    ("---", SyntaxKind::Heading),
    ("diff ", SyntaxKind::Heading),
    ("index ", SyntaxKind::Comment),
    ("@@", SyntaxKind::Keyword),
    ("+", SyntaxKind::String),
    ("-", SyntaxKind::Invalid),
];
const RST_LINES: &[(&str, SyntaxKind)] = &[
    ("..", SyntaxKind::Keyword),
    ("===", SyntaxKind::Heading),
    ("---", SyntaxKind::Heading),
    ("~~~", SyntaxKind::Heading),
    ("***", SyntaxKind::Heading),
    ("^^^", SyntaxKind::Heading),
];

const SYNTAXES: &[(&str, StreamSyntax)] = &[
    ("C", StreamSyntax { keywords: C_KEYWORDS, types: C_TYPES, constants: &["true", "false", "NULL"], ..BASE }),
    ("C++", StreamSyntax { keywords: CPP_KEYWORDS, types: C_TYPES, constants: &["true", "false", "nullptr", "NULL"], ..BASE }),
    ("Java", StreamSyntax { keywords: JAVA_KEYWORDS, types: JAVA_TYPES, annotation: Some('@'), ..BASE }),
    ("Kotlin", StreamSyntax { keywords: KOTLIN_KEYWORDS, quotes: &['"', '\'', '`'], annotation: Some('@'), ..BASE }),
    ("Swift", StreamSyntax { keywords: SWIFT_KEYWORDS, constants: &["true", "false", "nil"], annotation: Some('@'), ..BASE }),
    ("C#", StreamSyntax { keywords: CSHARP_KEYWORDS, types: CSHARP_TYPES, ..BASE }),
    ("Scala", StreamSyntax { keywords: SCALA_KEYWORDS, annotation: Some('@'), ..BASE }),
    ("Dart", StreamSyntax { keywords: DART_KEYWORDS, types: DART_TYPES, annotation: Some('@'), ..BASE }),
    ("PHP", StreamSyntax { line_comments: &["//", "#"], keywords: PHP_KEYWORDS, sigils: &['$'], ..BASE }),
    ("Zig", StreamSyntax { block_comment: None, keywords: ZIG_KEYWORDS, types: ZIG_TYPES, constants: &["true", "false", "null", "undefined"], annotation: Some('@'), ..BASE }),
    ("Solidity", StreamSyntax { keywords: SOLIDITY_KEYWORDS, types: SOLIDITY_TYPES, ..BASE }),
    ("Protocol Buffers", StreamSyntax { keywords: PROTO_KEYWORDS, types: PROTO_TYPES, ..BASE }),
    ("Groovy", StreamSyntax { keywords: GROOVY_KEYWORDS, annotation: Some('@'), ..BASE }),
    ("Ruby", StreamSyntax { line_comments: &["#"], block_comment: Some(("=begin", "=end")), keywords: RUBY_KEYWORDS, constants: &["true", "false", "nil"], sigils: &['@', '$', ':'], word_chars: "?!", ..BASE }),
    ("Perl", StreamSyntax { line_comments: &["#"], block_comment: None, keywords: PERL_KEYWORDS, constants: &["undef"], sigils: &['$', '@', '%'], capitalized_types: false, ..BASE }),
    ("R", StreamSyntax { line_comments: &["#"], block_comment: None, keywords: R_KEYWORDS, constants: &["TRUE", "FALSE", "NULL", "NA", "Inf", "NaN"], capitalized_types: false, ..BASE }),
    ("Elixir", StreamSyntax { line_comments: &["#"], block_comment: None, keywords: ELIXIR_KEYWORDS, constants: &["true", "false", "nil"], sigils: &[':', '@'], word_chars: "?!", ..BASE }),
    ("Nix", StreamSyntax { line_comments: &["#"], keywords: NIX_KEYWORDS, quotes: &['"'], capitalized_types: false, ..BASE }),
    ("Terraform", StreamSyntax { line_comments: &["#", "//"], keywords: HCL_KEYWORDS, types: HCL_TYPES, quotes: &['"'], capitalized_types: false, ..BASE }),
    ("Lua", StreamSyntax { line_comments: &["--"], block_comment: Some(("--[[", "]]")), keywords: LUA_KEYWORDS, constants: &["true", "false", "nil"], capitalized_types: false, ..BASE }),
    ("SQL", StreamSyntax { line_comments: &["--"], keywords: SQL_KEYWORDS, types: SQL_TYPES, case_insensitive: true, capitalized_types: false, ..BASE }),
    ("Haskell", StreamSyntax { line_comments: &["--"], block_comment: Some(("{-", "-}")), keywords: HASKELL_KEYWORDS, constants: &["True", "False", "Nothing"], ..BASE }),
    ("Lisp", StreamSyntax { line_comments: &[";"], block_comment: None, quotes: &['"'], keywords: LISP_KEYWORDS, constants: &["nil", "t", "true", "false"], sigils: &[':'], capitalized_types: false, word_chars: "-*!?<>", ..BASE }),
    ("Makefile", StreamSyntax { line_comments: &["#"], block_comment: None, keywords: MAKE_KEYWORDS, constants: &[], sigils: &['$'], capitalized_types: false, ..BASE }),
    ("Dockerfile", StreamSyntax { line_comments: &["#"], block_comment: None, keywords: DOCKER_KEYWORDS, constants: &[], sigils: &['$'], capitalized_types: false, ..BASE }),
    ("CMake", StreamSyntax { line_comments: &["#"], block_comment: None, quotes: &['"'], keywords: CMAKE_KEYWORDS, constants: &["ON", "OFF", "TRUE", "FALSE"], sigils: &['$'], capitalized_types: false, case_insensitive: true, ..BASE }),
    ("INI", StreamSyntax { line_comments: &["#", ";"], block_comment: None, constants: &["true", "false", "yes", "no", "on", "off"], capitalized_types: false, key_value: true, ..BASE }),
    ("Dotenv", StreamSyntax { line_comments: &["#"], block_comment: None, constants: &["true", "false"], sigils: &['$'], capitalized_types: false, key_value: true, ..BASE }),
    ("OCaml", StreamSyntax { line_comments: &[], block_comment: Some(("(*", "*)")), quotes: &['"'], keywords: OCAML_KEYWORDS, types: ML_TYPES, ..BASE }),
    ("F#", StreamSyntax { block_comment: Some(("(*", "*)")), quotes: &['"'], keywords: FSHARP_KEYWORDS, types: ML_TYPES, ..BASE }),
    ("Erlang", StreamSyntax { line_comments: &["%"], block_comment: None, quotes: &['"'], keywords: ERLANG_KEYWORDS, constants: &["true", "false", "undefined"], sigils: &['?'], ..BASE }),
    ("Julia", StreamSyntax { line_comments: &["#"], block_comment: Some(("#=", "=#")), keywords: JULIA_KEYWORDS, constants: &["true", "false", "nothing", "missing", "Inf", "NaN"], annotation: Some('@'), ..BASE }),
    ("PowerShell", StreamSyntax { line_comments: &["#"], block_comment: Some(("<#", "#>")), keywords: POWERSHELL_KEYWORDS, constants: &["$true", "$false", "$null"], sigils: &['$'], case_insensitive: true, capitalized_types: false, word_chars: "-", ..BASE }),
    ("Batch", StreamSyntax { line_comments: &["::", "REM ", "rem ", "@REM ", "@rem "], block_comment: None, quotes: &['"'], keywords: BATCH_KEYWORDS, constants: &[], sigils: &['%'], case_insensitive: true, capitalized_types: false, ..BASE }),
    ("LaTeX", StreamSyntax { line_comments: &["%"], block_comment: None, quotes: &['$'], constants: &[], capitalized_types: false, command_prefix: Some('\\'), ..BASE }),
    ("Verilog", StreamSyntax { keywords: VERILOG_KEYWORDS, quotes: &['"'], constants: &[], sigils: &['$'], annotation: Some('`'), capitalized_types: false, ..BASE }),
    ("Vim Script", StreamSyntax { line_comments: &["\""], block_comment: None, quotes: &['\''], keywords: VIM_KEYWORDS, constants: &["v:true", "v:false", "v:null"], sigils: &['&'], capitalized_types: false, word_chars: "!:", ..BASE }),
    ("reStructuredText", StreamSyntax { line_comments: &[], block_comment: None, quotes: &['`'], constants: &[], capitalized_types: false, line_styles: RST_LINES, ..BASE }),
    ("Diff", StreamSyntax { line_comments: &[], block_comment: None, quotes: &[], constants: &[], capitalized_types: false, line_styles: DIFF_LINES, ..BASE }),
    ("GraphQL", StreamSyntax { line_comments: &["#"], block_comment: None, quotes: &['"'], keywords: GRAPHQL_KEYWORDS, sigils: &['$'], annotation: Some('@'), ..BASE }),
    ("Nginx", StreamSyntax { line_comments: &["#"], block_comment: None, keywords: NGINX_KEYWORDS, constants: &["on", "off"], sigils: &['$'], capitalized_types: false, ..BASE }),
    ("Objective-C", StreamSyntax { keywords: OBJC_KEYWORDS, types: OBJC_TYPES, constants: &["YES", "NO", "nil", "Nil", "NULL", "true", "false"], annotation: Some('@'), ..BASE }),
    ("SCSS", StreamSyntax { keywords: SCSS_KEYWORDS, constants: &[], sigils: &['$'], annotation: Some('@'), capitalized_types: false, word_chars: "-!", ..BASE }),
    ("Ignore", StreamSyntax { line_comments: &["#"], block_comment: None, quotes: &[], constants: &[], capitalized_types: false, ..BASE }),
];

/// The tokenizer for a language the tree-sitter table has no grammar for.
pub(crate) fn syntax_for(language: &str) -> Option<&'static StreamSyntax> {
    SYNTAXES.iter().find(|(name, _)| *name == language).map(|(_, syntax)| syntax)
}

fn is_ident_start(ch: char) -> bool {
    ch.is_alphabetic() || ch == '_'
}

fn is_ident_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

/// Highlighted spans of `rope` within `range`, sorted and without overlaps.
pub(crate) fn highlight(syntax: &StreamSyntax, rope: &Rope, range: Range<usize>) -> Vec<(Range<usize>, SyntaxKind)> {
    let end = range.end.min(rope.len_bytes());
    let first_line = rope.byte_to_line(range.start.min(end));
    let start = rope.line_to_byte(first_line.saturating_sub(LOOKBEHIND_LINES));
    let last_line = rope.byte_to_line(end);
    let stop = if last_line + 1 < rope.len_lines() { rope.line_to_byte(last_line + 1) } else { rope.len_bytes() };
    let text = rope.byte_slice(start..stop).to_string();
    tokens(syntax, &text)
        .into_iter()
        .filter_map(|(token, kind)| {
            let token = token.start + start..token.end + start;
            let clipped = token.start.max(range.start)..token.end.min(end);
            (clipped.start < clipped.end).then_some((clipped, kind))
        })
        .collect()
}

pub(crate) fn tokens(syntax: &StreamSyntax, text: &str) -> Vec<(Range<usize>, SyntaxKind)> {
    let mut spans = Vec::new();
    let mut index = 0;
    let mut line_start = true;
    while index < text.len() {
        let rest = &text[index..];
        let ch = rest.chars().next().unwrap();
        if ch == '\n' {
            line_start = true;
            index += 1;
            continue;
        }
        if ch.is_whitespace() {
            index += ch.len_utf8();
            continue;
        }
        let at_line_start = std::mem::replace(&mut line_start, false);
        if (index == 0 || text.as_bytes()[index - 1] == b'\n')
            && let Some((_, kind)) = syntax.line_styles.iter().find(|(prefix, _)| rest.starts_with(prefix))
        {
            let end = rest.find('\n').map_or(text.len(), |found| index + found);
            spans.push((index..end, *kind));
            index = end;
            continue;
        }
        if syntax.command_prefix == Some(ch) {
            let body = &rest[ch.len_utf8()..];
            let len = body.find(|next: char| !next.is_alphabetic() && next != '@').unwrap_or(body.len());
            if len > 0 {
                spans.push((index..index + ch.len_utf8() + len, SyntaxKind::Keyword));
                index += ch.len_utf8() + len;
            } else {
                index += ch.len_utf8() + body.chars().next().map_or(0, char::len_utf8);
            }
            continue;
        }
        if let Some((open, close)) = syntax.block_comment
            && rest.starts_with(open)
            && (!open.starts_with('=') || at_line_start)
        {
            let end = rest[open.len()..].find(close).map_or(text.len(), |found| index + open.len() + found + close.len());
            spans.push((index..end, SyntaxKind::Comment));
            index = end;
            continue;
        }
        if syntax.line_comments.iter().any(|prefix| rest.starts_with(prefix)) {
            let end = rest.find('\n').map_or(text.len(), |found| index + found);
            spans.push((index..end, SyntaxKind::Comment));
            index = end;
            continue;
        }
        if syntax.key_value && at_line_start {
            if ch == '[' {
                let end = rest.find('\n').map_or(text.len(), |found| index + found);
                spans.push((index..end, SyntaxKind::Heading));
                index = end;
                continue;
            }
            let line_end = rest.find('\n').unwrap_or(rest.len());
            if let Some(separator) = rest[..line_end].find(['=', ':']) {
                let key = rest[..separator].trim_end();
                if !key.is_empty() {
                    spans.push((index..index + key.len(), SyntaxKind::Property));
                }
                spans.push((index + separator..index + separator + 1, SyntaxKind::Operator));
                index += separator + 1;
                continue;
            }
        }
        if syntax.quotes.contains(&ch) {
            let triple: String = std::iter::repeat_n(ch, 3).collect();
            let end = if ch != '\'' && rest.starts_with(&triple) {
                rest[3..].find(&triple).map_or(text.len(), |found| index + 3 + found + 3)
            } else {
                let mut end = text.len();
                let mut escaped = false;
                for (offset, next) in rest.char_indices().skip(1) {
                    if escaped {
                        escaped = false;
                    } else if next == '\\' {
                        escaped = true;
                    } else if next == ch {
                        end = index + offset + 1;
                        break;
                    } else if next == '\n' && ch != '`' {
                        end = index + offset;
                        break;
                    }
                }
                end
            };
            spans.push((index..end, SyntaxKind::String));
            index = end;
            continue;
        }
        if ch.is_ascii_digit() || (ch == '.' && rest[1..].starts_with(|next: char| next.is_ascii_digit())) {
            let len = rest.find(|next: char| !(next.is_ascii_alphanumeric() || next == '_' || next == '.')).unwrap_or(rest.len());
            spans.push((index..index + len, SyntaxKind::Number));
            index += len;
            continue;
        }
        if (syntax.sigils.contains(&ch) || syntax.annotation == Some(ch)) && rest[ch.len_utf8()..].starts_with(is_ident_start) {
            let body = &rest[ch.len_utf8()..];
            let len = ch.len_utf8() + body.find(|next: char| !is_ident_char(next)).unwrap_or(body.len());
            let kind = if syntax.annotation == Some(ch) && !syntax.sigils.contains(&ch) { SyntaxKind::Attribute } else { SyntaxKind::Variable };
            spans.push((index..index + len, kind));
            index += len;
            continue;
        }
        if is_ident_start(ch) || (ch == '#' && rest[1..].starts_with(is_ident_start)) || (ch == '<' && rest.starts_with("<?php")) {
            let skip = if ch == '<' { 5 } else { ch.len_utf8() };
            let body = &rest[skip..];
            let len = skip + body.find(|next: char| !(is_ident_char(next) || syntax.word_chars.contains(next))).unwrap_or(body.len());
            let word = &rest[..len];
            let matches = |list: &[&str]| if syntax.case_insensitive { list.iter().any(|item| item.eq_ignore_ascii_case(word)) } else { list.contains(&word) };
            let next = rest[len..].trim_start_matches([' ', '\t']).chars().next();
            let kind = if matches(syntax.keywords) {
                Some(SyntaxKind::Keyword)
            } else if matches(syntax.constants) {
                Some(match word {
                    "true" | "false" | "True" | "False" | "TRUE" | "FALSE" => SyntaxKind::Boolean,
                    "null" | "nil" | "NULL" | "nullptr" | "None" | "undefined" | "undef" | "Nothing" => SyntaxKind::Null,
                    _ => SyntaxKind::Constant,
                })
            } else if matches(syntax.types) {
                Some(SyntaxKind::Type)
            } else if ch == '#' {
                None
            } else if next == Some('(') {
                Some(SyntaxKind::Function)
            } else if syntax.capitalized_types && ch.is_uppercase() {
                Some(if len > 1 && word.chars().all(|c| !c.is_lowercase()) { SyntaxKind::Constant } else { SyntaxKind::Type })
            } else {
                None
            };
            if let Some(kind) = kind {
                spans.push((index..index + len, kind));
            }
            index += len;
            continue;
        }
        if "+-*/%=<>!&|^~?:".contains(ch) {
            spans.push((index..index + 1, SyntaxKind::Operator));
        }
        index += ch.len_utf8();
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(language: &str, text: &str) -> Vec<(&'static str, SyntaxKind)> {
        let text: &'static str = Box::leak(text.to_string().into_boxed_str());
        tokens(syntax_for(language).unwrap(), text).into_iter().map(|(range, kind)| (&text[range], kind)).collect()
    }

    #[test]
    fn java() {
        let spans = kinds("Java", "@Override\npublic int size() { return count; } // done\n/* a\nb */ String s = \"x\\\"y\";");
        assert_eq!(
            spans,
            vec![
                ("@Override", SyntaxKind::Attribute),
                ("public", SyntaxKind::Keyword),
                ("int", SyntaxKind::Type),
                ("size", SyntaxKind::Function),
                ("return", SyntaxKind::Keyword),
                ("// done", SyntaxKind::Comment),
                ("/* a\nb */", SyntaxKind::Comment),
                ("String", SyntaxKind::Type),
                ("=", SyntaxKind::Operator),
                ("\"x\\\"y\"", SyntaxKind::String),
            ]
        );
    }

    #[test]
    fn ruby_and_sql_and_ini() {
        assert_eq!(
            kinds("Ruby", "def ok?\n  @name = nil # c\nend"),
            vec![
                ("def", SyntaxKind::Keyword),
                ("@name", SyntaxKind::Variable),
                ("=", SyntaxKind::Operator),
                ("nil", SyntaxKind::Null),
                ("# c", SyntaxKind::Comment),
                ("end", SyntaxKind::Keyword)
            ]
        );
        assert_eq!(kinds("SQL", "SELECT 1 FROM t -- x"), vec![("SELECT", SyntaxKind::Keyword), ("1", SyntaxKind::Number), ("FROM", SyntaxKind::Keyword), ("-- x", SyntaxKind::Comment)]);
        assert_eq!(
            kinds("INI", "[core]\nname = value ; c\n"),
            vec![("[core]", SyntaxKind::Heading), ("name", SyntaxKind::Property), ("=", SyntaxKind::Operator), ("; c", SyntaxKind::Comment)]
        );
    }

    #[test]
    fn ml_latex_diff_and_powershell() {
        assert_eq!(
            kinds("OCaml", "let rec f x = (* c *) \"s\""),
            vec![("let", SyntaxKind::Keyword), ("rec", SyntaxKind::Keyword), ("=", SyntaxKind::Operator), ("(* c *)", SyntaxKind::Comment), ("\"s\"", SyntaxKind::String)]
        );
        assert_eq!(kinds("F#", "let x = 1 // c"), vec![("let", SyntaxKind::Keyword), ("=", SyntaxKind::Operator), ("1", SyntaxKind::Number), ("// c", SyntaxKind::Comment)]);
        assert_eq!(
            kinds("LaTeX", "\\section{A} $x$ % c"),
            vec![("\\section", SyntaxKind::Keyword), ("$x$", SyntaxKind::String), ("% c", SyntaxKind::Comment)]
        );
        assert_eq!(
            kinds("Diff", "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same"),
            vec![
                ("--- a", SyntaxKind::Heading),
                ("+++ b", SyntaxKind::Heading),
                ("@@ -1 +1 @@", SyntaxKind::Keyword),
                ("-old", SyntaxKind::Invalid),
                ("+new", SyntaxKind::String)
            ]
        );
        assert_eq!(kinds("PowerShell", "Function Get-X { $a }"), vec![("Function", SyntaxKind::Keyword), ("$a", SyntaxKind::Variable)]);
        assert_eq!(kinds("Erlang", "-module(m). % c"), vec![("-", SyntaxKind::Operator), ("module", SyntaxKind::Keyword), ("% c", SyntaxKind::Comment)]);
    }

    #[test]
    fn clips_to_the_range_and_sees_comments_opened_above() {
        let rope = Rope::from_str("/* one\ntwo\nthree */ int x;\n");
        let line = rope.line_to_byte(1);
        let spans = highlight(syntax_for("C").unwrap(), &rope, line..line + 3);
        assert_eq!(spans, vec![(line..line + 3, SyntaxKind::Comment)]);
    }
}
