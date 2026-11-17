//! Find in text (`text-search.ts`): the pattern a query and its options make, and the matches it
//! finds, as byte ranges.

use std::ops::Range;

use regex::{Regex, RegexBuilder};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
}

/// The pattern for `query`, or `None` when it is empty or not a valid expression.
pub fn build_search_regex(query: &str, options: SearchOptions) -> Option<Regex> {
    if query.is_empty() {
        return None;
    }
    let mut pattern = if options.use_regex { query.to_string() } else { regex::escape(query) };
    if options.whole_word {
        pattern = format!(r"\b{pattern}\b");
    }
    RegexBuilder::new(&pattern).case_insensitive(!options.case_sensitive).build().ok()
}

/// At most `limit` matches, and whether more were left out (`findLimitedMatches`).
pub fn find_limited_matches(content: &str, regex: &Regex, limit: usize) -> (Vec<Range<usize>>, bool) {
    let mut matches: Vec<Range<usize>> = regex.find_iter(content).take(limit + 1).map(|found| found.range()).collect();
    let limited = matches.len() > limit;
    matches.truncate(limit);
    (matches, limited)
}

/// The byte range lines `start_line..end_line` cover, given each line's starting offset
/// (`getSearchViewportOffsetRange`).
pub fn viewport_offset_range(line_offsets: &[usize], content_len: usize, start_line: usize, end_line: usize) -> Range<usize> {
    let start_line = start_line.min(line_offsets.len());
    let end_line = end_line.min(line_offsets.len()).max(start_line);
    let start = line_offsets.get(start_line).copied().unwrap_or(0);
    let end = if end_line >= line_offsets.len() { content_len } else { line_offsets[end_line] };
    start..end
}

/// The sorted matches that overlap `range`, with their indices (`getSearchMatchesInOffsetRange`).
pub fn matches_in_range(matches: &[Range<usize>], range: &Range<usize>) -> Vec<(usize, Range<usize>)> {
    let first = matches.partition_point(|found| found.end <= range.start);
    matches[first..]
        .iter()
        .enumerate()
        .take_while(|(_, found)| found.start < range.end)
        .filter(|(_, found)| found.end > range.start)
        .map(|(offset, found)| (first + offset, found.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_patterns_from_the_options() {
        let plain = build_search_regex("a.b", SearchOptions::default()).unwrap();
        assert!(plain.is_match("A.B") && !plain.is_match("axb"));
        let regex = build_search_regex("a.b", SearchOptions { use_regex: true, case_sensitive: true, ..Default::default() }).unwrap();
        assert!(regex.is_match("axb") && !regex.is_match("AXB"));
        let word = build_search_regex("cat", SearchOptions { whole_word: true, ..Default::default() }).unwrap();
        assert!(word.is_match("a cat sat") && !word.is_match("concatenate"));
        assert!(build_search_regex("", SearchOptions::default()).is_none());
        assert!(build_search_regex("(", SearchOptions { use_regex: true, ..Default::default() }).is_none());
    }

    #[test]
    fn finds_limited_matches_and_those_in_view() {
        let content = "one two one\nthree one\nfour";
        let regex = build_search_regex("one", SearchOptions::default()).unwrap();
        let (all, limited) = find_limited_matches(content, &regex, 10);
        assert_eq!((all.len(), limited), (3, false));
        let (two, limited) = find_limited_matches(content, &regex, 2);
        assert_eq!((two.len(), limited), (2, true));
        let offsets = [0, 12, 22];
        let second_line = viewport_offset_range(&offsets, content.len(), 1, 2);
        assert_eq!(second_line, 12..22);
        assert_eq!(viewport_offset_range(&offsets, content.len(), 2, 9), 22..content.len());
        assert_eq!(matches_in_range(&all, &second_line), vec![(2, 18..21)]);
        assert_eq!(matches_in_range(&all, &(0..12)).len(), 2);
    }
}
