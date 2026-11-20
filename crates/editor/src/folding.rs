//! Code folding (`features/editor` folding in Athas): fold ranges from the syntax tree, from the
//! language server's `foldingRange` when it offers them, or from indentation; the folded set,
//! kept on its code through edits; and the fold actions.

use std::{ops::Range, sync::Arc, time::Duration};

use gpui::{Context, Task, Window};
use lsp_client::lsp;
#[cfg(not(target_family = "wasm"))]
use tree_sitter::{Node, Tree};

use crate::{
    Editor,
    buffer::{AppliedEdit, Buffer},
    display_map::WrapIndex,
};

/// Fold ranges are worked out for files up to this size.
const MAX_FOLD_FILE: usize = 4 * 1024 * 1024;
const LSP_FOLD_DELAY: Duration = Duration::from_millis(600);

/// A foldable region: the header line stays visible, `start + 1..=end` hide.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct FoldRange {
    pub start: usize,
    pub end: usize,
}

impl FoldRange {
    pub fn contains_line(&self, line: usize) -> bool {
        (self.start..=self.end).contains(&line)
    }

    pub fn hides(&self, line: usize) -> bool {
        line > self.start && line <= self.end
    }
}

/// Node kinds that fold although they are not bracketed.
#[cfg(not(target_family = "wasm"))]
const BLOCK_KINDS: &[&str] = &[
    "block",
    "element",
    "jsx_element",
    "section",
    "fenced_code_block",
    "block_mapping_pair",
    "block_sequence_item",
    "template_string",
    "string",
    "raw_string_literal",
    "heredoc_body",
    "table",
    "array",
    "inline_table",
];

#[cfg(not(target_family = "wasm"))]
fn is_open_bracket(kind: &str) -> bool {
    matches!(kind, "{" | "[" | "(")
}

#[cfg(not(target_family = "wasm"))]
fn closes(open: &str, close: &str) -> bool {
    matches!((open, close), ("{", "}") | ("[", "]") | ("(", ")"))
}

/// Whether the text of `line` before `column` is blank: the closing bracket or tag starts it.
#[cfg(not(target_family = "wasm"))]
fn starts_line(buffer: &Buffer, line: usize, column: usize) -> bool {
    let text = buffer.line(line);
    text[..column.min(text.len())].trim().is_empty()
}

/// The region a node folds, if it spans lines and looks like a block.
#[cfg(not(target_family = "wasm"))]
fn node_fold(node: Node, buffer: &Buffer) -> Option<FoldRange> {
    let start = node.start_position().row;
    let end = node.end_position().row;
    if end <= start {
        return None;
    }
    let count = node.child_count();
    let kind = node.kind();
    if count >= 2
        && let (Some(first), Some(last)) = (node.child(0), node.child(count - 1))
        && !first.is_named()
        && !last.is_named()
        && is_open_bracket(first.kind())
        && closes(first.kind(), last.kind())
    {
        let header = first.start_position().row;
        let close = last.start_position().row;
        let end = if starts_line(buffer, close, last.start_position().column) { close.saturating_sub(1) } else { close };
        return (end > header).then_some(FoldRange { start: header, end });
    }
    if kind.contains("comment") {
        // A line comment's node takes its newline, ending at column 0 of the next line: it is
        // one line and folds nothing.
        let end = if node.end_position().column == 0 { end - 1 } else { end };
        return Some(FoldRange { start, end: if end > start && buffer.line(end).trim().is_empty() { end - 1 } else { end } }).filter(|range| range.end > range.start);
    }
    if !BLOCK_KINDS.contains(&kind) {
        return None;
    }
    // Python and YAML blocks start on the line after their header.
    let header = if kind == "block" && node.prev_sibling().is_some_and(|previous| previous.kind() == ":") {
        node.prev_sibling().map(|colon| colon.start_position().row).unwrap_or(start)
    } else {
        start
    };
    let mut last = end;
    // Keep a closing tag on its own line visible, and ignore a trailing newline.
    if node.end_position().column == 0 {
        last = last.saturating_sub(1);
    } else if let Some(close) = node.child(count.saturating_sub(1)).filter(|child| child.kind().contains("end_tag") || child.kind().starts_with("jsx_closing"))
        && close.start_position().row == end
        && starts_line(buffer, end, close.start_position().column)
    {
        last = end - 1;
    }
    (last > header).then_some(FoldRange { start: header, end: last })
}

