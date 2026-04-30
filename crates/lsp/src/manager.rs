use super::{
   client::LspClient,
   config::{LspRegistry, LspSettings},
   manager_state::{LspInstance, WorkspaceClients},
   manager_support, utils,
};
use anyhow::{Context, Result, bail};
use lsp_types::*;
use std::{
   fs,
   path::{Path, PathBuf},
   time::Instant,
};
use tauri::{AppHandle, Manager as TauriManager};

pub struct LspManager {
   // Map (workspace path, language) to their LSP clients with reference counting
   workspace_clients: WorkspaceClients,
   registry: LspRegistry,
   app_handle: AppHandle,
   settings: LspSettings,
}

impl LspManager {
   pub fn new(app_handle: AppHandle) -> Self {
      Self {
         workspace_clients: WorkspaceClients::new(),
         registry: LspRegistry::new(),
         app_handle,
         settings: LspSettings::default(),
      }
   }

   pub fn get_server_path(&self, server_name: &str) -> Result<PathBuf> {
      // For TypeScript, try multiple detection strategies
      if server_name == "typescript" {
         // First try: globally installed server via package managers
         if let Some(path) = utils::find_global_binary("typescript-language-server") {
            log::info!("Using global TypeScript server: {:?}", path);
            return Ok(path);
         }

         // Second try: check if it's in PATH
         if let Some(path) = utils::find_in_path("typescript-language-server") {
            log::info!("Using TypeScript server from PATH: {:?}", path);
            return Ok(path);
         }

         // Third try: local node_modules in current working directory
         let local_path = std::env::current_dir()
            .context("Failed to get current directory")?
            .join("node_modules/.bin/typescript-language-server");

         if local_path.exists() {
            log::info!("Using local TypeScript server: {:?}", local_path);
            return Ok(local_path);
         }
      }

      // Look for bundled executable
      let app_dir = self
         .app_handle
         .path()
         .app_data_dir()
         .context("Failed to get app dir")?;

      let bundled_path = app_dir.join(format!("{}-language-server", server_name));

      if bundled_path.exists() {
         log::info!("Using bundled language server: {:?}", bundled_path);
         Ok(bundled_path)
      } else {
         bail!(
            "Language server '{}' not found. Please install it globally using: bun add -g \
             typescript-language-server",
            server_name
         )
      }
   }

   fn validate_server_path(server_path: &Path) -> Result<()> {
      if server_path.exists() {
         #[cfg(unix)]
         {
            use std::os::unix::fs::PermissionsExt;

            let metadata = fs::metadata(server_path).with_context(|| {
               format!(
                  "Failed to inspect language server binary at '{}'",
                  server_path.display()
               )
            })?;

            let extension = server_path
               .extension()
               .and_then(|ext| ext.to_str())
               .unwrap_or_default();
            let is_js_entrypoint = matches!(extension, "js" | "mjs" | "cjs");
            let executable = metadata.permissions().mode() & 0o111 != 0;

            if !is_js_entrypoint && !executable {
               bail!(
                  "Language server binary exists but is not executable: '{}'. Reinstall the \
                   language tools.",
                  server_path.display()
               );
            }
         }

         return Ok(());
      }

      if server_path.components().count() == 1 {
         bail!(
            "LSP tool '{}' is unavailable. Athas could not resolve an installed binary. Reinstall \
             the language tools.",
            server_path.display()
         );
      }

      bail!(
         "Language server binary not found at '{}'. Reinstall the language tools.",
         server_path.display()
      );
   }

   fn resolve_server_path_override(&self, path: &str) -> Result<PathBuf> {
      let requested_path = PathBuf::from(path);
      if requested_path.components().count() != 1 {
         return Ok(requested_path);
      }

      if let Some(path_on_disk) = utils::find_in_path(path) {
         log::info!(
            "Resolved LSP bare command '{}' from PATH: {:?}",
            path,
            path_on_disk
         );
         return Ok(path_on_disk);
      }

      let tools_dir = self
         .app_handle
         .path()
         .app_data_dir()
         .context("Failed to resolve app data dir while resolving LSP tool path")?
         .join("tools");

      if let Some(managed_path) = utils::find_managed_binary(&tools_dir, path) {
         log::info!(
            "Resolved LSP bare command '{}' from managed tools: {:?}",
            path,
            managed_path
         );
         return Ok(managed_path);
      }

      Ok(requested_path)
   }

