//! A diff as the view draws it, worked out without touching git or the UI: files, hunks, the
//! rows of the unified and split layouts, word highlights and the patches hunk actions apply.

use std::{collections::HashSet, ops::Range, sync::Arc};

/// Diffs longer than this many lines are cut, as Athas does, to keep the view responsive.
pub const MAX_LINES: usize = 20_000;
pub const IMAGE_ZOOM_STEP: f32 = 0.25;
pub const MIN_IMAGE_ZOOM: f32 = 0.25;
pub const MAX_IMAGE_ZOOM: f32 = 4.;
/// The tallest an image diff side shows at 100%.
pub const IMAGE_MAX_HEIGHT: f32 = 360.;

pub fn clamp_image_zoom(zoom: f32) -> f32 {
    zoom.clamp(MIN_IMAGE_ZOOM, MAX_IMAGE_ZOOM)
}

/// An image's drawn width and height: its own size, shrunk to fit `IMAGE_MAX_HEIGHT`, times `zoom`.
pub fn image_display_size((width, height): (u32, u32), zoom: f32) -> (f32, f32) {
    let fit = if height as f32 > IMAGE_MAX_HEIGHT { IMAGE_MAX_HEIGHT / height as f32 } else { 1. };
    (width as f32 * fit * zoom, height as f32 * fit * zoom)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
}

