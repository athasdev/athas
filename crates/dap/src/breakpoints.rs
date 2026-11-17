//! The breakpoints of every open project, shared by the editor's gutter and the debugger.
//!
//! # Using it from the editor
//!
//! ```ignore
//! let store = dap::BreakpointStore::global(cx);           // Entity<BreakpointStore>
//! cx.observe(&store, |editor, _, cx| cx.notify()).detach(); // redraw on any change
//! for breakpoint in store.read(cx).breakpoints_for(&path) {
//!     // breakpoint.row is zero-based; draw a dot, hollow when !enabled, dimmed when
//!     // breakpoint.state.verified == Some(false); a diamond when log_message is set.
//! }
//! store.update(cx, |store, cx| store.toggle(&path, row, cx));   // gutter click / F9
//! store.update(cx, |store, cx| store.shift_rows(&path, row, delta, cx)); // after inserting or
//!                                                                         // deleting lines
//! let paused_at = store.read(cx).execution_position();   // the line the debuggee stopped on
//! ```
//!
//! Paths are absolute. Breakpoints persist per project in
//! `<data dir>/dev.athas.gpui/breakpoints.json`, keyed by project root with paths relative to it;
//! call [`BreakpointStore::load_project`] when a project opens.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use gpui::{App, AppContext as _, Context, Entity, EventEmitter, Global};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct BreakpointId(pub u64);

/// What the running adapter made of a breakpoint. Not saved.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BreakpointState {
    /// `None` while no session has reported on it.
    pub verified: Option<bool>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Breakpoint {
    pub id: BreakpointId,
    /// Zero-based line.
    pub row: u32,
    pub enabled: bool,
    /// Stop only when this expression is true.
    pub condition: Option<String>,
    /// Stop only when the hit count matches, such as `5` or `>= 3`.
    pub hit_condition: Option<String>,
    /// A logpoint: print this (with `{expressions}`) instead of stopping.
    pub log_message: Option<String>,
    pub state: BreakpointState,
}

/// The line a paused session stopped on, for the editor's execution marker.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionPosition {
    pub path: PathBuf,
    /// Zero-based line.
    pub row: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BreakpointStoreEvent {
    /// Breakpoints in this file were added, removed or edited; sessions send them again.
    Changed { path: PathBuf },
    /// A session reported which breakpoints in this file it could set.
    StateChanged { path: PathBuf },
    ExecutionPositionChanged,
}

/// Which of a breakpoint's texts to change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BreakpointField {
    Condition,
    HitCondition,
    LogMessage,
}

#[derive(Default)]
pub struct BreakpointStore {
    files: BTreeMap<PathBuf, Vec<Breakpoint>>,
    /// Projects whose saved breakpoints are loaded; saving writes each file under its root.
    roots: Vec<PathBuf>,
    persist_path: Option<PathBuf>,
    next_id: u64,
    execution_position: Option<ExecutionPosition>,
}

impl EventEmitter<BreakpointStoreEvent> for BreakpointStore {}

struct GlobalBreakpointStore(Entity<BreakpointStore>);

impl Global for GlobalBreakpointStore {}

/// One breakpoint as saved.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedBreakpoint {
    /// Relative to the project root (absolute for files outside every project).
    path: String,
    /// Zero-based.
    row: u32,
    #[serde(default = "enabled_default")]
    enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    condition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hit_condition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    log_message: Option<String>,
}

fn enabled_default() -> bool {
    true
}

/// Saved files outside every project are kept under this key.
const NO_PROJECT: &str = "";

impl BreakpointStore {
    /// A store saving to `persist_path` (none keeps it in memory, as tests do).
    pub fn new(persist_path: Option<PathBuf>) -> Self {
        Self { persist_path, next_id: 1, ..Default::default() }
    }

