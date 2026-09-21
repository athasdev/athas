#[tauri::command]
pub async fn intelligence_read_file(root: String, path: String) -> Result<String, String> {
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::read_workspace_file(&root, &path)
   })
   .await
   .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn intelligence_list_files(root: String) -> Result<Vec<String>, String> {
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::list_workspace_files(&root)
   })
   .await
   .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn intelligence_run_command(
   root: String,
   command: String,
   id: String,
) -> Result<athas_ai::workspace_command::WorkspaceCommandOutput, String> {
   athas_ai::workspace_command::run_workspace_command(&root, &command, &id).await
}

#[tauri::command]
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
pub fn intelligence_cancel_command(id: String) {
   athas_ai::workspace_command::cancel_workspace_command(&id);
}

#[tauri::command]
pub async fn intelligence_search_files(
   root: String,
   query: String,
) -> Result<Vec<athas_ai::workspace_tools::WorkspaceMatch>, String> {
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::search_workspace_files(&root, &query)
   })
   .await
   .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn intelligence_edit_file(
   root: String,
   path: String,
   expected_content: Option<String>,
   old_text: String,
   new_text: String,
) -> Result<(), String> {
   tauri::async_runtime::spawn_blocking(move || {
      athas_ai::workspace_tools::edit_workspace_file(
         &root,
         &path,
         expected_content.as_deref(),
         &old_text,
         &new_text,
      )
   })
   .await
   .map_err(|e| e.to_string())?
}
