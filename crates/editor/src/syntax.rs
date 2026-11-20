//! Languages and tree-sitter highlighting.
//!
//! Highlight queries come with the grammar crates; their capture names (`keyword`,
//! `function.method`, `string.special`, ...) map onto the theme's Athas syntax keys the same way
//! the old CodeMirror highlight style mapped lezer tags. Where two patterns capture the same
//! node the later one wins, and inner nodes win over outer ones.

use std::{
    ops::Range,
    path::Path,
    sync::{Arc, LazyLock, OnceLock},
};

use gpui::{FontStyle, FontWeight, Hsla};
use ropey::Rope;
#[cfg(not(target_family = "wasm"))]
use tree_sitter::{Node, Parser, Query, QueryCursor, StreamingIterator as _};
#[cfg(not(target_family = "wasm"))]
pub use tree_sitter::{InputEdit, Language, Point, Tree};
#[cfg(target_family = "wasm")]
pub use web::{InputEdit, Language, Point, Tree};

/// A theme colour slot, by its Athas syntax key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SyntaxKind {
    Comment,
    Keyword,
    String,
    Regex,
    Number,
    Boolean,
    Null,
    Constant,
    Function,
    Type,
    Property,
    Variable,
    Attribute,
    Tag,
    Operator,
    Punctuation,
    Heading,
    Emphasis,
    Strong,
    Link,
    Code,
    Invalid,
}

impl SyntaxKind {
    /// The theme keys to try, in order.
    fn keys(self) -> &'static [&'static str] {
        match self {
            SyntaxKind::Comment => &["comment"],
            SyntaxKind::Keyword => &["keyword"],
            SyntaxKind::String => &["string"],
            SyntaxKind::Regex => &["regex", "string"],
            SyntaxKind::Number => &["number", "constant"],
            SyntaxKind::Boolean => &["boolean", "constant"],
            SyntaxKind::Null => &["null", "constant"],
            SyntaxKind::Constant => &["constant"],
            SyntaxKind::Function => &["function"],
            SyntaxKind::Type => &["type"],
            SyntaxKind::Property => &["property", "variable"],
            SyntaxKind::Variable => &["variable"],
            SyntaxKind::Attribute => &["attribute"],
            SyntaxKind::Tag => &["tag", "keyword"],
            SyntaxKind::Operator => &["operator"],
            SyntaxKind::Punctuation => &["punctuation"],
            SyntaxKind::Heading => &["markdown-heading", "function"],
            SyntaxKind::Emphasis => &["markdown-italic", "keyword"],
            SyntaxKind::Strong => &["markdown-bold", "number"],
            SyntaxKind::Link => &["markdown-link", "constant"],
            SyntaxKind::Code => &["markdown-code", "string"],
            SyntaxKind::Invalid => &["invalid"],
        }
    }

    pub fn color(self, theme: &theme::Theme) -> Hsla {
        let colors = &theme.colors;
        if self == SyntaxKind::Invalid {
            return colors.destructive;
        }
        self.keys().iter().find_map(|key| colors.syntax.get(*key).copied()).unwrap_or(colors.foreground)
    }

    pub fn weight(self) -> FontWeight {
        match self {
            SyntaxKind::Heading | SyntaxKind::Strong => FontWeight::SEMIBOLD,
            _ => FontWeight::NORMAL,
        }
    }

    pub fn style(self, italic_comments: bool) -> FontStyle {
        match self {
            SyntaxKind::Emphasis => FontStyle::Italic,
            SyntaxKind::Comment if italic_comments => FontStyle::Italic,
            _ => FontStyle::Normal,
        }
    }
}

/// Maps a tree-sitter capture name to the colour it is drawn with. Names nest with dots and the
/// most specific known prefix decides.
#[cfg(not(target_family = "wasm"))]
pub fn kind_for_capture(name: &str) -> Option<SyntaxKind> {
    let exact = match name {
        "string.escape" | "string.regex" | "string.special.regex" | "escape" => Some(SyntaxKind::Regex),
        "string.special.key" => Some(SyntaxKind::Property),
        "constant.builtin.boolean" | "boolean" => Some(SyntaxKind::Boolean),
        "constant.builtin.null" | "null" => Some(SyntaxKind::Null),
        "variable.builtin" => Some(SyntaxKind::Keyword),
        "variable.parameter" | "variable" | "label" => Some(SyntaxKind::Variable),
        "constructor" => Some(SyntaxKind::Type),
        "tag.error" => Some(SyntaxKind::Invalid),
        "punctuation.special" => Some(SyntaxKind::Operator),
        "text.title" | "markup.heading" => Some(SyntaxKind::Heading),
        "text.emphasis" | "markup.italic" => Some(SyntaxKind::Emphasis),
        "text.strong" | "markup.bold" => Some(SyntaxKind::Strong),
        "text.uri" | "text.reference" | "markup.link" | "markup.link.url" => Some(SyntaxKind::Link),
        "text.literal" | "markup.raw" => Some(SyntaxKind::Code),
        "embedded" | "none" | "spell" => None,
        _ => None,
    };
    if exact.is_some() {
        return exact;
    }
    let root = name.split('.').next().unwrap_or(name);
    match root {
        "comment" => Some(SyntaxKind::Comment),
        "keyword" | "conditional" | "repeat" | "include" | "exception" | "storageclass" | "import" | "charset" | "media"
        | "keyframes" | "supports" => Some(SyntaxKind::Keyword),
        "string" | "character" => Some(SyntaxKind::String),
        "number" | "float" => Some(SyntaxKind::Number),
        "constant" => Some(SyntaxKind::Constant),
        "function" | "method" => Some(SyntaxKind::Function),
        "type" | "namespace" | "module" => Some(SyntaxKind::Type),
        "property" | "field" => Some(SyntaxKind::Property),
        "attribute" => Some(SyntaxKind::Attribute),
        "tag" => Some(SyntaxKind::Tag),
        "operator" => Some(SyntaxKind::Operator),
        "punctuation" | "delimiter" => Some(SyntaxKind::Punctuation),
        _ => None,
    }
}

