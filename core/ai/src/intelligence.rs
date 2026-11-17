//! Workspace tools for Athas's own agent: running commands with change tracking and announcing
//! file writes so the chat can review them like an ACP agent's.

use crate::{
   acp::next_agent_write_id,
   workspace_changes::{WorkspaceChanges, diff_workspace, snapshot_workspace},
   workspace_command::{WorkspaceCommandOutput, run_workspace_command},
   workspace_tools::{WorkspaceFileWrite, paths_stay_in_workspace},
};
use serde::Serialize;
use serde_json::{Value, json};

/// More paths than this in one containment check are refused outright.
const MAX_CONTAINMENT_PATHS: usize = 256;

/// Whether every path resolves inside the workspace; oversized batches are refused.
pub fn bounded_paths_stay_in_workspace(root: &str, paths: &[String]) -> bool {
   paths.len() <= MAX_CONTAINMENT_PATHS && paths_stay_in_workspace(root, paths)
}

/// A command's output together with the workspace files it changed, which the chat records for
/// review like the agent's own writes.
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceCommandRun {
   #[serde(flatten)]
   pub output: WorkspaceCommandOutput,
   /// `None` when the workspace could not be compared, so changes went untracked.
   pub file_changes: Option<WorkspaceChanges>,
}

/// Runs `command` in the workspace and reports the files it changed. A workspace that cannot be
/// snapshotted or compared only loses the change list, never the command's result.
pub async fn run_tracked_workspace_command(
   root: &str,
   command: &str,
   id: &str,
) -> Result<IntelligenceCommandRun, String> {
   let snapshot_root = root.to_string();
   let snapshot = tokio::task::spawn_blocking(move || snapshot_workspace(&snapshot_root).ok())
      .await
      .ok()
      .flatten();
   let output = run_workspace_command(root, command, id).await?;
   let file_changes = match snapshot {
      Some(snapshot) => tokio::task::spawn_blocking(move || diff_workspace(&snapshot).ok())
         .await
         .ok()
         .flatten(),
      None => None,
   };
   Ok(IntelligenceCommandRun {
      output,
      file_changes,
   })
}

/// A write by Athas's own agent, in the shape of the ACP `agent_file_write` event, so the chat
/// records it for keep-or-reject review exactly like an ACP agent's write.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceFileWrite {
   pub write_id: u64,
   pub path: String,
   pub previous_content: Option<String>,
   pub content: String,
}

impl IntelligenceFileWrite {
   /// Numbers the write so the review log knows the resulting file change is the agent's.
   pub fn record(write: WorkspaceFileWrite) -> Self {
      Self {
         write_id: next_agent_write_id(),
         path: write.path,
         previous_content: write.previous_content,
         content: write.content,
      }
   }

   /// The `file-changed` event that tells the file tree and open editors about the write.
   pub fn file_changed_event(&self) -> Value {
      json!({
         "path": self.path,
         "event_type": if self.previous_content.is_some() { "reloaded" } else { "opened" },
         "agent_write_id": self.write_id,
      })
   }
}

/// The `file-changed` event for a file the agent deleted.
pub fn file_deleted_event(path: &str) -> Value {
   json!({ "path": path, "event_type": "deleted" })
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::fs;

   fn write(path: &str, previous: Option<&str>) -> WorkspaceFileWrite {
      WorkspaceFileWrite {
         path: path.to_string(),
         previous_content: previous.map(ToString::to_string),
         content: "new".to_string(),
      }
   }

   #[test]
   fn numbers_writes_and_describes_them_as_file_changes() {
      let created = IntelligenceFileWrite::record(write("/ws/new.rs", None));
      let edited = IntelligenceFileWrite::record(write("/ws/old.rs", Some("old")));

      assert!(edited.write_id > created.write_id);
      assert_eq!(
         created.file_changed_event(),
         json!({ "path": "/ws/new.rs", "event_type": "opened", "agent_write_id": created.write_id })
      );
      assert_eq!(edited.file_changed_event()["event_type"], "reloaded");
      assert_eq!(
         serde_json::to_value(&edited).unwrap(),
         json!({
            "writeId": edited.write_id,
            "path": "/ws/old.rs",
            "previousContent": "old",
            "content": "new",
         })
      );
      assert_eq!(
         file_deleted_event("/ws/gone.rs"),
         json!({ "path": "/ws/gone.rs", "event_type": "deleted" })
      );
   }

   #[test]
   fn refuses_oversized_containment_checks() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();

      assert!(bounded_paths_stay_in_workspace(
         root,
         &["src/lib.rs".into()]
      ));
      assert!(!bounded_paths_stay_in_workspace(
         root,
         &["../outside".into()]
      ));
      assert!(!bounded_paths_stay_in_workspace(
         root,
         &vec!["src/lib.rs".to_string(); MAX_CONTAINMENT_PATHS + 1]
      ));
   }

   #[cfg(unix)]
   #[tokio::test]
   async fn reports_the_files_a_command_changed() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join("kept.txt"), "same\n").unwrap();

      let run = run_tracked_workspace_command(
         root,
         "printf created > created.txt; echo done",
         "tracked-command-test",
      )
      .await
      .unwrap();

      assert_eq!(run.output.stdout, "done\n");
      assert_eq!(run.output.exit_code, Some(0));
      let changes = run.file_changes.as_ref().expect("workspace compared");
      assert_eq!(changes.changes.len(), 1);
      assert!(changes.changes[0].path.ends_with("created.txt"));
      assert_eq!(changes.changes[0].previous_content, None);
      assert_eq!(changes.changes[0].content.as_deref(), Some("created"));
      let serialized = serde_json::to_value(&run).unwrap();
      assert_eq!(serialized["stdout"], "done\n");
      assert!(serialized["fileChanges"]["changes"].is_array());
   }
}
