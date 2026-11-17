//! The small helpers of `src/utils` that features share and the GPUI crates did not have yet:
//! date formatting (`date.ts`), search text matching (`search-match.ts`), find-in-text
//! (`text-search.ts`), frecency (`frecency.ts`) and `capitalize.ts`.

pub mod date;
pub mod search_match;
pub mod text_search;

/// The first character upper-cased (`capitalize`).
pub fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// `calculateFrecencyScore`: frequency (logarithmic) and recency (halving every 7 days) mixed
/// 70/30, scaled to 0–100.
pub fn frecency_score(access_count: u32, days_since_access: f64) -> f64 {
    const HALF_LIFE_DAYS: f64 = 7.;
    const FREQUENCY_WEIGHT: f64 = 0.7;
    let frequency = (access_count as f64 + 1.).log10();
    let recency = (-(2f64.ln() / HALF_LIFE_DAYS) * days_since_access).exp();
    ((FREQUENCY_WEIGHT * frequency + (1. - FREQUENCY_WEIGHT) * recency) * 100.).min(100.)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capitalizes_the_first_character() {
        assert_eq!(capitalize("error"), "Error");
        assert_eq!(capitalize("éa"), "Éa");
        assert_eq!(capitalize(""), "");
    }

    #[test]
    fn frecency_weighs_frequency_and_recency() {
        assert!((frecency_score(0, 0.) - 30.).abs() < 1e-9);
        assert!((frecency_score(9, 7.) - (70. + 15.)).abs() < 1e-9);
        assert_eq!(frecency_score(1_000_000, 0.), 100.);
        assert!(frecency_score(3, 1.) > frecency_score(3, 30.));
    }
}
