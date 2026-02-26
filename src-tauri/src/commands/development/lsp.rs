use crate::lsp::{LspManager, types::LspResult};
use lsp_types::{CompletionItem, GotoDefinitionResponse, Hover, Location};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn lsp_start(
   lsp_manager: State<'_, LspManager>,
   workspace_path: String,
   server_path: Option<String>,
   server_args: Option<Vec<String>>,
) -> LspResult<()> {
   log::info!("lsp_start command called with path: {}", workspace_path);
   lsp_manager
      .start_lsp_for_workspace(PathBuf::from(workspace_path), server_path, server_args)
      .await
      .map_err(|e| {
         log::error!("Failed to start LSP: {}", e);
         e.into()
      })
}

#[tauri::command]
pub fn lsp_stop(lsp_manager: State<'_, LspManager>, workspace_path: String) -> LspResult<()> {
   log::info!("lsp_stop command called with path: {}", workspace_path);
   lsp_manager
      .shutdown_workspace(&PathBuf::from(workspace_path))
      .map_err(|e| {
         log::error!("Failed to stop LSP: {}", e);
         e.into()
      })
}

#[tauri::command]
pub async fn lsp_start_for_file(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   workspace_path: String,
   server_path: Option<String>,
   server_args: Option<Vec<String>>,
) -> LspResult<()> {
   log::info!("lsp_start_for_file command called for file: {}", file_path);
   lsp_manager
      .start_lsp_for_file(
         PathBuf::from(file_path),
         PathBuf::from(workspace_path),
         server_path,
         server_args,
      )
      .await
      .map_err(|e| {
         log::error!("Failed to start LSP for file: {}", e);
         e.into()
      })
}

#[tauri::command]
pub fn lsp_stop_for_file(lsp_manager: State<'_, LspManager>, file_path: String) -> LspResult<()> {
   log::info!("lsp_stop_for_file command called for file: {}", file_path);
   lsp_manager
      .stop_lsp_for_file(&PathBuf::from(file_path))
      .map_err(|e| {
         log::error!("Failed to stop LSP for file: {}", e);
         e.into()
      })
}

#[tauri::command]
pub async fn lsp_get_completions(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Vec<CompletionItem>> {
   log::info!(
      "lsp_get_completions called for {}:{}:{}",
      file_path,
      line,
      character
   );
   let result = lsp_manager
      .get_completions(&file_path, line, character)
      .await
      .map_err(|e| {
         log::error!("Failed to get completions: {}", e);
         e.into()
      });
   if let Ok(ref completions) = result {
      log::info!("Got {} completions", completions.len());
   }
   result
}

#[tauri::command]
pub async fn lsp_get_hover(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Hover>> {
   lsp_manager
      .get_hover(&file_path, line, character)
      .await
      .map_err(Into::into)
}

#[tauri::command]
pub async fn lsp_get_definition(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Vec<Location>>> {
   let response = lsp_manager
      .get_definition(&file_path, line, character)
      .await;

   match response {
      Ok(Some(GotoDefinitionResponse::Scalar(loc))) => Ok(Some(vec![loc])),
      Ok(Some(GotoDefinitionResponse::Array(locs))) => Ok(Some(locs)),
      Ok(Some(GotoDefinitionResponse::Link(links))) => Ok(Some(
         links
            .into_iter()
            .map(|link| Location {
               uri: link.target_uri,
               range: link.target_selection_range,
            })
            .collect(),
      )),
      Ok(None) => Ok(None),
      Err(e) => Err(e.into()),
   }
}

#[tauri::command]
pub fn lsp_document_open(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   content: String,
   language_id: Option<String>,
) -> LspResult<()> {
   lsp_manager
      .notify_document_open(&file_path, content, language_id)
      .map_err(Into::into)
}

#[tauri::command]
pub fn lsp_document_change(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   content: String,
   version: i32,
) -> LspResult<()> {
   lsp_manager
      .notify_document_change(&file_path, content, version)
      .map_err(Into::into)
}

#[tauri::command]
pub fn lsp_document_close(lsp_manager: State<'_, LspManager>, file_path: String) -> LspResult<()> {
   lsp_manager
      .notify_document_close(&file_path)
      .map_err(Into::into)
}

#[tauri::command]
pub fn lsp_is_language_supported(_file_path: String) -> bool {
   // Note: LSP support is now determined dynamically by the frontend extension registry.
   // This command is deprecated but kept for backwards compatibility.
   // Always return true and let the frontend do the actual checking.
   true
}
