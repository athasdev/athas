//! The tree without the UI: loaded folder listings, which folders are open, and the flat list of
//! rows they produce (`lib/visible-file-tree-rows.ts`, `services/file-tree-utils.ts`).

use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
};

use ignore::gitignore::{Gitignore, GitignoreBuilder};

use crate::fs::DirEntry;

/// OS litter the tree never lists (`shouldHideFromFileTree`), matched case-insensitively.
const OS_GENERATED_NAMES: &[&str] = &[
    ".ds_store",
    ".ds_store?",
    "._*",
    ".spotlight-v100",
    ".trashes",
    ".fseventsd",
    ".documentrevisions-v100",
    ".volumeicon.icns",
    ".com.apple.timemachine.donotpresent",
    ".appledb",
    ".appledesktop",
    "network trash folder",
    ".temporaryitems",
    ".temporary items",
    "thumbs.db",
    "ehthumbs.db",
    "desktop.ini",
    "$recycle.bin",
    "system volume information",
];

pub fn is_os_generated(name: &str) -> bool {
    let name = name.to_lowercase();
    OS_GENERATED_NAMES.iter().any(|pattern| match pattern.strip_suffix('*') {
        Some(prefix) => name.starts_with(prefix),
        None => name == *pattern,
    })
}

/// Dotfiles, which the "Hidden Files" preference hides.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') && name.len() > 1
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SortOrder {
    #[default]
    FoldersFirst,
    Name,
}

/// Where a character falls in the collation Athas sorts names with: punctuation, then digits,
/// then letters.
fn char_class(c: char) -> u8 {
    if c.is_alphabetic() {
        2
    } else if c.is_numeric() {
        1
    } else {
        0
    }
}

/// Compares names the way the web tree's `Intl.Collator` does on lowercased names, closely
/// enough for file names: case-insensitive, punctuation before digits before letters.
pub fn compare_names(left: &str, right: &str) -> Ordering {
    let mut left_chars = left.chars().flat_map(char::to_lowercase);
    let mut right_chars = right.chars().flat_map(char::to_lowercase);
    loop {
        match (left_chars.next(), right_chars.next()) {
            (None, None) => return left.cmp(right),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(l), Some(r)) if l == r => continue,
            (Some(l), Some(r)) => {
                return char_class(l).cmp(&char_class(r)).then(l.cmp(&r));
            }
        }
    }
}

pub fn sort_entries(entries: &mut [DirEntry], order: SortOrder) {
    entries.sort_by(|left, right| {
        if order == SortOrder::FoldersFirst && left.is_dir != right.is_dir {
            return if left.is_dir { Ordering::Less } else { Ordering::Greater };
        }
        compare_names(&left.name, &right.name)
    });
}

impl SortOrder {
    /// `fileTreeSortOrder`: "folders-first" or "name".
    pub fn from_setting(value: &str) -> Self {
        if value == "name" { SortOrder::Name } else { SortOrder::FoldersFirst }
    }
}

/// `hiddenFilePatterns` and `hiddenDirectoryPatterns`: gitignore-style patterns relative to the
/// project root that the tree never lists; directory patterns match folders only.
#[derive(Clone, Default)]
pub struct HiddenPatterns {
    files: Vec<String>,
    dirs: Vec<String>,
    matcher: Option<Arc<Gitignore>>,
}

impl std::fmt::Debug for HiddenPatterns {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HiddenPatterns").field("files", &self.files).field("dirs", &self.dirs).finish()
    }
}

impl PartialEq for HiddenPatterns {
    fn eq(&self, other: &Self) -> bool {
        self.files == other.files && self.dirs == other.dirs && self.matcher.is_some() == other.matcher.is_some()
    }
}

impl HiddenPatterns {
    pub fn new(root: &Path, files: &[String], dirs: &[String]) -> Self {
        let clean = |patterns: &[String]| -> Vec<String> {
            patterns.iter().map(|pattern| pattern.trim().to_string()).filter(|pattern| !pattern.is_empty()).collect()
        };
        let (files, dirs) = (clean(files), clean(dirs));
        if files.is_empty() && dirs.is_empty() {
            return Self { files, dirs, matcher: None };
        }
        let mut builder = GitignoreBuilder::new(root);
        for pattern in &files {
            builder.add_line(None, pattern).ok();
        }
        for pattern in &dirs {
            let pattern = if pattern.ends_with('/') { pattern.clone() } else { format!("{pattern}/") };
            builder.add_line(None, &pattern).ok();
        }
        let matcher = builder.build().ok().map(Arc::new);
        Self { files, dirs, matcher }
    }

