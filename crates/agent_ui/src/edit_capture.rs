//! Diffs for agents that edit files through their own tools (`lib/edit-diff-capture.ts`). Such
//! agents rarely report what changed, so the transcript would only say "Edited foo.rs". The file
//! is remembered as it was when such a call starts and diffed against the result when the call
//! finishes; a call that arrives already finished is compared to HEAD.

use std::path::{Path, PathBuf};

use gpui::{AppContext as _, Context};
use serde_json::Value;

use crate::{
    SessionView,
    thread::{Entry, ToolCall, ToolContent, ToolKind, ToolStatus},
};

/// The file as it was when the call started, `None` when it did not exist yet.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EditSnapshot {
    pub path: PathBuf,
    pub before: Option<String>,
}

/// Whether the call edits, deletes or moves a file, by its kind or else its title.
pub(crate) fn is_edit_call(call: &ToolCall) -> bool {
    let kind = if call.kind == ToolKind::Other { crate::tool_summary::infer_kind(&call.title) } else { call.kind };
    matches!(kind, ToolKind::Edit | ToolKind::Delete | ToolKind::Move)
}

/// The file the call works on (`resolveToolCallPath`): its first location, else a path in its input.
pub(crate) fn call_path(call: &ToolCall) -> Option<PathBuf> {
    if let Some(location) = call.locations.first() {
        return Some(location.path.clone());
    }
    let input = call.raw_input.as_ref()?.as_object()?;
    ["file_path", "path", "filename", "filePath"].iter().find_map(|key| input.get(*key).and_then(Value::as_str).filter(|path| !path.is_empty()).map(PathBuf::from))
}

/// The edited file, absolute: relative paths are the project's.
pub(crate) fn edit_target(call: &ToolCall, root: Option<&Path>) -> Option<PathBuf> {
    if call.id.is_empty() || !is_edit_call(call) {
        return None;
    }
    let path = call_path(call)?;
    let text = path.to_string_lossy();
    let absolute = path.is_absolute() || text.starts_with("remote://") || (text.len() > 2 && text.as_bytes()[1] == b':' && matches!(text.as_bytes()[2], b'\\' | b'/'));
    Some(match root {
        Some(root) if !absolute => root.join(path),
        _ => path,
    })
}