   pub async fn start_lsp_for_workspace(
      &self,
      workspace_path: PathBuf,
      server_path_override: Option<String>,
      server_args_override: Option<Vec<String>>,
      initialization_options: Option<serde_json::Value>,
   ) -> Result<()> {
      log::info!("Starting LSP for workspace: {:?}", workspace_path);

      // Use provided server path or find appropriate LSP server for workspace
      let (server_path, server_args, server_name) = if let Some(path) = server_path_override {
         log::info!("Using provided server path override: {}", path);
         let args = server_args_override.unwrap_or_default();
         let name = path.split('/').next_back().unwrap_or("custom").to_string();
         let resolved_path = self.resolve_server_path_override(&path)?;

         log::info!("Resolved LSP server path: {:?}", resolved_path);
         log::info!("Path exists: {}", resolved_path.exists());

         (resolved_path, args, name)
      } else {
         // Fallback to registry-based detection
         let server_config = self
            .registry
            .find_server_for_workspace(&workspace_path)
            .context("No LSP server found for workspace")?;

         log::info!("Using LSP server '{}' for workspace", server_config.name);

         let server_path = self.get_server_path(&server_config.name)?;
         (
            server_path,
            server_config.args.clone(),
            server_config.name.clone(),
         )
      };

      Self::validate_server_path(&server_path)?;

      let root_uri = Url::from_file_path(&workspace_path)
         .map_err(|_| anyhow::anyhow!("Invalid workspace path"))?;

      let (client, child) = LspClient::start(
         server_path,
         server_args,
         root_uri.clone(),
         Some(self.app_handle.clone()),
      )
      .await?;

      // Initialize the client
      client
         .initialize(root_uri, initialization_options.clone())
         .await?;

      // Check if LSP already running for this workspace+language
      if self
         .workspace_clients
         .contains_workspace_server(&workspace_path, &server_name)
      {
         log::info!(
            "LSP '{}' already running for workspace: {:?}",
            server_name,
            workspace_path
         );
         return Ok(());
      }

      self.workspace_clients.insert(
         workspace_path,
         server_name.clone(),
         LspInstance {
            client,
            child,
            server_name: server_name.clone(),
            ref_count: 0,
            files: Vec::new(),
         },
      );

      log::info!("LSP '{}' started and initialized successfully", server_name);
      Ok(())
   }

   /// Start LSP server for a specific file (buffer-scoped)
   /// This will start the LSP server if it's not already running for the workspace/language
   /// and increment the reference count
   pub async fn start_lsp_for_file(
      &self,
      file_path: PathBuf,
      workspace_path: PathBuf,
      server_path_override: Option<String>,
      server_args_override: Option<Vec<String>>,
      initialization_options: Option<serde_json::Value>,
   ) -> Result<()> {
      log::info!("Starting LSP for file: {:?}", file_path);

      // Find appropriate LSP server for this file
      let (server_path, server_args, server_name) = if let Some(path) = server_path_override {
         log::info!("Using provided server path override: {}", path);
         let args = server_args_override.unwrap_or_default();
         let name = path.split('/').next_back().unwrap_or("custom").to_string();
         let resolved_path = self.resolve_server_path_override(&path)?;
         (resolved_path, args, name)
      } else {
         let server_config = self
            .registry
            .find_server_for_file(&file_path)
            .context("No LSP server found for file")?;

         log::info!("Using LSP server '{}' for file", server_config.name);
         let server_path = self.get_server_path(&server_config.name)?;
         (
            server_path,
            server_config.args.clone(),
            server_config.name.clone(),
         )
      };

      Self::validate_server_path(&server_path)?;

      // Check if LSP already running for this workspace+language
      if let Some(ref_count) =
         self
            .workspace_clients
            .track_file(&workspace_path, &server_name, &file_path)
      {
         log::info!(
            "Reusing existing LSP '{}' for file (ref_count: {})",
            server_name,
            ref_count
         );
         return Ok(());
      }

      let root_uri = Url::from_file_path(&workspace_path)
         .map_err(|_| anyhow::anyhow!("Invalid workspace path"))?;

      let (client, child) = LspClient::start(
         server_path,
         server_args,
         root_uri.clone(),
         Some(self.app_handle.clone()),
      )
      .await?;

      // Initialize the client
      client
         .initialize(root_uri, initialization_options.clone())
         .await?;

      // Store the new instance
      self.workspace_clients.insert(
         workspace_path,
         server_name.clone(),
         LspInstance {
            client,
            child,
            server_name: server_name.clone(),
            ref_count: 1,
            files: vec![file_path],
         },
      );

      log::info!("LSP '{}' started successfully for file", server_name);
      Ok(())
   }