/// Fold ranges from a syntax tree, one per header line (the widest), sorted.
#[cfg(not(target_family = "wasm"))]
pub fn syntax_fold_ranges(tree: &Tree, buffer: &Buffer) -> Vec<FoldRange> {
    let mut ranges = Vec::new();
    let mut cursor = tree.walk();
    let mut descend = true;
    loop {
        let node = cursor.node();
        if descend {
            if node.parent().is_some()
                && let Some(range) = node_fold(node, buffer)
            {
                ranges.push(range);
            }
            // Single-line nodes hold nothing that folds.
            if node.end_position().row > node.start_position().row && cursor.goto_first_child() {
                continue;
            }
        }
        if cursor.goto_next_sibling() {
            descend = true;
            continue;
        }
        if !cursor.goto_parent() {
            break;
        }
        descend = false;
    }
    dedupe(ranges)
}

/// Fold ranges by indentation, for files without a grammar: a line folds the lines below it
/// that are indented deeper (blank lines inside included).
pub fn indent_fold_ranges(buffer: &Buffer, tab_size: usize) -> Vec<FoldRange> {
    let indent_of = |line: usize| -> Option<usize> {
        let text = buffer.line(line);
        if text.trim().is_empty() {
            return None;
        }
        Some(crate::display_map::display_column(&text, text.len() - text.trim_start().len(), tab_size))
    };
    let mut ranges = Vec::new();
    // Open headers: (line, indent), and the last non-blank line seen.
    let mut stack: Vec<(usize, usize)> = Vec::new();
    let mut last_content = 0;
    for line in 0..buffer.line_count() {
        let Some(indent) = indent_of(line) else { continue };
        while let Some(&(header, header_indent)) = stack.last() {
            if indent > header_indent {
                break;
            }
            stack.pop();
            if last_content > header {
                ranges.push(FoldRange { start: header, end: last_content });
            }
        }
        stack.push((line, indent));
        last_content = line;
    }
    while let Some((header, _)) = stack.pop() {
        if last_content > header {
            ranges.push(FoldRange { start: header, end: last_content });
        }
    }
    dedupe(ranges)
}

/// Ranges from a language server; one that ends on a closing bracket keeps that line visible.
pub fn lsp_fold_ranges(ranges: &[lsp::FoldingRange], buffer: &Buffer) -> Vec<FoldRange> {
    let last_line = buffer.line_count().saturating_sub(1);
    let ranges = ranges
        .iter()
        .filter_map(|range| {
            let start = range.start_line as usize;
            let mut end = (range.end_line as usize).min(last_line);
            if end > start + 1 && buffer.line(end).trim_start().starts_with(['}', ']', ')']) {
                end -= 1;
            }
            (end > start).then_some(FoldRange { start, end })
        })
        .collect();
    dedupe(ranges)
}

fn dedupe(mut ranges: Vec<FoldRange>) -> Vec<FoldRange> {
    // Per header the widest range wins.
    ranges.sort_by_key(|range| (range.start, std::cmp::Reverse(range.end)));
    ranges.dedup_by_key(|range| range.start);
    ranges
}

/// The hidden line ranges of a fold set, merged where folds nest or touch.
pub fn hidden_lines(folds: &[FoldRange]) -> Vec<(usize, usize)> {
    let mut hidden: Vec<(usize, usize)> = Vec::new();
    let mut sorted: Vec<(usize, usize)> = folds.iter().map(|fold| (fold.start + 1, fold.end)).collect();
    sorted.sort();
    for (start, end) in sorted {
        match hidden.last_mut() {
            Some(last) if start <= last.1 + 1 => last.1 = last.1.max(end),
            _ => hidden.push((start, end)),
        }
    }
    hidden
}

