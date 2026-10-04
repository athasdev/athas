use athas_ai::workspace_tools::{
   ListFilesOptions, SearchOptions, WorkspaceFileWrite, WorkspaceReplacement,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[tauri::command]
#[specta::specta]
pub async fn intelligence_read_file(root: String, path: String) -> Result<String, String> {
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::read_workspace_file(&root, &path)
   })
   .await
   .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn intelligence_paths_stay_in_workspace(
   root: String,
   paths: Vec<String>,
) -> Result<bool, String> {
   if paths.len() > 256 {
      return Ok(false);
   }
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::paths_stay_in_workspace(&root, &paths)
   })
   .await
   .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn intelligence_list_files(
   root: String,
   options: Option<ListFilesOptions>,
) -> Result<athas_ai::workspace_tools::WorkspaceFileList, String> {
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::list_workspace_files(&root, &options.unwrap_or_default())
   })
   .await
   .map_err(|e| e.to_string())?
}

/// A command's output together with the workspace files it changed, which the chat records for
/// review like the agent's own writes.
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceCommandRun {
   #[serde(flatten)]
   output: athas_ai::workspace_command::WorkspaceCommandOutput,
   /// `None` when the workspace could not be compared, so changes went untracked.
   file_changes: Option<athas_ai::workspace_changes::WorkspaceChanges>,
}

#[tauri::command]
#[specta::specta]
pub async fn intelligence_run_command(
   root: String,
   command: String,
   id: String,
) -> Result<IntelligenceCommandRun, String> {
   let snapshot_root = root.clone();
   let snapshot = tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_changes::snapshot_workspace(&snapshot_root).ok()
   })
   .await
   .ok()
   .flatten();
   let output = athas_ai::workspace_command::run_workspace_command(&root, &command, &id).await?;
   let file_changes = match snapshot {
      Some(snapshot) => tauri::async_runtime::spawn_blocking(move || {
         athas_ai::workspace_changes::diff_workspace(&snapshot).ok()
      })
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

#[tauri::command]
#[specta::specta]
pub async fn chat_run_terminal_command(
   root: String,
   command: String,
   id: String,
   on_output: tauri::ipc::Channel<athas_ai::workspace_command::WorkspaceCommandChunk>,
) -> Result<athas_ai::workspace_command::WorkspaceCommandOutput, String> {
   let listener: athas_ai::workspace_command::CommandOutputListener =
      std::sync::Arc::new(move |chunk| {
         let _ = on_output.send(chunk);
      });
   athas_ai::workspace_command::run_workspace_command_with_output(
      &root,
      &command,
      &id,
      Some(listener),
   )
   .await
}

#[tauri::command]
#[specta::specta]
pub fn intelligence_cancel_command(id: String) {
   athas_ai::workspace_command::cancel_workspace_command(&id);
}

#[tauri::command]
#[specta::specta]
pub async fn intelligence_search_files(
   root: String,
   options: SearchOptions,
) -> Result<athas_ai::workspace_tools::WorkspaceSearchResult, String> {
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::search_workspace_files(&root, &options)
   })
   .await
   .map_err(|e| e.to_string())?
}

/// A write by Athas's own agent, in the shape of the ACP `agent_file_write` event, so the chat
/// records it for keep-or-reject review exactly like an ACP agent's write.
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceFileWrite {
   write_id: u64,
   path: String,
   previous_content: Option<String>,
   content: String,
}

/// Tells the file tree and open editors about the write, tagged with its write id so the review
/// log knows the change is the agent's. The caller records the write before the file watcher's
/// grace period for unclaimed writes runs out.
fn announce_write(
   app: &AppHandle,
   write: WorkspaceFileWrite,
) -> Result<IntelligenceFileWrite, String> {
   let write_id = athas_ai::acp::next_agent_write_id();
   let _ = app.emit(
      "file-changed",
      serde_json::json!({
         "path": write.path,
         "event_type": if write.previous_content.is_some() { "reloaded" } else { "opened" },
         "agent_write_id": write_id,
      }),
   );
   Ok(IntelligenceFileWrite {
      write_id,
      path: write.path,
      previous_content: write.previous_content,
      content: write.content,
   })
}

#[tauri::command]
#[specta::specta]
pub async fn intelligence_edit_file(
   app: AppHandle,
   root: String,
   path: String,
   expected_content: String,
   edits: Vec<WorkspaceReplacement>,
) -> Result<IntelligenceFileWrite, String> {
   let write = tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::edit_workspace_file(&root, &path, &expected_content, &edits)
   })
   .await
   .map_err(|e| e.to_string())??;
   announce_write(&app, write)
}

#[tauri::command]
#[specta::specta]
pub async fn intelligence_write_file(
   app: AppHandle,
   root: String,
   path: String,
   expected_content: Option<String>,
   content: String,
) -> Result<IntelligenceFileWrite, String> {
   let write = tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::write_workspace_file(
         &root,
         &path,
         expected_content.as_deref(),
         &content,
      )
   })
   .await
   .map_err(|e| e.to_string())??;
   announce_write(&app, write)
}

#[tauri::command]
#[specta::specta]
pub async fn intelligence_delete_file(
   app: AppHandle,
   root: String,
   path: String,
   expected_content: String,
) -> Result<String, String> {
   let path = tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::delete_workspace_file(&root, &path, &expected_content)
   })
   .await
   .map_err(|e| e.to_string())??;
   let _ = app.emit(
      "file-changed",
      serde_json::json!({ "path": path, "event_type": "deleted" }),
   );
   Ok(path)
}