#[cfg_attr(target_family = "wasm", allow(dead_code))]
struct Grammar {
    language: Language,
    queries: &'static [&'static str],
    highlights: OnceLock<Option<HighlightQuery>>,
}

#[cfg(not(target_family = "wasm"))]
struct HighlightQuery {
    query: Query,
    kinds: Vec<Option<SyntaxKind>>,
}

#[cfg(target_family = "wasm")]
enum HighlightQuery {}

/// A language the editor knows: how to comment it, and its grammar when it has one.
pub struct LanguageConfig {
    pub name: &'static str,
    pub line_comment: Option<&'static str>,
    pub block_comment: Option<(&'static str, &'static str)>,
    extensions: &'static [&'static str],
    file_names: &'static [&'static str],
    grammar: Option<Grammar>,
}

impl LanguageConfig {
    #[cfg(test)]
    fn has_grammar(&self) -> bool {
        self.grammar.is_some()
    }

    pub fn ts_language(&self) -> Option<Language> {
        self.grammar.as_ref().map(|grammar| grammar.language.clone())
    }

    #[cfg(not(target_family = "wasm"))]
    fn highlight_query(&self) -> Option<&HighlightQuery> {
        let grammar = self.grammar.as_ref()?;
        grammar
            .highlights
            .get_or_init(|| {
                let source = grammar.queries.concat();
                match Query::new(&grammar.language, &source) {
                    Ok(query) => {
                        let kinds = query.capture_names().iter().map(|name| kind_for_capture(name)).collect();
                        Some(HighlightQuery { query, kinds })
                    }
                    Err(error) => {
                        eprintln!("editor: the {} highlight query does not compile: {error}", self.name);
                        None
                    }
                }
            })
            .as_ref()
    }
}

fn language(
    name: &'static str,
    extensions: &'static [&'static str],
    file_names: &'static [&'static str],
    line_comment: Option<&'static str>,
    block_comment: Option<(&'static str, &'static str)>,
    grammar: Option<(Language, &'static [&'static str])>,
) -> Arc<LanguageConfig> {
    Arc::new(LanguageConfig {
        name,
        line_comment,
        block_comment,
        extensions,
        file_names,
        grammar: grammar.map(|(language, queries)| Grammar { language, queries, highlights: OnceLock::new() }),
    })
}

