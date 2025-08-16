use crate::lsp::{LspManager, types::LspResult};
use lsp_types::{CompletionItem, Hover};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn lsp_start(
   lsp_manager: State<'_, LspManager>,
   workspace_path: String,
) -> LspResult<()> {
   log::info!("lsp_start command called with path: {}", workspace_path);
   lsp_manager
      .start_lsp_for_workspace(PathBuf::from(workspace_path))
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
pub fn lsp_document_open(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   content: String,
) -> LspResult<()> {
   lsp_manager
      .notify_document_open(&file_path, content)
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
pub fn lsp_is_language_supported(file_path: String) -> bool {
   let path = PathBuf::from(file_path);
   let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

   // Support TypeScript, JavaScript, and related files
   matches!(extension, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "json")
}
