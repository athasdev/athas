use super::types::{IntoLsp, Lsp, SemanticTokensPayload};
use athas_lsp::{
   DocumentChangeBatch, LspError, LspManager, LspResult,
   client::LspInitialization,
   flat::{
      FlatCodeLens, FlatInlayHint, FlatSymbol, FlatTextEdit, FlatWorkspaceSymbol,
      LspApplyCodeActionResult, LspCodeActionContext, LspCodeActionItem, code_action_items,
      flatten_code_lenses, flatten_document_symbol_response, flatten_inlay_hints,
      flatten_text_edits, flatten_workspace_symbol_response, locations_from_goto_response,
      semantic_tokens_payload,
   },
};
use athas_tooling::{LanguageToolConfigSet, LspLaunch, resolve_lsp_launch};
use lsp_types::{
   CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, CodeActionOrCommand,
   CompletionItem, DocumentHighlight, FoldingRange, Hover, Location, Position,
   PrepareRenameResponse, SelectionRange, SignatureHelp, TextEdit, TypeHierarchyItem,
   WorkspaceEdit,
};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{Manager, State};

#[tauri::command]
#[specta::specta]
pub async fn lsp_start(
   window: tauri::WebviewWindow,
   lsp_manager: State<'_, LspManager>,
   workspace_path: String,
   server_path: Option<String>,
   server_args: Option<Vec<String>>,
   language_id: Option<String>,
   tools: Option<LanguageToolConfigSet>,
   initialization_options: Option<Value>,
   workspace_edit_owner: Option<String>,
) -> LspResult<()> {
   log::info!("lsp_start command called with path: {}", workspace_path);
   let LspLaunch {
      server_path,
      server_args,
      server_env,
   } = resolve_lsp_launch(
      window.app_handle(),
      language_id,
      server_path,
      server_args,
      tools,
   )
   .await
   .map_err(|e| LspError::from(anyhow::anyhow!(e)))?;
   lsp_manager
      .start_lsp_for_workspace(
         PathBuf::from(workspace_path),
         server_path,
         server_args,
         server_env,
         LspInitialization {
            options: initialization_options,
            workspace_edit_owner,
            window_label: Some(window.label().to_string()),
         },
      )
      .await
      .map_err(|e| {
         log::error!("Failed to start LSP: {}", e);
         e.into()
      })
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub async fn lsp_start_for_file(
   window: tauri::WebviewWindow,
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   workspace_path: String,
   server_path: Option<String>,
   server_args: Option<Vec<String>>,
   language_id: Option<String>,
   tools: Option<LanguageToolConfigSet>,
   initialization_options: Option<Value>,
   workspace_edit_owner: Option<String>,
) -> LspResult<()> {
   log::info!("lsp_start_for_file command called for file: {}", file_path);
   let LspLaunch {
      server_path,
      server_args,
      server_env,
   } = resolve_lsp_launch(
      window.app_handle(),
      language_id,
      server_path,
      server_args,
      tools,
   )
   .await
   .map_err(|e| LspError::from(anyhow::anyhow!(e)))?;
   lsp_manager
      .start_lsp_for_file(
         PathBuf::from(file_path),
         PathBuf::from(workspace_path),
         server_path,
         server_args,
         server_env,
         LspInitialization {
            options: initialization_options,
            workspace_edit_owner,
            window_label: Some(window.label().to_string()),
         },
      )
      .await
      .map_err(|e| {
         log::error!("Failed to start LSP for file: {}", e);
         e.into()
      })
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub async fn lsp_get_completions(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
   trigger_kind: Option<u8>,
   trigger_character: Option<String>,
) -> LspResult<Vec<Lsp<CompletionItem>>> {
   log::info!(
      "lsp_get_completions called for {}:{}:{}",
      file_path,
      line,
      character
   );
   let result = lsp_manager
      .get_completions(&file_path, line, character, trigger_kind, trigger_character)
      .await
      .map(IntoLsp::into_lsp)
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
#[specta::specta]
pub async fn lsp_resolve_completion_item(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   item: Lsp<CompletionItem>,
) -> LspResult<Lsp<CompletionItem>> {
   lsp_manager
      .resolve_completion_item(&file_path, item.0)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_hover(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Lsp<Hover>>> {
   lsp_manager
      .get_hover(&file_path, line, character)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_definition(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Vec<Lsp<Location>>>> {
   let response = lsp_manager
      .get_definition(&file_path, line, character)
      .await;

   match response {
      Ok(response) => Ok(locations_from_goto_response(response).into_lsp()),
      Err(e) => Err(e.into()),
   }
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_implementation(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Vec<Lsp<Location>>>> {
   let response = lsp_manager
      .get_implementation(&file_path, line, character)
      .await;

   match response {
      Ok(response) => Ok(locations_from_goto_response(response).into_lsp()),
      Err(e) => Err(e.into()),
   }
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_type_definition(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Vec<Lsp<Location>>>> {
   let response = lsp_manager
      .get_type_definition(&file_path, line, character)
      .await;

   match response {
      Ok(response) => Ok(locations_from_goto_response(response).into_lsp()),
      Err(e) => Err(e.into()),
   }
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_code_actions(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   context: LspCodeActionContext,
) -> LspResult<Vec<LspCodeActionItem>> {
   let (range, diagnostics) = context.into_request();
   let actions = lsp_manager
      .get_code_actions(&file_path, range, diagnostics)
      .await
      .map_err(|e| {
         log::error!("Failed to get code actions: {}", e);
         LspError::from(e)
      })?;

   Ok(code_action_items(actions))
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_apply_code_action(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   action_payload: Value,
) -> LspResult<LspApplyCodeActionResult> {
   let action = serde_json::from_value::<CodeActionOrCommand>(action_payload).map_err(|e| {
      log::error!("Invalid code action payload: {}", e);
      LspError::new("Invalid code action payload")
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
#[specta::specta]
pub async fn lsp_execute_command(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   command: String,
   command_arguments: Option<Vec<Value>>,
) -> LspResult<Option<Value>> {
   lsp_manager
      .execute_command(&file_path, command, command_arguments.unwrap_or_default())
      .await
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub fn lsp_validate_workspace_edit_owner(
   lsp_manager: State<'_, LspManager>,
   client_id: String,
   owner_token: String,
) -> bool {
   lsp_manager.validate_workspace_edit_owner(&client_id, &owner_token)
}

#[tauri::command]
#[specta::specta]
pub fn lsp_respond_workspace_edit(
   lsp_manager: State<'_, LspManager>,
   client_id: String,
   request_id: Value,
   applied: bool,
   failure_reason: Option<String>,
   failed_change: Option<u32>,
) -> LspResult<()> {
   lsp_manager
      .respond_workspace_edit(
         &client_id,
         request_id,
         applied,
         failure_reason,
         failed_change,
      )
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_java_class_file_contents(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   uri: String,
) -> LspResult<String> {
   let uri = uri
      .parse()
      .map_err(|error| LspError::new(format!("Invalid Java class file URI: {error}")))?;
   lsp_manager
      .get_java_class_file_contents(&file_path, uri)
      .await
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_semantic_tokens(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> LspResult<SemanticTokensPayload> {
   let response = lsp_manager
      .get_semantic_tokens(&file_path)
      .await
      .map_err(|e| {
         log::error!("Failed to get semantic tokens: {}", e);
         LspError::from(e)
      })?;

   Ok(SemanticTokensPayload(semantic_tokens_payload(
      response,
      || lsp_manager.semantic_token_legend(&file_path),
   )))
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_code_lens(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> LspResult<Vec<FlatCodeLens>> {
   let response = lsp_manager.get_code_lens(&file_path).await.map_err(|e| {
      log::error!("Failed to get code lens: {}", e);
      LspError::from(e)
   })?;

   Ok(flatten_code_lenses(response))
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_format_document(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> LspResult<Vec<FlatTextEdit>> {
   let response = lsp_manager.format_document(&file_path).await.map_err(|e| {
      log::error!("Failed to format document with LSP: {}", e);
      LspError::from(e)
   })?;

   Ok(flatten_text_edits(response))
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_format_range(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   start_line: u32,
   start_character: u32,
   end_line: u32,
   end_character: u32,
) -> LspResult<Vec<FlatTextEdit>> {
   let response = lsp_manager
      .format_range(
         &file_path,
         start_line,
         start_character,
         end_line,
         end_character,
      )
      .await
      .map_err(|e| {
         log::error!("Failed to format range with LSP: {}", e);
         LspError::from(e)
      })?;

   Ok(flatten_text_edits(response))
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_folding_ranges(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> LspResult<Vec<Lsp<FoldingRange>>> {
   lsp_manager
      .get_folding_ranges(&file_path)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_selection_ranges(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   positions: Vec<Lsp<Position>>,
) -> LspResult<Vec<Lsp<SelectionRange>>> {
   lsp_manager
      .get_selection_ranges(&file_path, positions.into_iter().map(|p| p.0).collect())
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_document_highlights(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Vec<Lsp<DocumentHighlight>>> {
   lsp_manager
      .get_document_highlights(&file_path, line, character)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_prepare_call_hierarchy(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Vec<Lsp<CallHierarchyItem>>> {
   lsp_manager
      .prepare_call_hierarchy(&file_path, line, character)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_incoming_calls(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   item: Lsp<CallHierarchyItem>,
) -> LspResult<Vec<Lsp<CallHierarchyIncomingCall>>> {
   lsp_manager
      .get_incoming_calls(&file_path, item.0)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_outgoing_calls(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   item: Lsp<CallHierarchyItem>,
) -> LspResult<Vec<Lsp<CallHierarchyOutgoingCall>>> {
   lsp_manager
      .get_outgoing_calls(&file_path, item.0)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_prepare_type_hierarchy(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Vec<Lsp<TypeHierarchyItem>>> {
   lsp_manager
      .prepare_type_hierarchy(&file_path, line, character)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_supertypes(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   item: Lsp<TypeHierarchyItem>,
) -> LspResult<Vec<Lsp<TypeHierarchyItem>>> {
   lsp_manager
      .get_supertypes(&file_path, item.0)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_subtypes(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   item: Lsp<TypeHierarchyItem>,
) -> LspResult<Vec<Lsp<TypeHierarchyItem>>> {
   lsp_manager
      .get_subtypes(&file_path, item.0)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_format_on_type(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
   trigger_character: String,
   tab_size: u32,
   insert_spaces: bool,
) -> LspResult<Vec<Lsp<TextEdit>>> {
   lsp_manager
      .format_on_type(
         &file_path,
         line,
         character,
         trigger_character,
         tab_size,
         insert_spaces,
      )
      .await
      .map(IntoLsp::into_lsp)
      .map_err(LspError::from)
}

#[tauri::command]
#[specta::specta]
pub fn lsp_get_on_type_formatting_trigger_characters(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> Vec<String> {
   lsp_manager.get_on_type_formatting_trigger_characters(&file_path)
}

#[tauri::command]
#[specta::specta]
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

   Ok(flatten_inlay_hints(response))
}

#[tauri::command]
#[specta::specta]
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

   Ok(flatten_document_symbol_response(response))
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_workspace_symbols(
   lsp_manager: State<'_, LspManager>,
   workspace_path: String,
   query: String,
) -> LspResult<Vec<FlatWorkspaceSymbol>> {
   let responses = lsp_manager
      .get_workspace_symbols(std::path::Path::new(&workspace_path), &query)
      .await
      .map_err(|e| {
         log::error!("Failed to get workspace symbols: {}", e);
         LspError::from(e)
      })?;

   Ok(flatten_workspace_symbol_response(responses))
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_signature_help(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Lsp<SignatureHelp>>> {
   lsp_manager
      .get_signature_help(&file_path, line, character)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(|e| {
         log::error!("Failed to get signature help: {}", e);
         e.into()
      })
}

#[tauri::command]
#[specta::specta]
pub fn lsp_get_signature_trigger_characters(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
) -> Vec<String> {
   lsp_manager.get_signature_help_trigger_characters(&file_path)
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_get_references(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Vec<Lsp<Location>>>> {
   lsp_manager
      .get_references(&file_path, line, character)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(|e| {
         log::error!("Failed to get references: {}", e);
         e.into()
      })
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_rename(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
   new_name: String,
) -> LspResult<Option<Lsp<WorkspaceEdit>>> {
   lsp_manager
      .rename(&file_path, line, character, new_name)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(|e| {
         log::error!("Failed to rename: {}", e);
         e.into()
      })
}

#[tauri::command]
#[specta::specta]
pub async fn lsp_prepare_rename(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   line: u32,
   character: u32,
) -> LspResult<Option<Lsp<PrepareRenameResponse>>> {
   lsp_manager
      .prepare_rename(&file_path, line, character)
      .await
      .map(IntoLsp::into_lsp)
      .map_err(|e| {
         log::error!("Failed to prepare rename: {}", e);
         e.into()
      })
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub fn lsp_document_change(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   content: String,
   version: i64,
) -> LspResult<()> {
   lsp_manager
      .notify_document_change(&file_path, content, version)
      .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn lsp_document_change_batch(
   lsp_manager: State<'_, LspManager>,
   file_path: String,
   batches: Vec<DocumentChangeBatch>,
) -> LspResult<i32> {
   lsp_manager
      .queue_document_change_batches(&file_path, batches)
      .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn lsp_document_save(lsp_manager: State<'_, LspManager>, file_path: String) -> LspResult<()> {
   lsp_manager
      .notify_document_save(&file_path)
      .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn lsp_document_close(lsp_manager: State<'_, LspManager>, file_path: String) -> LspResult<()> {
   lsp_manager
      .notify_document_close(&file_path)
      .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn lsp_is_language_supported(lsp_manager: State<'_, LspManager>, file_path: String) -> bool {
   lsp_manager.get_client_for_file(&file_path).is_some()
}
