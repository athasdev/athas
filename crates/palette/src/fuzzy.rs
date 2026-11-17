/// Where a query matched a candidate, and how well.
#[derive(Clone, Debug, PartialEq)]
pub struct FuzzyMatch {
    pub score: i64,
    /// Byte offsets of the matched characters in the candidate.
    pub positions: Vec<usize>,
}

/// Matches `query` as a subsequence of `candidate`, ignoring case. Consecutive characters, word
/// starts and an early first match score higher; `None` when some query character is missing.
pub fn fuzzy_match(query: &str, candidate: &str) -> Option<FuzzyMatch> {
    let query: Vec<char> = query.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect();
    if query.is_empty() {
        return Some(FuzzyMatch { score: 0, positions: Vec::new() });
    }
    let mut positions = Vec::with_capacity(query.len());
    let mut score = 0i64;
    let mut next = 0;
    let mut previous_matched: Option<usize> = None;
    let mut previous_char: Option<char> = None;
    for (index, (offset, character)) in candidate.char_indices().enumerate() {
        if next == query.len() {
            break;
        }
        let lower = character.to_lowercase().next().unwrap_or(character);
        if lower == query[next] {
            let word_start = previous_char.is_none_or(|p| !p.is_alphanumeric() || (p.is_lowercase() && character.is_uppercase()));
            score += 10;
            if word_start {
                score += 15;
            }
            if previous_matched == Some(index.wrapping_sub(1)) {
                score += 20;
            }
            if positions.is_empty() {
                score -= index.min(30) as i64;
            }
            positions.push(offset);
            previous_matched = Some(index);
            next += 1;
        }
        previous_char = Some(character);
    }
    (next == query.len()).then(|| FuzzyMatch { score: score - candidate.len() as i64 / 8, positions })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_subsequences_and_prefers_word_starts() {
        assert!(fuzzy_match("tgs", "Toggle Sidebar").is_some());
        assert!(fuzzy_match("xyz", "Toggle Sidebar").is_none());
        let word = fuzzy_match("ts", "Toggle Sidebar").unwrap().score;
        let middle = fuzzy_match("ts", "Cut Selection").unwrap().score;
        assert!(word > middle, "{word} {middle}");
    }

    #[test]
    fn empty_query_matches_everything() {
        assert_eq!(fuzzy_match("", "anything").unwrap().score, 0);
    }
}