/// Moves folds with the lines they cover through `edits`; a fold whose hidden lines were edited
/// opens.
pub fn map_folds(folds: &mut Vec<FoldRange>, edits: &[AppliedEdit]) {
    for edit in edits {
        let first = edit.lsp.range.start.line as usize;
        let last = edit.lsp.range.end.line as usize;
        let delta = edit.lsp.text.matches('\n').count() as isize - (last - first) as isize;
        let at_line_start = edit.lsp.range.start.character == 0 && edit.lsp.range.end.character == 0 && edit.lsp.text.ends_with('\n');
        folds.retain_mut(|fold| {
            let above = last < fold.start || (first == fold.start && last == fold.start && at_line_start);
            if above {
                fold.start = (fold.start as isize + delta) as usize;
                fold.end = (fold.end as isize + delta) as usize;
                true
            } else {
                // Below the fold, or on the header without adding lines; otherwise it opens.
                first > fold.end || (first == fold.start && last == fold.start && delta == 0)
            }
        });
    }
}

/// The breakpoints' and other line marks' move through `edits`: `(from line, delta)` per edit,
/// in order.
pub fn line_shifts(edits: &[AppliedEdit]) -> Vec<(usize, isize)> {
    edits
        .iter()
        .filter_map(|edit| {
            let first = edit.lsp.range.start.line as usize;
            let last = edit.lsp.range.end.line as usize;
            let delta = edit.lsp.text.matches('\n').count() as isize - (last - first) as isize;
            if delta == 0 {
                return None;
            }
            // Lines inserted at a line start push that line down too; whole lines deleted (from a
            // line start to a line start) are the lines from `first` on, not the one after.
            let at_line_starts = edit.lsp.range.start.character == 0 && (delta > 0 || edit.lsp.range.end.character == 0);
            let from = if at_line_starts { first } else { first + 1 };
            Some((from, delta))
        })
        .collect()
}

/// Fold state of an editor.
#[derive(Default)]
pub(crate) struct FoldState {
    /// What is folded, sorted by header.
    pub folded: Vec<FoldRange>,
    /// Bumped on every change to `folded`, for the row index.
    pub generation: usize,
    /// Ranges for the current text: (buffer version, syntax generation, ranges).
    cache: Option<(usize, usize, Arc<Vec<FoldRange>>)>,
    /// The server's ranges and the buffer version they are for.
    lsp: Option<(usize, Arc<Vec<FoldRange>>)>,
    lsp_task: Option<Task<()>>,
}

/// The regions nested `level` deep, as `computeFoldDepths` counts: a region's depth is one more
/// than the regions around it.
fn ranges_at_depth(ranges: &[FoldRange], level: usize) -> Vec<FoldRange> {
    let mut sorted = ranges.to_vec();
    sorted.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
    let mut ancestors: Vec<FoldRange> = Vec::new();
    let mut found = Vec::new();
    for range in sorted {
        while ancestors.last().is_some_and(|parent| range.start > parent.end || range.end > parent.end) {
            ancestors.pop();
        }
        if ancestors.len() + 1 == level {
            found.push(range);
        }
        ancestors.push(range);
    }
    found
}

impl FoldState {
    pub fn is_folded(&self, line: usize) -> bool {
        self.folded.iter().any(|fold| fold.start == line)
    }

    pub fn hidden(&self) -> Vec<(usize, usize)> {
        hidden_lines(&self.folded)
    }

    fn set(&mut self, mut folded: Vec<FoldRange>) {
        folded.sort();
        folded.dedup();
        if folded != self.folded {
            self.folded = folded;
            self.generation += 1;
        }
    }
}

