use super::{
   client::LspClient,
   config::{LspRegistry, LspSettings},
};
use anyhow::{Context, Result, bail};
use lsp_types::*;
use std::{
   collections::HashMap,
   path::PathBuf,
   process::Child,
   sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager as TauriManager};

type WorkspaceClients = Arc<Mutex<HashMap<PathBuf, (LspClient, Child, String)>>>;

pub struct LspManager {
   // Map workspace paths to their LSP clients
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
      // In development, use static path
      #[cfg(debug_assertions)]
      {
         if server_name == "typescript" {
            let server_path = PathBuf::from(
               "/Users/ale/mimi/prepos/athas/node_modules/.bin/typescript-language-server",
            );

            log::info!("Using TypeScript server path: {:?}", server_path);

            if server_path.exists() {
               return Ok(server_path);
            }
         }
      }

      // In production, look for bundled executable
      let app_dir = self
         .app_handle
         .path()
         .app_data_dir()
         .context("Failed to get app dir")?;

      let bundled_path = app_dir.join(format!("{}-language-server", server_name));

      if bundled_path.exists() {
         Ok(bundled_path)
      } else {
         bail!("Language server '{}' not found", server_name)
      }
   }

   pub async fn start_lsp_for_workspace(&self, workspace_path: PathBuf) -> Result<()> {
      log::info!("Starting LSP for workspace: {:?}", workspace_path);

      // Check if LSP already running for this workspace
      if self
         .workspace_clients
         .lock()
         .unwrap()
         .contains_key(&workspace_path)
      {
         log::info!("LSP already running for workspace: {:?}", workspace_path);
         return Ok(());
      }

      // Find appropriate LSP server for workspace
      let server_config = self
         .registry
         .find_server_for_workspace(&workspace_path)
         .context("No LSP server found for workspace")?;

      log::info!("Using LSP server '{}' for workspace", server_config.name);

      // Get server executable path
      let server_path = self.get_server_path(&server_config.name)?;
      let root_uri = Url::from_file_path(&workspace_path)
         .map_err(|_| anyhow::anyhow!("Invalid workspace path"))?;

      let (client, child) =
         LspClient::start(server_path, server_config.args.clone(), root_uri.clone())?;

      // Initialize the client
      client.initialize(root_uri).await?;

      self
         .workspace_clients
         .lock()
         .unwrap()
         .insert(workspace_path, (client, child, server_config.name.clone()));

      log::info!(
         "LSP '{}' started and initialized successfully",
         server_config.name
      );
      Ok(())
   }

   pub fn get_client_for_file(&self, file_path: &str) -> Option<LspClient> {
      let path = PathBuf::from(file_path);
      let clients = self.workspace_clients.lock().unwrap();

      // Find workspace that contains this file
      for (workspace_path, (client, _, _)) in clients.iter() {
         if path.starts_with(workspace_path) {
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
         log::warn!(
            "LSP returned {} completions, limiting to {}",
            items.len(),
            max_completions
         );
         items.truncate(max_completions);
      }

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
      for (workspace, (_, mut child, name)) in clients.drain() {
         log::info!("Shutting down LSP '{}' for workspace {:?}", name, workspace);
         let _ = child.kill();
      }
   }

   pub fn shutdown_workspace(&self, workspace_path: &PathBuf) -> Result<()> {
      let mut clients = self.workspace_clients.lock().unwrap();
      if let Some((_, mut child, name)) = clients.remove(workspace_path) {
         log::info!(
            "Shutting down LSP '{}' for workspace {:?}",
            name,
            workspace_path
         );
         child.kill()?;
      }
      Ok(())
   }

   fn get_language_id_for_file(&self, file_path: &str) -> String {
      let path = PathBuf::from(file_path);
      let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

      match extension {
         "ts" | "tsx" => "typescript",
         "js" | "jsx" => "javascript",
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
