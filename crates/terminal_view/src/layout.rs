//! Split terminals: a tree of panes per split group, each leaf one terminal, as Athas's
//! `terminal-layout.ts` keeps them on top of `pane-tree.ts`. A terminal in no tree stands alone
//! in its tab.

/// The smallest share of a split a pane can be dragged to, in percent (`MIN_PANE_SIZE`).
pub(crate) const MIN_PANE_SIZE: f32 = 10.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SplitAxis {
    /// Side by side ("Split Right").
    Horizontal,
    /// One above the other ("Split Down").
    Vertical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Placement {
    Before,
    After,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum PaneNode {
    Leaf(usize),
    Split { id: usize, axis: SplitAxis, sizes: [f32; 2], children: Box<[PaneNode; 2]> },
}

/// A pane of a flattened split: runs of nested splits along the same axis read as one row of
/// panes, as `flattenPaneSplit` lays them out.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct FlatEntry<'a> {
    pub node: &'a PaneNode,
    pub size: f32,
    path: Vec<(usize, usize)>,
}

impl PaneNode {
    pub fn terminal_ids(&self) -> Vec<usize> {
        match self {
            PaneNode::Leaf(id) => vec![*id],
            PaneNode::Split { children, .. } => children.iter().flat_map(PaneNode::terminal_ids).collect(),
        }
    }

    pub fn contains(&self, terminal: usize) -> bool {
        match self {
            PaneNode::Leaf(id) => *id == terminal,
            PaneNode::Split { children, .. } => children.iter().any(|child| child.contains(terminal)),
        }
    }

    fn contains_split(&self, split: usize) -> bool {
        match self {
            PaneNode::Leaf(_) => false,
            PaneNode::Split { id, children, .. } => *id == split || children.iter().any(|child| child.contains_split(split)),
        }
    }

    pub fn is_split(&self) -> bool {
        matches!(self, PaneNode::Split { .. })
    }

    fn split_leaf(&mut self, terminal: usize, new: usize, axis: SplitAxis, placement: Placement, split_id: usize) -> bool {
        match self {
            PaneNode::Leaf(id) if *id == terminal => {
                let existing = PaneNode::Leaf(terminal);
                let added = PaneNode::Leaf(new);
                let children = match placement {
                    Placement::Before => [added, existing],
                    Placement::After => [existing, added],
                };
                *self = PaneNode::Split { id: split_id, axis, sizes: [50., 50.], children: Box::new(children) };
                true
            }
            PaneNode::Leaf(_) => false,
            PaneNode::Split { children, .. } => children.iter_mut().any(|child| child.split_leaf(terminal, new, axis, placement, split_id)),
        }
    }

    /// The tree without `terminal`'s pane: its sibling takes the parent's place. `None` when
    /// the tree was that pane alone.
    fn without(self, terminal: usize) -> Option<PaneNode> {
        match self {
            PaneNode::Leaf(id) => (id != terminal).then_some(PaneNode::Leaf(id)),
            PaneNode::Split { id, axis, sizes, children } => {
                let [first, second] = *children;
                match (first.without(terminal), second.without(terminal)) {
                    (Some(first), Some(second)) => Some(PaneNode::Split { id, axis, sizes, children: Box::new([first, second]) }),
                    (Some(only), None) | (None, Some(only)) => Some(only),
                    (None, None) => None,
                }
            }
        }
    }

    fn find_split(&self, split: usize) -> Option<&PaneNode> {
        match self {
            PaneNode::Leaf(_) => None,
            PaneNode::Split { id, children, .. } => {
                if *id == split {
                    return Some(self);
                }
                children.iter().find_map(|child| child.find_split(split))
            }
        }
    }

    fn split_sizes_mut(&mut self, split: usize) -> Option<&mut [f32; 2]> {
        match self {
            PaneNode::Leaf(_) => None,
            PaneNode::Split { id, sizes, children, .. } => {
                if *id == split {
                    return Some(sizes);
                }
                let [first, second] = &mut **children;
                first.split_sizes_mut(split).or_else(|| second.split_sizes_mut(split))
            }
        }
    }
}

/// The panes of a split in order along its axis, with their share of it in percent.
pub(crate) fn flatten(node: &PaneNode) -> Vec<FlatEntry<'_>> {
    fn walk<'a>(node: &'a PaneNode, parent: f32, path: Vec<(usize, usize)>, out: &mut Vec<FlatEntry<'a>>) {
        let PaneNode::Split { id, axis, sizes, children } = node else { return };
        for (index, child) in children.iter().enumerate() {
            let size = sizes[index] / 100. * parent;
            let mut child_path = path.clone();
            child_path.push((*id, index));
            match child {
                PaneNode::Split { axis: child_axis, .. } if child_axis == axis => walk(child, size, child_path, out),
                _ => out.push(FlatEntry { node: child, size, path: child_path }),
            }
        }
    }
    let mut entries = Vec::new();
    walk(node, 100., Vec::new(), &mut entries);
    entries
}

