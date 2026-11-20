//! What a search asks for: the pattern built from the query and its toggles, the include and
//! exclude path filters.

use regex::{Regex, RegexBuilder};

/// The toggles beside the query field.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
}

/// The pattern handed to the index, and whether it is a regular expression or plain text.
#[derive(Clone, Debug, PartialEq, Eq)]
#[derive(Default)]
pub struct GrepPattern {
    pub pattern: String,
    pub is_regex: bool,
    /// The query as typed, with its toggles: what other tools (remote `rg`/`grep`) search for.
    /// `pattern` is shaped for the index's query parser (`\x20`, `(?i:…)`) that only it reads.
    pub typed: Option<(String, SearchOptions)>,
}

/// Builds the index pattern the way the Tauri backend does: literals are escaped, whole words get
/// `\b` boundaries and case-insensitive searches an inline `(?i)` group. Only a case-sensitive
/// literal stays on the fast plain-text path.
pub fn grep_pattern(query: &str, options: SearchOptions) -> GrepPattern {
    let base = if options.use_regex { query.to_string() } else { regex::escape(query) };
    let bounded = if options.whole_word { format!(r"\b(?:{base})\b") } else { base };
    let pattern = if options.case_sensitive { bounded } else { format!("(?i:{bounded})") };
    // Always a regular expression, made safe from the index's query syntax: it splits on spaces
    // (`foo  bar` became `foo bar`, leading spaces went), and reads `!word` as an exclusion and
    // `/dir/` or `*.ext` as path filters. Spaces become `\x20` and a leading `!`, `/` or `*` or
    // a trailing `/` a class, so the text is searched as typed and Replace finds what was shown.
    GrepPattern { pattern: parser_safe(&pattern), is_regex: true, typed: Some((query.to_string(), options)) }
}

fn parser_safe(pattern: &str) -> String {
    let mut out = pattern.replace(' ', r"\x20").replace('\t', r"\t");
    for lead in ['!', '/'] {
        if out.starts_with(lead) {
            out = format!("[{lead}]{}", &out[1..]);
        }
    }
    if out.ends_with('/') && !out.ends_with("\\/") {
        out = format!("{}[/]", &out[..out.len() - 1]);
    }
    out
}

/// The expression replacements run with: the search pattern, with `^` and `$` at line bounds.
pub fn replacement_regex(query: &str, options: SearchOptions) -> Result<Regex, regex::Error> {
    let base = if options.use_regex { query.to_string() } else { regex::escape(query) };
    let pattern = if options.whole_word { format!(r"\b(?:{base})\b") } else { base };
    RegexBuilder::new(&pattern).case_insensitive(!options.case_sensitive).multi_line(true).build()
}

/// Why a regular expression cannot be used, or `None` when it compiles (or regex is off).
pub fn regex_error(query: &str, options: SearchOptions) -> Option<String> {
    if !options.use_regex || query.is_empty() {
        return None;
    }
    Regex::new(query).err().map(|error| match error {
        regex::Error::Syntax(message) => message.lines().last().unwrap_or("Invalid regular expression").trim().to_string(),
        _ => "Invalid regular expression".into(),
    })
}

enum PathMatcher {
    Pattern(Regex),
    Substring(String),
}

impl PathMatcher {
    fn matches(&self, path: &str, lower: &str) -> bool {
        match self {
            PathMatcher::Pattern(regex) => regex.is_match(path),
            PathMatcher::Substring(text) => lower.contains(text.as_str()),
        }
    }
}

/// The "files to include" and "files to exclude" fields: comma or newline separated globs,
/// matched case-insensitively against the path relative to its project root. A glob without
/// wildcards matches anywhere in the path (`src` keeps everything under any `src`); one with
/// wildcards must match through the end of the path (`*.ts` does not keep `.tsx` files).
#[derive(Default)]
pub struct PathFilter {
    include: Vec<PathMatcher>,
    exclude: Vec<PathMatcher>,
}

impl PathFilter {
    pub fn new(include: &str, exclude: &str) -> Self {
        Self { include: compile_globs(include), exclude: compile_globs(exclude) }
    }

    pub fn is_empty(&self) -> bool {
        self.include.is_empty() && self.exclude.is_empty()
    }

    pub fn matches(&self, relative_path: &str) -> bool {
        let path = relative_path.replace('\\', "/");
        let lower = path.to_lowercase();
        let any = |matchers: &[PathMatcher]| matchers.iter().any(|matcher| matcher.matches(&path, &lower));
        (self.include.is_empty() || any(&self.include)) && !any(&self.exclude)
    }
}

fn compile_globs(query: &str) -> Vec<PathMatcher> {
    query
        .split([',', '\n'])
        .map(str::trim)
        .filter(|glob| !glob.is_empty())
        .map(|glob| {
            glob_regex(glob)
                .map(PathMatcher::Pattern)
                .unwrap_or_else(|| PathMatcher::Substring(glob.to_lowercase()))
        })
        .collect()
}