impl Editor {
    /// The foldable regions of the text as it is now.
    pub(crate) fn fold_ranges(&mut self) -> Arc<Vec<FoldRange>> {
        let version = self.document.buffer.version();
        if let Some((lsp_version, ranges)) = &self.folds.lsp
            && *lsp_version == version
        {
            return ranges.clone();
        }
        let generation = self.document.syntax.generation;
        if let Some((cached_version, cached_generation, ranges)) = &self.folds.cache
            && *cached_version == version
            && *cached_generation == generation
        {
            return ranges.clone();
        }
        let buffer = &self.document.buffer;
        let ranges = if buffer.len() > MAX_FOLD_FILE {
            Vec::new()
        } else {
            match &self.document.syntax.tree {
                #[cfg(not(target_family = "wasm"))]
                Some(tree) => syntax_fold_ranges(tree, buffer),
                #[cfg(target_family = "wasm")]
                Some(tree) => match *tree {},
                None => indent_fold_ranges(buffer, self.document.tab_size),
            }
        };
        let ranges = Arc::new(ranges);
        self.folds.cache = Some((version, generation, ranges.clone()));
        ranges
    }

    /// The row index the display map needs: soft wrap at `columns`, and the folds.
    pub(crate) fn row_index(&mut self, columns: Option<usize>) -> Option<Arc<WrapIndex>> {
        let buffer = &self.document.buffer;
        let tab_size = self.document.tab_size;
        let blocks = self.blocks();
        if columns.is_none() && self.folds.folded.is_empty() && blocks.is_empty() {
            self.wrap_index = None;
            return None;
        }
        let stale = self.wrap_index.as_ref().is_none_or(|index| {
            index.version != buffer.version()
                || index.columns != columns
                || index.tab_size != tab_size
                || index.fold_generation != self.folds.generation
                || index.blocks != blocks
        });
        if stale {
            let hidden = self.folds.hidden();
            self.wrap_index = Some(Arc::new(WrapIndex::build_with_blocks(buffer, columns, tab_size, &hidden, self.folds.generation, blocks)));
        }
        self.wrap_index.clone()
    }

    /// The current row index, rebuilt for edits and folds since the last frame.
    pub(crate) fn current_row_index(&mut self) -> Option<Arc<WrapIndex>> {
        let columns = self.wrap_index.as_ref().and_then(|index| index.columns);
        self.row_index(columns)
    }

    /// Keeps the folds on their code after an edit.
    pub(crate) fn folds_edited(&mut self, edits: &[AppliedEdit]) {
        if self.folds.folded.is_empty() {
            return;
        }
        let mut folded = std::mem::take(&mut self.folds.folded);
        map_folds(&mut folded, edits);
        let last = self.document.buffer.line_count().saturating_sub(1);
        folded.retain(|fold| fold.end <= last && fold.end > fold.start);
        self.folds.folded = folded;
        self.folds.generation += 1;
    }

    /// The fold whose hidden lines hold `line`.
    pub(crate) fn fold_hiding(&self, line: usize) -> Option<FoldRange> {
        self.folds.folded.iter().copied().filter(|fold| fold.hides(line)).min_by_key(|fold| fold.start)
    }

    /// Moves carets out of folded lines after a motion: past the fold going forward, onto its
    /// header going back. Edits instead open the fold.
    pub(crate) fn settle_carets_in_folds(&mut self, previous_head: usize, edited: bool) {
        if self.folds.folded.is_empty() {
            return;
        }
        let buffer = &self.document.buffer;
        let heads: Vec<usize> = self.document.selections.iter().map(|selection| selection.head).collect();
        let mut opened = Vec::new();
        let mut moved = false;
        let mut selections = self.document.selections.clone();
        for (selection, head) in selections.iter_mut().zip(heads) {
            let line = buffer.line_of(head);
            let Some(fold) = self.fold_hiding(line) else { continue };
            if edited {
                opened.push(fold);
                continue;
            }
            let outer = self.folds.folded.iter().filter(|other| other.hides(line)).map(|other| other.end).max().unwrap_or(fold.end);
            let target = if head >= previous_head {
                if outer + 1 < buffer.line_count() { buffer.line_start(outer + 1) } else { buffer.line_end(fold.start) }
            } else {
                buffer.line_end(fold.start)
            };
            if selection.is_empty() { selection.collapse_to(target) } else { selection.head = target }
            moved = true;
        }
        if moved {
            self.document.set_selections(selections);
        }
        if !opened.is_empty() {
            let folded = self.folds.folded.iter().copied().filter(|fold| !opened.contains(fold)).collect();
            self.folds.set(folded);
        }
    }