    pub fn hides(&self, path: &Path, is_dir: bool) -> bool {
        let Some(matcher) = &self.matcher else { return false };
        path.strip_prefix(matcher.path()).is_ok_and(|relative| !relative.as_os_str().is_empty())
            && matcher.matched(path, is_dir).is_ignore()
    }
}

/// What the rows show and leave out: the Files preferences.
#[derive(Clone, Debug, PartialEq)]
pub struct ViewOptions {
    pub sort_order: SortOrder,
    pub show_hidden: bool,
    pub show_ignored: bool,
    /// Chains of single folders collapse into one row ("src/features/files").
    pub compact_folders: bool,
    pub hide_root: bool,
    pub hidden_patterns: HiddenPatterns,
}

impl Default for ViewOptions {
    fn default() -> Self {
        Self {
            sort_order: SortOrder::FoldersFirst,
            show_hidden: true,
            show_ignored: true,
            compact_folders: false,
            hide_root: false,
            hidden_patterns: HiddenPatterns::default(),
        }
    }
}

/// A name field that is not an entry yet: a file or folder being created inside `parent`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Draft {
    pub parent: PathBuf,
    pub is_dir: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub path: PathBuf,
    /// The name shown; compact folders join their chain with `/`.
    pub label: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub depth: usize,
    pub expanded: bool,
    pub ignored: bool,
    /// The name field of a new entry; `path` is its parent folder.
    pub draft: bool,
}

/// The loaded part of one project's tree.
pub struct TreeModel {
    root: PathBuf,
    /// Folders added to the workspace beside the root, listed after it.
    extra_roots: Vec<PathBuf>,
    /// Listings of the folders read so far, unsorted and unfiltered.
    listings: HashMap<PathBuf, Vec<DirEntry>>,
    expanded: HashSet<PathBuf>,
}

impl TreeModel {
    /// The root starts open, as `expandRootOnce` opens it.
    pub fn new(root: PathBuf) -> Self {
        let expanded = HashSet::from([root.clone()]);
        Self { root, extra_roots: Vec::new(), listings: HashMap::new(), expanded }
    }

    /// Lists `root` after the project's own folder, open.
    pub fn add_root(&mut self, root: PathBuf) {
        if root != self.root && !self.extra_roots.contains(&root) {
            self.expanded.insert(root.clone());
            self.extra_roots.push(root);
        }
    }

    pub fn remove_root(&mut self, root: &Path) {
        self.extra_roots.retain(|extra| extra != root);
        self.forget(root);
    }

    pub fn extra_roots(&self) -> &[PathBuf] {
        &self.extra_roots
    }

    pub fn is_root(&self, path: &Path) -> bool {
        path == self.root || self.extra_roots.iter().any(|root| root == path)
    }

    /// The workspace folder `path` is in: the deepest root that holds it.
    pub fn root_of(&self, path: &Path) -> &Path {
        std::iter::once(&self.root)
            .chain(&self.extra_roots)
            .filter(|root| path.starts_with(root))
            .max_by_key(|root| root.as_os_str().len())
            .map_or(self.root.as_path(), PathBuf::as_path)
    }

