//! Loose matching for search fields (`search-match.ts`): accents and punctuation fall away, so
//! "cafe" finds "Café" and "gitbranch" finds "Git: Branch".

use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

/// Lower-cased, without accents, with runs of anything but letters and digits as one space.
pub fn normalize_search_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut pending_space = false;
    for char in value.nfkd().filter(|char| !is_combining_mark(*char)).flat_map(char::to_lowercase) {
        if char.is_ascii_lowercase() || char.is_ascii_digit() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(char);
        } else {
            pending_space = true;
        }
    }
    out
}

/// [`normalize_search_text`] without the spaces.
pub fn compact_search_text(value: &str) -> String {
    normalize_search_text(value).replace(' ', "")
}

fn includes(value: &str, normalized_query: &str, compact_query: &str) -> bool {
    normalize_search_text(value).contains(normalized_query) || compact_search_text(value).contains(compact_query)
}

/// Whether any candidate contains the query; an empty query matches everything.
pub fn matches_search_query<'a>(query: &str, candidates: impl IntoIterator<Item = Option<&'a str>>) -> bool {
    let normalized = normalize_search_text(query);
    if normalized.is_empty() {
        return true;
    }
    let compact = compact_search_text(query);
    candidates.into_iter().flatten().any(|candidate| includes(candidate, &normalized, &compact))
}

/// `scoreSearchQuery`: every word of the query must appear in some field; each field it appears
/// in adds that field's weight. 0 when a word is missing or the query is empty.
pub fn score_search_query(query: &str, fields: &[(&str, f64)]) -> f64 {
    let normalized = normalize_search_text(query);
    let tokens: Vec<&str> = normalized.split(' ').filter(|token| !token.is_empty()).collect();
    if tokens.is_empty() {
        return 0.;
    }
    let mut score = 0.;
    for token in tokens {
        let compact = compact_search_text(token);
        let mut matched = false;
        for (value, weight) in fields {
            if includes(value, token, &compact) {
                matched = true;
                score += weight;
            }
        }
        if !matched {
            return 0.;
        }
    }
    score
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_like_the_web_helper() {
        assert_eq!(normalize_search_text("  Café — Crème_Brûlée! "), "cafe creme brulee");
        assert_eq!(compact_search_text("Git: Branch"), "gitbranch");
        assert_eq!(normalize_search_text("ﬁle"), "file");
    }

    #[test]
    fn matches_and_scores() {
        assert!(matches_search_query("cafe", [Some("Café au lait")]));
        assert!(matches_search_query("gitbranch", [None, Some("Git: Branch")]));
        assert!(matches_search_query("  ", [None]));
        assert!(!matches_search_query("zed", [Some("Athas")]));
        assert_eq!(score_search_query("font size", &[("Editor font size", 2.), ("Font", 1.)]), 2. + 1. + 2.);
        assert_eq!(score_search_query("font zoom", &[("Editor font size", 2.)]), 0.);
        assert_eq!(score_search_query("", &[("x", 1.)]), 0.);
    }
}