    /// Opens every fold that hides a caret (after a jump: find, go to line, definition).
    pub(crate) fn reveal_carets(&mut self) {
        if self.folds.folded.is_empty() {
            return;
        }
        let buffer = &self.document.buffer;
        let lines: Vec<usize> = self.document.selections.iter().map(|selection| buffer.line_of(selection.head)).collect();
        let folded: Vec<FoldRange> = self.folds.folded.iter().copied().filter(|fold| !lines.iter().any(|line| fold.hides(*line))).collect();
        if folded.len() != self.folds.folded.len() {
            self.folds.set(folded);
        }
    }

    /// The innermost foldable range around `line` that is not folded yet.
    fn foldable_at(&mut self, line: usize) -> Option<FoldRange> {
        let ranges = self.fold_ranges();
        if let Some(range) = ranges.iter().find(|range| range.start == line && !self.folds.is_folded(line)) {
            return Some(*range);
        }
        ranges.iter().filter(|range| range.contains_line(line) && !self.folds.is_folded(range.start)).max_by_key(|range| range.start).copied()
    }

    pub fn fold_line(&mut self, line: usize, cx: &mut Context<Self>) {
        let Some(range) = self.foldable_at(line) else { return };
        let mut folded = self.folds.folded.clone();
        folded.push(range);
        self.folds.set(folded);
        // A caret inside goes to the header.
        let header_end = self.document.buffer.line_end(range.start);
        let buffer = &self.document.buffer;
        if self.document.selections.iter().any(|selection| range.hides(buffer.line_of(selection.head))) {
            self.document.set_cursor(header_end);
        }
        cx.notify();
    }

    pub fn unfold_line(&mut self, line: usize, cx: &mut Context<Self>) {
        let folded: Vec<FoldRange> = self.folds.folded.iter().copied().filter(|fold| fold.start != line && !fold.hides(line)).collect();
        self.folds.set(folded);
        cx.notify();
    }

    /// Folds or opens the region headed at `line` (a gutter chevron click).
    pub fn toggle_fold_at(&mut self, line: usize, cx: &mut Context<Self>) {
        if self.folds.is_folded(line) {
            self.unfold_line(line, cx);
        } else if self.fold_ranges().iter().any(|range| range.start == line) {
            self.fold_line(line, cx);
        }
    }

    fn caret_line(&self) -> usize {
        self.document.buffer.line_of(self.document.newest_selection().head)
    }

    pub(crate) fn fold(&mut self, _: &crate::Fold, _: &mut Window, cx: &mut Context<Self>) {
        let line = self.caret_line();
        self.fold_line(line, cx);
    }

    pub(crate) fn unfold(&mut self, _: &crate::Unfold, _: &mut Window, cx: &mut Context<Self>) {
        let line = self.caret_line();
        self.unfold_line(line, cx);
    }

    pub(crate) fn toggle_fold(&mut self, _: &crate::ToggleFold, _: &mut Window, cx: &mut Context<Self>) {
        let line = self.caret_line();
        if self.folds.folded.iter().any(|fold| fold.contains_line(line)) {
            self.unfold_line(line, cx);
        } else {
            self.fold_line(line, cx);
        }
    }

    pub fn fold_all(&mut self, cx: &mut Context<Self>) {
        let ranges = self.fold_ranges();
        self.folds.set(ranges.to_vec());
        let buffer = &self.document.buffer;
        let caret = self.document.newest_selection().head;
        let line = buffer.line_of(caret);
        if let Some(fold) = self.fold_hiding(line) {
            let outer = self.folds.folded.iter().filter(|other| other.hides(line)).min_by_key(|other| other.start).copied().unwrap_or(fold);
            let end = buffer.line_end(outer.start);
            self.document.set_cursor(end);
        }
        cx.notify();
    }

