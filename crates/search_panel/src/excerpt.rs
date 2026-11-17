//! A file's matches as an excerpt: each match line with lines of context around it, overlapping
//! stretches merged and a `...` line between the rest (`utils/search-excerpts` of Athas).

use std::ops::Range;

use crate::engine::FileMatches;

/// Lines around each match by default (`CONTEXT_LINES`).
pub const CONTEXT_LINES: u32 = 2;
/// Lines around each match once a file's context is expanded (`EXPANDED_CONTEXT_LINES`).
pub const EXPANDED_CONTEXT_LINES: u32 = 7;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExcerptLine {
    /// Lines left out between two stretches.
    Gap,
    Line {
        /// 1-based.
        number: u32,
        text: String,
        /// Byte ranges of the matches on a match line.
        ranges: Vec<Range<usize>>,
        /// The index in the file's matches, on a match line.
        found: Option<usize>,
    },
}

/// The excerpt of `file`. Context comes from `source` (the file's lines); without it only the
/// match lines show.
pub fn build(file: &FileMatches, source: Option<&[String]>, context: u32) -> Vec<ExcerptLine> {
    let total = source.map_or(0, |lines| lines.len() as u32);
    let mut stretches: Vec<Range<u32>> = file
        .matches
        .iter()
        .map(|found| match source {
            Some(_) => found.line.saturating_sub(context).max(1)..(found.line + context).min(total.max(found.line)) + 1,
            None => found.line..found.line + 1,
        })
        .collect();
    stretches.sort_by_key(|stretch| stretch.start);
    let mut merged: Vec<Range<u32>> = Vec::new();
    for stretch in stretches {
        match merged.last_mut() {
            Some(last) if stretch.start <= last.end => last.end = last.end.max(stretch.end),
            _ => merged.push(stretch),
        }
    }
    let mut lines = Vec::new();
    for (index, stretch) in merged.into_iter().enumerate() {
        if index > 0 {
            lines.push(ExcerptLine::Gap);
        }
        for number in stretch {
            let found = file.matches.iter().position(|found| found.line == number);
            let text = match (found, source) {
                (Some(found), _) => file.matches[found].text.clone(),
                (None, Some(source)) => source.get(number as usize - 1).cloned().unwrap_or_default(),
                (None, None) => String::new(),
            };
            let ranges = found
                .map(|found| {
                    file.matches[found]
                        .ranges
                        .iter()
                        .map(|&(start, end)| start as usize..(end as usize).max(start as usize + 1))
                        .filter(|range| range.end <= text.len())
                        .collect()
                })
                .unwrap_or_default();
            lines.push(ExcerptLine::Line { number, text, ranges, found });
        }
    }
    lines
}

/// The excerpt line each match is on.
pub fn match_lines(lines: &[ExcerptLine], matches: usize) -> Vec<usize> {
    let mut out = vec![0; matches];
    for (index, line) in lines.iter().enumerate() {
        if let ExcerptLine::Line { found: Some(found), .. } = line
            && let Some(slot) = out.get_mut(*found)
        {
            *slot = index;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::engine::LineMatch;

    fn file(lines: &[u32]) -> FileMatches {
        FileMatches {
            path: PathBuf::from("/p/a.rs"),
            relative: "a.rs".into(),
            matches: lines.iter().map(|&line| LineMatch { line, column: 0, text: format!("hit {line}"), ranges: vec![(0, 3)] }).collect(),
        }
    }

    fn numbers(lines: &[ExcerptLine]) -> Vec<Option<u32>> {
        lines.iter().map(|line| match line { ExcerptLine::Gap => None, ExcerptLine::Line { number, .. } => Some(*number) }).collect()
    }

    #[test]
    fn merges_context_and_marks_gaps() {
        let source: Vec<String> = (1..=30).map(|n| format!("line {n}")).collect();
        let lines = build(&file(&[2, 5, 20]), Some(&source), CONTEXT_LINES);
        assert_eq!(numbers(&lines), [Some(1), Some(2), Some(3), Some(4), Some(5), Some(6), Some(7), None, Some(18), Some(19), Some(20), Some(21), Some(22)]);
        assert_eq!(lines[1], ExcerptLine::Line { number: 2, text: "hit 2".into(), ranges: vec![0..3], found: Some(0) });
        assert_eq!(lines[0], ExcerptLine::Line { number: 1, text: "line 1".into(), ranges: vec![], found: None });
        assert_eq!(match_lines(&lines, 3), [1, 4, 10]);
        let wide = build(&file(&[29]), Some(&source), EXPANDED_CONTEXT_LINES);
        assert_eq!(numbers(&wide).first(), Some(&Some(22)));
        assert_eq!(numbers(&wide).last(), Some(&Some(30)));
    }

    #[test]
    fn shows_match_lines_alone_without_the_source() {
        let lines = build(&file(&[3, 4, 9]), None, CONTEXT_LINES);
        assert_eq!(numbers(&lines), [Some(3), Some(4), None, Some(9)]);
    }
}