fn glob_regex(glob: &str) -> Option<Regex> {
    if !glob.contains(['*', '?']) {
        return None;
    }
    let mut source = String::new();
    let mut chars = glob.chars().peekable();
    while let Some(char) = chars.next() {
        match char {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                // `**/` also matches no directory at all.
                if chars.peek() == Some(&'/') {
                    chars.next();
                    source.push_str("(?:.*/)?");
                } else {
                    source.push_str(".*");
                }
            }
            '*' => source.push_str("[^/]*"),
            '?' => source.push_str("[^/]"),
            char => source.push_str(&regex::escape(&char.to_string())),
        }
    }
    source.push('$');
    RegexBuilder::new(&source).case_insensitive(true).build().ok()
}

/// "1 result in 1 file", "12 results in 3 files", "2000+ results in 40 files".
pub fn summary(matches: usize, files: usize, more: bool) -> String {
    let results = if matches == 1 && !more { "result" } else { "results" };
    let file_word = if files == 1 { "file" } else { "files" };
    format!("{matches}{} {results} in {files} {file_word}", if more { "+" } else { "" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(case_sensitive: bool, whole_word: bool, use_regex: bool) -> SearchOptions {
        SearchOptions { case_sensitive, whole_word, use_regex }
    }

    #[test]
    fn case_sensitive_literals_stay_plain_text() {
        // Escaped as a literal; regex mode keeps the index's query syntax out of the way.
        let pattern = grep_pattern("value.*", options(true, false, false));
        assert_eq!(pattern, GrepPattern { pattern: r"value\.\*".into(), is_regex: true, typed: Some(("value.*".into(), options(true, false, false))) });
    }

    #[test]
    fn spaces_bangs_and_slashes_are_searched_as_typed() {
        assert_eq!(grep_pattern("    return x", options(true, false, false)).pattern, r"\x20\x20\x20\x20return\x20x");
        assert_eq!(grep_pattern("!important", options(true, false, false)).pattern, "[!]important");
        assert_eq!(grep_pattern("/api/", options(true, false, false)).pattern, "[/]api[/]");
        let regex = regex::Regex::new(&grep_pattern("a  b", options(true, false, false)).pattern).unwrap();
        assert!(regex.is_match("a  b") && !regex.is_match("a b"));
    }

    #[test]
    fn insensitive_literals_are_escaped_into_an_inline_group() {
        let pattern = grep_pattern("value.*", options(false, false, false));
        assert_eq!(pattern, GrepPattern { pattern: r"(?i:value\.\*)".into(), is_regex: true, typed: Some(("value.*".into(), options(false, false, false))) });
    }

    #[test]
    fn whole_words_get_boundaries() {
        let pattern = grep_pattern("foo", options(true, true, false));
        assert_eq!(pattern.pattern, r"\b(?:foo)\b");
        assert!(pattern.is_regex);
        assert_eq!(grep_pattern("a|b", options(true, false, true)).pattern, "a|b");
    }

    #[test]
    fn replacement_regex_follows_the_toggles() {
        let regex = replacement_regex("Foo", options(false, true, false)).unwrap();
        assert!(regex.is_match("a foo b"));
        assert!(!regex.is_match("foobar"));
        let regex = replacement_regex("^x", options(true, false, true)).unwrap();
        assert_eq!(regex.find_iter("x\nx\n").count(), 2);
        assert!(replacement_regex("(", options(true, false, true)).is_err());
    }

    #[test]
    fn reports_invalid_expressions_only_in_regex_mode() {
        assert!(regex_error("(", options(false, false, true)).is_some());
        assert!(regex_error("(", options(false, false, false)).is_none());
        assert!(regex_error("a+", options(false, false, true)).is_none());
    }

    #[test]
    fn path_filters_include_then_exclude() {
        let filter = PathFilter::new("*.rs, docs", "target/**");
        assert!(filter.matches("src/main.rs"));
        assert!(filter.matches("Docs/guide.md"));
        assert!(!filter.matches("src/main.rsx"));
        assert!(!filter.matches("target/debug/build.rs"));
        assert!(!filter.matches("README.md"));
        assert!(PathFilter::new(" , ", "").is_empty());
        let nested = PathFilter::new("src/**/*.ts", "");
        assert!(nested.matches("src/a/b/c.ts"));
        assert!(nested.matches("src/c.ts"));
        assert!(!nested.matches("lib/c.ts"));
    }

    #[test]
    fn summaries_pluralise() {
        assert_eq!(summary(1, 1, false), "1 result in 1 file");
        assert_eq!(summary(12, 3, true), "12+ results in 3 files");
    }
}
