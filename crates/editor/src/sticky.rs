//! Sticky scroll (`features/editor` sticky-scroll in Athas): the headers of the scopes around the
//! top of the viewport stay pinned above the text, outermost first.

use crate::folding::FoldRange;

/// At most this many headers stick.
pub const MAX_STICKY_LINES: usize = 5;

/// Whether a header line is a comment (comment blocks fold but never stick).
fn is_comment(text: &str) -> bool {
    let text = text.trim_start();
    ["//", "/*", "*", "#", "<!--", "--", ";"].iter().any(|prefix| text.starts_with(prefix))
}

/// The header lines to pin. `line_below(count)` is the line drawn in the first row under
/// `count` pinned lines; a scope's header sticks while that line is inside the scope (its
/// closing line included).
pub fn sticky_lines(ranges: &[FoldRange], header_text: impl Fn(usize) -> String, line_below: impl Fn(usize) -> usize, max: usize) -> Vec<usize> {
    let mut stack: Vec<FoldRange> = Vec::new();
    while stack.len() < max {
        let line = line_below(stack.len());
        let candidate = ranges
            .iter()
            .filter(|range| range.start < line && line <= range.end + 1)
            .filter(|range| stack.last().is_none_or(|outer| range.start > outer.start && range.end <= outer.end))
            .filter(|range| !is_comment(&header_text(range.start)))
            .min_by_key(|range| range.start)
            .copied();
        match candidate {
            Some(range) => stack.push(range),
            None => break,
        }
    }
    // Pinning a header can push the line below past the end of the innermost scope.
    while let Some(last) = stack.last() {
        if line_below(stack.len()) > last.end + 1 {
            stack.pop();
        } else {
            break;
        }
    }
    stack.into_iter().map(|range| range.start).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &[&str] = &[
        "impl A {",           // 0
        "    fn a() {",       // 1
        "        if x {",     // 2
        "            y();",   // 3
        "            z();",   // 4
        "        }",          // 5
        "    }",              // 6
        "    // doc",         // 7
        "    fn b() {}",      // 8
        "}",                  // 9
    ];

    fn ranges() -> Vec<FoldRange> {
        vec![FoldRange { start: 0, end: 8 }, FoldRange { start: 1, end: 5 }, FoldRange { start: 2, end: 4 }]
    }

    fn pinned(top: usize) -> Vec<usize> {
        sticky_lines(&ranges(), |line| TEXT[line].to_string(), |count| top + count, MAX_STICKY_LINES)
    }

    #[test]
    fn nothing_sticks_at_the_top() {
        assert_eq!(pinned(0), Vec::<usize>::new());
    }

    #[test]
    fn enclosing_headers_stick_outermost_first() {
        // Each pinned line covers a row, so the headers under it stick too.
        assert_eq!(pinned(1), vec![0, 1, 2]);
        assert_eq!(pinned(2), vec![0, 1, 2]);
    }

    #[test]
    fn headers_leave_as_their_scope_ends() {
        assert_eq!(pinned(3), vec![0, 1]);
        assert_eq!(pinned(4), vec![0, 1]);
        assert_eq!(pinned(5), vec![0]);
        assert_eq!(pinned(7), vec![0]);
        assert_eq!(pinned(9), Vec::<usize>::new());
    }

    #[test]
    fn the_limit_holds_and_comments_never_stick() {
        let only_two = sticky_lines(&ranges(), |line| TEXT[line].to_string(), |count| 3 + count, 2);
        assert_eq!(only_two, vec![0, 1]);
        let comment = [FoldRange { start: 7, end: 8 }];
        assert!(sticky_lines(&comment, |line| TEXT[line].to_string(), |count| 8 + count, 5).is_empty());
    }
}