    pub fn root_name(&self) -> String {
        self.root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.root.to_string_lossy().into_owned())
    }

    pub fn set_listing(&mut self, dir: PathBuf, entries: Vec<DirEntry>) {
        self.listings.insert(dir, entries);
    }

    pub fn is_loaded(&self, dir: &Path) -> bool {
        self.listings.contains_key(dir)
    }

    pub fn loaded_dirs(&self) -> Vec<PathBuf> {
        self.listings.keys().cloned().collect()
    }

    #[cfg(test)]
    pub fn listing(&self, dir: &Path) -> Option<&[DirEntry]> {
        self.listings.get(dir).map(Vec::as_slice)
    }

    pub fn is_expanded(&self, dir: &Path) -> bool {
        self.expanded.contains(dir)
    }

    pub fn set_expanded(&mut self, dir: &Path, expanded: bool) {
        if expanded {
            self.expanded.insert(dir.to_path_buf());
        } else {
            self.expanded.remove(dir);
        }
    }

    /// Closes every folder, the root included, as the header's Collapse All does.
    pub fn collapse_all(&mut self) {
        self.expanded.clear();
    }

    /// Closes `dir` and every folder inside it.
    pub fn collapse_within(&mut self, dir: &Path) {
        self.expanded.retain(|path| !path.starts_with(dir));
    }

    /// Opens every folder from the root down to `path`'s parent, and returns the ones that still
    /// need reading.
    pub fn expand_to(&mut self, path: &Path) -> Vec<PathBuf> {
        let mut unloaded = Vec::new();
        let root = self.root_of(path).to_path_buf();
        let Ok(relative) = path.strip_prefix(&root) else { return unloaded };
        let mut current = root;
        let components: Vec<_> = relative.components().collect();
        for (index, component) in components.iter().enumerate() {
            if !self.is_loaded(&current) {
                unloaded.push(current.clone());
            }
            self.expanded.insert(current.clone());
            if index + 1 == components.len() {
                break;
            }
            current.push(component);
        }
        unloaded
    }

    /// Opens `dir` and every folder above it; returns the ones that still need reading.
    pub fn expand_dir(&mut self, dir: &Path) -> Vec<PathBuf> {
        let mut unloaded = if self.is_root(dir) { Vec::new() } else { self.expand_to(dir) };
        self.expanded.insert(dir.to_path_buf());
        if !self.is_loaded(dir) {
            unloaded.push(dir.to_path_buf());
        }
        unloaded
    }

    /// Drops what was kept for a deleted entry and everything under it.
    pub fn forget(&mut self, path: &Path) {
        self.listings.retain(|dir, _| !dir.starts_with(path));
        self.expanded.retain(|dir| !dir.starts_with(path));
    }

    /// Follows a renamed or moved entry: listings and open folders under it move along.
    pub fn relocate(&mut self, from: &Path, to: &Path) {
        self.expanded = self.expanded.drain().map(|path| relocate_path(&path, from, to).unwrap_or(path)).collect();
        self.listings = self
            .listings
            .drain()
            .map(|(dir, mut entries)| {
                for entry in &mut entries {
                    if let Some(path) = relocate_path(&entry.path, from, to) {
                        entry.path = path;
                    }
                }
                (relocate_path(&dir, from, to).unwrap_or(dir), entries)
            })
            .collect();
    }

    /// The rows on screen, in order. `is_ignored` says whether an entry is gitignored.
    pub fn rows(
        &self,
        options: &ViewOptions,
        draft: Option<&Draft>,
        is_ignored: &mut dyn FnMut(&Path, bool) -> bool,
    ) -> Vec<Row> {
        let mut rows = Vec::new();
        let root_expanded = self.is_expanded(&self.root);
        if options.hide_root {
            self.push_children(&self.root, 0, options, draft, is_ignored, &mut rows);
        } else {
            rows.push(Row {
                path: self.root.clone(),
                label: self.root_name(),
                is_dir: true,
                is_symlink: false,
                depth: 0,
                expanded: root_expanded,
                ignored: false,
                draft: false,
            });
            if root_expanded {
                self.push_children(&self.root, 1, options, draft, is_ignored, &mut rows);
            }
        }
        for root in &self.extra_roots {
            let expanded = self.is_expanded(root);
            rows.push(Row {
                path: root.clone(),
                label: root.file_name().map_or_else(|| root.to_string_lossy().into_owned(), |name| name.to_string_lossy().into_owned()),
                is_dir: true,
                is_symlink: false,
                depth: 0,
                expanded,
                ignored: false,
                draft: false,
            });
            if expanded {
                self.push_children(root, 1, options, draft, is_ignored, &mut rows);
            }
        }
        rows
    }

    /// The listing of `dir` as shown: filtered and sorted.
    fn visible_children(
        &self,
        dir: &Path,
        options: &ViewOptions,
        is_ignored: &mut dyn FnMut(&Path, bool) -> bool,
    ) -> Vec<(DirEntry, bool)> {
        let Some(listing) = self.listings.get(dir) else { return Vec::new() };
        let mut entries: Vec<DirEntry> = listing
            .iter()
            .filter(|entry| !is_os_generated(&entry.name) && !options.hidden_patterns.hides(&entry.path, entry.is_dir))
            .filter(|entry| options.show_hidden || !is_hidden_name(&entry.name))
            .cloned()
            .collect();
        sort_entries(&mut entries, options.sort_order);
        entries
            .into_iter()
            .filter_map(|entry| {
                let ignored = is_ignored(&entry.path, entry.is_dir);
                (options.show_ignored || !ignored).then_some((entry, ignored))
            })
            .collect()
    }

    fn push_children(
        &self,
        dir: &Path,
        depth: usize,
        options: &ViewOptions,
        draft: Option<&Draft>,
        is_ignored: &mut dyn FnMut(&Path, bool) -> bool,
        rows: &mut Vec<Row>,
    ) {
        let children = self.visible_children(dir, options, is_ignored);
        // A new entry's field sorts as an empty name: first among its kind.
        let draft_here = draft.filter(|draft| draft.parent == dir);
        let draft_index = draft_here.map(|draft| {
            if draft.is_dir || options.sort_order == SortOrder::Name {
                0
            } else {
                children.iter().take_while(|(entry, _)| entry.is_dir).count()
            }
        });

        for (index, (entry, ignored)) in children.into_iter().enumerate() {
            if draft_index == Some(index) {
                rows.push(draft_row(dir, draft_here.is_some_and(|draft| draft.is_dir), depth));
            }
            let mut path = entry.path.clone();
            let mut label = entry.name.clone();
            let mut ignored = ignored;
            let mut expanded = entry.is_dir && self.is_expanded(&path);
            if options.compact_folders {
                while expanded && draft.is_none_or(|draft| draft.parent != path) {
                    let only_child = self.visible_children(&path, options, is_ignored);
                    let [(child, child_ignored)] = only_child.as_slice() else { break };
                    if !child.is_dir {
                        break;
                    }
                    label = format!("{label}/{}", child.name);
                    path = child.path.clone();
                    ignored = *child_ignored;
                    expanded = self.is_expanded(&path);
                }
            }
            rows.push(Row {
                path: path.clone(),
                label,
                is_dir: entry.is_dir,
                is_symlink: entry.is_symlink,
                depth,
                expanded,
                ignored,
                draft: false,
            });
            if expanded {
                self.push_children(&path, depth + 1, options, draft, is_ignored, rows);
            }
        }
        // An empty folder, or a new file after every folder, puts the field last.
        if let Some(draft) = draft_here
            && !rows.iter().any(|row| row.draft)
        {
            rows.push(draft_row(dir, draft.is_dir, depth));
        }
    }
}

