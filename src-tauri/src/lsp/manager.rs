use super::{
   client::LspClient,
   config::{LspRegistry, LspSettings},
   utils,
};
use anyhow::{Context, Result, bail};
use lsp_types::*;
use std::{
   collections::HashMap,
   path::PathBuf,
   process::Child,
   sync::{Arc, Mutex},
   time::Instant,
};
use tauri::{AppHandle, Manager as TauriManager};

type WorkspaceClients = Arc<Mutex<HashMap<(PathBuf, String), (LspClient, Child, String)>>>;

pub struct LspManager {
   // Map (workspace path, language) to their LSP clients
   workspace_clients: WorkspaceClients,
   registry: LspRegistry,
   app_handle: AppHandle,
   settings: LspSettings,
}

impl LspManager {
   pub fn new(app_handle: AppHandle) -> Self {
      Self {
         workspace_clients: Arc::new(Mutex::new(HashMap::new())),
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

   pub async fn start_lsp_for_workspace(
      &self,
      workspace_path: PathBuf,
      server_path_override: Option<String>,
      server_args_override: Option<Vec<String>>,
   ) -> Result<()> {
      log::info!("Starting LSP for workspace: {:?}", workspace_path);

      // Use provided server path or find appropriate LSP server for workspace
      let (server_path, server_args, server_name) = if let Some(path) = server_path_override {
         log::info!("Using provided server path override: {}", path);
         let args = server_args_override.unwrap_or_default();
         let name = path.split('/').last().unwrap_or("custom").to_string();

         // Use the path directly - it should already be absolute from the frontend
         let resolved_path = PathBuf::from(&path);

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

      let root_uri = Url::from_file_path(&workspace_path)
         .map_err(|_| anyhow::anyhow!("Invalid workspace path"))?;

      let (client, child) = LspClient::start(
         server_path,
         server_args,
         root_uri.clone(),
         Some(self.app_handle.clone()),
      )?;

      // Initialize the client
      client.initialize(root_uri).await?;

      // Check if LSP already running for this workspace+language
      let workspace_key = (workspace_path.clone(), server_name.clone());
      if self
         .workspace_clients
         .lock()
         .unwrap()
         .contains_key(&workspace_key)
      {
         log::info!(
            "LSP '{}' already running for workspace: {:?}",
            server_name,
            workspace_path
         );
         return Ok(());
      }

      self
         .workspace_clients
         .lock()
         .unwrap()
         .insert(workspace_key, (client, child, server_name.clone()));

      log::info!("LSP '{}' started and initialized successfully", server_name);
      Ok(())
   }

   pub fn get_client_for_file(&self, file_path: &str) -> Option<LspClient> {
      let path = PathBuf::from(file_path);
      let clients = self.workspace_clients.lock().unwrap();

      // Find the right language server for this file
      let server_config = self.registry.find_server_for_file(&path)?;

      // Find workspace that contains this file
      for ((workspace_path, server_name), (client, _, _)) in clients.iter() {
         if path.starts_with(workspace_path) && server_name == &server_config.name {
            return Some(client.clone());
         }
      }

      None
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
      let client = self
         .get_client_for_file(file_path)
         .context("No LSP client for this file")?;

      let text_document = TextDocumentIdentifier {
         uri: Url::from_file_path(file_path).map_err(|_| anyhow::anyhow!("Invalid file path"))?,
      };

      let params = HoverParams {
         text_document_position_params: TextDocumentPositionParams {
            text_document,
            position: Position { line, character },
         },
         work_done_progress_params: Default::default(),
      };

      client.text_document_hover(params).await
   }

   pub fn notify_document_open(&self, file_path: &str, content: String) -> Result<()> {
      let path = PathBuf::from(file_path);
      let _extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

      let client = self
         .get_client_for_file(file_path)
         .context("No LSP client for this file")?;

      let params = DidOpenTextDocumentParams {
         text_document: TextDocumentItem {
            uri: Url::from_file_path(file_path)
               .map_err(|_| anyhow::anyhow!("Invalid file path"))?,
            language_id: self.get_language_id_for_file(file_path),
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
            uri: Url::from_file_path(file_path)
               .map_err(|_| anyhow::anyhow!("Invalid file path"))?,
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
         text_document: TextDocumentIdentifier {
            uri: Url::from_file_path(file_path)
               .map_err(|_| anyhow::anyhow!("Invalid file path"))?,
         },
      };

      client.text_document_did_close(params)
   }

   pub fn shutdown(&self) {
      let mut clients = self.workspace_clients.lock().unwrap();
      for ((workspace, server_name), (_, mut child, _)) in clients.drain() {
         log::info!(
            "Shutting down LSP '{}' for workspace {:?}",
            server_name,
            workspace
         );
         let _ = child.kill();
      }
   }

   pub fn shutdown_workspace(&self, workspace_path: &PathBuf) -> Result<()> {
      let mut clients = self.workspace_clients.lock().unwrap();

      // Find all LSP servers for this workspace (all languages)
      let keys_to_remove: Vec<_> = clients
         .keys()
         .filter(|(ws, _)| ws == workspace_path)
         .cloned()
         .collect();

      for key in keys_to_remove {
         if let Some((_, mut child, name)) = clients.remove(&key) {
            log::info!(
               "Shutting down LSP '{}' for workspace {:?}",
               name,
               workspace_path
            );
            child.kill()?;
         }
      }

      Ok(())
   }

   fn get_language_id_for_file(&self, file_path: &str) -> String {
      let path = PathBuf::from(file_path);
      let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

      match extension {
         "ts" => "typescript",
         "tsx" => "typescriptreact",
         "js" | "mjs" | "cjs" => "javascript",
         "jsx" => "javascriptreact",
         "json" => "json",
         _ => "plaintext",
      }
      .to_string()
   }
}

impl Drop for LspManager {
   fn drop(&mut self) {
      self.shutdown();
   }
}
