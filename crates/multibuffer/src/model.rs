//! What a multibuffer lists: its sections flattened into list entries, and the navigator's rows
//! (`file-navigator-sidebar` and `utils/path-tree` of Athas).

use std::collections::HashSet;

use gpui::SharedString;

/// The colour a navigator icon or reading takes (`FileNavigatorTone`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Tone {
    #[default]
    Neutral,
    Subtle,
    Added,
    Deleted,
    Modified,
    Renamed,
    Error,
    Info,
    Warning,
}

/// One file's slice of a multibuffer: a sticky header over `rows` body rows the owner draws.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Section {
    /// Doubles as the navigator key.
    pub key: SharedString,
    /// The path shown, relative to the project.
    pub path: SharedString,
    /// The file name the icon is picked by, when it differs from `path`.
    pub icon_path: Option<SharedString>,
    pub tone: Tone,
    /// Readings beside the navigator row, such as `+3` and `-1`.
    pub metadata: Vec<(SharedString, Tone)>,
    /// Readings at the end of the header, such as `:12` and `3 matches`.
    pub trailing: Vec<(SharedString, Tone)>,
    pub rows: usize,
}

impl Section {
    pub fn new(key: impl Into<SharedString>, path: impl Into<SharedString>, rows: usize) -> Self {
        Self { key: key.into(), path: path.into(), rows, ..Default::default() }
    }

    pub fn name(&self) -> &str {
        self.path.rsplit('/').next().unwrap_or(&self.path)
    }

    pub fn dir(&self) -> &str {
        self.path.rsplit_once('/').map_or("", |(dir, _)| dir)
    }

    pub fn icon_name(&self) -> &str {
        let path = self.icon_path.as_ref().unwrap_or(&self.path);
        path.rsplit(['/', '\\']).next().unwrap_or(path)
    }
}

/// A row of the multibuffer's list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Entry {
    Header(usize),
    /// A section's body row: the section, then the row within it.
    Row(usize, usize),
    /// After the last section, when the owner asked for one (a "load more" row).
    Footer,
}

/// The list entries of `sections`, with collapsed sections showing their header alone, and the
/// entry index of each section's header.
pub fn flatten(sections: &[Section], collapsed: &HashSet<SharedString>, footer: bool) -> (Vec<Entry>, Vec<usize>) {
    let mut entries = Vec::with_capacity(sections.iter().map(|section| section.rows + 1).sum::<usize>() + 1);
    let mut starts = Vec::with_capacity(sections.len());
    for (index, section) in sections.iter().enumerate() {
        starts.push(entries.len());
        entries.push(Entry::Header(index));
        if !collapsed.contains(&section.key) {
            entries.extend((0..section.rows).map(|row| Entry::Row(index, row)));
        }
    }
    if footer {
        entries.push(Entry::Footer);
    }
    (entries, starts)
}

/// The section an entry belongs to; `None` for the footer or past the end.
pub fn section_at(starts: &[usize], entry: usize, total: usize) -> Option<usize> {
    if entry >= total || starts.is_empty() || entry < starts[0] {
        return None;
    }
    Some(starts.partition_point(|&start| start <= entry) - 1)
}

/// How the navigator lists files.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NavigatorMode {
    #[default]
    Flat,
    Tree,
}

/// A fuzzy score of `query` against `text`: every character in order, case ignored, higher for
/// runs and word starts. `None` when it does not match.
pub fn fuzzy_score(text: &str, query: &str) -> Option<i64> {
    let query: Vec<char> = query.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect();
    if query.is_empty() {
        return Some(0);
    }
    let mut score = 0i64;
    let mut next = 0;
    let mut previous: Option<usize> = None;
    let mut last_char = '/';
    for (index, ch) in text.chars().enumerate() {
        if next == query.len() {
            break;
        }
        if ch.to_lowercase().next() == Some(query[next]) {
            score += 1;
            if previous.is_some_and(|previous| previous + 1 == index) {
                score += 4;
            }
            if matches!(last_char, '/' | '\\' | '_' | '-' | '.' | ' ') {
                score += 3;
            }
            previous = Some(index);
            next += 1;
        }
        last_char = ch;
    }
    (next == query.len()).then_some(score - text.chars().count() as i64 / 16)
}

