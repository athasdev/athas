use super::{
   convert::{
      convert_diagnostic_context_to_lsp, flatten_document_symbols, flatten_inlay_hint,
      symbol_kind_label,
   },
   types::{
      FlatCodeLens, FlatInlayHint, FlatSemanticToken, FlatSymbol, LspApplyCodeActionResult,
      LspCodeActionItem, LspDiagnosticContext,
   },
};
use athas_lsp::{LspError, LspManager, LspResult};
use lsp_types::{
   CodeActionOrCommand, CompletionItem, DocumentSymbolResponse, GotoDefinitionResponse, Hover,
   Location, SemanticTokensResult, SignatureHelp, WorkspaceEdit,
};
use serde_json::Value;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn lsp_start(
   lsp_manager: State<'_, LspManager>,
   workspace_path: String,
   server_path: Option<String>,
   server_args: Option<Vec<String>>,
   initialization_options: Option<Value>,
) -> LspResult<()> {
   log::info!("lsp_start command called with path: {}", workspace_path);
   lsp_manager
      .start_lsp_for_workspace(
         PathBuf::from(workspace_path),
         server_path,
         server_args,
         initialization_options,
      )
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
   initialization_options: Option<Value>,
) -> LspResult<()> {
   log::info!("lsp_start_for_file command called for file: {}", file_path);
   lsp_manager
      .start_lsp_for_file(
         PathBuf::from(file_path),
         PathBuf::from(workspace_path),
         server_path,
         server_args,
         initialization_options,
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

   Ok(actions
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
      .collect())
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
pub async fn lsp_get_semantic_tokens(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> LspResult<Vec<FlatSemanticToken>> {
   let response = lsp_manager
      .get_semantic_tokens(&file_path)
      .await
      .map_err(|e| {
         log::error!("Failed to get semantic tokens: {}", e);
         LspError::from(e)
      })?;

   let data = match response {
      Some(SemanticTokensResult::Tokens(tokens)) => tokens.data,
      Some(SemanticTokensResult::Partial(partial)) => partial.data,
      None => return Ok(vec![]),
   };

   let mut result = Vec::with_capacity(data.len());
   let mut current_line: u32 = 0;
   let mut current_char: u32 = 0;

   for token in &data {
      if token.delta_line > 0 {
         current_line += token.delta_line;
         current_char = token.delta_start;
      } else {
         current_char += token.delta_start;
      }

      result.push(FlatSemanticToken {
         line: current_line,
         start_char: current_char,
         length: token.length,
         token_type: token.token_type,
         token_modifiers: token.token_modifiers_bitset,
      });
   }

   Ok(result)
}

#[tauri::command]
pub async fn lsp_get_code_lens(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> LspResult<Vec<FlatCodeLens>> {
   let response = lsp_manager.get_code_lens(&file_path).await.map_err(|e| {
      log::error!("Failed to get code lens: {}", e);
      LspError::from(e)
   })?;

   Ok(response
      .unwrap_or_default()
      .into_iter()
      .filter_map(|lens| {
         let cmd = lens.command?;
         Some(FlatCodeLens {
            line: lens.range.start.line,
            title: cmd.title,
            command: Some(cmd.command),
         })
      })
      .collect())
}

#[tauri::command]
pub async fn lsp_get_inlay_hints(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   start_line: u32,
   end_line: u32,
) -> LspResult<Vec<FlatInlayHint>> {
   let response = lsp_manager
      .get_inlay_hints(&file_path, start_line, end_line)
      .await
      .map_err(|e| {
         log::error!("Failed to get inlay hints: {}", e);
         LspError::from(e)
      })?;

   Ok(response
      .unwrap_or_default()
      .iter()
      .map(flatten_inlay_hint)
      .collect())
}

#[tauri::command]
pub async fn lsp_get_document_symbols(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> LspResult<Vec<FlatSymbol>> {
   let response = lsp_manager
      .get_document_symbols(&file_path)
      .await
      .map_err(|e| {
         log::error!("Failed to get document symbols: {}", e);
         LspError::from(e)
      })?;

   let symbols = match response {
      Some(DocumentSymbolResponse::Flat(infos)) => infos
         .into_iter()
         .map(|info| FlatSymbol {
            name: info.name,
            kind: symbol_kind_label(info.kind),
            detail: None,
            line: info.location.range.start.line,
            character: info.location.range.start.character,
            end_line: info.location.range.end.line,
            end_character: info.location.range.end.character,
            container_name: info.container_name,
         })
         .collect(),
      Some(DocumentSymbolResponse::Nested(doc_symbols)) => {
         flatten_document_symbols(&doc_symbols, None)
      }
      None => vec![],
   };

   Ok(symbols)
}

#[tauri::command]
pub async fn lsp_get_signature_help(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<SignatureHelp>> {
   lsp_manager
      .get_signature_help(&file_path, line, character)
      .await
      .map_err(|e| {
         log::error!("Failed to get signature help: {}", e);
         e.into()
      })
}

#[tauri::command]
pub async fn lsp_get_references(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Vec<Location>>> {
   lsp_manager
      .get_references(&file_path, line, character)
      .await
      .map_err(|e| {
         log::error!("Failed to get references: {}", e);
         e.into()
      })
}

#[tauri::command]
pub async fn lsp_rename(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
   new_name: String,
) -> LspResult<Option<WorkspaceEdit>> {
   lsp_manager
      .rename(&file_path, line, character, new_name)
      .await
      .map_err(|e| {
         log::error!("Failed to rename: {}", e);
         e.into()
      })
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
   true
}