impl FileStatus {
    pub fn label(self) -> &'static str {
        match self {
            FileStatus::Added => "Added",
            FileStatus::Deleted => "Deleted",
            FileStatus::Modified => "Modified",
            FileStatus::Renamed => "Renamed",
        }
    }

    pub fn letter(self) -> &'static str {
        match self {
            FileStatus::Added => "A",
            FileStatus::Deleted => "D",
            FileStatus::Modified => "M",
            FileStatus::Renamed => "R",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineKind {
    Context,
    Added,
    Removed,
    /// `\ No newline at end of file`, about the line before it.
    NoNewline,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: LineKind,
    /// 1-based line numbers in the old and new file.
    pub old: Option<u32>,
    pub new: Option<u32>,
    /// The text without its line break.
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    /// `@@ -a,b +c,d @@ context`.
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

impl Hunk {
    /// Why this hunk cannot be applied as a patch: its text was decoded lossily (not UTF-8, so
    /// the patch would write U+FFFD into the file), or it was cut off by the line budget (its
    /// counts no longer match its lines).
    pub fn unpatchable(&self) -> Option<&'static str> {
        if self.lines.iter().any(|line| line.text.contains('\u{FFFD}')) {
            return Some("This file is not UTF-8 text; stage or discard it as a whole file instead.");
        }
        let count = |kinds: &[LineKind]| self.lines.iter().filter(|line| kinds.contains(&line.kind)).count() as u32;
        if count(&[LineKind::Context, LineKind::Removed]) != self.old_lines || count(&[LineKind::Context, LineKind::Added]) != self.new_lines {
            return Some("This change is too large to show in full; stage or discard the whole file instead.");
        }
        None
    }

    /// The text after the second `@@`: usually the enclosing function.
    pub fn context(&self) -> &str {
        self.header.splitn(3, "@@").nth(2).map(str::trim).unwrap_or("")
    }

    pub fn counts(&self) -> (usize, usize) {
        counts(&self.lines)
    }

    /// The last old and new line the hunk covers (the line before it when it covers none).
    fn ends(&self) -> (u32, u32) {
        let end = |start: u32, count: u32| if count == 0 { start } else { start + count - 1 };
        (end(self.old_start, self.old_lines), end(self.new_start, self.new_lines))
    }

    /// The first new line the hunk touches, for opening the file there.
    pub fn first_changed_line(&self) -> u32 {
        self.lines
            .iter()
            .find(|line| matches!(line.kind, LineKind::Added | LineKind::Removed))
            .and_then(|line| line.new.or(line.old))
            .unwrap_or(self.new_start)
            .max(1)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageSide {
    pub bytes: Arc<Vec<u8>>,
    /// Width and height in pixels, when the format is known.
    pub size: Option<(u32, u32)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileContent {
    Text {
        hunks: Vec<Hunk>,
        /// Every line of each side, to unfold the unchanged lines between hunks. `None` when a
        /// side is too large or not text.
        old_text: Option<Arc<Vec<String>>>,
        new_text: Option<Arc<Vec<String>>>,
    },
    Image { old: Option<ImageSide>, new: Option<ImageSide> },
    Binary,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDiff {
    pub path: String,
    /// The path before a rename.
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub content: FileContent,
    pub additions: usize,
    pub deletions: usize,
    /// Lines were left out past [`MAX_LINES`].
    pub truncated: bool,
}

impl FileDiff {
    pub fn hunks(&self) -> &[Hunk] {
        match &self.content {
            FileContent::Text { hunks, .. } => hunks,
            _ => &[],
        }
    }

    pub fn name(&self) -> &str {
        self.path.rsplit('/').next().unwrap_or(&self.path)
    }

    pub fn dir(&self) -> &str {
        self.path.rsplit_once('/').map_or("", |(dir, _)| dir)
    }
}

pub fn counts(lines: &[DiffLine]) -> (usize, usize) {
    lines.iter().fold((0, 0), |(added, removed), line| match line.kind {
        LineKind::Added => (added + 1, removed),
        LineKind::Removed => (added, removed + 1),
        _ => (added, removed),
    })
}

/// The first old and new line and the counts of `@@ -a,b +c,d @@`.
pub fn parse_hunk_header(header: &str) -> Option<(u32, u32, u32, u32)> {
    let mut parts = header.strip_prefix("@@ ")?.split_whitespace();
    let range = |part: Option<&str>, sign: char| -> Option<(u32, u32)> {
        let range = part?.strip_prefix(sign)?;
        let (start, count) = range.split_once(',').unwrap_or((range, "1"));
        Some((start.parse().ok()?, count.parse().ok()?))
    };
    let (old_start, old_lines) = range(parts.next(), '-')?;
    let (new_start, new_lines) = range(parts.next(), '+')?;
    Some((old_start, old_lines, new_start, new_lines))
}

// Patches for hunk actions.

/// A patch of one hunk of `path` that `git apply` (and libgit2's) takes. With `reverse`, the
/// patch undoes the hunk: what unstaging and discarding apply.
pub fn hunk_patch(path: &str, hunk: &Hunk, reverse: bool) -> String {
    let (old_start, old_lines, new_start, new_lines) = if reverse {
        (hunk.new_start, hunk.new_lines, hunk.old_start, hunk.old_lines)
    } else {
        (hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines)
    };
    let mut patch = format!("diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n");
    patch.push_str(&format!("@@ -{old_start},{old_lines} +{new_start},{new_lines} @@\n"));
    for line in &hunk.lines {
        let sign = match (line.kind, reverse) {
            (LineKind::Context, _) => ' ',
            (LineKind::Added, false) | (LineKind::Removed, true) => '+',
            (LineKind::Removed, false) | (LineKind::Added, true) => '-',
            (LineKind::NoNewline, _) => {
                patch.push_str("\\ No newline at end of file\n");
                continue;
            }
        };
        patch.push(sign);
        patch.push_str(&line.text);
        patch.push('\n');
    }
    patch
}

// Word highlights.

/// Words, runs of spaces, and single other characters: the units a changed line is compared in.
fn tokens(text: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some((start, ch)) = chars.next() {
        let class = |ch: char| {
            if ch.is_alphanumeric() || ch == '_' {
                0
            } else if ch.is_whitespace() {
                1
            } else {
                2
            }
        };
        let kind = class(ch);
        let mut end = start + ch.len_utf8();
        if kind != 2 {
            while let Some(&(index, next)) = chars.peek() {
                if class(next) != kind {
                    break;
                }
                end = index + next.len_utf8();
                chars.next();
            }
        }
        out.push(start..end);
    }
    out
}

/// Comparing more token pairs than this falls back to trimming the common start and end.
const MAX_WORD_PAIRS: usize = 40_000;

/// The byte ranges that differ between a removed line and the added line that replaced it.
/// Lines with nothing in common get no highlights: the whole line is the change.
pub fn word_changes(old: &str, new: &str) -> (Vec<Range<usize>>, Vec<Range<usize>>) {
    let (old_tokens, new_tokens) = (tokens(old), tokens(new));
    let text = |source: &str, range: &Range<usize>| source[range.clone()].to_string();
    let old_words: Vec<String> = old_tokens.iter().map(|range| text(old, range)).collect();
    let new_words: Vec<String> = new_tokens.iter().map(|range| text(new, range)).collect();

    let mut prefix = 0;
    while prefix < old_words.len() && prefix < new_words.len() && old_words[prefix] == new_words[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < old_words.len() - prefix
        && suffix < new_words.len() - prefix
        && old_words[old_words.len() - 1 - suffix] == new_words[new_words.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let old_middle = prefix..old_words.len() - suffix;
    let new_middle = prefix..new_words.len() - suffix;

    let (mut old_same, mut new_same) = (vec![false; old_words.len()], vec![false; new_words.len()]);
    for index in (0..prefix).chain(old_words.len() - suffix..old_words.len()) {
        old_same[index] = true;
    }
    for index in (0..prefix).chain(new_words.len() - suffix..new_words.len()) {
        new_same[index] = true;
    }
    if old_middle.len() * new_middle.len() <= MAX_WORD_PAIRS {
        // Longest common subsequence of the middle tokens.
        let (rows, cols) = (old_middle.len(), new_middle.len());
        let mut table = vec![0u32; (rows + 1) * (cols + 1)];
        for i in (0..rows).rev() {
            for j in (0..cols).rev() {
                table[i * (cols + 1) + j] = if old_words[old_middle.start + i] == new_words[new_middle.start + j] {
                    table[(i + 1) * (cols + 1) + j + 1] + 1
                } else {
                    table[(i + 1) * (cols + 1) + j].max(table[i * (cols + 1) + j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < rows && j < cols {
            if old_words[old_middle.start + i] == new_words[new_middle.start + j] {
                old_same[old_middle.start + i] = true;
                new_same[new_middle.start + j] = true;
                i += 1;
                j += 1;
            } else if table[(i + 1) * (cols + 1) + j] >= table[i * (cols + 1) + j + 1] {
                i += 1;
            } else {
                j += 1;
            }
        }
    }

    let shared = old_tokens.iter().zip(&old_same).filter(|(range, same)| **same && !old[(*range).clone()].trim().is_empty()).count();
    if shared == 0 {
        return (Vec::new(), Vec::new());
    }
    (changed_ranges(&old_tokens, &old_same), changed_ranges(&new_tokens, &new_same))
}

/// Adjacent changed tokens merged into ranges.
fn changed_ranges(tokens: &[Range<usize>], same: &[bool]) -> Vec<Range<usize>> {
    let mut out: Vec<Range<usize>> = Vec::new();
    for (range, same) in tokens.iter().zip(same) {
        if *same {
            continue;
        }
        match out.last_mut() {
            Some(last) if last.end == range.start => last.end = range.end,
            _ => out.push(range.clone()),
        }
    }
    out
}

// Rows.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Layout {
    #[default]
    Unified,
    Split,
}

impl Layout {
    pub fn from_setting(value: &str) -> Self {
        if value == "split" { Layout::Split } else { Layout::Unified }
    }

    pub fn setting(self) -> &'static str {
        match self {
            Layout::Unified => "unified",
            Layout::Split => "split",
        }
    }
}

/// One side of a drawn line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cell {
    pub kind: LineKind,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: Arc<str>,
    /// Byte ranges of the words that changed.
    pub words: Vec<Range<usize>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Notice {
    Binary,
    Image,
    Truncated,
    /// A file whose only change is its mode, or an empty file added.
    NoContent,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Row {
    /// A file's header in a multi-file diff.
    File { file: usize },
    Hunk { file: usize, hunk: usize },
    /// Unchanged lines folded away; `gap` counts from 0 before the first hunk.
    Gap { file: usize, gap: usize, lines: u32 },
    Line { file: usize, hunk: Option<usize>, cell: Cell },
    Split { file: usize, hunk: Option<usize>, left: Option<Cell>, right: Option<Cell> },
    Notice { file: usize, notice: Notice },
}

impl Row {
    pub fn file(&self) -> usize {
        match self {
            Row::File { file }
            | Row::Hunk { file, .. }
            | Row::Gap { file, .. }
            | Row::Line { file, .. }
            | Row::Split { file, .. }
            | Row::Notice { file, .. } => *file,
        }
    }
}

/// What is folded or unfolded, as the user left it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Folds {
    pub collapsed_files: HashSet<usize>,
    pub collapsed_hunks: HashSet<(usize, usize)>,
    pub expanded_gaps: HashSet<(usize, usize)>,
}

/// The unchanged lines before hunk `gap` (or after the last hunk when `gap == hunks.len()`):
/// first old and new line and how many.
pub fn gap_range(hunks: &[Hunk], gap: usize, old_total: u32, new_total: u32) -> Option<(u32, u32, u32)> {
    let (old_from, new_from) = match gap.checked_sub(1).map(|index| hunks[index].ends()) {
        Some((old_end, new_end)) => (old_end + 1, new_end + 1),
        None => (1, 1),
    };
    let (old_to, new_to) = match hunks.get(gap) {
        Some(hunk) => {
            let before = |start: u32, count: u32| if count == 0 { start } else { start.saturating_sub(1) };
            (before(hunk.old_start, hunk.old_lines), before(hunk.new_start, hunk.new_lines))
        }
        None => (old_total, new_total),
    };
    let lines = if new_to >= new_from { new_to - new_from + 1 } else if old_to >= old_from { old_to - old_from + 1 } else { 0 };
    (lines > 0).then_some((old_from, new_from, lines))
}

fn cell(line: &DiffLine) -> Cell {
    Cell { kind: line.kind, old: line.old, new: line.new, text: line.text.as_str().into(), words: Vec::new() }
}

/// The lines of a hunk as cells, with removed and added lines of each change block paired for
/// word highlights. Returns the cells and, per block, the removed and added cell indices.
fn hunk_cells(hunk: &Hunk) -> (Vec<Cell>, Vec<(Vec<usize>, Vec<usize>)>) {
    let mut cells: Vec<Cell> = hunk.lines.iter().map(cell).collect();
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < cells.len() {
        if !matches!(cells[index].kind, LineKind::Added | LineKind::Removed) {
            index += 1;
            continue;
        }
        let (mut removed, mut added) = (Vec::new(), Vec::new());
        while index < cells.len() && matches!(cells[index].kind, LineKind::Added | LineKind::Removed | LineKind::NoNewline) {
            match cells[index].kind {
                LineKind::Removed => removed.push(index),
                LineKind::Added => added.push(index),
                _ => {}
            }
            index += 1;
        }
        for (&old, &new) in removed.iter().zip(&added) {
            let (old_words, new_words) = word_changes(&cells[old].text, &cells[new].text);
            cells[old].words = old_words;
            cells[new].words = new_words;
        }
        blocks.push((removed, added));
    }
    (cells, blocks)
}

fn context_cell(text: &str, old: u32, new: u32) -> Cell {
    Cell { kind: LineKind::Context, old: Some(old), new: Some(new), text: text.into(), words: Vec::new() }
}

fn push_cell(rows: &mut Vec<Row>, layout: Layout, file: usize, hunk: Option<usize>, cell: Cell) {
    rows.push(match layout {
        Layout::Unified => Row::Line { file, hunk, cell },
        Layout::Split => Row::Split { file, hunk, left: Some(cell.clone()), right: Some(cell) },
    });
}

/// Every row of the diff in `layout`, with folds applied. `multi_file` adds a header per file.
pub fn build_rows(files: &[FileDiff], layout: Layout, folds: &Folds, multi_file: bool) -> Vec<Row> {
    let mut rows = Vec::new();
    for (file_index, file) in files.iter().enumerate() {
        if multi_file {
            rows.push(Row::File { file: file_index });
            if folds.collapsed_files.contains(&file_index) {
                continue;
            }
        }
        let (hunks, old_text, new_text) = match &file.content {
            FileContent::Text { hunks, old_text, new_text } => (hunks, old_text, new_text),
            FileContent::Image { .. } => {
                rows.push(Row::Notice { file: file_index, notice: Notice::Image });
                continue;
            }
            FileContent::Binary => {
                rows.push(Row::Notice { file: file_index, notice: Notice::Binary });
                continue;
            }
        };
        if hunks.is_empty() {
            rows.push(Row::Notice { file: file_index, notice: Notice::NoContent });
            continue;
        }
        let old_total = old_text.as_ref().map_or(0, |lines| lines.len() as u32);
        let new_total = new_text.as_ref().map_or(0, |lines| lines.len() as u32);
        let has_text = old_text.is_some() || new_text.is_some();
        for gap in 0..=hunks.len() {
            // The folded lines before this hunk (or after the last), when the file text is known.
            if has_text && let Some((old_from, new_from, lines)) = gap_range(hunks, gap, old_total, new_total) {
                if folds.expanded_gaps.contains(&(file_index, gap)) {
                    for offset in 0..lines {
                        let text = new_text
                            .as_ref()
                            .and_then(|text| text.get((new_from + offset - 1) as usize))
                            .or_else(|| old_text.as_ref().and_then(|text| text.get((old_from + offset - 1) as usize)))
                            .map_or("", String::as_str);
                        push_cell(&mut rows, layout, file_index, None, context_cell(text, old_from + offset, new_from + offset));
                    }
                } else {
                    rows.push(Row::Gap { file: file_index, gap, lines });
                }
            }
            let Some(hunk) = hunks.get(gap) else { break };
            rows.push(Row::Hunk { file: file_index, hunk: gap });
            if folds.collapsed_hunks.contains(&(file_index, gap)) {
                continue;
            }
            push_hunk(&mut rows, layout, file_index, gap, hunk);
        }
        if file.truncated {
            rows.push(Row::Notice { file: file_index, notice: Notice::Truncated });
        }
    }
    rows
}

fn push_hunk(rows: &mut Vec<Row>, layout: Layout, file: usize, hunk_index: usize, hunk: &Hunk) {
    let (cells, blocks) = hunk_cells(hunk);
    let hunk = Some(hunk_index);
    match layout {
        Layout::Unified => {
            rows.extend(cells.into_iter().filter(|cell| cell.kind != LineKind::NoNewline).map(|cell| Row::Line { file, hunk, cell }))
        }
        Layout::Split => {
            let mut blocks = blocks.into_iter().peekable();
            let mut index = 0;
            while index < cells.len() {
                match cells[index].kind {
                    LineKind::Context => {
                        rows.push(Row::Split { file, hunk, left: Some(cells[index].clone()), right: Some(cells[index].clone()) });
                        index += 1;
                    }
                    LineKind::NoNewline => index += 1,
                    LineKind::Added | LineKind::Removed => {
                        let Some((removed, added)) = blocks.next() else { break };
                        let span = removed.len().max(added.len());
                        for pair in 0..span {
                            rows.push(Row::Split {
                                file,
                                hunk,
                                left: removed.get(pair).map(|&at| cells[at].clone()),
                                right: added.get(pair).map(|&at| cells[at].clone()),
                            });
                        }
                        index = removed.iter().chain(&added).max().map_or(index + 1, |last| last + 1);
                        while index < cells.len() && cells[index].kind == LineKind::NoNewline {
                            index += 1;
                        }
                    }
                }
            }
        }
    }
}

/// Where each hunk header sits among the rows, in order: what hunk navigation steps through.
pub fn hunk_rows(rows: &[Row]) -> Vec<usize> {
    rows.iter().enumerate().filter(|(_, row)| matches!(row, Row::Hunk { .. })).map(|(index, _)| index).collect()
}

/// The hunk row after (or before) `from`, wrapping around.
pub fn step_hunk(hunk_rows: &[usize], from: Option<usize>, forward: bool) -> Option<usize> {
    let (first, last) = (*hunk_rows.first()?, *hunk_rows.last()?);
    Some(match (from, forward) {
        (None, true) => first,
        (None, false) => last,
        (Some(from), true) => hunk_rows.iter().copied().find(|&row| row > from).unwrap_or(first),
        (Some(from), false) => hunk_rows.iter().rev().copied().find(|&row| row < from).unwrap_or(last),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_zoom_steps_and_fits() {
        assert_eq!(clamp_image_zoom(0.), MIN_IMAGE_ZOOM);
        assert_eq!(clamp_image_zoom(9.), MAX_IMAGE_ZOOM);
        assert_eq!(image_display_size((100, 50), 1.), (100., 50.));
        assert_eq!(image_display_size((100, 50), 2.), (200., 100.));
        assert_eq!(image_display_size((1440, 720), 1.), (720., 360.));
        assert_eq!(image_display_size((1440, 720), 0.5), (360., 180.));
    }

    fn line(kind: LineKind, old: Option<u32>, new: Option<u32>, text: &str) -> DiffLine {
        DiffLine { kind, old, new, text: text.into() }
    }

    fn sample_hunk() -> Hunk {
        Hunk {
            header: "@@ -2,4 +2,4 @@ fn main() {".into(),
            old_start: 2,
            old_lines: 4,
            new_start: 2,
            new_lines: 4,
            lines: vec![
                line(LineKind::Context, Some(2), Some(2), "a"),
                line(LineKind::Removed, Some(3), None, "let total = old_value + 1;"),
                line(LineKind::Removed, Some(4), None, "gone"),
                line(LineKind::Added, None, Some(3), "let total = new_value + 1;"),
                line(LineKind::Context, Some(5), Some(4), "b"),
                line(LineKind::Added, None, Some(5), "tail"),
                line(LineKind::NoNewline, None, None, ""),
            ],
        }
    }

    fn text_file(hunks: Vec<Hunk>, old: usize, new: usize) -> FileDiff {
        let lines = |count: usize, prefix: &str| Some(Arc::new((1..=count).map(|n| format!("{prefix}{n}")).collect::<Vec<_>>()));
        FileDiff {
            path: "src/a.rs".into(),
            old_path: None,
            status: FileStatus::Modified,
            content: FileContent::Text { hunks, old_text: lines(old, "old "), new_text: lines(new, "line ") },
            additions: 0,
            deletions: 0,
            truncated: false,
        }
    }

    #[test]
    fn parses_hunk_headers() {
        assert_eq!(parse_hunk_header("@@ -1,4 +1,5 @@ fn main() {"), Some((1, 4, 1, 5)));
        assert_eq!(parse_hunk_header("@@ -10 +12,0 @@"), Some((10, 1, 12, 0)));
        assert_eq!(parse_hunk_header("not a hunk"), None);
        assert_eq!(sample_hunk().context(), "fn main() {");
        assert_eq!(sample_hunk().counts(), (2, 2));
        assert_eq!(sample_hunk().first_changed_line(), 3);
    }

    #[test]
    fn writes_forward_and_reverse_patches() {
        let hunk = sample_hunk();
        let forward = hunk_patch("src/a.rs", &hunk, false);
        assert_eq!(
            forward,
            "diff --git a/src/a.rs b/src/a.rs\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -2,4 +2,4 @@\n a\n-let total = old_value + 1;\n-gone\n+let total = new_value + 1;\n b\n+tail\n\\ No newline at end of file\n"
        );
        let reverse = hunk_patch("src/a.rs", &hunk, true);
        assert!(reverse.contains("@@ -2,4 +2,4 @@\n a\n+let total = old_value + 1;\n+gone\n-let total = new_value + 1;\n b\n-tail\n"));
    }

    #[test]
    fn highlights_changed_words() {
        let (old, new) = word_changes("let total = old_value + 1;", "let total = new_value + 1;");
        assert_eq!(old, vec![12..21]);
        assert_eq!(new, vec![12..21]);
        let (old, new) = word_changes("foo(a, b)", "foo(a, b, c)");
        assert!(old.is_empty());
        assert_eq!(new, vec![8..11]);
        // Nothing in common: no word highlights, the whole line is the change.
        assert_eq!(word_changes("alpha", "omega"), (Vec::new(), Vec::new()));
        // Multi-byte text keeps char boundaries.
        let (old, new) = word_changes("naïve café", "naïve cafés");
        assert_eq!((old.len(), new.len()), (1, 1));
        assert_eq!(&"naïve cafés"[new[0].clone()], "cafés");
    }

    #[test]
    fn builds_unified_rows_with_folded_gaps() {
        let files = vec![text_file(vec![sample_hunk()], 10, 11)];
        let rows = build_rows(&files, Layout::Unified, &Folds::default(), false);
        assert_eq!(rows[0], Row::Gap { file: 0, gap: 0, lines: 1 });
        assert_eq!(rows[1], Row::Hunk { file: 0, hunk: 0 });
        let lines: Vec<LineKind> = rows.iter().filter_map(|row| match row {
            Row::Line { cell, .. } => Some(cell.kind),
            _ => None,
        }).collect();
        assert_eq!(lines.len(), 6, "the no-newline note is not a row");
        assert_eq!(rows.last(), Some(&Row::Gap { file: 0, gap: 1, lines: 6 }));
        let Row::Line { cell, .. } = &rows[3] else { panic!() };
        assert_eq!(cell.words, vec![12..21]);

        let mut folds = Folds::default();
        folds.expanded_gaps.insert((0, 0));
        folds.collapsed_hunks.insert((0, 0));
        let rows = build_rows(&files, Layout::Unified, &folds, false);
        let Row::Line { cell, hunk: None, .. } = &rows[0] else { panic!("{:?}", rows[0]) };
        assert_eq!((&*cell.text, cell.old, cell.new), ("line 1", Some(1), Some(1)));
        assert_eq!(rows[1], Row::Hunk { file: 0, hunk: 0 });
        assert_eq!(rows[2], Row::Gap { file: 0, gap: 1, lines: 6 });
    }

    #[test]
    fn pairs_split_rows() {
        let files = vec![text_file(vec![sample_hunk()], 0, 0)];
        let files = vec![FileDiff { content: FileContent::Text { hunks: files[0].hunks().to_vec(), old_text: None, new_text: None }, ..files[0].clone() }];
        let rows = build_rows(&files, Layout::Split, &Folds::default(), false);
        let sides: Vec<(Option<LineKind>, Option<LineKind>)> = rows
            .iter()
            .filter_map(|row| match row {
                Row::Split { left, right, .. } => Some((left.as_ref().map(|c| c.kind), right.as_ref().map(|c| c.kind))),
                _ => None,
            })
            .collect();
        use LineKind::*;
        assert_eq!(
            sides,
            [
                (Some(Context), Some(Context)),
                (Some(Removed), Some(Added)),
                (Some(Removed), None),
                (Some(Context), Some(Context)),
                (None, Some(Added)),
            ]
        );
        assert_eq!(rows[0], Row::Hunk { file: 0, hunk: 0 }, "no gaps without the file text");
    }

    #[test]
    fn counts_gaps_around_pure_insertions_and_deletions() {
        let insertion = Hunk { header: String::new(), old_start: 4, old_lines: 0, new_start: 5, new_lines: 2, lines: Vec::new() };
        assert_eq!(gap_range(std::slice::from_ref(&insertion), 0, 10, 12), Some((1, 1, 4)));
        assert_eq!(gap_range(std::slice::from_ref(&insertion), 1, 10, 12), Some((5, 7, 6)));
        let deletion = Hunk { header: String::new(), old_start: 1, old_lines: 3, new_start: 0, new_lines: 0, lines: Vec::new() };
        assert_eq!(gap_range(std::slice::from_ref(&deletion), 0, 3, 0), None);
        assert_eq!(gap_range(std::slice::from_ref(&deletion), 1, 3, 0), None);
    }

    #[test]
    fn multi_file_headers_fold_files() {
        let mut second = text_file(vec![sample_hunk()], 10, 11);
        second.content = FileContent::Binary;
        let files = vec![text_file(vec![sample_hunk()], 10, 11), second];
        let mut folds = Folds::default();
        folds.collapsed_files.insert(0);
        let rows = build_rows(&files, Layout::Unified, &folds, true);
        assert_eq!(rows, vec![Row::File { file: 0 }, Row::File { file: 1 }, Row::Notice { file: 1, notice: Notice::Binary }]);
    }

    #[test]
    fn steps_between_hunks() {
        let rows = [3, 10, 20];
        assert_eq!(step_hunk(&rows, None, true), Some(3));
        assert_eq!(step_hunk(&rows, Some(3), true), Some(10));
        assert_eq!(step_hunk(&rows, Some(20), true), Some(3));
        assert_eq!(step_hunk(&rows, Some(10), false), Some(3));
        assert_eq!(step_hunk(&rows, Some(3), false), Some(20));
        assert_eq!(step_hunk(&[], None, true), None);
    }
}
