//! Completion matching and snippets, without a window: fuzzy filtering of the server's items by
//! the word being typed, and the subset of the LSP snippet grammar that tab stops need.

use std::ops::Range;

/// How well `candidate` matches the typed `query`, or `None` when it does not contain the query's
/// characters in order. Higher is better: a prefix, consecutive runs and word starts score.
pub fn fuzzy_score(query: &str, candidate: &str) -> Option<i32> {
    if query.is_empty() {
        return Some(0);
    }
    let candidate_chars: Vec<char> = candidate.chars().collect();
    let mut score = 0;
    let mut position = 0;
    let mut previous_match: Option<usize> = None;
    for (index, wanted) in query.chars().enumerate() {
        let wanted_lower = wanted.to_lowercase().next().unwrap_or(wanted);
        let found = (position..candidate_chars.len()).find(|at| candidate_chars[*at].to_lowercase().next() == Some(wanted_lower))?;
        let ch = candidate_chars[found];
        score += 1;
        if ch == wanted {
            score += 1;
        }
        if found == index && previous_match.is_none_or(|previous| previous + 1 == found) {
            // Still matching the start of the candidate.
            score += 6;
        } else if previous_match.is_some_and(|previous| previous + 1 == found) {
            score += 4;
        } else {
            let before = found.checked_sub(1).map(|at| candidate_chars[at]);
            let boundary = before.is_none_or(|before| !before.is_alphanumeric() || (before.is_lowercase() && ch.is_uppercase()));
            if boundary {
                score += 3;
            }
            score -= (found - position).min(5) as i32;
        }
        previous_match = Some(found);
        position = found + 1;
    }
    // Shorter candidates win ties.
    score -= (candidate_chars.len().saturating_sub(query.chars().count()) as i32).min(10) / 3;
    Some(score)
}

/// One item as the menu filters it.
pub struct Candidate<'a> {
    pub filter_text: &'a str,
    pub sort_text: &'a str,
}

/// The indices of the candidates that match `query`, best first; the server's sort text breaks
/// ties.
pub fn filter(query: &str, candidates: &[Candidate]) -> Vec<usize> {
    let mut matched: Vec<(usize, i32)> =
        candidates.iter().enumerate().filter_map(|(index, candidate)| Some((index, fuzzy_score(query, candidate.filter_text)?))).collect();
    if query.is_empty() {
        matched.sort_by(|a, b| candidates[a.0].sort_text.cmp(candidates[b.0].sort_text));
    } else {
        matched.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| candidates[a.0].sort_text.cmp(candidates[b.0].sort_text)));
    }
    matched.into_iter().map(|(index, _)| index).collect()
}

/// A snippet expanded to plain text with its tab stops (byte ranges in the text). Stops are
/// ordered `$1`, `$2`, …, with `$0` (or the end) last; a stop may appear several times.
#[derive(Clone, Debug, PartialEq)]
pub struct Snippet {
    pub text: String,
    pub stops: Vec<Vec<Range<usize>>>,
}

/// Parses `$1`, `${1}`, `${1:default}`, `${1|one,two|}` (the first choice), variables (left empty
/// or with their default) and `\$`, `\}`, `\\` escapes.
pub fn parse_snippet(source: &str) -> Snippet {
    let mut text = String::new();
    let mut stops: Vec<(usize, Range<usize>)> = Vec::new();
    let chars: Vec<char> = source.chars().collect();
    parse_into(&chars, &mut 0, &mut text, &mut stops, false);
    let mut indices: Vec<usize> = stops.iter().map(|(index, _)| *index).collect();
    indices.sort_unstable();
    indices.dedup();
    // `$0` is the final stop.
    if let Some(zero) = indices.iter().position(|index| *index == 0) {
        indices.remove(zero);
        indices.push(0);
    }
    let mut grouped: Vec<Vec<Range<usize>>> =
        indices.iter().map(|index| stops.iter().filter(|(other, _)| other == index).map(|(_, range)| range.clone()).collect()).collect();
    if !indices.contains(&0) {
        grouped.push(vec![text.len()..text.len()]);
    }
    Snippet { text, stops: grouped }
}