fn draft_row(parent: &Path, is_dir: bool, depth: usize) -> Row {
    Row {
        path: parent.to_path_buf(),
        label: String::new(),
        is_dir,
        is_symlink: false,
        depth,
        expanded: false,
        ignored: false,
        draft: true,
    }
}

/// `path` after the entry at `from` moved to `to`, when it is that entry or under it.
pub fn relocate_path(path: &Path, from: &Path, to: &Path) -> Option<PathBuf> {
    let rest = path.strip_prefix(from).ok()?;
    Some(if rest.as_os_str().is_empty() { to.to_path_buf() } else { to.join(rest) })
}

/// The path relative to the project root, or `.` for the root itself.
pub fn relative_path(path: &Path, root: &Path) -> String {
    match path.strip_prefix(root) {
        Ok(relative) if relative.as_os_str().is_empty() => ".".into(),
        Ok(relative) => relative.to_string_lossy().into_owned(),
        Err(_) => path.to_string_lossy().into_owned(),
    }
}

/// `name_copy.ext`, then `name_copy_1.ext`, … for Duplicate and pasting next to the original.
pub fn copy_name(name: &str, attempt: usize) -> String {
    let (stem, extension) = match name.rfind('.') {
        Some(index) if index > 0 => name.split_at(index),
        _ => (name, ""),
    };
    if attempt == 0 {
        format!("{stem}_copy{extension}")
    } else {
        format!("{stem}_copy_{attempt}{extension}")
    }
}

/// A typed name as the path it means, relative to the folder it was typed in: `docs/readme.md`
/// is `readme.md` in a `docs` folder, made along with it. A trailing slash means the entry itself
/// is a folder, so `docs/` makes a folder even from the New File field.
pub fn draft_path(name: &str) -> (PathBuf, bool) {
    let name = name.trim();
    let folder = name.ends_with('/') || name.ends_with('\\');
    let path = name.trim_end_matches(['/', '\\']).split(['/', '\\']).map(str::trim).collect();
    (path, folder)
}

/// Why a typed name cannot be used, if it cannot. Folders in a name are allowed and made with the
/// entry, so every segment of it is checked on its own.
pub fn validate_name(name: &str) -> Option<&'static str> {
    let name = name.trim();
    if name.starts_with('/') || name.starts_with('\\') {
        return Some("A name cannot start at the root.");
    }
    let segments: Vec<&str> = name.trim_end_matches(['/', '\\']).split(['/', '\\']).map(str::trim).collect();
    if segments.iter().any(|segment| *segment == "." || *segment == "..") {
        Some("That name is reserved.")
    } else if segments.iter().all(|segment| segment.is_empty()) {
        Some("A name is required.")
    } else if segments.iter().any(|segment| segment.is_empty()) {
        Some("A folder in that name has no name.")
    } else {
        None
    }
}

