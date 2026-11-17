//! Selections: an anchor and a head (the cursor) per caret, kept sorted and disjoint.

use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    /// Order of creation; the newest selection is the one the view follows.
    pub id: usize,
    pub anchor: usize,
    pub head: usize,
    /// The display column vertical motion aims for, kept across short lines.
    pub goal_column: Option<usize>,
}

impl Selection {
    pub fn cursor(id: usize, offset: usize) -> Self {
        Self { id, anchor: offset, head: offset, goal_column: None }
    }

    pub fn start(&self) -> usize {
        self.anchor.min(self.head)
    }

    pub fn end(&self) -> usize {
        self.anchor.max(self.head)
    }

    pub fn range(&self) -> Range<usize> {
        self.start()..self.end()
    }

    pub fn is_empty(&self) -> bool {
        self.anchor == self.head
    }

    pub fn reversed(&self) -> bool {
        self.head < self.anchor
    }

    /// Puts the cursor at `offset` with nothing selected.
    pub fn collapse_to(&mut self, offset: usize) {
        self.anchor = offset;
        self.head = offset;
        self.goal_column = None;
    }

    pub fn select_to(&mut self, offset: usize) {
        self.head = offset;
        self.goal_column = None;
    }

    pub fn set_range(&mut self, range: Range<usize>, reversed: bool) {
        if reversed {
            self.anchor = range.end;
            self.head = range.start;
        } else {
            self.anchor = range.start;
            self.head = range.end;
        }
        self.goal_column = None;
    }
}

/// Sorts selections and merges the ones that overlap (or touch, when both are carets at the same
/// spot).
pub fn normalize(mut selections: Vec<Selection>) -> Vec<Selection> {
    selections.sort_by_key(|selection| (selection.start(), selection.end()));
    let mut merged: Vec<Selection> = Vec::with_capacity(selections.len());
    for selection in selections {
        if let Some(last) = merged.last_mut() {
            let same_caret = last.is_empty() && selection.is_empty() && last.head == selection.head;
            if selection.start() < last.end() || same_caret {
                let start = last.start().min(selection.start());
                let end = last.end().max(selection.end());
                let reversed = last.reversed();
                let id = last.id.max(selection.id);
                let goal = if selection.id > last.id { selection.goal_column } else { last.goal_column };
                last.set_range(start..end, reversed);
                last.id = id;
                last.goal_column = goal;
                continue;
            }
        }
        merged.push(selection);
    }
    merged
}

/// The selections' positions match, regardless of ids and goal columns.
pub fn same_positions(a: &[Selection], b: &[Selection]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.anchor == b.anchor && a.head == b.head)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sel(id: usize, anchor: usize, head: usize) -> Selection {
        Selection { id, anchor, head, goal_column: None }
    }

    #[test]
    fn overlapping_selections_merge() {
        let merged = normalize(vec![sel(0, 5, 10), sel(1, 0, 6), sel(2, 20, 20), sel(3, 20, 20)]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].range(), 0..10);
        assert_eq!(merged[0].id, 1);
        assert_eq!(merged[1].range(), 20..20);
    }

    #[test]
    fn touching_ranges_stay_apart() {
        let merged = normalize(vec![sel(0, 0, 3), sel(1, 3, 6)]);
        assert_eq!(merged.len(), 2);
    }
}