#[cfg(not(target_family = "wasm"))]
static JS_QUERIES: LazyLock<[&'static str; 2]> =
    LazyLock::new(|| [tree_sitter_javascript::HIGHLIGHT_QUERY, tree_sitter_javascript::JSX_HIGHLIGHT_QUERY]);
#[cfg(not(target_family = "wasm"))]
static TS_QUERIES: LazyLock<[&'static str; 2]> =
    LazyLock::new(|| [tree_sitter_javascript::HIGHLIGHT_QUERY, tree_sitter_typescript::HIGHLIGHTS_QUERY]);
#[cfg(not(target_family = "wasm"))]
static TSX_QUERIES: LazyLock<[&'static str; 3]> = LazyLock::new(|| {
    [tree_sitter_javascript::HIGHLIGHT_QUERY, tree_sitter_javascript::JSX_HIGHLIGHT_QUERY, tree_sitter_typescript::HIGHLIGHTS_QUERY]
});

/// A grammar for the table below. The web build has none: the grammars are C, which this
/// tree-sitter does not build for wasm32-unknown-unknown.
#[cfg(not(target_family = "wasm"))]
macro_rules! grammar {
    ($language:expr, $queries:expr) => {
        Some(($language.into(), $queries))
    };
}

#[cfg(target_family = "wasm")]
macro_rules! grammar {
    ($language:expr, $queries:expr) => {
        None
    };
}

static LANGUAGES: LazyLock<Vec<Arc<LanguageConfig>>> = LazyLock::new(|| {
    let slash = Some("//");
    let hash = Some("#");
    let dashes = Some("--");
    let c_block = Some(("/*", "*/"));
    let html_block = Some(("<!--", "-->"));
    vec![
        language("Rust", &["rs"], &[], slash, c_block, grammar!(tree_sitter_rust::LANGUAGE, &[tree_sitter_rust::HIGHLIGHTS_QUERY])),
        language(
            "TypeScript",
            &["ts", "mts", "cts"],
            &[],
            slash,
            c_block,
            grammar!(tree_sitter_typescript::LANGUAGE_TYPESCRIPT, &*TS_QUERIES),
        ),
        language("TSX", &["tsx"], &[], slash, c_block, grammar!(tree_sitter_typescript::LANGUAGE_TSX, &*TSX_QUERIES)),
        language(
            "JavaScript",
            &["js", "mjs", "cjs", "jsx"],
            &[],
            slash,
            c_block,
            grammar!(tree_sitter_javascript::LANGUAGE, &*JS_QUERIES),
        ),
        language(
            "JSON",
            &["json", "jsonc", "json5"],
            &[".prettierrc", ".babelrc", ".eslintrc"],
            slash,
            c_block,
            grammar!(tree_sitter_json::LANGUAGE, &[tree_sitter_json::HIGHLIGHTS_QUERY]),
        ),
        language("Python", &["py", "pyi", "pyw"], &[], hash, None, grammar!(tree_sitter_python::LANGUAGE, &[tree_sitter_python::HIGHLIGHTS_QUERY])),
        language("Go", &["go"], &[], slash, c_block, grammar!(tree_sitter_go::LANGUAGE, &[tree_sitter_go::HIGHLIGHTS_QUERY])),
        language("CSS", &["css"], &[], None, c_block, grammar!(tree_sitter_css::LANGUAGE, &[tree_sitter_css::HIGHLIGHTS_QUERY])),
        language("SCSS", &["scss", "less", "sass"], &[], slash, c_block, None),
        language("HTML", &["html", "htm", "xhtml"], &[], None, html_block, grammar!(tree_sitter_html::LANGUAGE, &[tree_sitter_html::HIGHLIGHTS_QUERY])),
        language("Vue", &["vue"], &[], None, html_block, grammar!(tree_sitter_html::LANGUAGE, &[tree_sitter_html::HIGHLIGHTS_QUERY])),
        language("Svelte", &["svelte"], &[], None, html_block, grammar!(tree_sitter_html::LANGUAGE, &[tree_sitter_html::HIGHLIGHTS_QUERY])),
        language("Astro", &["astro"], &[], None, html_block, grammar!(tree_sitter_html::LANGUAGE, &[tree_sitter_html::HIGHLIGHTS_QUERY])),
        language("ERB", &["erb", "rhtml"], &[], None, Some(("<%#", "%>")), grammar!(tree_sitter_html::LANGUAGE, &[tree_sitter_html::HIGHLIGHTS_QUERY])),
        language(
            "XML",
            &["xml", "svg", "plist", "xsd", "xsl", "xslt", "csproj", "fsproj", "vcxproj", "xaml", "storyboard", "xib"],
            &[],
            None,
            html_block,
            grammar!(tree_sitter_html::LANGUAGE, &[tree_sitter_html::HIGHLIGHTS_QUERY]),
        ),
        language(
            "Markdown",
            &["md", "markdown", "mdx"],
            &[],
            None,
            html_block,
            grammar!(tree_sitter_md::LANGUAGE, &[tree_sitter_md::HIGHLIGHT_QUERY_BLOCK]),
        ),
        language(
            "TOML",
            &["toml"],
            &["Cargo.lock"],
            hash,
            None,
            grammar!(tree_sitter_toml_ng::LANGUAGE, &[tree_sitter_toml_ng::HIGHLIGHTS_QUERY]),
        ),
        language("YAML", &["yml", "yaml"], &[], hash, None, grammar!(tree_sitter_yaml::LANGUAGE, &[tree_sitter_yaml::HIGHLIGHTS_QUERY])),
        language(
            "Shell",
            &["sh", "bash", "zsh", "fish", "command"],
            &[".bashrc", ".zshrc", ".bash_profile", ".profile", ".zprofile", ".envrc"],
            hash,
            None,
            grammar!(tree_sitter_bash::LANGUAGE, &[tree_sitter_bash::HIGHLIGHT_QUERY]),
        ),
        language("C", &["c", "h"], &[], slash, c_block, None),
        language("C++", &["cc", "cpp", "cxx", "hpp", "hh", "hxx", "ino"], &[], slash, c_block, None),
        language("Java", &["java"], &[], slash, c_block, None),
        language("Kotlin", &["kt", "kts"], &[], slash, c_block, None),
        language("Swift", &["swift"], &[], slash, c_block, None),
        language("C#", &["cs", "csx"], &[], slash, c_block, None),
        language("Scala", &["scala", "sc"], &[], slash, c_block, None),
        language("Dart", &["dart"], &[], slash, c_block, None),
        language("PHP", &["php", "phtml"], &[], slash, c_block, None),
        language("Zig", &["zig", "zon"], &[], slash, None, None),
        language("Solidity", &["sol"], &[], slash, c_block, None),
        language("Protocol Buffers", &["proto"], &[], slash, c_block, None),
        language("Groovy", &["groovy", "gradle"], &["Jenkinsfile"], slash, c_block, None),
        language("Lua", &["lua"], &[], dashes, Some(("--[[", "]]")), None),
        language("SQL", &["sql"], &[], dashes, c_block, None),
        language("Haskell", &["hs", "elm"], &[], dashes, Some(("{-", "-}")), None),
        language("Ruby", &["rb", "rake", "gemspec"], &["Gemfile", "Rakefile", "Podfile", "Brewfile"], hash, None, None),
        language("Perl", &["pl", "pm"], &[], hash, None, None),
        language("R", &["r"], &[], hash, None, None),
        language("Elixir", &["ex", "exs"], &["mix.lock"], hash, None, None),
        language("Nix", &["nix"], &[], hash, c_block, None),
        language("Terraform", &["tf", "tfvars", "hcl"], &[], hash, c_block, None),
        language("Makefile", &["mk", "make"], &["Makefile", "makefile", "GNUmakefile"], hash, None, None),
        language("CMake", &["cmake"], &["CMakeLists.txt"], hash, None, None),
        language("Dockerfile", &["dockerfile", "containerfile"], &["Dockerfile", "Containerfile"], hash, None, None),
        language("INI", &["ini", "conf", "cfg", "properties", "editorconfig"], &[".editorconfig", ".gitconfig", ".npmrc"], hash, None, None),
        language("Dotenv", &["env"], &[".env", ".env.local", ".env.example"], hash, None, None),
        language("Ignore", &["gitignore", "dockerignore"], &[".gitignore", ".dockerignore", ".ignore", ".npmignore", ".eslintignore", ".prettierignore", ".stylelintignore", ".vscodeignore", ".rgignore", ".fdignore"], hash, None, None),
        language("Hash comments", &[], &["Procfile", ".gitattributes"], hash, None, None),
        language("Lisp", &["clj", "cljs", "cljc", "edn", "el", "lisp", "scm", "ss", "rkt"], &[], Some(";"), None, None),
        language("OCaml", &["ml", "mli", "mll", "mly"], &[], None, Some(("(*", "*)")), None),
        language("F#", &["fs", "fsi", "fsx"], &[], slash, Some(("(*", "*)")), None),
        language("Erlang", &["erl", "hrl"], &["rebar.config"], Some("%"), None, None),
        language("Julia", &["jl"], &[], hash, Some(("#=", "=#")), None),
        language("PowerShell", &["ps1", "psm1", "psd1"], &[], hash, Some(("<#", "#>")), None),
        language("Batch", &["bat", "cmd"], &[], Some("REM"), None, None),
        language("LaTeX", &["tex", "latex", "sty", "cls", "bib"], &[], Some("%"), None, None),
        language("Verilog", &["v", "vh", "sv", "svh"], &[], slash, c_block, None),
        language("Vim Script", &["vim"], &[".vimrc", "_vimrc", ".gvimrc"], Some("\""), None, None),
        language("reStructuredText", &["rst"], &[], Some(".."), None, None),
        language("Diff", &["diff", "patch"], &[], None, None, None),
        language("GraphQL", &["graphql", "gql"], &[], hash, None, None),
        language("Nginx", &[], &["nginx.conf"], hash, None, None),
        language("Objective-C", &["m", "mm"], &[], slash, c_block, None),
    ]
});

static PLAIN_TEXT: LazyLock<Arc<LanguageConfig>> = LazyLock::new(|| language("Plain Text", &[], &[], None, None, None));

/// The language for a file, by its name or extension.
/// Highlighted spans of a standalone snippet in `path`'s language, such as a search excerpt.
pub fn highlight_snippet(path: &Path, text: &str) -> Vec<(Range<usize>, SyntaxKind)> {
    let rope = Rope::from_str(text);
    let mut state = SyntaxState::new(language_for_path(path));
    state.reparse_now(&rope);
    state.highlights(&rope, 0..text.len())
}

/// The name of the language a file at `path` opens in, such as `Rust` or `Plain Text`.
pub fn language_name_for_path(path: &Path) -> &'static str {
    language_for_path(path).name
}

