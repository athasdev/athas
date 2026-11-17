//! Find in the buffer: plain or regex queries, case and whole-word options.

use std::ops::Range;

use regex::{Regex, RegexBuilder};

/// More matches than this are not counted (the find bar shows "10000+").
pub const MAX_MATCHES: usize = 10_000;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

/// A compiled query; `None` for an empty query, `Err` for an invalid regex.
pub fn compile(query: &str, options: &SearchOptions) -> Option<Result<Regex, String>> {
    if query.is_empty() {
        return None;
    }
    let pattern = if options.regex { query.to_string() } else { regex::escape(query) };
    let pattern = if options.whole_word { format!(r"\b(?:{pattern})\b") } else { pattern };
    Some(
        RegexBuilder::new(&pattern)
            .case_insensitive(!options.case_sensitive)
            .multi_line(true)
            .build()
            .map_err(|error| error.to_string()),
    )
}

/// Every non-empty match, up to `MAX_MATCHES`.
pub fn find_all(regex: &Regex, text: &str) -> (Vec<Range<usize>>, bool) {
    let mut matches = Vec::new();
    for found in regex.find_iter(text) {
        if found.is_empty() {
            continue;
        }
        if matches.len() == MAX_MATCHES {
            return (matches, true);
        }
        matches.push(found.range());
    }
    (matches, false)
}

/// The replacement for the match at `range` of `text`: regex queries expand `$1` groups. The
/// groups come from matching in the whole text, so a pattern that looks around the match (`\b`,
/// `\B`, `^`) finds the same groups it found when searching.
pub fn replacement(regex: &Regex, options: &SearchOptions, text: &str, range: std::ops::Range<usize>, replace: &str) -> String {
    if !options.regex {
        return replace.to_string();
    }
    let mut out = String::new();
    match regex.captures_at(text, range.start).filter(|captures| captures.get(0).is_some_and(|whole| whole.range() == range)) {
        Some(captures) => {
            captures.expand(replace, &mut out);
            out
        }
        None => replace.to_string(),
    }
}

/// Every non-empty match, with no cap: Replace All changes all of them.
pub fn find_every(regex: &Regex, text: &str) -> Vec<Range<usize>> {
    regex.find_iter(text).filter(|found| !found.is_empty()).map(|found| found.range()).collect()
}

/// Whole-word occurrences of `word` in `text`, offset by `base`.
pub fn word_occurrences(text: &str, base: usize, word: &str) -> Vec<Range<usize>> {
    if word.is_empty() {
        return Vec::new();
    }
    let is_word = |ch: char| crate::buffer::is_word_char(ch);
    text.match_indices(word)
        .filter(|(index, _)| {
            let before = text[..*index].chars().next_back();
            let after = text[index + word.len()..].chars().next();
            !before.is_some_and(is_word) && !after.is_some_and(is_word)
        })
        .map(|(index, _)| base + index..base + index + word.len())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_queries_are_literal_and_case_insensitive() {
        let regex = compile("a.b", &SearchOptions::default()).unwrap().unwrap();
        assert_eq!(find_all(&regex, "a.b axb A.B").0, vec![0..3, 8..11]);
    }

    #[test]
    fn whole_word_and_case() {
        let options = SearchOptions { case_sensitive: true, whole_word: true, regex: false };
        let regex = compile("foo", &options).unwrap().unwrap();
        assert_eq!(find_all(&regex, "foo foobar Foo foo").0, vec![0..3, 15..18]);
    }

    #[test]
    fn regex_replacement_expands_groups() {
        let options = SearchOptions { regex: true, ..Default::default() };
        let regex = compile(r"(\w+)@(\w+)", &options).unwrap().unwrap();
        assert_eq!(replacement(&regex, &options, "me@host", 0..7, "$2/$1"), "host/me");
        // Groups come from the match in its text, so patterns that look around it still expand.
        let around = Regex::new(r"\B(\w)").unwrap();
        assert_eq!(replacement(&around, &options, "ab", 1..2, "[$1]"), "[b]");
        assert!(compile("(", &options).unwrap().is_err());
    }

    #[test]
    fn occurrences_respect_word_boundaries() {
        assert_eq!(word_occurrences("x xy x_ x", 10, "x"), vec![10..11, 18..19]);
    }
}
