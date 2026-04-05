use athas_lsp::{LspError, LspManager, LspResult};
use lsp_types::{
   CodeActionOrCommand, CompletionItem, Diagnostic as LspDiagnostic, DiagnosticSeverity,
   GotoDefinitionResponse, Hover, Location, NumberOrString, Position, Range,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnosticContext {
   pub line: u32,
   pub column: u32,
   pub end_line: u32,
   pub end_column: u32,
   pub message: String,
   pub source: Option<String>,
   pub code: Option<String>,
   pub severity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCodeActionItem {
   pub id: String,
   pub title: String,
   pub kind: Option<String>,
   pub is_preferred: bool,
   pub disabled_reason: Option<String>,
   pub has_command: bool,
   pub has_edit: bool,
   pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspApplyCodeActionResult {
   pub applied: bool,
   pub reason: Option<String>,
}

fn convert_diagnostic_context_to_lsp(context: LspDiagnosticContext) -> LspDiagnostic {
   let severity = match context.severity.as_deref() {
      Some("error") => Some(DiagnosticSeverity::ERROR),
      Some("warning") => Some(DiagnosticSeverity::WARNING),
      Some("info") => Some(DiagnosticSeverity::INFORMATION),
      _ => None,
   };

   let code = context.code.as_ref().map(|value| {
      if let Ok(num) = value.parse::<i32>() {
         NumberOrString::Number(num)
      } else {
         NumberOrString::String(value.clone())
      }
   });

   LspDiagnostic {
      range: Range {
         start: Position {
            line: context.line,
            character: context.column,
         },
         end: Position {
            line: context.end_line,
            character: context.end_column,
         },
      },
      severity,
      code,
      code_description: None,
      source: context.source,
      message: context.message,
      related_information: None,
      tags: None,
      data: None,
   }
}

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
pub async fn lsp_get_code_actions(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   diagnostic: LspDiagnosticContext,
) -> LspResult<Vec<LspCodeActionItem>> {
   let actions = lsp_manager
      .get_code_actions(&file_path, convert_diagnostic_context_to_lsp(diagnostic))
      .await
      .map_err(|e| {
         log::error!("Failed to get code actions: {}", e);
         LspError::from(e)
      })?;

   let result = actions
      .into_iter()
      .enumerate()
      .map(|(index, action)| {
         let payload = serde_json::to_value(&action).unwrap_or(Value::Null);
         match &action {
            CodeActionOrCommand::Command(command) => LspCodeActionItem {
               id: format!("command-{}", index),
               title: command.title.clone(),
               kind: None,
               is_preferred: false,
               disabled_reason: None,
               has_command: true,
               has_edit: false,
               payload,
            },
            CodeActionOrCommand::CodeAction(code_action) => LspCodeActionItem {
               id: format!("code-action-{}", index),
               title: code_action.title.clone(),
               kind: code_action
                  .kind
                  .as_ref()
                  .map(|kind| kind.as_str().to_string()),
               is_preferred: code_action.is_preferred.unwrap_or(false),
               disabled_reason: code_action
                  .disabled
                  .as_ref()
                  .map(|disabled| disabled.reason.clone()),
               has_command: code_action.command.is_some(),
               has_edit: code_action.edit.is_some(),
               payload,
            },
         }
      })
      .collect();

   Ok(result)
}

#[tauri::command]
pub async fn lsp_apply_code_action(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   action_payload: Value,
) -> LspResult<LspApplyCodeActionResult> {
   let action = serde_json::from_value::<CodeActionOrCommand>(action_payload).map_err(|e| {
      log::error!("Invalid code action payload: {}", e);
      LspError {
         message: "Invalid code action payload".to_string(),
      }
   })?;

   let (applied, reason) = lsp_manager
      .apply_code_action(&file_path, action)
      .await
      .map_err(|e| {
         log::error!("Failed to apply code action: {}", e);
         LspError::from(e)
      })?;

   Ok(LspApplyCodeActionResult { applied, reason })
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