/// The sections a navigator filter keeps, best match first (in order when the filter is empty).
pub fn filter_sections(sections: &[Section], query: &str) -> Vec<usize> {
    let query = query.trim();
    if query.is_empty() {
        return (0..sections.len()).collect();
    }
    let mut scored: Vec<(i64, usize)> = sections
        .iter()
        .enumerate()
        .filter_map(|(index, section)| {
            [section.name(), section.path.as_ref(), section.dir(), section.key.as_ref()]
                .into_iter()
                .filter(|field| !field.is_empty())
                .filter_map(|field| fuzzy_score(field, query))
                .max()
                .map(|score| (score, index))
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    scored.into_iter().map(|(_, index)| index).collect()
}

/// A row of the navigator's tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TreeRow {
    /// A folder, with single-child folder chains joined (`src/features`).
    Dir { id: String, label: String, depth: usize, expanded: bool },
    File { section: usize, label: String, depth: usize },
}

#[derive(Default)]
struct Node {
    dirs: Vec<(String, Node)>,
    files: Vec<(String, usize)>,
}

impl Node {
    fn dir(&mut self, name: &str) -> &mut Node {
        let index = match self.dirs.iter().position(|(dir, _)| dir == name) {
            Some(index) => index,
            None => {
                self.dirs.push((name.to_string(), Node::default()));
                self.dirs.len() - 1
            }
        };
        &mut self.dirs[index].1
    }
}

/// The tree rows of the kept sections. Folders in `collapsed` hide their children unless
/// `force_expanded` (while filtering every folder with a match stays open).
pub fn tree_rows(sections: &[Section], kept: &[usize], collapsed: &HashSet<String>, force_expanded: bool) -> Vec<TreeRow> {
    let mut root = Node::default();
    for &index in kept {
        let path = sections[index].path.as_ref();
        let mut parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
        let Some(name) = parts.pop() else { continue };
        let mut node = &mut root;
        for part in parts {
            node = node.dir(part);
        }
        node.files.push((name.to_string(), index));
    }
    let mut rows = Vec::new();
    push_rows(&mut root, "", 0, collapsed, force_expanded, &mut rows);
    rows
}

fn push_rows(node: &mut Node, prefix: &str, depth: usize, collapsed: &HashSet<String>, force: bool, rows: &mut Vec<TreeRow>) {
    node.dirs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    node.files.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    for (name, child) in &mut node.dirs {
        let mut label = name.clone();
        let mut id = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let mut child = child;
        while child.files.is_empty() && child.dirs.len() == 1 {
            let (next_name, next) = &mut child.dirs[0];
            label = format!("{label}/{next_name}");
            id = format!("{id}/{next_name}");
            child = next;
        }
        let expanded = force || !collapsed.contains(&id);
        rows.push(TreeRow::Dir { id: id.clone(), label, depth, expanded });
        if expanded {
            push_rows(child, &id, depth + 1, collapsed, force, rows);
        }
    }
    for (name, section) in &node.files {
        rows.push(TreeRow::File { section: *section, label: name.clone(), depth });
    }
}

/// What a key does in the navigator (`SidebarTree`'s keyboard handling).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NavAction {
    Select(usize),
    Expand(String),
    Collapse(String),
    Open(usize),
}

impl TreeRow {
    fn depth(&self) -> usize {
        match self {
            TreeRow::Dir { depth, .. } | TreeRow::File { depth, .. } => *depth,
        }
    }
}

/// Up/Down/Home/End move; Right opens a folder, then steps into it; Left closes it, then steps to
/// its parent; Enter or Space opens a file or toggles a folder.
pub fn navigate(rows: &[TreeRow], current: usize, key: &str) -> Option<NavAction> {
    let last = rows.len().checked_sub(1)?;
    let current = current.min(last);
    let row = &rows[current];
    match (key, row) {
        ("down", _) => Some(NavAction::Select((current + 1).min(last))),
        ("up", _) => Some(NavAction::Select(current.saturating_sub(1))),
        ("home", _) => Some(NavAction::Select(0)),
        ("end", _) => Some(NavAction::Select(last)),
        ("right", TreeRow::Dir { id, expanded: false, .. }) => Some(NavAction::Expand(id.clone())),
        ("right", TreeRow::Dir { depth, expanded: true, .. }) => {
            rows.get(current + 1).filter(|next| next.depth() == depth + 1).map(|_| NavAction::Select(current + 1))
        }
        ("left", TreeRow::Dir { id, expanded: true, .. }) => Some(NavAction::Collapse(id.clone())),
        ("left", _) => rows[..current].iter().rposition(|candidate| candidate.depth() < row.depth()).map(NavAction::Select),
        ("enter" | "space", TreeRow::File { section, .. }) => Some(NavAction::Open(*section)),
        ("enter" | "space", TreeRow::Dir { id, expanded, .. }) => Some(if *expanded { NavAction::Collapse(id.clone()) } else { NavAction::Expand(id.clone()) }),
        _ => None,
    }
}

pub const DEFAULT_NAVIGATOR_WIDTH: f32 = 224.;
const MIN_NAVIGATOR_WIDTH: f32 = 176.;
const MAX_NAVIGATOR_WIDTH: f32 = 420.;