fn normalize(sizes: [f32; 2]) -> [f32; 2] {
    let first = if sizes[0].is_finite() { sizes[0] } else { 50. };
    let second = if sizes[1].is_finite() { sizes[1] } else { 50. };
    let total = first + second;
    if total <= 0. { [50., 50.] } else { [first / total * 100., second / total * 100.] }
}

/// Writes the flattened sizes back into the nested splits they came from.
fn write_flat_sizes(root: &mut PaneNode, entries: &[(Vec<(usize, usize)>, f32)]) {
    let mut totals: Vec<(usize, [f32; 2])> = Vec::new();
    for (path, size) in entries {
        for (split, index) in path {
            match totals.iter_mut().find(|(id, _)| id == split) {
                Some((_, total)) => total[*index] += size,
                None => {
                    let mut total = [0., 0.];
                    total[*index] = *size;
                    totals.push((*split, total));
                }
            }
        }
    }
    for (split, total) in totals {
        if let Some(sizes) = root.split_sizes_mut(split) {
            *sizes = normalize(total);
        }
    }
}

/// The split groups of a panel, and the ids new splits get.
#[derive(Clone, Debug, Default)]
pub(crate) struct Layouts {
    pub trees: Vec<PaneNode>,
    next_split: usize,
}

impl Layouts {
    pub fn find(&self, terminal: usize) -> Option<&PaneNode> {
        self.trees.iter().find(|tree| tree.contains(terminal))
    }

    /// The terminals shown together with `terminal`, itself included.
    pub fn members(&self, terminal: usize) -> Vec<usize> {
        self.find(terminal).map(PaneNode::terminal_ids).unwrap_or_else(|| vec![terminal])
    }

    pub fn is_split(&self, terminal: usize) -> bool {
        self.find(terminal).is_some()
    }

    /// Puts `new` beside `terminal`: after it (right or below) or before it. `new` leaves any
    /// split it was in first.
    pub fn split(&mut self, terminal: usize, new: usize, axis: SplitAxis, placement: Placement) {
        if terminal == new {
            return;
        }
        self.remove(new);
        self.next_split += 1;
        let split_id = self.next_split;
        match self.trees.iter_mut().find(|tree| tree.contains(terminal)) {
            Some(tree) => {
                tree.split_leaf(terminal, new, axis, placement, split_id);
            }
            None => {
                let mut tree = PaneNode::Leaf(terminal);
                tree.split_leaf(terminal, new, axis, placement, split_id);
                self.trees.push(tree);
            }
        }
    }

    /// Adds a restored split group, numbering its splits; a lone pane is no group.
    pub fn insert_tree(&mut self, mut tree: PaneNode) {
        fn number(node: &mut PaneNode, next: &mut usize) {
            if let PaneNode::Split { id, children, .. } = node {
                *next += 1;
                *id = *next;
                children.iter_mut().for_each(|child| number(child, next));
            }
        }
        if !tree.is_split() || tree.terminal_ids().iter().any(|id| self.is_split(*id)) {
            return;
        }
        number(&mut tree, &mut self.next_split);
        self.trees.push(tree);
    }

    /// Takes `terminal` out of its split; a tree left with one pane dissolves.
    pub fn remove(&mut self, terminal: usize) {
        let trees = std::mem::take(&mut self.trees);
        self.trees = trees
            .into_iter()
            .filter_map(|tree| if tree.contains(terminal) { tree.without(terminal) } else { Some(tree) })
            .filter(PaneNode::is_split)
            .collect();
    }