    /// The app's store, created on first use with the default save file.
    pub fn global(cx: &mut App) -> Entity<Self> {
        if let Some(store) = cx.try_global::<GlobalBreakpointStore>() {
            return store.0.clone();
        }
        let path = dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("breakpoints.json"));
        let store = cx.new(|_| Self::new(path));
        cx.set_global(GlobalBreakpointStore(store.clone()));
        store
    }

    /// Makes `store` the app's store; for tests and snapshots.
    pub fn set_global(store: Entity<Self>, cx: &mut App) {
        cx.set_global(GlobalBreakpointStore(store));
    }

    /// Loads a project's saved breakpoints (once per project).
    pub fn load_project(&mut self, root: &Path, cx: &mut Context<Self>) {
        if self.roots.iter().any(|loaded| loaded == root) {
            return;
        }
        self.roots.push(root.to_path_buf());
        let saved = self.read_saved();
        let key = root.to_string_lossy();
        let Some(entries) = saved.get(key.as_ref()) else { return };
        let mut changed = Vec::new();
        for entry in entries {
            let path = root.join(&entry.path);
            let file = self.files.entry(path.clone()).or_default();
            if file.iter().any(|existing| existing.row == entry.row) {
                continue;
            }
            file.push(Breakpoint {
                id: BreakpointId(self.next_id),
                row: entry.row,
                enabled: entry.enabled,
                condition: entry.condition.clone(),
                hit_condition: entry.hit_condition.clone(),
                log_message: entry.log_message.clone(),
                state: BreakpointState::default(),
            });
            self.next_id += 1;
            file.sort_by_key(|breakpoint| breakpoint.row);
            if !changed.contains(&path) {
                changed.push(path);
            }
        }
        for path in changed {
            cx.emit(BreakpointStoreEvent::Changed { path });
        }
        cx.notify();
    }

    /// A file's breakpoints, by line.
    pub fn breakpoints_for(&self, path: &Path) -> &[Breakpoint] {
        self.files.get(path).map(Vec::as_slice).unwrap_or_default()
    }

    pub fn breakpoint_at(&self, path: &Path, row: u32) -> Option<&Breakpoint> {
        self.breakpoints_for(path).iter().find(|breakpoint| breakpoint.row == row)
    }

    /// Every file with breakpoints, and its breakpoints.
    pub fn files(&self) -> impl Iterator<Item = (&Path, &[Breakpoint])> {
        self.files.iter().filter(|(_, breakpoints)| !breakpoints.is_empty()).map(|(path, breakpoints)| (path.as_path(), breakpoints.as_slice()))
    }

    pub fn len(&self) -> usize {
        self.files.values().map(Vec::len).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn find(&self, id: BreakpointId) -> Option<(&Path, &Breakpoint)> {
        self.files().find_map(|(path, breakpoints)| breakpoints.iter().find(|breakpoint| breakpoint.id == id).map(|breakpoint| (path, breakpoint)))
    }

    /// Adds a breakpoint on the line, or removes the one there. Returns whether one was added.
    pub fn toggle(&mut self, path: &Path, row: u32, cx: &mut Context<Self>) -> bool {
        let file = self.files.entry(path.to_path_buf()).or_default();
        let added = match file.iter().position(|breakpoint| breakpoint.row == row) {
            Some(index) => {
                file.remove(index);
                false
            }
            None => {
                file.push(Breakpoint {
                    id: BreakpointId(self.next_id),
                    row,
                    enabled: true,
                    condition: None,
                    hit_condition: None,
                    log_message: None,
                    state: BreakpointState::default(),
                });
                self.next_id += 1;
                file.sort_by_key(|breakpoint| breakpoint.row);
                true
            }
        };
        self.changed(path, cx);
        added
    }

    pub fn remove(&mut self, id: BreakpointId, cx: &mut Context<Self>) {
        let Some(path) = self.path_of(id) else { return };
        if let Some(file) = self.files.get_mut(&path) {
            file.retain(|breakpoint| breakpoint.id != id);
        }
        self.changed(&path, cx);
    }

    pub fn set_enabled(&mut self, id: BreakpointId, enabled: bool, cx: &mut Context<Self>) {
        self.edit(id, cx, |breakpoint| breakpoint.enabled = enabled);
    }

    /// Enables or disables every breakpoint.
    pub fn set_all_enabled(&mut self, enabled: bool, cx: &mut Context<Self>) {
        let paths: Vec<PathBuf> = self.files.keys().cloned().collect();
        for file in self.files.values_mut() {
            for breakpoint in file {
                breakpoint.enabled = enabled;
            }
        }
        for path in paths {
            self.changed(&path, cx);
        }
    }

    /// Sets a condition, hit condition or log message; empty text clears it.
    pub fn set_field(&mut self, id: BreakpointId, field: BreakpointField, text: Option<String>, cx: &mut Context<Self>) {
        let text = text.map(|text| text.trim().to_string()).filter(|text| !text.is_empty());
        self.edit(id, cx, |breakpoint| match field {
            BreakpointField::Condition => breakpoint.condition = text,
            BreakpointField::HitCondition => breakpoint.hit_condition = text,
            BreakpointField::LogMessage => breakpoint.log_message = text,
        });
    }

    pub fn clear(&mut self, cx: &mut Context<Self>) {
        let paths: Vec<PathBuf> = self.files.keys().cloned().collect();
        self.files.clear();
        for path in paths {
            self.changed(&path, cx);
        }
    }

    /// Keeps breakpoints on their code after an edit: lines from `from_row` on move by `delta`,
    /// and breakpoints on deleted lines go.
    pub fn shift_rows(&mut self, path: &Path, from_row: u32, delta: i64, cx: &mut Context<Self>) {
        let Some(file) = self.files.get_mut(path) else { return };
        if delta == 0 || file.iter().all(|breakpoint| breakpoint.row < from_row) {
            return;
        }
        let deleted_end = if delta < 0 { from_row as i64 - delta } else { from_row as i64 };
        file.retain(|breakpoint| delta > 0 || (breakpoint.row as i64) < from_row as i64 || breakpoint.row as i64 >= deleted_end);
        for breakpoint in file.iter_mut() {
            if breakpoint.row >= from_row {
                breakpoint.row = (breakpoint.row as i64 + delta).max(0) as u32;
            }
        }
        file.dedup_by_key(|breakpoint| breakpoint.row);
        self.changed(path, cx);
    }

    /// Records what a session made of a file's breakpoints.
    pub fn set_states(&mut self, path: &Path, states: Vec<(BreakpointId, BreakpointState)>, cx: &mut Context<Self>) {
        let Some(file) = self.files.get_mut(path) else { return };
        let mut changed = false;
        for (id, state) in states {
            if let Some(breakpoint) = file.iter_mut().find(|breakpoint| breakpoint.id == id)
                && breakpoint.state != state
            {
                breakpoint.state = state;
                changed = true;
            }
        }
        if changed {
            cx.emit(BreakpointStoreEvent::StateChanged { path: path.to_path_buf() });
            cx.notify();
        }
    }

    /// Forgets what sessions reported, once the session ends.
    pub fn clear_states(&mut self, cx: &mut Context<Self>) {
        let mut changed = Vec::new();
        for (path, file) in &mut self.files {
            for breakpoint in file.iter_mut().filter(|breakpoint| breakpoint.state != BreakpointState::default()) {
                breakpoint.state = BreakpointState::default();
                if !changed.contains(path) {
                    changed.push(path.clone());
                }
            }
        }
        for path in changed {
            cx.emit(BreakpointStoreEvent::StateChanged { path });
        }
        cx.notify();
    }

    pub fn execution_position(&self) -> Option<&ExecutionPosition> {
        self.execution_position.as_ref()
    }

    pub fn set_execution_position(&mut self, position: Option<ExecutionPosition>, cx: &mut Context<Self>) {
        if self.execution_position != position {
            self.execution_position = position;
            cx.emit(BreakpointStoreEvent::ExecutionPositionChanged);
            cx.notify();
        }
    }

    fn path_of(&self, id: BreakpointId) -> Option<PathBuf> {
        self.find(id).map(|(path, _)| path.to_path_buf())
    }

    fn edit(&mut self, id: BreakpointId, cx: &mut Context<Self>, edit: impl FnOnce(&mut Breakpoint)) {
        let Some(path) = self.path_of(id) else { return };
        if let Some(breakpoint) = self.files.get_mut(&path).and_then(|file| file.iter_mut().find(|breakpoint| breakpoint.id == id)) {
            edit(breakpoint);
        }
        self.changed(&path, cx);
    }

    fn changed(&mut self, path: &Path, cx: &mut Context<Self>) {
        if self.files.get(path).is_some_and(Vec::is_empty) {
            self.files.remove(path);
        }
        self.save();
        cx.emit(BreakpointStoreEvent::Changed { path: path.to_path_buf() });
        cx.notify();
    }

    fn read_saved(&self) -> BTreeMap<String, Vec<SavedBreakpoint>> {
        let Some(path) = &self.persist_path else { return BTreeMap::new() };
        let Ok(json) = std::fs::read_to_string(path) else { return BTreeMap::new() };
        let Ok(value) = serde_json::from_str::<Value>(&json) else { return BTreeMap::new() };
        value.get("projects").cloned().and_then(|projects| serde_json::from_value(projects).ok()).unwrap_or_default()
    }

    /// Rewrites the loaded projects' entries in the save file, keeping other projects' entries.
    fn save(&self) {
        let Some(persist_path) = &self.persist_path else { return };
        let mut saved = self.read_saved();
        for root in &self.roots {
            saved.remove(root.to_string_lossy().as_ref());
        }
        saved.remove(NO_PROJECT);
        for (path, breakpoints) in &self.files {
            let root = self.roots.iter().filter(|root| path.starts_with(root)).max_by_key(|root| root.as_os_str().len());
            let (key, relative) = match root {
                Some(root) => (root.to_string_lossy().into_owned(), path.strip_prefix(root).unwrap_or(path)),
                None => (NO_PROJECT.to_string(), path.as_path()),
            };
            let entries = saved.entry(key).or_default();
            entries.extend(breakpoints.iter().map(|breakpoint| SavedBreakpoint {
                path: relative.to_string_lossy().into_owned(),
                row: breakpoint.row,
                enabled: breakpoint.enabled,
                condition: breakpoint.condition.clone(),
                hit_condition: breakpoint.hit_condition.clone(),
                log_message: breakpoint.log_message.clone(),
            }));
        }
        saved.retain(|_, entries| !entries.is_empty());
        let json = serde_json::json!({ "version": 1, "projects": saved });
        if let Some(parent) = persist_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        if let Ok(json) = serde_json::to_string_pretty(&json) {
            std::fs::write(persist_path, json).ok();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, rc::Rc};

    use gpui::TestAppContext;

    use super::*;

    fn rows(store: &BreakpointStore, path: &Path) -> Vec<u32> {
        store.breakpoints_for(path).iter().map(|breakpoint| breakpoint.row).collect()
    }

    #[gpui::test]
    fn toggles_edits_and_notifies(cx: &mut TestAppContext) {
        let store = cx.new(|_| BreakpointStore::new(None));
        let events = Rc::new(RefCell::new(Vec::new()));
        let recorded = events.clone();
        cx.update(|cx| {
            cx.subscribe(&store, move |_, event: &BreakpointStoreEvent, _| recorded.borrow_mut().push(event.clone())).detach();
        });
        let path = PathBuf::from("/p/src/main.rs");
        store.update(cx, |store, cx| {
            assert!(store.toggle(&path, 9, cx));
            assert!(store.toggle(&path, 2, cx));
            assert_eq!(rows(store, &path), vec![2, 9]);
            assert!(!store.toggle(&path, 9, cx));
            assert_eq!(rows(store, &path), vec![2]);

            let id = store.breakpoints_for(&path)[0].id;
            store.set_field(id, BreakpointField::Condition, Some(" x > 1 ".into()), cx);
            store.set_field(id, BreakpointField::LogMessage, Some("x = {x}".into()), cx);
            store.set_enabled(id, false, cx);
            let breakpoint = &store.breakpoints_for(&path)[0];
            assert_eq!(breakpoint.condition.as_deref(), Some("x > 1"));
            assert_eq!(breakpoint.log_message.as_deref(), Some("x = {x}"));
            assert!(!breakpoint.enabled);
            store.set_field(id, BreakpointField::Condition, Some("  ".into()), cx);
            assert_eq!(store.breakpoints_for(&path)[0].condition, None);

            store.set_states(&path, vec![(id, BreakpointState { verified: Some(false), message: Some("no code".into()) })], cx);
            assert_eq!(store.breakpoints_for(&path)[0].state.verified, Some(false));
            store.remove(id, cx);
            assert!(store.is_empty());
        });
        let events = events.borrow();
        assert!(events.iter().all(|event| matches!(event, BreakpointStoreEvent::Changed { .. } | BreakpointStoreEvent::StateChanged { .. })));
        assert_eq!(events.iter().filter(|event| matches!(event, BreakpointStoreEvent::StateChanged { .. })).count(), 1);
    }

    #[gpui::test]
    fn shifts_rows_after_edits(cx: &mut TestAppContext) {
        let store = cx.new(|_| BreakpointStore::new(None));
        let path = PathBuf::from("/p/a.py");
        store.update(cx, |store, cx| {
            for row in [1, 5, 6, 10] {
                store.toggle(&path, row, cx);
            }
            store.shift_rows(&path, 3, 2, cx);
            assert_eq!(rows(store, &path), vec![1, 7, 8, 12]);
            // Lines 7 and 8 are deleted.
            store.shift_rows(&path, 7, -2, cx);
            assert_eq!(rows(store, &path), vec![1, 10]);
        });
    }

    #[gpui::test]
    fn persists_per_project(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("breakpoints.json");
        let root = PathBuf::from("/work/app");
        let other = PathBuf::from("/work/other");

        let store = cx.new(|_| BreakpointStore::new(Some(file.clone())));
        store.update(cx, |store, cx| {
            store.load_project(&root, cx);
            store.load_project(&other, cx);
            store.toggle(&root.join("src/main.rs"), 4, cx);
            let id = store.breakpoints_for(&root.join("src/main.rs"))[0].id;
            store.set_field(id, BreakpointField::HitCondition, Some(">= 3".into()), cx);
            store.toggle(&other.join("lib.go"), 0, cx);
        });
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(saved["projects"]["/work/app"][0]["path"], "src/main.rs");
        assert_eq!(saved["projects"]["/work/app"][0]["hitCondition"], ">= 3");
        assert_eq!(saved["projects"]["/work/other"][0]["path"], "lib.go");

        // A new store that only opens one project keeps the other's entries when it saves.
        let reloaded = cx.new(|_| BreakpointStore::new(Some(file.clone())));
        reloaded.update(cx, |store, cx| {
            store.load_project(&root, cx);
            let breakpoint = &store.breakpoints_for(&root.join("src/main.rs"))[0];
            assert_eq!(breakpoint.row, 4);
            assert_eq!(breakpoint.hit_condition.as_deref(), Some(">= 3"));
            assert!(store.breakpoints_for(&other.join("lib.go")).is_empty());
            store.toggle(&root.join("src/main.rs"), 8, cx);
        });
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(saved["projects"]["/work/app"].as_array().unwrap().len(), 2);
        assert_eq!(saved["projects"]["/work/other"][0]["path"], "lib.go");
    }

    #[gpui::test]
    fn the_global_store_is_shared(cx: &mut TestAppContext) {
        cx.update(|cx| {
            let store = cx.new(|_| BreakpointStore::new(None));
            BreakpointStore::set_global(store.clone(), cx);
            assert_eq!(BreakpointStore::global(cx), store);
        });
    }
}