    /// Folds every region nested `level` deep (1 is outermost), keeping the folds already closed
    /// (`foldLevel`, Cmd-K Cmd-1 … Cmd-7).
    pub fn fold_level(&mut self, level: usize, cx: &mut Context<Self>) {
        let ranges = self.fold_ranges();
        let mut folded = self.folds.folded.clone();
        folded.extend(ranges_at_depth(&ranges, level.max(1)));
        self.folds.set(folded);
        self.reveal_carets_to_headers();
        cx.notify();
    }

    /// Moves carets hidden by a fold onto the outermost hiding fold's header.
    fn reveal_carets_to_headers(&mut self) {
        let buffer = &self.document.buffer;
        let line = buffer.line_of(self.document.newest_selection().head);
        if let Some(outer) = self.folds.folded.iter().filter(|fold| fold.hides(line)).min_by_key(|fold| fold.start).copied() {
            let end = buffer.line_end(outer.start);
            self.document.set_cursor(end);
        }
    }

    pub fn unfold_all(&mut self, cx: &mut Context<Self>) {
        self.folds.set(Vec::new());
        cx.notify();
    }

    /// Lines currently folded away, as (header line, last hidden line), 0-based.
    pub fn folded_ranges(&self) -> Vec<Range<usize>> {
        self.folds.folded.iter().map(|fold| fold.start..fold.end + 1).collect()
    }