pub fn language_for_path(path: &Path) -> Arc<LanguageConfig> {
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    let extension = path.extension().and_then(|extension| extension.to_str()).map(str::to_ascii_lowercase);
    LANGUAGES
        .iter()
        .find(|language| language.file_names.contains(&file_name))
        .or_else(|| {
            let extension = extension.as_deref()?;
            LANGUAGES.iter().find(|language| language.extensions.contains(&extension))
        })
        .cloned()
        .unwrap_or_else(|| PLAIN_TEXT.clone())
}

/// Every language a file can be shown in, Plain Text first (the language mode picker).
pub fn all_languages() -> Vec<Arc<LanguageConfig>> {
    std::iter::once(PLAIN_TEXT.clone()).chain(LANGUAGES.iter().filter(|language| language.name != "Hash comments").cloned()).collect()
}

/// The language named `name`.
pub fn language_named(name: &str) -> Option<Arc<LanguageConfig>> {
    all_languages().into_iter().find(|language| language.name == name)
}

/// The language of a `defaultLanguage` setting value (`typescript`, `rust`, …).
pub fn language_for_id(id: &str) -> Option<Arc<LanguageConfig>> {
    let name = match id {
        "plaintext" => return Some(PLAIN_TEXT.clone()),
        "typescript" => "TypeScript",
        "javascript" => "JavaScript",
        "rust" => "Rust",
        "python" => "Python",
        "go" => "Go",
        "markdown" => "Markdown",
        "json" => "JSON",
        "html" => "HTML",
        "css" => "CSS",
        "yaml" => "YAML",
        "toml" => "TOML",
        "shell" | "shellscript" | "bash" => "Shell",
        "java" => "Java",
        "c" => "C",
        "cpp" => "C++",
        "csharp" => "C#",
        "kotlin" => "Kotlin",
        "swift" => "Swift",
        "php" => "PHP",
        "ruby" => "Ruby",
        "lua" => "Lua",
        "sql" => "SQL",
        "xml" => "XML",
        "scss" => "SCSS",
        _ => return None,
    };
    LANGUAGES.iter().find(|language| language.name == name).cloned()
}

/// Guesses the language of a file its name does not identify, from a shebang or the first
/// line (`autoDetectLanguage`).
pub fn detect_language(text: &str) -> Option<Arc<LanguageConfig>> {
    let first = text.lines().find(|line| !line.trim().is_empty())?.trim();
    let id = if let Some(shebang) = first.strip_prefix("#!") {
        let program = shebang.split_whitespace().rev().find(|word| !word.starts_with('-'))?;
        let program = program.rsplit('/').next().unwrap_or(program);
        match program.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.') {
            "sh" | "bash" | "zsh" | "dash" | "ksh" | "fish" => "shell",
            "python" => "python",
            "node" | "bun" | "deno" => "javascript",
            "ts-node" | "tsx" => "typescript",
            _ => return None,
        }
    } else if first.starts_with("<?xml") || first.starts_with("<!DOCTYPE") || first.starts_with("<html") {
        "html"
    } else if (first.starts_with('{') || first.starts_with('[')) && looks_like_json(text) {
        "json"
    } else if first.starts_with("---") || first.starts_with("# ") {
        if first.starts_with("---") { "yaml" } else { "markdown" }
    } else {
        return None;
    };
    language_for_id(id)
}

fn looks_like_json(text: &str) -> bool {
    let trimmed = text.trim();
    matches!((trimmed.chars().next(), trimmed.chars().last()), (Some('{'), Some('}')) | (Some('['), Some(']')))
}

/// The language to show a file in: by its name, else detected from its text, else the
/// `defaultLanguage` setting.
pub fn resolve_language(path: &Path, text: &str, auto_detect: bool, default_language: &str) -> Arc<LanguageConfig> {
    let by_name = language_for_path(path);
    if by_name.name != PLAIN_TEXT.name {
        return by_name;
    }
    auto_detect
        .then(|| detect_language(text))
        .flatten()
        .or_else(|| language_for_id(default_language))
        .unwrap_or(by_name)
}

#[cfg(target_family = "wasm")]
pub fn parse(language: &Language, _: &Rope, _: Option<&Tree>) -> Option<Tree> {
    match *language {}
}

/// Parses `rope`, reusing `old` (already edited to match) for the unchanged parts.
#[cfg(not(target_family = "wasm"))]
pub fn parse(language: &Language, rope: &Rope, old: Option<&Tree>) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(language).ok()?;
    let len = rope.len_bytes();
    parser.parse_with_options(
        &mut |byte: usize, _| -> &[u8] {
            if byte >= len {
                return &[];
            }
            let (chunk, chunk_start, _, _) = rope.chunk_at_byte(byte);
            &chunk.as_bytes()[byte - chunk_start..]
        },
        old,
        None,
    )
}

/// The syntax tree of a buffer, kept in step with its edits.
pub struct SyntaxState {
    pub language: Arc<LanguageConfig>,
    pub tree: Option<Tree>,
    /// Bumped whenever the tree changes, for caches.
    pub generation: usize,
    /// Edits made since the background parse in flight started, to replay onto its result.
    pub pending_edits: Vec<InputEdit>,
    pub parsing: bool,
    /// Embedded languages of the current tree, by generation.
    #[cfg(not(target_family = "wasm"))]
    injections: std::sync::Mutex<Option<Arc<Injections>>>,
}