/// Drops entries that sit inside another entry of the list, so acting on a folder and a file in
/// it acts once (`withoutNestedEntries`).
/// Whether the pointer has reached or crossed the window's edge (`isPointerAtWindowEdge`).
pub fn at_window_edge((x, y): (f32, f32), (width, height): (f32, f32)) -> bool {
    x <= 0. || y <= 0. || x >= width - 1. || y >= height - 1.
}

/// The rows from `anchor` (or `target` when the anchor is gone) to `target`, and the anchor kept:
/// empty when the range is one row (`selectRangeTo`).
pub fn range_selection(rows: &[PathBuf], anchor: Option<&Path>, target: &Path) -> (Option<PathBuf>, Vec<PathBuf>) {
    let Some(target_index) = rows.iter().position(|row| row == target) else { return (anchor.map(Path::to_path_buf), Vec::new()) };
    let anchor_index = anchor.and_then(|anchor| rows.iter().position(|row| row == anchor)).unwrap_or(target_index);
    let (from, to) = (anchor_index.min(target_index), anchor_index.max(target_index));
    let range = if from == to { Vec::new() } else { rows[from..=to].to_vec() };
    (Some(rows[anchor_index].clone()), range)
}

/// Command-click on `path`: the selection with it added or taken out (empty under two rows), and
/// the row the keyboard moves to (`toggleRowSelection`).
pub fn toggle_selection(multi: &[PathBuf], focused: Option<&Path>, path: &Path) -> (Vec<PathBuf>, PathBuf) {
    let mut next: Vec<PathBuf> = if multi.is_empty() { focused.map(Path::to_path_buf).into_iter().collect() } else { multi.to_vec() };
    match next.iter().position(|entry| entry == path) {
        Some(index) => {
            next.remove(index);
        }
        None => next.push(path.to_path_buf()),
    }
    let focus = if next.iter().any(|entry| entry == path) || next.is_empty() { path.to_path_buf() } else { next[0].clone() };
    (if next.len() > 1 { next } else { Vec::new() }, focus)
}

/// What an action on `path` applies to: the selection without nested entries when `path` is part
/// of it, else `path` alone (`getSelectionActionTargets`).
pub fn selection_targets(multi: &[PathBuf], path: &Path) -> Vec<PathBuf> {
    if multi.len() < 2 || !multi.iter().any(|entry| entry == path) {
        return vec![path.to_path_buf()];
    }
    let mut unique: Vec<PathBuf> = Vec::new();
    for entry in multi {
        if !unique.contains(entry) {
            unique.push(entry.clone());
        }
    }
    let kept = without_nested(unique.clone());
    unique.into_iter().filter(|entry| kept.contains(entry)).collect()
}

pub fn without_nested(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.sort();
    let mut kept: Vec<PathBuf> = Vec::new();
    for path in paths {
        if !kept.iter().any(|parent| path.starts_with(parent)) {
            kept.push(path);
        }
    }
    kept
}

/// The index of the closest row above `index` that is shallower: its folder.
pub fn parent_row(rows: &[Row], index: usize) -> Option<usize> {
    let depth = rows.get(index)?.depth;
    (0..index).rev().find(|&candidate| rows[candidate].depth < depth)
}