/// The navigator's width: what was asked for, within its limits and at most half the pane.
pub fn navigator_width(preferred: f32, parent: Option<f32>) -> f32 {
    let max = parent.map_or(MAX_NAVIGATOR_WIDTH, |parent| MAX_NAVIGATOR_WIDTH.min((parent * 0.5).floor()).max(0.));
    let min = MIN_NAVIGATOR_WIDTH.min(max);
    preferred.round().clamp(min, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigates_the_tree_with_keys() {
        let dir = |id: &str, depth, expanded| TreeRow::Dir { id: id.into(), label: id.into(), depth, expanded };
        let file = |section, depth| TreeRow::File { section, label: String::new(), depth };
        let rows = vec![dir("src", 0, true), file(0, 1), file(1, 1), dir("docs", 0, false), file(2, 0)];
        assert_eq!(navigate(&rows, 0, "down"), Some(NavAction::Select(1)));
        assert_eq!(navigate(&rows, 4, "down"), Some(NavAction::Select(4)));
        assert_eq!(navigate(&rows, 0, "up"), Some(NavAction::Select(0)));
        assert_eq!(navigate(&rows, 2, "home"), Some(NavAction::Select(0)));
        assert_eq!(navigate(&rows, 0, "end"), Some(NavAction::Select(4)));
        assert_eq!(navigate(&rows, 0, "right"), Some(NavAction::Select(1)));
        assert_eq!(navigate(&rows, 3, "right"), Some(NavAction::Expand("docs".into())));
        assert_eq!(navigate(&rows, 0, "left"), Some(NavAction::Collapse("src".into())));
        assert_eq!(navigate(&rows, 2, "left"), Some(NavAction::Select(0)));
        assert_eq!(navigate(&rows, 4, "left"), None);
        assert_eq!(navigate(&rows, 2, "enter"), Some(NavAction::Open(1)));
        assert_eq!(navigate(&rows, 3, "space"), Some(NavAction::Expand("docs".into())));
        assert_eq!(navigate(&[], 0, "down"), None);
    }

    fn sections(paths: &[(&str, usize)]) -> Vec<Section> {
        paths.iter().map(|(path, rows)| Section::new(*path, *path, *rows)).collect()
    }

    #[test]
    fn flattens_with_collapsed_sections_and_footer() {
        let sections = sections(&[("a.rs", 2), ("b.rs", 1), ("c.rs", 0)]);
        let collapsed: HashSet<SharedString> = ["b.rs".into()].into_iter().collect();
        let (entries, starts) = flatten(&sections, &collapsed, true);
        assert_eq!(entries, [Entry::Header(0), Entry::Row(0, 0), Entry::Row(0, 1), Entry::Header(1), Entry::Header(2), Entry::Footer]);
        assert_eq!(starts, [0, 3, 4]);
        assert_eq!(section_at(&starts, 2, entries.len()), Some(0));
        assert_eq!(section_at(&starts, 3, entries.len()), Some(1));
        assert_eq!(section_at(&starts, 5, entries.len()), Some(2));
        assert_eq!(section_at(&starts, 6, entries.len()), None);
    }

    #[test]
    fn filters_fuzzily_best_first() {
        let sections = sections(&[("src/git/diff.rs", 0), ("src/main.rs", 0), ("docs/guide.md", 0)]);
        assert_eq!(filter_sections(&sections, ""), [0, 1, 2]);
        assert_eq!(filter_sections(&sections, "main"), [1]);
        assert_eq!(filter_sections(&sections, "gd"), [0, 2]);
        assert!(filter_sections(&sections, "zzz").is_empty());
        assert!(fuzzy_score("Diff.rs", "DIFF").is_some());
    }

    #[test]
    fn builds_a_compacted_tree() {
        let sections = sections(&[("src/features/git/a.rs", 0), ("src/features/git/b.rs", 0), ("README.md", 0), ("src/lib.rs", 0)]);
        let kept: Vec<usize> = (0..sections.len()).collect();
        let rows = tree_rows(&sections, &kept, &HashSet::new(), false);
        assert_eq!(
            rows,
            [
                TreeRow::Dir { id: "src".into(), label: "src".into(), depth: 0, expanded: true },
                TreeRow::Dir { id: "src/features/git".into(), label: "features/git".into(), depth: 1, expanded: true },
                TreeRow::File { section: 0, label: "a.rs".into(), depth: 2 },
                TreeRow::File { section: 1, label: "b.rs".into(), depth: 2 },
                TreeRow::File { section: 3, label: "lib.rs".into(), depth: 1 },
                TreeRow::File { section: 2, label: "README.md".into(), depth: 0 },
            ]
        );
        let collapsed: HashSet<String> = ["src".to_string()].into_iter().collect();
        assert_eq!(tree_rows(&sections, &kept, &collapsed, false).len(), 2);
        assert_eq!(tree_rows(&sections, &kept, &collapsed, true).len(), 6);
    }

    #[test]
    fn clamps_the_navigator_width() {
        assert_eq!(navigator_width(224., None), 224.);
        assert_eq!(navigator_width(1000., None), 420.);
        assert_eq!(navigator_width(10., None), 176.);
        assert_eq!(navigator_width(300., Some(400.)), 200.);
        assert_eq!(navigator_width(300., Some(300.)), 150.);
    }
}