impl SyntaxState {
    pub fn new(language: Arc<LanguageConfig>) -> Self {
        Self {
            language,
            tree: None,
            generation: 0,
            pending_edits: Vec::new(),
            parsing: false,
            #[cfg(not(target_family = "wasm"))]
            injections: Default::default(),
        }
    }

    pub fn edit(&mut self, edits: &[InputEdit]) {
        if let Some(tree) = &mut self.tree {
            for edit in edits {
                tree.edit(edit);
            }
            self.generation += 1;
        }
        if self.parsing {
            self.pending_edits.extend_from_slice(edits);
        }
    }

    /// Installs a tree parsed in the background, replaying the edits made meanwhile. Returns
    /// whether it is stale and another parse should follow.
    pub fn install(&mut self, mut tree: Tree) -> bool {
        let stale = !self.pending_edits.is_empty();
        for edit in self.pending_edits.drain(..) {
            tree.edit(&edit);
        }
        self.tree = Some(tree);
        self.parsing = false;
        self.generation += 1;
        stale
    }

    pub fn reparse_now(&mut self, rope: &Rope) {
        let Some(language) = self.language.ts_language() else { return };
        if let Some(tree) = parse(&language, rope, self.tree.as_ref()) {
            self.tree = Some(tree);
            self.generation += 1;
        }
    }

}

#[cfg(target_family = "wasm")]
impl SyntaxState {
    pub fn highlights(&self, rope: &Rope, range: Range<usize>) -> Vec<(Range<usize>, SyntaxKind)> {
        crate::stream_highlight::syntax_for(self.language.name).map(|syntax| crate::stream_highlight::highlight(syntax, rope, range)).unwrap_or_default()
    }

    pub fn bracket_depths(&self, _: Range<usize>) -> Vec<(usize, usize)> {
        Vec::new()
    }

    pub fn enclosing_range(&self, _: Range<usize>) -> Option<Range<usize>> {
        None
    }

    pub fn matching_bracket(&self, _: usize) -> Option<(usize, usize)> {
        None
    }
}

#[cfg(not(target_family = "wasm"))]
impl SyntaxState {
    /// Highlighted spans within `range`, without overlaps, sorted.
    pub fn highlights(&self, rope: &Rope, range: Range<usize>) -> Vec<(Range<usize>, SyntaxKind)> {
        let (Some(tree), Some(query)) = (&self.tree, self.language.highlight_query()) else {
            return crate::stream_highlight::syntax_for(self.language.name).map(|syntax| crate::stream_highlight::highlight(syntax, rope, range)).unwrap_or_default();
        };
        let spans = highlight_spans(tree, query, rope, range.clone());
        if !embeds_languages(self.language.name) {
            return spans;
        }
        let injections = {
            let mut cached = self.injections.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            match cached.as_ref() {
                Some(injections) if injections.generation == self.generation => injections.clone(),
                _ => {
                    let fresh = Arc::new(collect_injections(self.language.name, self.generation, tree, rope));
                    *cached = Some(fresh.clone());
                    fresh
                }
            }
        };
        injections.overlay(spans, range)
    }

    /// Nesting depth of each bracket in `range`, for bracket pair colours.
    pub fn bracket_depths(&self, range: Range<usize>) -> Vec<(usize, usize)> {
        let Some(tree) = &self.tree else { return Vec::new() };
        let mut out = Vec::new();
        collect_brackets(tree.root_node(), &range, 0, &mut out);
        out
    }

    /// The smallest node that holds `range` and is larger than it, for expand selection.
    pub fn enclosing_range(&self, range: Range<usize>) -> Option<Range<usize>> {
        let tree = self.tree.as_ref()?;
        let mut node = tree.root_node().descendant_for_byte_range(range.start, range.end)?;
        loop {
            let found = node.byte_range();
            if found.start <= range.start && found.end >= range.end && found != range {
                return Some(found);
            }
            node = node.parent()?;
        }
    }

    /// The bracket next to `offset` and its partner, by the syntax tree.
    pub fn matching_bracket(&self, offset: usize) -> Option<(usize, usize)> {
        let tree = self.tree.as_ref()?;
        let root = tree.root_node();
        for at in [Some(offset), offset.checked_sub(1)].into_iter().flatten() {
            let Some(node) = root.descendant_for_byte_range(at, at + 1) else { continue };
            if node.is_named() || node.start_byte() != at || bracket_pair(node.kind()).is_none() {
                continue;
            }
            if let Some(partner) = partner_in_parent(node) {
                return Some((at, partner));
            }
        }
        None
    }
}

/// Languages whose files hold other languages: `<script>`/`<style>` blocks, ERB tags, Astro
/// front matter.
#[cfg(not(target_family = "wasm"))]
fn embeds_languages(name: &str) -> bool {
    matches!(name, "HTML" | "Vue" | "Svelte" | "Astro" | "ERB")
}

#[cfg(not(target_family = "wasm"))]
struct Injection {
    range: Range<usize>,
    language: Arc<LanguageConfig>,
    rope: Rope,
    tree: Option<Tree>,
}

#[cfg(not(target_family = "wasm"))]
struct Injections {
    generation: usize,
    list: Vec<Injection>,
    /// Delimiters of embedded regions (`<%=`, `%>`, `---`).
    marks: Vec<(Range<usize>, SyntaxKind)>,
}

