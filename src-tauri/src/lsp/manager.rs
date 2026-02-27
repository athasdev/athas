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

struct LspInstance {
   client: LspClient,
   child: Child,
   server_name: String,
   ref_count: usize,
   files: Vec<PathBuf>,
}

type WorkspaceClients = Arc<Mutex<HashMap<(PathBuf, String), LspInstance>>>;

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
         let name = path.split('/').next_back().unwrap_or("custom").to_string();

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
      )
      .await?;

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

      self.workspace_clients.lock().unwrap().insert(
         workspace_key,
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
   ) -> Result<()> {
      log::info!("Starting LSP for file: {:?}", file_path);

      // Find appropriate LSP server for this file
      let (server_path, server_args, server_name) = if let Some(path) = server_path_override {
         log::info!("Using provided server path override: {}", path);
         let args = server_args_override.unwrap_or_default();
         let name = path.split('/').next_back().unwrap_or("custom").to_string();
         let resolved_path = PathBuf::from(&path);
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

      let workspace_key = (workspace_path.clone(), server_name.clone());

      // Check if LSP already running for this workspace+language
      {
         let mut clients = self.workspace_clients.lock().unwrap();
         if let Some(instance) = clients.get_mut(&workspace_key) {
            // Increment ref count and add file to tracking
            instance.ref_count += 1;
            if !instance.files.contains(&file_path) {
               instance.files.push(file_path.clone());
            }
            log::info!(
               "Reusing existing LSP '{}' for file (ref_count: {})",
               server_name,
               instance.ref_count
            );
            return Ok(());
         }
      } // Lock is automatically dropped here

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
      client.initialize(root_uri).await?;

      // Store the new instance
      self.workspace_clients.lock().unwrap().insert(
         workspace_key,
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

      let mut clients = self.workspace_clients.lock().unwrap();

      // Find the LSP instance that contains this file
      let mut to_remove: Option<(PathBuf, String)> = None;

      for (key, instance) in clients.iter_mut() {
         if instance.files.contains(file_path) {
            // Remove file from tracking
            instance.files.retain(|f| f != file_path);
            instance.ref_count = instance.ref_count.saturating_sub(1);

            log::info!(
               "Decremented ref_count for LSP '{}' (now: {})",
               instance.server_name,
               instance.ref_count
            );

            // If ref count reaches 0, mark for removal
            if instance.ref_count == 0 {
               log::info!(
                  "LSP '{}' ref_count reached 0, shutting down",
                  instance.server_name
               );
               to_remove = Some(key.clone());
            }

            break;
         }
      }

      // Shutdown and remove the instance if ref count reached 0
      if let Some(key) = to_remove
         && let Some(mut instance) = clients.remove(&key)
      {
         log::info!("Shutting down LSP '{}'", instance.server_name);
         let _ = instance.child.kill();
      }

      Ok(())
   }

   pub fn get_client_for_file(&self, file_path: &str) -> Option<LspClient> {
      let path = PathBuf::from(file_path);
      let file_ext = path.extension().and_then(|e| e.to_str());
      let clients = self.workspace_clients.lock().unwrap();

      log::debug!(
         "get_client_for_file: looking for client for {} (ext: {:?})",
         file_path,
         file_ext
      );

      // First pass: find a server that has opened a file with the same extension
      // This ensures we route to the correct server (e.g., TypeScript for .tsx files)
      for ((workspace_path, server_name), instance) in clients.iter() {
         if path.starts_with(workspace_path) {
            let has_matching_ext = instance
               .files
               .iter()
               .any(|f| f.extension() == path.extension());

            log::debug!(
               "  checking server '{}': has_matching_ext={}",
               server_name,
               has_matching_ext
            );

            if has_matching_ext {
               log::info!(
                  "get_client_for_file: selected server '{}' for {} (matched extension)",
                  server_name,
                  file_path
               );
               return Some(instance.client.clone());
            }
         }
      }

      // Second pass: check if this exact file is tracked by any server
      for ((workspace_path, server_name), instance) in clients.iter() {
         if path.starts_with(workspace_path) && instance.files.contains(&path) {
            log::info!(
               "get_client_for_file: selected server '{}' for {} (exact file match)",
               server_name,
               file_path
            );
            return Some(instance.client.clone());
         }
      }

      log::warn!("get_client_for_file: no client found for {}", file_path);
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
      let Some(client) = self.get_client_for_file(file_path) else {
         return Ok(None);
      };

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

      match client.text_document_hover(params).await {
         Ok(value) => Ok(value),
         Err(error) => {
            let message = error.to_string();
            if message.contains("-32601")
               || message.contains("Method not found")
               || message.contains("Unhandled method textDocument/hover")
            {
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
         uri: Url::from_file_path(file_path).map_err(|_| anyhow::anyhow!("Invalid file path"))?,
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
            let message = error.to_string();
            if message.contains("-32601")
               || message.contains("Method not found")
               || message.contains("Unhandled method textDocument/definition")
            {
               log::debug!("Definition method is not supported by this language server");
               return Ok(None);
            }
            Err(error)
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
            uri: Url::from_file_path(file_path)
               .map_err(|_| anyhow::anyhow!("Invalid file path"))?,
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
      for ((workspace, server_name), mut instance) in clients.drain() {
         log::info!(
            "Shutting down LSP '{}' for workspace {:?}",
            server_name,
            workspace
         );
         let _ = instance.child.kill();
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
         if let Some(mut instance) = clients.remove(&key) {
            log::info!(
               "Shutting down LSP '{}' for workspace {:?}",
               instance.server_name,
               workspace_path
            );
            instance.child.kill()?;
         }
      }

      Ok(())
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