/// The committed text of `path` in the repository at `root`.
fn head_text(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let output = std::process::Command::new("git").arg("show").arg(format!("HEAD:{}", relative.to_string_lossy().replace('\\', "/"))).current_dir(root).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The diff a finished call gets: `None` when it already reports one or nothing changed.
pub(crate) fn resolve_diff(call: &ToolCall, snapshot: Option<EditSnapshot>, root: Option<&Path>) -> Option<ToolContent> {
    if call.content.iter().any(|content| matches!(content, ToolContent::Diff { .. })) {
        return None;
    }
    let path = snapshot.as_ref().map(|snapshot| snapshot.path.clone()).or_else(|| edit_target(call, root))?;
    let after = std::fs::read_to_string(&path).unwrap_or_default();
    let mut before = snapshot.as_ref().and_then(|snapshot| snapshot.before.clone()).unwrap_or_default();
    if snapshot.is_none() || before == after {
        // Reported after the fact, or read too late: the committed version is the best
        // remaining reference.
        before = head_text(root?, &path)?;
    }
    (before != after).then(|| ToolContent::Diff { path, old_text: Some(before), new_text: after })
}

impl SessionView {
    /// Remembers an edit call's file as it starts, and adds the diff when it finishes.
    pub(crate) fn capture_tool_edit(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(Entry::ToolCall(call)) = self.transcript.entries.get(index) else { return };
        if self.edit_captured.contains(&call.id) || !is_edit_call(call) {
            return;
        }
        let root = self.info.cwd.clone();
        let id = call.id.clone();
        match call.status {
            ToolStatus::Pending | ToolStatus::InProgress | ToolStatus::WaitingForPermission => {
                if self.edit_snapshots.contains_key(&id) {
                    return;
                }
                let Some(path) = edit_target(call, root.as_deref()) else { return };
                self.edit_snapshots.insert(id.clone(), None);
                cx.spawn(async move |this, cx| {
                    let read = path.clone();
                    let before = cx.background_spawn(async move { std::fs::read_to_string(read).ok() }).await;
                    this.update(cx, |this, _| {
                        if let Some(slot @ None) = this.edit_snapshots.get_mut(&id) {
                            *slot = Some(EditSnapshot { path, before });
                        }
                    })
                    .ok();
                })
                .detach();
            }
            ToolStatus::Failed | ToolStatus::Canceled => {
                self.edit_snapshots.remove(&id);
                self.edit_captured.insert(id);
            }
            ToolStatus::Completed => {
                let snapshot = self.edit_snapshots.remove(&id).flatten();
                self.edit_captured.insert(id.clone());
                // A replayed history's calls arrive finished outside a turn; HEAD says nothing
                // about what they changed back then.
                if snapshot.is_none() && self.turn.is_none() {
                    return;
                }
                let call = call.clone();
                cx.spawn(async move |this, cx| {
                    let diff = cx.background_spawn(async move { resolve_diff(&call, snapshot, root.as_deref()) }).await;
                    let Some(diff) = diff else { return };
                    this.update(cx, |this, cx| {
                        let Some(index) = this.transcript.entries.iter().position(|entry| matches!(entry, Entry::ToolCall(call) if call.id == id)) else { return };
                        if let Entry::ToolCall(call) = &mut this.transcript.entries[index]
                            && !call.content.iter().any(|content| matches!(content, ToolContent::Diff { .. }))
                        {
                            call.content.push(diff);
                            this.entry_changed(index);
                            this.schedule_save(cx);
                            cx.notify();
                        }
                    })
                    .ok();
                })
                .detach();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::Location;
    use serde_json::json;

    fn edit(path: &str) -> ToolCall {
        ToolCall { id: "t1".into(), title: "Edit".into(), kind: ToolKind::Edit, status: ToolStatus::Completed, locations: vec![Location { path: path.into(), line: None }], ..Default::default() }
    }

    #[test]
    fn edit_calls_are_known_by_kind_or_title() {
        assert!(is_edit_call(&edit("/a")));
        let call = ToolCall { title: "write_file".into(), ..Default::default() };
        assert!(is_edit_call(&call));
        let call = ToolCall { title: "Read".into(), kind: ToolKind::Read, ..Default::default() };
        assert!(!is_edit_call(&call));
    }

    #[test]
    fn the_target_is_the_location_or_an_input_path_under_the_project() {
        assert_eq!(edit_target(&edit("/abs/a.rs"), Some(Path::new("/p"))), Some(PathBuf::from("/abs/a.rs")));
        assert_eq!(edit_target(&edit("src/a.rs"), Some(Path::new("/p"))), Some(PathBuf::from("/p/src/a.rs")));
        let call = ToolCall { id: "t".into(), kind: ToolKind::Edit, raw_input: Some(json!({ "file_path": "b.rs" })), ..Default::default() };
        assert_eq!(edit_target(&call, Some(Path::new("/p"))), Some(PathBuf::from("/p/b.rs")));
        assert_eq!(edit_target(&ToolCall { id: String::new(), ..edit("/a") }, None), None);
    }

    #[test]
    fn a_finished_edit_is_diffed_against_its_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "new\n").unwrap();
        let call = edit(path.to_str().unwrap());
        let snapshot = EditSnapshot { path: path.clone(), before: Some("old\n".into()) };
        assert_eq!(resolve_diff(&call, Some(snapshot), None), Some(ToolContent::Diff { path: path.clone(), old_text: Some("old\n".into()), new_text: "new\n".into() }));

        let unchanged = EditSnapshot { path: path.clone(), before: Some("new\n".into()) };
        assert_eq!(resolve_diff(&call, Some(unchanged), None), None);

        let reported = ToolCall { content: vec![ToolContent::Diff { path: path.clone(), old_text: None, new_text: "x".into() }], ..call };
        assert_eq!(resolve_diff(&reported, None, Some(dir.path())), None);
    }
}