    /// Moves the edge between the `index`th pane of a flattened split and the next to `sizes`
    /// (percent of the two together).
    pub fn resize(&mut self, split: usize, index: usize, sizes: [f32; 2]) {
        let Some(tree) = self.trees.iter_mut().find(|tree| tree.contains_split(split)) else { return };
        let Some(node) = tree.find_split(split) else { return };
        let entries = flatten(node);
        if index + 1 >= entries.len() {
            return;
        }
        let mut next: Vec<(Vec<(usize, usize)>, f32)> = entries.iter().map(|entry| (entry.path.clone(), entry.size)).collect();
        let pair = next[index].1 + next[index + 1].1;
        let sizes = normalize(sizes);
        next[index].1 = sizes[0] / 100. * pair;
        next[index + 1].1 = sizes[1] / 100. * pair;
        write_flat_sizes(tree, &next);
    }

    /// Gives every pane of a flattened split the same share (double-clicking a divider).
    pub fn distribute(&mut self, split: usize) {
        let Some(tree) = self.trees.iter_mut().find(|tree| tree.contains_split(split)) else { return };
        let Some(node) = tree.find_split(split) else { return };
        let entries = flatten(node);
        if entries.is_empty() {
            return;
        }
        let total: f32 = entries.iter().map(|entry| entry.size).sum();
        let equal = total / entries.len() as f32;
        let next: Vec<(Vec<(usize, usize)>, f32)> = entries.iter().map(|entry| (entry.path.clone(), equal)).collect();
        write_flat_sizes(tree, &next);
    }

    /// The pane after (`1`) or before (`-1`) `terminal` in its split, wrapping around.
    pub fn adjacent(&self, terminal: usize, offset: isize) -> Option<usize> {
        let ids = self.find(terminal)?.terminal_ids();
        let index = ids.iter().position(|id| *id == terminal)?;
        if ids.len() < 2 {
            return None;
        }
        let len = ids.len() as isize;
        ids.get(((index as isize + offset + len) % len) as usize).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sizes(layouts: &Layouts, terminal: usize) -> Vec<f32> {
        flatten(layouts.find(terminal).unwrap()).iter().map(|entry| entry.size.round()).collect()
    }

    #[test]
    fn splits_and_unsplits() {
        let mut layouts = Layouts::default();
        layouts.split(1, 2, SplitAxis::Horizontal, Placement::After);
        assert_eq!(layouts.members(1), vec![1, 2]);
        layouts.split(2, 3, SplitAxis::Horizontal, Placement::After);
        assert_eq!(layouts.members(3), vec![1, 2, 3]);
        assert_eq!(sizes(&layouts, 1), vec![50., 25., 25.]);
        layouts.split(1, 4, SplitAxis::Vertical, Placement::Before);
        assert_eq!(layouts.members(1), vec![4, 1, 2, 3]);
        assert_eq!(layouts.members(9), vec![9]);

        layouts.remove(2);
        layouts.remove(3);
        assert_eq!(layouts.members(1), vec![4, 1]);
        layouts.remove(4);
        assert!(layouts.trees.is_empty());
        assert!(!layouts.is_split(1));
    }

    #[test]
    fn resizes_flattened_panes() {
        let mut layouts = Layouts::default();
        layouts.split(1, 2, SplitAxis::Horizontal, Placement::After);
        layouts.split(2, 3, SplitAxis::Horizontal, Placement::After);
        let PaneNode::Split { id, .. } = layouts.trees[0] else { panic!() };
        layouts.resize(id, 1, [80., 20.]);
        assert_eq!(sizes(&layouts, 1), vec![50., 40., 10.]);
        layouts.resize(id, 0, [25., 75.]);
        assert_eq!(sizes(&layouts, 1), vec![23., 67., 10.]);
        layouts.distribute(id);
        assert_eq!(sizes(&layouts, 1), vec![33., 33., 33.]);
    }

    #[test]
    fn moves_between_panes() {
        let mut layouts = Layouts::default();
        layouts.split(1, 2, SplitAxis::Horizontal, Placement::After);
        layouts.split(2, 3, SplitAxis::Vertical, Placement::After);
        assert_eq!(layouts.adjacent(3, 1), Some(1));
        assert_eq!(layouts.adjacent(1, -1), Some(3));
        assert_eq!(layouts.adjacent(5, 1), None);
    }
}