    /// Asks the language server for folding ranges (when it offers them) after a pause.
    pub(crate) fn schedule_lsp_folds(&mut self, debounce: bool, cx: &mut Context<Self>) {
        let Some(document) = self.lsp.document.clone() else { return };
        let server = document.server().clone();
        let offers = server.capabilities().is_some_and(|capabilities| {
            capabilities.folding_range_provider.as_ref().is_some_and(|provider| !matches!(provider, lsp::FoldingRangeProviderCapability::Simple(false)))
        });
        if !offers {
            return;
        }
        let version = self.document.buffer.version();
        self.folds.lsp_task = Some(cx.spawn(async move |this, cx| {
            if debounce {
                cx.background_executor().timer(LSP_FOLD_DELAY).await;
            }
            let request = server.request::<lsp::request::FoldingRangeRequest>(lsp::FoldingRangeParams {
                text_document: document.identifier(),
                work_done_progress_params: Default::default(),
                partial_result_params: Default::default(),
            });
            let Ok(Some(ranges)) = request.await else { return };
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() != version {
                    return;
                }
                let ranges = lsp_fold_ranges(&ranges, &editor.document.buffer);
                editor.folds.lsp = Some((version, Arc::new(ranges)));
                cx.notify();
            })
            .ok();
        }));
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use ropey::Rope;

    use super::*;
    use crate::syntax::{SyntaxState, language_for_path};

    #[test]
    fn regions_at_a_nesting_level() {
        // root { first { child } second { child } } tail, as the original's fold-store test.
        let all = [FoldRange { start: 0, end: 4 }, FoldRange { start: 1, end: 2 }, FoldRange { start: 3, end: 4 }];
        assert_eq!(ranges_at_depth(&all, 2), vec![FoldRange { start: 1, end: 2 }, FoldRange { start: 3, end: 4 }]);
        assert_eq!(ranges_at_depth(&all, 1), vec![FoldRange { start: 0, end: 4 }]);
        assert!(ranges_at_depth(&all, 3).is_empty());
    }

    fn ranges(path: &str, text: &str) -> Vec<(usize, usize)> {
        let buffer = Buffer::new(text);
        let mut state = SyntaxState::new(language_for_path(Path::new(path)));
        state.reparse_now(&Rope::from_str(text));
        syntax_fold_ranges(state.tree.as_ref().unwrap(), &buffer).iter().map(|range| (range.start, range.end)).collect()
    }

    #[test]
    fn rust_blocks_fold_and_keep_the_closing_brace() {
        let text = "fn main() {\n    let x = [\n        1,\n    ];\n    if x {\n        y();\n    }\n}\n";
        assert_eq!(ranges("a.rs", text), vec![(0, 6), (1, 2), (4, 5)]);
    }

    #[test]
    fn single_line_blocks_do_not_fold() {
        assert!(ranges("a.rs", "fn f() { g(); }\n").is_empty());
    }

    #[test]
    fn comments_and_typescript_objects_fold() {
        let text = "/**\n * Docs\n */\nconst a = {\n  b: 1,\n};\n";
        assert_eq!(ranges("a.ts", text), vec![(0, 2), (3, 4)]);
    }

    #[test]
    fn line_comments_do_not_fold_one_by_one() {
        let text = "//! One.\n//! Two.\n//! Three.\nmod a;\n";
        assert!(ranges("a.rs", text).is_empty());
    }

    #[test]
    fn python_blocks_fold_from_their_header() {
        let text = "def f():\n    a = 1\n    return a\n\nx = 2\n";
        assert_eq!(ranges("a.py", text), vec![(0, 2)]);
    }

    #[test]
    fn indentation_folds_without_a_grammar() {
        let buffer = Buffer::new("a:\n  b\n\n  c\n    d\ne\n");
        let found: Vec<_> = indent_fold_ranges(&buffer, 2).iter().map(|range| (range.start, range.end)).collect();
        assert_eq!(found, vec![(0, 4), (3, 4)]);
    }

    #[test]
    fn server_ranges_keep_the_closing_line() {
        let buffer = Buffer::new("fn a() {\n    b();\n    c();\n}\n");
        let range = lsp::FoldingRange { start_line: 0, end_line: 3, ..Default::default() };
        assert_eq!(lsp_fold_ranges(&[range], &buffer), vec![FoldRange { start: 0, end: 2 }]);
    }

    #[test]
    fn nested_folds_merge_into_hidden_lines() {
        let folds = [FoldRange { start: 0, end: 10 }, FoldRange { start: 2, end: 4 }, FoldRange { start: 12, end: 14 }];
        assert_eq!(hidden_lines(&folds), vec![(1, 10), (13, 14)]);
    }

    fn applied(buffer: &mut Buffer, edits: &[(Range<usize>, &str)]) -> Vec<AppliedEdit> {
        buffer.record_changes(true);
        buffer.apply(&edits.iter().map(|(range, text)| (range.clone(), text.to_string())).collect::<Vec<_>>());
        buffer.take_changes()
    }

    #[test]
    fn folds_follow_edits_above_and_open_when_edited_inside() {
        let mut buffer = Buffer::new("top\nfn a() {\n    b();\n}\n");
        let mut folds = vec![FoldRange { start: 1, end: 2 }];
        let edits = applied(&mut buffer, &[(0..0, "new\n")]);
        map_folds(&mut folds, &edits);
        assert_eq!(folds, vec![FoldRange { start: 2, end: 3 }]);
        // Typing on the header keeps the fold.
        let at = buffer.line_start(2) + 2;
        let edits = applied(&mut buffer, &[(at..at, "x")]);
        map_folds(&mut folds, &edits);
        assert_eq!(folds.len(), 1);
        // An edit inside the hidden lines opens it.
        let at = buffer.line_start(3);
        let edits = applied(&mut buffer, &[(at..at + 1, "")]);
        map_folds(&mut folds, &edits);
        assert!(folds.is_empty());
    }

    #[test]
    fn line_shifts_for_marks() {
        let mut buffer = Buffer::new("a\nb\nc\n");
        let edits = applied(&mut buffer, &[(0..0, "x\ny\n")]);
        assert_eq!(line_shifts(&edits), vec![(0, 2)]);
        let edits = applied(&mut buffer, &[(1..3, "")]);
        assert_eq!(line_shifts(&edits), vec![(1, -1)]);
        // Deleting the whole line `b` of `a\nb\nc\n` moves `c` up onto row 1.
        let mut buffer = Buffer::new("a\nb\nc\n");
        let edits = applied(&mut buffer, &[(2..4, "")]);
        assert_eq!(line_shifts(&edits), vec![(1, -1)]);
    }
}