#[cfg(not(target_family = "wasm"))]
impl Injections {
    fn overlay(&self, spans: Vec<(Range<usize>, SyntaxKind)>, range: Range<usize>) -> Vec<(Range<usize>, SyntaxKind)> {
        let touches = |region: &Range<usize>| region.start < range.end && region.end > range.start;
        if !self.list.iter().any(|injection| touches(&injection.range)) && !self.marks.iter().any(|(mark, _)| touches(mark)) {
            return spans;
        }
        let len = range.end - range.start;
        let mut paint: Vec<Option<SyntaxKind>> = vec![None; len];
        let mut fill = |region: &Range<usize>, kind: Option<SyntaxKind>| {
            let start = region.start.max(range.start);
            let end = region.end.min(range.end);
            if start < end {
                paint[start - range.start..end - range.start].fill(kind);
            }
        };
        for (span, kind) in &spans {
            fill(span, Some(*kind));
        }
        for injection in self.list.iter().filter(|injection| touches(&injection.range)) {
            fill(&injection.range, None);
            let local = range.start.max(injection.range.start) - injection.range.start..range.end.min(injection.range.end) - injection.range.start;
            let inner = match (&injection.tree, injection.language.highlight_query()) {
                (Some(tree), Some(query)) => highlight_spans(tree, query, &injection.rope, local),
                _ => crate::stream_highlight::syntax_for(injection.language.name)
                    .map(|syntax| crate::stream_highlight::highlight(syntax, &injection.rope, local))
                    .unwrap_or_default(),
            };
            for (span, kind) in inner {
                fill(&(span.start + injection.range.start..span.end + injection.range.start), Some(kind));
            }
        }
        for (mark, kind) in &self.marks {
            fill(mark, Some(*kind));
        }
        paint_runs(range.start, &paint)
    }
}

#[cfg(not(target_family = "wasm"))]
fn embedded(name: &str, range: Range<usize>, rope: &Rope) -> Option<Injection> {
    let language = LANGUAGES.iter().find(|language| language.name == name)?.clone();
    let rope = Rope::from(rope.byte_slice(range.clone()));
    let tree = language.ts_language().and_then(|ts| parse(&ts, &rope, None));
    Some(Injection { range, language, rope, tree })
}

#[cfg(not(target_family = "wasm"))]
fn collect_injections(name: &str, generation: usize, tree: &Tree, rope: &Rope) -> Injections {
    let mut list = Vec::new();
    let mut marks = Vec::new();
    let text = |node: Node| rope.byte_slice(node.byte_range()).to_string();
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        let kind = node.kind();
        if kind == "script_element" || kind == "style_element" {
            let mut attributes = Vec::new();
            let mut content = None;
            for index in 0..node.named_child_count() {
                let Some(child) = node.named_child(index) else { continue };
                match child.kind() {
                    "start_tag" => {
                        for index in 0..child.named_child_count() {
                            let Some(attribute) = child.named_child(index).filter(|attribute| attribute.kind() == "attribute") else { continue };
                            let mut key = String::new();
                            let mut value = String::new();
                            for index in 0..attribute.named_child_count() {
                                let Some(part) = attribute.named_child(index) else { continue };
                                match part.kind() {
                                    "attribute_name" => key = text(part).to_ascii_lowercase(),
                                    "attribute_value" | "quoted_attribute_value" => {
                                        value = text(part).trim_matches(['"', '\'']).to_ascii_lowercase();
                                    }
                                    _ => {}
                                }
                            }
                            attributes.push((key, value));
                        }
                    }
                    "raw_text" => content = Some(child.byte_range()),
                    _ => {}
                }
            }
            let attribute = |key: &str| attributes.iter().find(|(name, _)| name == key).map(|(_, value)| value.as_str());
            let language = if kind == "style_element" {
                match attribute("lang") {
                    Some("scss" | "sass" | "less" | "stylus") => "SCSS",
                    _ => "CSS",
                }
            } else {
                match (attribute("lang"), attribute("type").unwrap_or_default()) {
                    (Some("ts" | "typescript"), _) => "TypeScript",
                    (Some("tsx"), _) => "TSX",
                    (_, kind) if kind.contains("json") => "JSON",
                    (_, kind) if kind.contains("typescript") => "TypeScript",
                    (_, "text/x-template" | "text/html" | "text/template") => "HTML",
                    _ => "JavaScript",
                }
            };
            if let Some(content) = content
                && let Some(injection) = embedded(language, content, rope)
            {
                list.push(injection);
            }
            continue;
        }
        for index in (0..node.child_count()).rev() {
            if let Some(child) = node.child(index) {
                stack.push(child);
            }
        }
    }
    if name == "Astro" && rope.len_bytes() >= 3 && rope.byte_slice(0..3) == "---" {
        let head = rope.byte_slice(0..rope.len_bytes().min(64 * 1024)).to_string();
        if let Some(close) = head[3..].find("\n---").map(|found| found + 3) {
            marks.push((0..3, SyntaxKind::Punctuation));
            marks.push((close + 1..close + 4, SyntaxKind::Punctuation));
            list.extend(embedded("TypeScript", 3..close + 1, rope));
        }
    }
    if name == "ERB" {
        let source = rope.to_string();
        let mut at = 0;
        while let Some(found) = source[at..].find("<%") {
            let open = at + found;
            let close = source[open + 2..].find("%>").map_or(source.len(), |found| open + 2 + found);
            at = (close + 2).min(source.len());
            if source[open..].starts_with("<%#") {
                marks.push((open..at, SyntaxKind::Comment));
                continue;
            }
            let delimiter = if source[open..].starts_with("<%=") || source[open..].starts_with("<%-") || source[open..].starts_with("<%%") { 3 } else { 2 };
            let trim = usize::from(source[..close].ends_with('-'));
            marks.push((open..open + delimiter, SyntaxKind::Tag));
            if close < source.len() {
                marks.push((close - trim..at, SyntaxKind::Tag));
            }
            if open + delimiter < close - trim {
                list.extend(embedded("Ruby", open + delimiter..close - trim, rope));
            }
        }
    }
    Injections { generation, list, marks }
}

#[cfg(not(target_family = "wasm"))]
fn paint_runs(base: usize, paint: &[Option<SyntaxKind>]) -> Vec<(Range<usize>, SyntaxKind)> {
    let mut spans: Vec<(Range<usize>, SyntaxKind)> = Vec::new();
    let mut index = 0;
    while index < paint.len() {
        let Some(kind) = paint[index] else {
            index += 1;
            continue;
        };
        let start = index;
        while index < paint.len() && paint[index] == Some(kind) {
            index += 1;
        }
        spans.push((base + start..base + index, kind));
    }
    spans
}

