use athas_ai::{
   intelligence::{IntelligenceCommandRun, IntelligenceFileWrite, file_deleted_event},
   workspace_tools::{ListFilesOptions, SearchOptions, WorkspaceFileWrite, WorkspaceReplacement},
};
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
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::intelligence::bounded_paths_stay_in_workspace(&root, &paths)
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

#[tauri::command]
#[specta::specta]
pub async fn intelligence_run_command(
   root: String,
   command: String,
   id: String,
) -> Result<IntelligenceCommandRun, String> {
   athas_ai::intelligence::run_tracked_workspace_command(&root, &command, &id).await
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

/// Tells the file tree and open editors about the write, tagged with its write id so the review
/// log knows the change is the agent's. The caller records the write before the file watcher's
/// grace period for unclaimed writes runs out.
fn announce_write(app: &AppHandle, write: WorkspaceFileWrite) -> IntelligenceFileWrite {
   let write = IntelligenceFileWrite::record(write);
   let _ = app.emit("file-changed", write.file_changed_event());
   write
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
   Ok(announce_write(&app, write))
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
   Ok(announce_write(&app, write))
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
   let _ = app.emit("file-changed", file_deleted_event(&path));
   Ok(path)
}