   /// Stop LSP server for a specific file (buffer-scoped)
   /// This will decrement the reference count and shutdown the server if it reaches 0
   pub fn stop_lsp_for_file(&self, file_path: &PathBuf) -> Result<()> {
      log::info!("Stopping LSP for file: {:?}", file_path);
      self.workspace_clients.stop_file(file_path);
      Ok(())
   }

   pub fn get_client_for_file(&self, file_path: &str) -> Option<LspClient> {
      self
         .workspace_clients
         .get_client_for_file(&PathBuf::from(file_path))
   }

   pub async fn get_completions(
      &self,
      file_path: &str,
      line: u32,
      character: u32,
   ) -> Result<Vec<CompletionItem>> {
      let start_time = Instant::now();

      let client = self
         .get_client_for_file(file_path)
         .context("No LSP client for this file")?;

      let params = CompletionParams {
         text_document_position: TextDocumentPositionParams {
            text_document: TextDocumentIdentifier {
               uri: Url::from_file_path(file_path)
                  .map_err(|_| anyhow::anyhow!("Invalid file path"))?,
            },
            position: Position { line, character },
         },
         context: Some(CompletionContext {
            trigger_kind: CompletionTriggerKind::INVOKED,
            trigger_character: None,
         }),
         work_done_progress_params: Default::default(),
         partial_result_params: Default::default(),
      };

      let response = client.text_document_completion(params).await?;
      let max_completions = self.settings.max_completion_items;

      let mut items = match response {
         Some(CompletionResponse::Array(items)) => items,
         Some(CompletionResponse::List(list)) => list.items,
         None => vec![],
      };

      if items.len() > max_completions {
         log::debug!(
            "LSP returned {} completions, limiting to {}",
            items.len(),
            max_completions
         );
         items.truncate(max_completions);
      }

      let elapsed = start_time.elapsed();
      log::debug!(
         "LSP completion request completed in {:?} with {} items",
         elapsed,
         items.len()
      );

      Ok(items)
   }

   pub async fn get_hover(
      &self,
      file_path: &str,
      line: u32,
      character: u32,
   ) -> Result<Option<Hover>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = HoverParams {
         text_document_position_params: TextDocumentPositionParams {
            text_document,
            position: Position { line, character },
         },
         work_done_progress_params: Default::default(),
      };