#[cfg(not(target_family = "wasm"))]
fn highlight_spans(tree: &Tree, highlights: &HighlightQuery, rope: &Rope, range: Range<usize>) -> Vec<(Range<usize>, SyntaxKind)> {
    let mut cursor = QueryCursor::new();
    cursor.set_byte_range(range.clone());
    cursor.set_match_limit(2048);
    let mut captures = cursor.captures(&highlights.query, tree.root_node(), |node: Node| {
        rope.byte_slice(node.byte_range()).chunks().map(str::as_bytes)
    });
    let mut found: Vec<(usize, usize, usize, SyntaxKind)> = Vec::new();
    while let Some((query_match, index)) = captures.next() {
        let capture = query_match.captures[*index];
        let Some(kind) = highlights.kinds[capture.index as usize] else { continue };
        let node = capture.node;
        let start = node.start_byte().max(range.start);
        let end = node.end_byte().min(range.end);
        if start < end {
            found.push((start, end, query_match.pattern_index, kind));
        }
    }
    // Outer spans first, then the inner ones on top; for the same node the later pattern wins.
    found.sort_by_key(|(start, end, pattern, _)| (*start, std::cmp::Reverse(*end), *pattern));
    let len = range.end - range.start;
    let mut paint: Vec<Option<SyntaxKind>> = vec![None; len];
    for (start, end, _, kind) in found {
        paint[start - range.start..end - range.start].fill(Some(kind));
    }
    paint_runs(range.start, &paint)
}

#[cfg(not(target_family = "wasm"))]
fn bracket_pair(kind: &str) -> Option<(&'static str, &'static str, bool)> {
    match kind {
        "(" => Some(("(", ")", true)),
        ")" => Some(("(", ")", false)),
        "[" => Some(("[", "]", true)),
        "]" => Some(("[", "]", false)),
        "{" => Some(("{", "}", true)),
        "}" => Some(("{", "}", false)),
        _ => None,
    }
}

#[cfg(not(target_family = "wasm"))]
fn is_open_bracket(kind: &str) -> bool {
    matches!(kind, "(" | "[" | "{")
}

#[cfg(not(target_family = "wasm"))]
fn collect_brackets(node: Node, range: &Range<usize>, depth: usize, out: &mut Vec<(usize, usize)>) {
    let count = node.child_count();
    let bearing = (0..count.min(3)).filter_map(|index| node.child(index)).any(|child| !child.is_named() && is_open_bracket(child.kind()));
    let inner = if bearing { depth + 1 } else { depth };
    let mut cursor = node.walk();
    if cursor.goto_first_child_for_byte(range.start).is_none() {
        return;
    }
    loop {
        let child = cursor.node();
        if child.start_byte() >= range.end {
            break;
        }
        if !child.is_named() && bracket_pair(child.kind()).is_some() {
            if child.start_byte() >= range.start {
                out.push((child.start_byte(), depth));
            }
        } else if child.child_count() > 0 && child.end_byte() > range.start {
            collect_brackets(child, range, inner, out);
        }
        if !cursor.goto_next_sibling() {
            break;
        }
    }
}

#[cfg(not(target_family = "wasm"))]
fn partner_in_parent(node: Node) -> Option<usize> {
    let (open, close, opening) = bracket_pair(node.kind())?;
    let parent = node.parent()?;
    let mut cursor = parent.walk();
    let siblings: Vec<Node> = parent.children(&mut cursor).collect();
    let position = siblings.iter().position(|sibling| sibling.id() == node.id())?;
    let mut depth = 0usize;
    if opening {
        for sibling in &siblings[position + 1..] {
            match sibling.kind() {
                kind if kind == open && !sibling.is_named() => depth += 1,
                kind if kind == close && !sibling.is_named() => {
                    if depth == 0 {
                        return Some(sibling.start_byte());
                    }
                    depth -= 1;
                }
                _ => {}
            }
        }
    } else {
        for sibling in siblings[..position].iter().rev() {
            match sibling.kind() {
                kind if kind == close && !sibling.is_named() => depth += 1,
                kind if kind == open && !sibling.is_named() => {
                    if depth == 0 {
                        return Some(sibling.start_byte());
                    }
                    depth -= 1;
                }
                _ => {}
            }
        }
    }
    None
}