/// The next row after `from` whose label starts with `prefix`, wrapping around (type to find).
pub fn find_by_prefix(rows: &[Row], prefix: &str, from: usize) -> Option<usize> {
    let prefix = prefix.to_lowercase();
    let count = rows.len();
    (0..count)
        .map(|offset| (from + offset) % count)
        .find(|&index| !rows[index].draft && rows[index].label.to_lowercase().starts_with(&prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multi_selection() {
        let rows: Vec<PathBuf> = ["/r/a", "/r/a/x", "/r/b", "/r/c"].iter().map(PathBuf::from).collect();
        let p = |path: &str| PathBuf::from(path);
        let (anchor, range) = range_selection(&rows, Some(&p("/r/a")), &p("/r/b"));
        assert_eq!(anchor, Some(p("/r/a")));
        assert_eq!(range, vec![p("/r/a"), p("/r/a/x"), p("/r/b")]);
        assert!(range_selection(&rows, Some(&p("/r/c")), &p("/r/c")).1.is_empty());
        let (anchor, range) = range_selection(&rows, Some(&p("/gone")), &p("/r/b"));
        assert_eq!((anchor, range.len()), (Some(p("/r/b")), 0));

        let (multi, focus) = toggle_selection(&[], Some(&p("/r/a")), &p("/r/c"));
        assert_eq!((multi.clone(), focus), (vec![p("/r/a"), p("/r/c")], p("/r/c")));
        let (multi, focus) = toggle_selection(&multi, None, &p("/r/c"));
        assert_eq!((multi, focus), (Vec::new(), p("/r/a")));
        assert_eq!(toggle_selection(&[], None, &p("/r/b")), (Vec::new(), p("/r/b")));

        let multi = vec![p("/r/b"), p("/r/a"), p("/r/a/x")];
        assert_eq!(selection_targets(&multi, &p("/r/a/x")), vec![p("/r/b"), p("/r/a")]);
        assert_eq!(selection_targets(&multi, &p("/r/c")), vec![p("/r/c")]);
        assert_eq!(selection_targets(&[p("/r/a")], &p("/r/a")), vec![p("/r/a")]);
        assert!(at_window_edge((0., 10.), (100., 100.)));
        assert!(at_window_edge((50., 99.5), (100., 100.)));
        assert!(!at_window_edge((50., 50.), (100., 100.)));
    }

    fn entry(dir: &str, name: &str, is_dir: bool) -> DirEntry {
        DirEntry { name: name.into(), path: Path::new(dir).join(name), is_dir, is_symlink: false }
    }

    fn labels(rows: &[Row]) -> Vec<String> {
        rows.iter().map(|row| format!("{}{}", "  ".repeat(row.depth), if row.draft { "<draft>" } else { &row.label })).collect()
    }

    fn sample() -> TreeModel {
        let mut model = TreeModel::new("/p".into());
        model.set_listing(
            "/p".into(),
            vec![
                entry("/p", "b.txt", false),
                entry("/p", "src", true),
                entry("/p", ".git", true),
                entry("/p", "A.md", false),
                entry("/p", ".DS_Store", false),
                entry("/p", "assets", true),
            ],
        );
        model.set_listing("/p/src".into(), vec![entry("/p/src", "main.rs", false), entry("/p/src", "lib", true)]);
        model.set_listing("/p/src/lib".into(), vec![entry("/p/src/lib", "mod.rs", false)]);
        model
    }

    #[test]
    fn sorts_folders_first_then_names_case_insensitively() {
        let mut entries = vec![entry("/", "b", false), entry("/", "Z", true), entry("/", "a", false), entry("/", "C", true)];
        sort_entries(&mut entries, SortOrder::FoldersFirst);
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["C", "Z", "a", "b"]);
        sort_entries(&mut entries, SortOrder::Name);
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["a", "b", "C", "Z"]);
    }

    #[test]
    fn punctuation_sorts_before_digits_before_letters() {
        let mut names = vec!["b", "_a", "1x", ".env", "A"];
        names.sort_by(|l, r| compare_names(l, r));
        assert_eq!(names, [".env", "_a", "1x", "A", "b"]);
    }

    #[test]
    fn rows_show_the_root_and_open_folders() {
        let mut model = sample();
        let rows = model.rows(&ViewOptions::default(), None, &mut |_, _| false);
        assert_eq!(labels(&rows), ["p", "  .git", "  assets", "  src", "  A.md", "  b.txt"]);

        model.set_expanded(Path::new("/p/src"), true);
        let rows = model.rows(&ViewOptions::default(), None, &mut |_, _| false);
        assert_eq!(labels(&rows), ["p", "  .git", "  assets", "  src", "    lib", "    main.rs", "  A.md", "  b.txt"]);
    }

    #[test]
    fn options_hide_dotfiles_ignored_entries_and_the_root() {
        let model = sample();
        let options = ViewOptions { show_hidden: false, show_ignored: false, hide_root: true, ..ViewOptions::default() };
        let rows = model.rows(&options, None, &mut |path, _| path.ends_with("assets"));
        assert_eq!(labels(&rows), ["src", "A.md", "b.txt"]);

        let rows = model.rows(&ViewOptions::default(), None, &mut |path, _| path.ends_with("assets"));
        assert!(rows.iter().find(|row| row.label == "assets").unwrap().ignored);
    }

    #[test]
    fn extra_roots_follow_the_project_folder() {
        let mut model = sample();
        model.add_root("/q".into());
        model.add_root("/q".into());
        model.set_listing("/q".into(), vec![entry("/q", "lib.rs", false)]);
        let rows = model.rows(&ViewOptions::default(), None, &mut |_, _| false);
        assert_eq!(labels(&rows), ["p", "  .git", "  assets", "  src", "  A.md", "  b.txt", "q", "  lib.rs"]);
        let options = ViewOptions { hide_root: true, ..ViewOptions::default() };
        let rows = model.rows(&options, None, &mut |_, _| false);
        assert_eq!(labels(&rows).last().map(String::as_str), Some("  lib.rs"));
        assert!(model.is_root(Path::new("/q")));
        assert_eq!(model.root_of(Path::new("/q/x/y.rs")), Path::new("/q"));
        assert_eq!(model.root_of(Path::new("/p/src")), Path::new("/p"));
        assert_eq!(model.expand_to(Path::new("/q/x/y.rs")), vec![PathBuf::from("/q/x")]);
        model.remove_root(Path::new("/q"));
        assert!(!model.is_root(Path::new("/q")));
        assert!(!model.is_loaded(Path::new("/q")));
    }

    #[test]
    fn compact_folders_join_single_folder_chains() {
        let mut model = TreeModel::new("/p".into());
        model.set_listing("/p".into(), vec![entry("/p", "a", true)]);
        model.set_listing("/p/a".into(), vec![entry("/p/a", "b", true)]);
        model.set_listing("/p/a/b".into(), vec![entry("/p/a/b", "x.rs", false)]);
        model.set_expanded(Path::new("/p/a"), true);
        model.set_expanded(Path::new("/p/a/b"), true);
        let options = ViewOptions { compact_folders: true, ..ViewOptions::default() };
        let rows = model.rows(&options, None, &mut |_, _| false);
        assert_eq!(labels(&rows), ["p", "  a/b", "    x.rs"]);
        assert_eq!(rows[1].path, Path::new("/p/a/b"));
    }

    #[test]
    fn hidden_patterns_drop_matching_files_and_folders() {
        let mut model = sample();
        model.set_expanded(Path::new("/p/src"), true);
        let hidden = HiddenPatterns::new(Path::new("/p"), &["*.md".into(), " ".into()], &["lib".into(), "b.txt".into()]);
        let options = ViewOptions { hidden_patterns: hidden, ..ViewOptions::default() };
        let rows = model.rows(&options, None, &mut |_, _| false);
        assert_eq!(labels(&rows), ["p", "  .git", "  assets", "  src", "    main.rs", "  b.txt"]);
        assert!(!HiddenPatterns::new(Path::new("/p"), &["p".into()], &[]).hides(Path::new("/p"), true));
    }

    #[test]
    fn sort_order_follows_the_setting() {
        assert_eq!(SortOrder::from_setting("name"), SortOrder::Name);
        assert_eq!(SortOrder::from_setting("folders-first"), SortOrder::FoldersFirst);
        assert_eq!(SortOrder::from_setting("bogus"), SortOrder::FoldersFirst);
        let model = sample();
        let options = ViewOptions { sort_order: SortOrder::Name, ..ViewOptions::default() };
        let rows = model.rows(&options, None, &mut |_, _| false);
        assert_eq!(labels(&rows), ["p", "  .git", "  A.md", "  assets", "  b.txt", "  src"]);
    }

    #[test]
    fn drafts_sit_first_among_their_kind() {
        let model = sample();
        let file = Draft { parent: "/p".into(), is_dir: false };
        let rows = model.rows(&ViewOptions::default(), Some(&file), &mut |_, _| false);
        assert_eq!(labels(&rows), ["p", "  .git", "  assets", "  src", "  <draft>", "  A.md", "  b.txt"]);

        let folder = Draft { parent: "/p".into(), is_dir: true };
        let rows = model.rows(&ViewOptions::default(), Some(&folder), &mut |_, _| false);
        assert_eq!(labels(&rows)[1], "  <draft>");

        let mut empty = TreeModel::new("/e".into());
        empty.set_listing("/e".into(), Vec::new());
        let draft = Draft { parent: "/e".into(), is_dir: false };
        let rows = empty.rows(&ViewOptions::default(), Some(&draft), &mut |_, _| false);
        assert_eq!(labels(&rows), ["e", "  <draft>"]);
    }

    #[test]
    fn expand_to_opens_ancestors_and_reports_unloaded_ones() {
        let mut model = sample();
        model.collapse_all();
        let unloaded = model.expand_to(Path::new("/p/src/lib/deep/file.rs"));
        assert_eq!(unloaded, [PathBuf::from("/p/src/lib/deep")]);
        assert!(model.is_expanded(Path::new("/p")));
        assert!(model.is_expanded(Path::new("/p/src/lib/deep")));
        assert!(!model.is_expanded(Path::new("/p/src/lib/deep/file.rs")));
    }

    #[test]
    fn expand_dir_opens_the_folder_and_its_ancestors() {
        let mut model = sample();
        model.collapse_all();
        assert_eq!(model.expand_dir(Path::new("/p/src/lib")), Vec::<PathBuf>::new());
        assert!(model.is_expanded(Path::new("/p")) && model.is_expanded(Path::new("/p/src/lib")));
        assert_eq!(model.expand_dir(Path::new("/p/new")), [PathBuf::from("/p/new")]);
    }

    #[test]
    fn relocate_and_forget_follow_moves_and_deletes() {
        let mut model = sample();
        model.set_expanded(Path::new("/p/src/lib"), true);
        model.relocate(Path::new("/p/src"), Path::new("/p/code"));
        assert!(model.is_expanded(Path::new("/p/code/lib")));
        assert!(model.is_loaded(Path::new("/p/code/lib")));
        assert_eq!(model.listing(Path::new("/p/code")).unwrap()[0].path, Path::new("/p/code/main.rs"));
        model.forget(Path::new("/p/code"));
        assert!(!model.is_loaded(Path::new("/p/code/lib")));
        assert!(!model.is_expanded(Path::new("/p/code/lib")));
    }

    #[test]
    fn path_helpers() {
        assert_eq!(relocate_path(Path::new("/a/b/c"), Path::new("/a/b"), Path::new("/x")), Some("/x/c".into()));
        assert_eq!(relocate_path(Path::new("/a/bc"), Path::new("/a/b"), Path::new("/x")), None);
        assert_eq!(relative_path(Path::new("/p/src/a.rs"), Path::new("/p")), "src/a.rs");
        assert_eq!(relative_path(Path::new("/p"), Path::new("/p")), ".");
        assert_eq!(copy_name("main.rs", 0), "main_copy.rs");
        assert_eq!(copy_name("main.rs", 2), "main_copy_2.rs");
        assert_eq!(copy_name(".env", 0), ".env_copy");
        assert_eq!(copy_name("Makefile", 1), "Makefile_copy_1");
        assert!(validate_name(" ").is_some());
        assert!(validate_name("ok.txt").is_none());
        // A name may carry the folders it goes in; only a broken path is refused.
        assert!(validate_name("docs/readme.md").is_none());
        assert!(validate_name("docs/").is_none());
        assert!(validate_name("docs//readme.md").is_some());
        assert!(validate_name("/docs/readme.md").is_some());
        assert!(validate_name("docs/../readme.md").is_some());
        assert_eq!(draft_path(" docs/readme.md "), (PathBuf::from("docs/readme.md"), false));
        assert_eq!(draft_path("docs/pages/"), (PathBuf::from("docs/pages"), true));
        assert_eq!(draft_path("readme.md"), (PathBuf::from("readme.md"), false));
        assert_eq!(
            without_nested(vec!["/p/a/x".into(), "/p/a".into(), "/p/ab".into()]),
            [PathBuf::from("/p/a"), PathBuf::from("/p/ab")]
        );
    }

    #[test]
    fn hides_os_litter() {
        assert!(is_os_generated(".DS_Store"));
        assert!(is_os_generated("._resource"));
        assert!(is_os_generated("Thumbs.db"));
        assert!(!is_os_generated(".gitignore"));
        assert!(is_hidden_name(".env"));
        assert!(!is_hidden_name("."));
    }

    #[test]
    fn navigation_helpers() {
        let mut model = sample();
        model.set_expanded(Path::new("/p/src"), true);
        let rows = model.rows(&ViewOptions::default(), None, &mut |_, _| false);
        let main = rows.iter().position(|row| row.label == "main.rs").unwrap();
        assert_eq!(rows[parent_row(&rows, main).unwrap()].label, "src");
        assert_eq!(rows[find_by_prefix(&rows, "B", 0).unwrap()].label, "b.txt");
        assert_eq!(rows[find_by_prefix(&rows, "s", 4).unwrap()].label, "src");
    }
}
