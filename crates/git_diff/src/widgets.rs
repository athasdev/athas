//! Small pieces the diff, commit and blame views share.

use std::ops::Range;

use gpui::{AnyElement, Hsla, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};
use theme::ThemeColors;
use ui::{EmptyState, IconName, typography};

use crate::model::FileStatus;

pub fn status_color(status: FileStatus, colors: &ThemeColors) -> Hsla {
    match status {
        FileStatus::Added => colors.git_added,
        FileStatus::Deleted => colors.git_deleted,
        FileStatus::Modified => colors.git_modified,
        FileStatus::Renamed => colors.git_renamed,
    }
}

/// `+12 −3` in the git colours; nothing when both are zero.
pub fn diff_numbers(additions: usize, deletions: usize, colors: &ThemeColors) -> Option<AnyElement> {
    (additions > 0 || deletions > 0).then(|| {
        div()
            .flex()
            .flex_none()
            .gap(px(6.))
            .font_family(typography::MONO_FONT)
            .text_size(typography::TEXT_CAPTION)
            .when(additions > 0, |this| this.child(div().text_color(colors.git_added).child(format!("+{additions}"))))
            .when(deletions > 0, |this| this.child(div().text_color(colors.git_deleted).child(format!("−{deletions}"))))
            .into_any_element()
    })
}

/// The status as a small tinted pill: "Modified", "Added"…
pub fn status_badge(status: FileStatus, colors: &ThemeColors) -> impl IntoElement {
    let tone = status_color(status, colors);
    div()
        .flex_none()
        .px(px(6.))
        .rounded_full()
        .bg(tone.opacity(0.14))
        .text_color(tone)
        .text_size(typography::TEXT_CAPTION)
        .font_weight(typography::MEDIUM)
        .child(status.label())
}

/// A centred message filling the view: loading, failed, nothing to show.
pub fn fill_message(title: impl Into<SharedString>, message: Option<SharedString>, icon: IconName, action: Option<AnyElement>) -> AnyElement {
    let mut state = EmptyState::new(title).icon(icon);
    if let Some(message) = message {
        state = state.message(message);
    }
    if let Some(action) = action {
        state = state.action(action);
    }
    div().flex().flex_1().size_full().items_center().justify_center().p(px(24.)).child(state).into_any_element()
}

/// The text as drawn: tabs as four spaces and no carriage return, with byte ranges moved along.
pub fn display_text(text: &str, ranges: &[Range<usize>]) -> (String, Vec<Range<usize>>) {
    let text = text.strip_suffix('\r').unwrap_or(text);
    if !text.contains('\t') {
        let ranges = ranges.iter().map(|range| range.start.min(text.len())..range.end.min(text.len())).filter(|range| !range.is_empty()).collect();
        return (text.to_string(), ranges);
    }
    let mut out = String::with_capacity(text.len() + 8);
    let mut map = Vec::with_capacity(text.len() + 1);
    for ch in text.chars() {
        for _ in 0..ch.len_utf8() {
            map.push(out.len());
        }
        if ch == '\t' {
            out.push_str("    ");
        } else {
            out.push(ch);
        }
    }
    map.push(out.len());
    let at = |offset: usize| map[offset.min(map.len() - 1)];
    let ranges = ranges.iter().map(|range| at(range.start)..at(range.end)).filter(|range| !range.is_empty()).collect();
    (out, ranges)
}

/// Spaces drawn as `·` and tabs as `→` (Show whitespace), with byte ranges moved along.
pub fn visible_whitespace(text: &str, ranges: &[Range<usize>]) -> (String, Vec<Range<usize>>) {
    let mut out = String::with_capacity(text.len() * 2);
    let mut map = Vec::with_capacity(text.len() + 1);
    for ch in text.chars() {
        for _ in 0..ch.len_utf8() {
            map.push(out.len());
        }
        match ch {
            ' ' => out.push('·'),
            '\t' => out.push_str("→   "),
            _ => out.push(ch),
        }
    }
    map.push(out.len());
    let at = |offset: usize| map[offset.min(map.len() - 1)];
    (out, ranges.iter().map(|range| at(range.start)..at(range.end)).filter(|range| !range.is_empty()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_whitespace_and_moves_ranges() {
        assert_eq!(visible_whitespace("a b", &[2..3]), ("a·b".to_string(), vec![3..4]));
        assert_eq!(visible_whitespace("\tx", &[1..2]), ("→   x".to_string(), vec![6..7]));
    }

    #[test]
    fn expands_tabs_and_moves_ranges() {
        assert_eq!(display_text("a\tb", &[2..3]), ("a    b".to_string(), vec![5..6]));
        assert_eq!(display_text("plain\r", &[0..5]), ("plain".to_string(), vec![0..5]));
        assert_eq!(display_text("\té", &[1..3]), ("    é".to_string(), vec![4..6]));
    }
}
