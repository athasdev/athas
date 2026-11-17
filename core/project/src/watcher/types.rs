use serde::Serialize;

/// The event that carries [`WorkspaceFileChanges`] to the windows that own a workspace.
pub const WORKSPACE_FILE_CHANGES_EVENT: &str = "workspace-file-changes";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceFileChangeKind {
   Created,
   Modified,
   Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct WorkspaceFileChange {
   pub path: String,
   pub kind: WorkspaceFileChangeKind,
   /// False for removed paths, whose type can no longer be read.
   pub is_dir: bool,
}

/// Everything that changed under one workspace root during one debounce window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct WorkspaceFileChanges {
   /// The root exactly as it was passed to the watcher.
   pub root: String,
   /// Worktree changes that pass the ignore rules, one entry per path.
   pub changes: Vec<WorkspaceFileChange>,
   /// Repository state (HEAD, the index, refs) changed; refresh the Git view.
   pub git_changed: bool,
   /// Events were lost or too many paths changed to list; `changes` may be incomplete and the
   /// whole root should be re-read.
   pub rescan: bool,
}

impl WorkspaceFileChanges {
   pub fn is_empty(&self) -> bool {
      self.changes.is_empty() && !self.git_changed && !self.rescan
   }
}

/// Who asked for a root to be watched. A root stays watched while any subscriber remains.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Subscriber {
   /// A webview window, by label; its batches are emitted to that window only.
   Window(String),
   /// The file search index, which is fed from the same batches instead of running its own
   /// watcher.
   SearchIndex,
}

/// Receives one batch per root per debounce window.
pub trait WorkspaceChangeSink: Send + Sync {
   fn deliver(&self, changes: &WorkspaceFileChanges, subscribers: &[Subscriber]);
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn serializes_the_batch_payload_in_snake_case() {
      let batch = WorkspaceFileChanges {
         root: "/repo".into(),
         changes: vec![WorkspaceFileChange {
            path: "/repo/a.ts".into(),
            kind: WorkspaceFileChangeKind::Removed,
            is_dir: false,
         }],
         git_changed: true,
         rescan: false,
      };
      assert_eq!(
         serde_json::to_value(&batch).unwrap(),
         serde_json::json!({
            "root": "/repo",
            "changes": [{ "path": "/repo/a.ts", "kind": "removed", "is_dir": false }],
            "git_changed": true,
            "rescan": false,
         })
      );
   }
}