fn parse_into(chars: &[char], at: &mut usize, text: &mut String, stops: &mut Vec<(usize, Range<usize>)>, nested: bool) {
    while *at < chars.len() {
        let ch = chars[*at];
        match ch {
            '\\' if *at + 1 < chars.len() && matches!(chars[*at + 1], '$' | '}' | '\\' | ',' | '|') => {
                text.push(chars[*at + 1]);
                *at += 2;
            }
            '}' if nested => return,
            '$' => {
                *at += 1;
                if *at < chars.len() && chars[*at].is_ascii_digit() {
                    let index = read_number(chars, at);
                    stops.push((index, text.len()..text.len()));
                } else if *at < chars.len() && chars[*at] == '{' {
                    *at += 1;
                    if *at < chars.len() && chars[*at].is_ascii_digit() {
                        let index = read_number(chars, at);
                        let start = text.len();
                        match chars.get(*at) {
                            Some(':') => {
                                *at += 1;
                                parse_into(chars, at, text, stops, true);
                            }
                            Some('|') => {
                                *at += 1;
                                let mut first = String::new();
                                let mut in_first = true;
                                while *at < chars.len() && chars[*at] != '|' {
                                    match chars[*at] {
                                        '\\' if *at + 1 < chars.len() => {
                                            if in_first {
                                                first.push(chars[*at + 1]);
                                            }
                                            *at += 2;
                                            continue;
                                        }
                                        ',' => in_first = false,
                                        other if in_first => first.push(other),
                                        _ => {}
                                    }
                                    *at += 1;
                                }
                                *at += 1;
                                text.push_str(&first);
                            }
                            _ => {}
                        }
                        // Skip to the closing brace.
                        while *at < chars.len() && chars[*at] != '}' {
                            *at += 1;
                        }
                        *at += 1;
                        stops.push((index, start..text.len()));
                    } else {
                        // A variable: `${NAME}` or `${NAME:default}`; only the default is kept.
                        while *at < chars.len() && (chars[*at].is_alphanumeric() || chars[*at] == '_') {
                            *at += 1;
                        }
                        if chars.get(*at) == Some(&':') {
                            *at += 1;
                            parse_into(chars, at, text, stops, true);
                        }
                        while *at < chars.len() && chars[*at] != '}' {
                            *at += 1;
                        }
                        *at += 1;
                    }
                } else if *at < chars.len() && (chars[*at].is_alphabetic() || chars[*at] == '_') {
                    while *at < chars.len() && (chars[*at].is_alphanumeric() || chars[*at] == '_') {
                        *at += 1;
                    }
                } else {
                    text.push('$');
                }
            }
            _ => {
                text.push(ch);
                *at += 1;
            }
        }
    }
}

fn read_number(chars: &[char], at: &mut usize) -> usize {
    let mut value = 0usize;
    while *at < chars.len() && chars[*at].is_ascii_digit() {
        value = value * 10 + chars[*at].to_digit(10).unwrap_or(0) as usize;
        *at += 1;
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidates<'a>(labels: &'a [&'a str]) -> Vec<Candidate<'a>> {
        labels.iter().map(|label| Candidate { filter_text: label, sort_text: label }).collect()
    }

    #[test]
    fn fuzzy_matching_prefers_prefixes_and_word_starts() {
        assert!(fuzzy_score("vec", "Vec").is_some());
        assert!(fuzzy_score("xyz", "Vec").is_none());
        assert!(fuzzy_score("ps", "push_str").unwrap() > fuzzy_score("ps", "apps").unwrap());
        let labels = ["to_string", "as_str", "into_iter", "to_owned", "trim_start"];
        let items = candidates(&labels);
        let order: Vec<&str> = filter("to", &items).into_iter().map(|index| labels[index]).collect();
        assert_eq!(&order[..2], ["to_owned", "to_string"]);
        assert!(!order.contains(&"as_str"));
        // Without a query the server's order stands.
        assert_eq!(filter("", &items).len(), labels.len());
    }

    #[test]
    fn snippets_expand_with_tab_stops() {
        let snippet = parse_snippet("fn ${1:name}(${2}) {\n\t$0\n}");
        assert_eq!(snippet.text, "fn name() {\n\t\n}");
        assert_eq!(snippet.stops, vec![vec![3..7], vec![8..8], vec![13..13]]);

        let snippet = parse_snippet("println!(\"$1\", $1)");
        assert_eq!(snippet.text, "println!(\"\", )");
        assert_eq!(snippet.stops, vec![vec![10..10, 13..13], vec![14..14]]);

        let snippet = parse_snippet("${1|let,const|} ${2:x} = \\$5; ${TM_SELECTED_TEXT:sel}$TM_FILENAME");
        assert_eq!(snippet.text, "let x = $5; sel");
        assert_eq!(snippet.stops[0], vec![0..3]);
        assert_eq!(snippet.stops[1], vec![4..5]);
        assert_eq!(snippet.stops.last(), Some(&vec![15..15]));

        let nested = parse_snippet("${1:outer ${2:inner}}");
        assert_eq!(nested.text, "outer inner");
        assert_eq!(nested.stops, vec![vec![0..11], vec![6..11], vec![11..11]]);
    }
}
