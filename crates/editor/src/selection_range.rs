//! Expand selection through the language server (`use-active-navigation.ts`): the
//! `textDocument/selectionRange` chain at the caret, kept while the text is unchanged so repeated
//! expands step outwards without asking again; syntax nodes when the server has nothing larger.

use std::ops::Range;

use gpui::{Context, Task};
use lsp_client::{lsp, offset_to_position, position_to_offset};
use ropey::Rope;

use crate::{Autoscroll, Editor};

#[derive(Default)]
pub(crate) struct SelectionRangeState {
    /// The chain at the last asked position, innermost first, for one buffer version.
    cached: Option<(usize, Vec<Range<usize>>)>,
    task: Option<Task<()>>,
}

/// The chain as offset ranges, innermost first, without repeats.
pub(crate) fn flatten(rope: &Rope, range: Option<&lsp::SelectionRange>) -> Vec<Range<usize>> {
    let mut ranges: Vec<Range<usize>> = Vec::new();
    let mut current = range;
    while let Some(selection) = current {
        let start = position_to_offset(rope, selection.range.start);
        let end = position_to_offset(rope, selection.range.end).max(start);
        if ranges.last() != Some(&(start..end)) {
            ranges.push(start..end);
        }
        current = selection.parent.as_deref();
    }
    ranges
}

/// The smallest range that strictly contains `selection` (`expandSelectionTarget`).
pub(crate) fn expand_target(ranges: &[Range<usize>], selection: &Range<usize>) -> Option<Range<usize>> {
    ranges
        .iter()
        .filter(|range| range.start <= selection.start && range.end >= selection.end && (range.start < selection.start || range.end > selection.end))
        .min_by_key(|range| range.end - range.start)
        .cloned()
}

impl Editor {
    /// Expands the single selection with the server's selection ranges. Returns false when the
    /// server cannot help, so the caller grows by syntax instead.
    pub(crate) fn expand_selection_with_lsp(&mut self, cx: &mut Context<Self>) -> bool {
        if self.document.selections.len() != 1 {
            return false;
        }
        let Some(document) = self.lsp.document.clone() else { return false };
        let supported = document
            .server()
            .capabilities()
            .and_then(|capabilities| capabilities.selection_range_provider.as_ref())
            .is_some_and(|provider| !matches!(provider, lsp::SelectionRangeProviderCapability::Simple(false)));
        if !supported {
            return false;
        }
        let selection = self.document.newest_selection().range();
        let version = self.document.buffer.version();
        if let Some((cached_version, ranges)) = &self.selection_ranges.cached
            && *cached_version == version
            && let Some(target) = expand_target(ranges, &selection)
        {
            self.select_expanded(target, cx);
            return true;
        }
        let head = self.document.newest_selection().head;
        let offset = if selection.is_empty() { head } else { selection.start };
        let position = offset_to_position(self.document.buffer.rope(), offset);
        let request = document.server().request::<lsp::request::SelectionRangeRequest>(lsp::SelectionRangeParams {
            text_document: document.identifier(),
            positions: vec![position],
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        });
        self.selection_ranges.task = Some(cx.spawn(async move |this, cx| {
            let response = request.await;
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() != version {
                    return;
                }
                let ranges = match &response {
                    Ok(Some(ranges)) => flatten(editor.document.buffer.rope(), ranges.first()),
                    _ => Vec::new(),
                };
                let target = expand_target(&ranges, &selection);
                editor.selection_ranges.cached = Some((version, ranges));
                match target {
                    Some(target) if editor.document.newest_selection().range() == selection => editor.select_expanded(target, cx),
                    Some(_) => {}
                    None => editor.expand_selection_by_syntax(cx),
                }
            })
            .ok();
        }));
        true
    }

    fn select_expanded(&mut self, target: Range<usize>, cx: &mut Context<Self>) {
        self.selection_stack.push(self.document.selections.clone());
        self.document.select_range(target);
        self.autoscroll = Some(Autoscroll::Fit);
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(rope: &Rope, start: usize, end: usize, parent: Option<lsp::SelectionRange>) -> lsp::SelectionRange {
        lsp::SelectionRange { range: lsp::Range::new(offset_to_position(rope, start), offset_to_position(rope, end)), parent: parent.map(Box::new) }
    }

    #[test]
    fn flattens_and_expands_outwards() {
        let rope = Rope::from_str("fn main() { let value = 1; }\n");
        let outer = range(&rope, 0, 28, None);
        let block = range(&rope, 10, 28, Some(outer));
        let statement = range(&rope, 12, 26, Some(block));
        let word = range(&rope, 16, 21, Some(statement));
        let same = range(&rope, 16, 21, Some(word));
        let ranges = flatten(&rope, Some(&same));
        assert_eq!(ranges, vec![16..21, 12..26, 10..28, 0..28]);
        assert_eq!(expand_target(&ranges, &(18..18)), Some(16..21));
        assert_eq!(expand_target(&ranges, &(16..21)), Some(12..26));
        assert_eq!(expand_target(&ranges, &(13..22)), Some(12..26));
        assert_eq!(expand_target(&ranges, &(0..28)), None);
    }
}