      match client.text_document_hover(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/hover") {
               log::debug!("Hover method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn get_definition(
      &self,
      file_path: &str,
      line: u32,
      character: u32,
   ) -> Result<Option<GotoDefinitionResponse>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = GotoDefinitionParams {
         text_document_position_params: TextDocumentPositionParams {
            text_document,
            position: Position { line, character },
         },
         work_done_progress_params: Default::default(),
         partial_result_params: Default::default(),
      };

      match client.text_document_definition(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/definition") {
               log::debug!("Definition method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn get_semantic_tokens(
      &self,
      file_path: &str,
   ) -> Result<Option<SemanticTokensResult>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = SemanticTokensParams {
         text_document,
         work_done_progress_params: Default::default(),
         partial_result_params: Default::default(),
      };

      match client.text_document_semantic_tokens_full(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/semanticTokens") {
               log::debug!("SemanticTokens method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn get_inlay_hints(
      &self,
      file_path: &str,
      start_line: u32,
      end_line: u32,
   ) -> Result<Option<Vec<InlayHint>>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = InlayHintParams {
         text_document,
         range: Range {
            start: Position {
               line: start_line,
               character: 0,
            },
            end: Position {
               line: end_line,
               character: 0,
            },
         },
         work_done_progress_params: Default::default(),
      };

      match client.text_document_inlay_hint(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/inlayHint") {
               log::debug!("InlayHint method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn get_document_symbols(
      &self,
      file_path: &str,
   ) -> Result<Option<DocumentSymbolResponse>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = DocumentSymbolParams {
         text_document,
         work_done_progress_params: Default::default(),
         partial_result_params: Default::default(),
      };

      match client.text_document_document_symbol(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/documentSymbol") {
               log::debug!("DocumentSymbol method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn get_signature_help(
      &self,
      file_path: &str,
      line: u32,
      character: u32,
   ) -> Result<Option<SignatureHelp>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = SignatureHelpParams {
         text_document_position_params: TextDocumentPositionParams {
            text_document,
            position: Position { line, character },
         },
         context: None,
         work_done_progress_params: Default::default(),
      };

      match client.text_document_signature_help(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/signatureHelp") {
               log::debug!("SignatureHelp method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub fn get_signature_help_trigger_characters(&self, file_path: &str) -> Vec<String> {
      self
         .get_client_for_file(file_path)
         .map(|client| client.signature_help_trigger_characters())
         .unwrap_or_default()
   }

   pub async fn get_references(
      &self,
      file_path: &str,
      line: u32,
      character: u32,
   ) -> Result<Option<Vec<Location>>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = ReferenceParams {
         text_document_position: TextDocumentPositionParams {
            text_document,
            position: Position { line, character },
         },
         context: ReferenceContext {
            include_declaration: true,
         },
         work_done_progress_params: Default::default(),
         partial_result_params: Default::default(),
      };

      match client.text_document_references(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/references") {
               log::debug!("References method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn rename(
      &self,
      file_path: &str,
      line: u32,
      character: u32,
      new_name: String,
   ) -> Result<Option<WorkspaceEdit>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = RenameParams {
         text_document_position: TextDocumentPositionParams {
            text_document,
            position: Position { line, character },
         },
         new_name,
         work_done_progress_params: Default::default(),
      };

      match client.text_document_rename(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/rename") {
               log::debug!("Rename method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn prepare_rename(
      &self,
      file_path: &str,
      line: u32,
      character: u32,
   ) -> Result<Option<PrepareRenameResponse>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = TextDocumentPositionParams {
         text_document,
         position: Position { line, character },
      };

      match client.text_document_prepare_rename(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/prepareRename") {
               log::debug!("PrepareRename method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn get_code_lens(&self, file_path: &str) -> Result<Option<Vec<CodeLens>>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = CodeLensParams {
         text_document,
         work_done_progress_params: Default::default(),
         partial_result_params: Default::default(),
      };

      match client.text_document_code_lens(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/codeLens") {
               log::debug!("CodeLens method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
         }
      }
   }

   pub async fn get_code_actions(
      &self,
      file_path: &str,
      diagnostic: Diagnostic,
   ) -> Result<Vec<CodeActionOrCommand>> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(vec![]);
      };

      let text_document = TextDocumentIdentifier {
         uri: manager_support::text_document_identifier(file_path)?.uri,
      };

      let params = CodeActionParams {
         text_document,
         range: diagnostic.range,
         context: CodeActionContext {
            diagnostics: vec![diagnostic],
            only: None,
            trigger_kind: Some(CodeActionTriggerKind::INVOKED),
         },
         work_done_progress_params: Default::default(),
         partial_result_params: Default::default(),
      };

      match client.text_document_code_action(params).await {
         Ok(Some(actions)) => Ok(actions),
         Ok(None) => Ok(vec![]),
         Err(error) => {
            if manager_support::is_unsupported_method(&error, "textDocument/codeAction") {
               log::debug!("CodeAction method is not supported by this language server");
               return Ok(vec![]);
            }
            Err(error)
         }
      }
   }

   pub async fn apply_code_action(
      &self,
      file_path: &str,
      action: CodeActionOrCommand,
   ) -> Result<(bool, Option<String>)> {
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok((
            false,
            Some("No active LSP client for this file".to_string()),
         ));
      };

      match action {
         CodeActionOrCommand::Command(command) => {
            let params = manager_support::execute_command_params(
               command.command,
               command.arguments.unwrap_or_default(),
            );

            match client.workspace_execute_command(params).await {
               Ok(_) => Ok((true, None)),
               Err(error) => {
                  if manager_support::is_unsupported_method(&error, "workspace/executeCommand") {
                     return Ok((
                        false,
                        Some("Server does not support workspace/executeCommand".to_string()),
                     ));
                  }
                  Err(error)
               }
            }
         }
         CodeActionOrCommand::CodeAction(code_action) => {
            if let Some(disabled) = code_action.disabled {
               return Ok((false, Some(disabled.reason)));
            }

            if code_action.edit.is_some() && code_action.command.is_none() {
               return Ok((
                  false,
                  Some("Edit-only actions are not supported yet in this menu".to_string()),
               ));
            }

            if let Some(command) = code_action.command {
               let params = manager_support::execute_command_params(
                  command.command,
                  command.arguments.unwrap_or_default(),
               );

               match client.workspace_execute_command(params).await {
                  Ok(_) => Ok((true, None)),
                  Err(error) => {
                     if manager_support::is_unsupported_method(&error, "workspace/executeCommand") {
                        return Ok((
                           false,
                           Some("Server does not support workspace/executeCommand".to_string()),
                        ));
                     }
                     Err(error)
                  }
               }
            } else {
               Ok((false, Some("Action has no executable command".to_string())))
            }
         }
      }
   }

   pub fn notify_document_open(
      &self,
      file_path: &str,
      content: String,
      language_id: Option<String>,
   ) -> Result<()> {
      let path = PathBuf::from(file_path);
      let _extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

      let client = self
         .get_client_for_file(file_path)
         .context("No LSP client for this file")?;

      let params = DidOpenTextDocumentParams {
         text_document: TextDocumentItem {
            uri: manager_support::text_document_identifier(file_path)?.uri,
            language_id: language_id.unwrap_or_else(|| self.get_language_id_for_file(file_path)),
            version: 1,
            text: content,
         },
      };

      client.text_document_did_open(params)
   }

   pub fn notify_document_change(
      &self,
      file_path: &str,
      content: String,
      version: i32,
   ) -> Result<()> {
      let path = PathBuf::from(file_path);
      let _extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

      let client = self
         .get_client_for_file(file_path)
         .context("No LSP client for this file")?;

      let params = DidChangeTextDocumentParams {
         text_document: VersionedTextDocumentIdentifier {
            uri: manager_support::text_document_identifier(file_path)?.uri,
            version,
         },
         content_changes: vec![TextDocumentContentChangeEvent {
            range: None,
            range_length: None,
            text: content,
         }],
      };

      client.text_document_did_change(params)
   }

   pub fn notify_document_close(&self, file_path: &str) -> Result<()> {
      let path = PathBuf::from(file_path);
      let _extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

      let client = self
         .get_client_for_file(file_path)
         .context("No LSP client for this file")?;

      let params = DidCloseTextDocumentParams {
         text_document: manager_support::text_document_identifier(file_path)?,
      };

      client.text_document_did_close(params)
   }

   pub fn shutdown(&self) {
      self.workspace_clients.shutdown_all();
   }

   pub fn shutdown_workspace(&self, workspace_path: &Path) -> Result<()> {
      Ok(self.workspace_clients.shutdown_workspace(workspace_path)?)
   }

   fn get_language_id_for_file(&self, file_path: &str) -> String {
      let path = PathBuf::from(file_path);
      let file_name = path
         .file_name()
         .and_then(|name| name.to_str())
         .unwrap_or_default();
      let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

      let mut language_id = match extension {
         "sh" | "bash" | "zsh" => "bash",
         "c" => "c",
         "h" => "c",
         "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx" => "cpp",
         "cs" => "csharp",
         "css" => "css",
         "dart" => "dart",
         "el" => "elisp",
         "ex" | "exs" => "elixir",
         "elm" => "elm",
         "go" => "go",
         "html" | "htm" | "xhtml" => "html",
         "java" => "java",
         "ts" => "typescript",
         "tsx" => "typescriptreact",
         "js" | "mjs" | "cjs" => "javascript",
         "jsx" => "javascriptreact",
         "jsonc" => "jsonc",
         "json" => "json",
         "kt" | "kts" => "kotlin",
         "lua" => "lua",
         "ml" | "mli" => "ocaml",
         "php" | "phtml" | "php3" | "php4" | "php5" => "php",
         "py" | "pyw" | "pyi" => "python",
         "rb" | "rake" | "gemspec" => "ruby",
         "rs" => "rust",
         "scala" | "sc" => "scala",
         "swift" => "swift",
         "toml" => "toml",
         "vue" => "vue",
         "yaml" | "yml" => "yaml",
         "zig" => "zig",
         _ => "plaintext",
      }
      .to_string();

      if language_id == "plaintext" {
         language_id = match file_name {
            ".bashrc" | ".zshrc" | ".bash_profile" | ".profile" => "bash".to_string(),
            _ => language_id,
         };
      }

      language_id
   }
}

impl Drop for LspManager {
   fn drop(&mut self) {
      self.shutdown();
   }
}