/// What the editor names of tree-sitter, for the web build, which never has a tree.
#[cfg(target_family = "wasm")]
mod web {
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct Point {
        pub row: usize,
        pub column: usize,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct InputEdit {
        pub start_byte: usize,
        pub old_end_byte: usize,
        pub new_end_byte: usize,
        pub start_position: Point,
        pub old_end_position: Point,
        pub new_end_position: Point,
    }

    #[derive(Clone, Debug)]
    pub enum Language {}

    #[derive(Clone, Debug)]
    pub enum Tree {}

    impl Tree {
        pub fn edit(&mut self, _: &InputEdit) {
            match *self {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_files_detect_or_fall_back_to_the_default_language() {
        let name = |path: &str, text: &str, detect: bool, default: &str| resolve_language(Path::new(path), text, detect, default).name;
        assert_eq!(name("a.rs", "#!/bin/bash", true, "python"), "Rust");
        assert_eq!(name("run", "#!/usr/bin/env python3\nprint(1)", true, "auto"), "Python");
        assert_eq!(name("run", "#!/bin/sh -e\n", true, "auto"), "Shell");
        assert_eq!(name("data", "{\n  \"a\": 1\n}\n", true, "auto"), "JSON");
        assert_eq!(name("run", "#!/usr/bin/env python3", false, "auto"), "Plain Text");
        assert_eq!(name("notes", "hello", true, "rust"), "Rust");
        assert_eq!(name("notes", "hello", true, "auto"), "Plain Text");
        assert_eq!(name("notes", "#!/usr/bin/env node", true, "rust"), "JavaScript");
    }

    fn spans(path: &str, text: &str) -> Vec<(String, SyntaxKind)> {
        let rope = Rope::from_str(text);
        let mut state = SyntaxState::new(language_for_path(Path::new(path)));
        state.reparse_now(&rope);
        state.highlights(&rope, 0..text.len()).into_iter().map(|(range, kind)| (text[range].to_string(), kind)).collect()
    }

    #[test]
    fn capture_names_map_to_theme_keys() {
        assert_eq!(kind_for_capture("keyword.control.import"), Some(SyntaxKind::Keyword));
        assert_eq!(kind_for_capture("function.method"), Some(SyntaxKind::Function));
        assert_eq!(kind_for_capture("string.special.regex"), Some(SyntaxKind::Regex));
        assert_eq!(kind_for_capture("constant.builtin"), Some(SyntaxKind::Constant));
        assert_eq!(kind_for_capture("punctuation.bracket"), Some(SyntaxKind::Punctuation));
        assert_eq!(kind_for_capture("variable.builtin"), Some(SyntaxKind::Keyword));
        assert_eq!(kind_for_capture("injection.content"), None);
    }

    #[test]
    fn every_query_compiles() {
        for language in LANGUAGES.iter().filter(|language| language.has_grammar()) {
            assert!(language.highlight_query().is_some(), "{}", language.name);
        }
    }

    #[test]
    fn rust_highlights() {
        let found = spans("a.rs", "fn main() { let x = \"hi\"; } // done");
        assert!(found.contains(&("fn".into(), SyntaxKind::Keyword)), "{found:?}");
        assert!(found.contains(&("main".into(), SyntaxKind::Function)), "{found:?}");
        assert!(found.contains(&("\"hi\"".into(), SyntaxKind::String)), "{found:?}");
        assert!(found.contains(&("// done".into(), SyntaxKind::Comment)), "{found:?}");
    }

    #[test]
    fn typescript_highlights_later_patterns_win() {
        let found = spans("a.ts", "function greet(name: string) { return name; }");
        assert!(found.contains(&("greet".into(), SyntaxKind::Function)), "{found:?}");
        assert!(found.contains(&("string".into(), SyntaxKind::Type)), "{found:?}");
        assert!(found.contains(&("function".into(), SyntaxKind::Keyword)), "{found:?}");
    }

    #[test]
    fn brackets_nest_and_match() {
        let text = "fn f() { g(a[1]); }";
        let rope = Rope::from_str(text);
        let mut state = SyntaxState::new(language_for_path(Path::new("a.rs")));
        state.reparse_now(&rope);
        let depths = state.bracket_depths(0..text.len());
        let depth_at = |ch: usize| depths.iter().find(|(offset, _)| *offset == ch).map(|(_, depth)| *depth);
        assert_eq!(depth_at(7), Some(0)); // {
        assert_eq!(depth_at(10), Some(1)); // (
        assert_eq!(depth_at(12), Some(2)); // [
        assert_eq!(state.matching_bracket(7), Some((7, 18)));
        assert_eq!(state.matching_bracket(19), Some((18, 7)));
    }

    #[test]
    fn selection_expands_through_enclosing_nodes() {
        let text = "fn f() { g(a, b); }";
        let rope = Rope::from_str(text);
        let mut state = SyntaxState::new(language_for_path(Path::new("a.rs")));
        state.reparse_now(&rope);
        let a = text.find('a').unwrap();
        let first = state.enclosing_range(a..a + 1).unwrap();
        assert!(first.start <= a && first.end > a + 1, "{first:?}");
        let mut range = a..a + 1;
        let mut steps = 0;
        while let Some(next) = state.enclosing_range(range.clone()) {
            assert!(next.len() > range.len());
            range = next;
            steps += 1;
        }
        assert_eq!(range, 0..text.len());
        assert!(steps >= 3);
    }

    #[test]
    fn embedded_scripts_styles_and_templates() {
        let vue = "<template><div>{{ a }}</div></template>\n<script setup lang=\"ts\">\nconst n: number = 1\n</script>\n<style lang=\"scss\">$c: red;</style>";
        let found = spans("App.vue", vue);
        assert!(found.contains(&("div".into(), SyntaxKind::Tag)), "{found:?}");
        assert!(found.contains(&("const".into(), SyntaxKind::Keyword)), "{found:?}");
        assert!(found.contains(&("number".into(), SyntaxKind::Type)), "{found:?}");
        assert!(found.contains(&("$c".into(), SyntaxKind::Variable)), "{found:?}");
        let html = spans("a.html", "<script>let x = 'y'</script><style>a { color: red }</style>");
        assert!(html.contains(&("let".into(), SyntaxKind::Keyword)), "{html:?}");
        assert!(html.contains(&("'y'".into(), SyntaxKind::String)), "{html:?}");
        assert!(html.contains(&("color".into(), SyntaxKind::Property)), "{html:?}");
        let erb = spans("a.html.erb", "<p><%= user.name if true %></p><%# note %>");
        assert!(erb.contains(&("<%=".into(), SyntaxKind::Tag)), "{erb:?}");
        assert!(erb.contains(&("if".into(), SyntaxKind::Keyword)), "{erb:?}");
        assert!(erb.contains(&("true".into(), SyntaxKind::Boolean)), "{erb:?}");
        assert!(erb.contains(&("<%# note %>".into(), SyntaxKind::Comment)), "{erb:?}");
        let astro = spans("a.astro", "---\nconst a = 1\n---\n<h1>{a}</h1>");
        assert!(astro.contains(&("const".into(), SyntaxKind::Keyword)), "{astro:?}");
        assert!(astro.contains(&("h1".into(), SyntaxKind::Tag)), "{astro:?}");
    }

    #[test]
    fn languages_by_path() {
        assert_eq!(language_for_path(Path::new("a.ml")).name, "OCaml");
        assert_eq!(language_for_path(Path::new("a.fsx")).name, "F#");
        assert_eq!(language_for_path(Path::new("doc.tex")).name, "LaTeX");
        assert_eq!(language_for_path(Path::new("nginx.conf")).name, "Nginx");
        assert_eq!(language_for_path(Path::new("src/main.rs")).name, "Rust");
        assert_eq!(language_for_path(Path::new("App.TSX")).name, "TSX");
        assert_eq!(language_for_path(Path::new("Makefile")).line_comment, Some("#"));
        assert_eq!(language_for_path(Path::new("notes.txt")).name, "Plain Text");
    }
}
