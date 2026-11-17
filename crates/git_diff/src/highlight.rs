//! Syntax colours for diff, commit and blame lines (`use-git-diff-highlight.ts`): each side of a
//! file is highlighted as a whole, in the file's language, then cut into its lines.

use std::{collections::HashMap, ops::Range, path::Path, sync::Arc};

use editor::SyntaxKind;
use gpui::{HighlightStyle, Hsla};

use crate::model::{FileContent, FileDiff, LineKind};

/// A line's highlighted spans, as byte ranges of its text.
pub type LineSpans = Arc<Vec<(Range<usize>, SyntaxKind)>>;

/// Sides larger than this highlight only the lines the hunks show.
const MAX_WHOLE_SIDE_BYTES: usize = 512 * 1024;

/// The highlighted lines of a file's old and new side, by 1-based line number.
#[derive(Clone, Debug, Default)]
pub struct FileSyntax {
    pub old: HashMap<u32, LineSpans>,
    pub new: HashMap<u32, LineSpans>,
}

impl FileSyntax {
    pub fn line(&self, old_side: bool, line: Option<u32>) -> Option<&LineSpans> {
        let line = line?;
        if old_side { self.old.get(&line) } else { self.new.get(&line) }
    }
}

/// Highlights `lines` (numbered, in order, gaps allowed) as one text and cuts the spans per line.
pub fn highlight_lines(path: &Path, lines: &[(u32, &str)]) -> HashMap<u32, LineSpans> {
    let mut text = String::new();
    let mut starts = Vec::with_capacity(lines.len());
    for (index, (_, line)) in lines.iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        starts.push(text.len());
        text.push_str(line);
    }
    let mut spans: Vec<Vec<(Range<usize>, SyntaxKind)>> = vec![Vec::new(); lines.len()];
    for (range, kind) in editor::highlight_snippet(path, &text) {
        let mut index = starts.partition_point(|start| *start <= range.start).saturating_sub(1);
        while index < lines.len() && starts[index] < range.end {
            let start = starts[index];
            let end = start + lines[index].1.len();
            let clipped = range.start.max(start)..range.end.min(end);
            if !clipped.is_empty() {
                spans[index].push((clipped.start - start..clipped.end - start, kind));
            }
            index += 1;
        }
    }
    lines.iter().zip(spans).filter(|(_, spans)| !spans.is_empty()).map(|((number, _), spans)| (*number, Arc::new(spans))).collect()
}

fn side_lines<'a>(whole: Option<&'a Arc<Vec<String>>>, hunk_lines: impl Iterator<Item = (u32, &'a str)>) -> Vec<(u32, &'a str)> {
    match whole.filter(|lines| lines.iter().map(|line| line.len() + 1).sum::<usize>() <= MAX_WHOLE_SIDE_BYTES) {
        Some(lines) => lines.iter().enumerate().map(|(index, line)| (index as u32 + 1, line.as_str())).collect(),
        None => hunk_lines.collect(),
    }
}

/// Both sides of a text diff, highlighted; nothing for images and binary files.
pub fn file_syntax(file: &FileDiff) -> FileSyntax {
    let FileContent::Text { hunks, old_text, new_text } = &file.content else { return FileSyntax::default() };
    let lines = || hunks.iter().flat_map(|hunk| hunk.lines.iter());
    let old = side_lines(
        old_text.as_ref(),
        lines().filter(|line| matches!(line.kind, LineKind::Context | LineKind::Removed)).filter_map(|line| Some((line.old?, line.text.as_str()))),
    );
    let new = side_lines(
        new_text.as_ref(),
        lines().filter(|line| matches!(line.kind, LineKind::Context | LineKind::Added)).filter_map(|line| Some((line.new?, line.text.as_str()))),
    );
    let old_path = file.old_path.as_deref().unwrap_or(&file.path);
    FileSyntax { old: highlight_lines(Path::new(old_path), &old), new: highlight_lines(Path::new(&file.path), &new) }
}

/// Layers syntax colours under background highlights (changed words, search matches): the text
/// is cut wherever either changes, so the runs never overlap.
pub fn layer(syntax: &[(Range<usize>, Hsla)], backgrounds: &[(Range<usize>, HighlightStyle)]) -> Vec<(Range<usize>, HighlightStyle)> {
    let mut cuts: Vec<usize> = syntax.iter().map(|(range, _)| range).chain(backgrounds.iter().map(|(range, _)| range)).flat_map(|range| [range.start, range.end]).collect();
    cuts.sort_unstable();
    cuts.dedup();
    let mut out: Vec<(Range<usize>, HighlightStyle)> = Vec::new();
    for pair in cuts.windows(2) {
        let piece = pair[0]..pair[1];
        let color = syntax.iter().find(|(range, _)| range.start <= piece.start && piece.end <= range.end).map(|(_, color)| *color);
        let background = backgrounds.iter().rev().find(|(range, _)| range.start <= piece.start && piece.end <= range.end).map(|(_, style)| *style);
        if color.is_none() && background.is_none() {
            continue;
        }
        let mut style = background.unwrap_or_default();
        if let Some(color) = color {
            style.color = Some(color);
        }
        match out.last_mut() {
            Some((range, last)) if range.end == piece.start && *last == style => range.end = piece.end,
            _ => out.push((piece, style)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spans_are_cut_per_line() {
        let lines = [(3, "let a = \"x"), (4, "y\";"), (9, "// note")];
        let spans = highlight_lines(Path::new("main.rs"), &lines);
        let line = |number: u32| spans.get(&number).map(|spans| spans.iter().map(|(range, kind)| (range.clone(), *kind)).collect::<Vec<_>>()).unwrap_or_default();
        assert!(line(3).iter().any(|(range, kind)| *kind == SyntaxKind::Keyword && *range == (0..3)), "{:?}", line(3));
        assert!(line(9).iter().any(|(range, kind)| *kind == SyntaxKind::Comment && *range == (0..7)), "{:?}", line(9));
        for (number, text) in lines {
            assert!(line(number).iter().all(|(range, _)| range.end <= text.len()));
        }
    }

    #[test]
    fn layers_never_overlap() {
        let red = Hsla::red();
        let blue = Hsla::blue();
        let background = HighlightStyle { background_color: Some(blue), ..Default::default() };
        let out = layer(&[(0..4, red)], &[(2..6, background)]);
        assert_eq!(out.iter().map(|(range, _)| range.clone()).collect::<Vec<_>>(), vec![0..2, 2..4, 4..6]);
        assert_eq!(out[1].1.color, Some(red));
        assert_eq!(out[1].1.background_color, Some(blue));
        assert_eq!(out[2].1.color, None);
        assert!(out.windows(2).all(|pair| pair[0].0.end <= pair[1].0.start));
    }
}
