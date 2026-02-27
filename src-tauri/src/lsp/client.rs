use crate::features::runtime::NodeRuntime;
use anyhow::{Context, Result};
use crossbeam_channel::{Sender, bounded};
use lsp_types::*;
use serde_json::{Value, json};
use std::{
   collections::HashMap,
   ffi::OsStr,
   io::{BufRead, BufReader, Read, Write},
   path::PathBuf,
   process::{Child, Command, Stdio},
   sync::{
      Arc, Mutex,
      atomic::{AtomicU64, Ordering},
   },
   thread,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

type PendingRequests = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>;

#[derive(Clone)]
pub struct LspClient {
   request_counter: Arc<AtomicU64>,
   stdin_tx: Sender<String>,
   pending_requests: PendingRequests,
   capabilities: Arc<Mutex<Option<ServerCapabilities>>>,
}

impl LspClient {
   pub async fn start(
      server_path: PathBuf,
      args: Vec<String>,
      _root_uri: Url,
      app_handle: Option<AppHandle>,
   ) -> Result<(Self, Child)> {
      // Check if this is a JavaScript-based language server
      let is_js_server = server_path
         .extension()
         .map(|ext| ext == OsStr::new("js") || ext == OsStr::new("mjs") || ext == OsStr::new("cjs"))
         .unwrap_or(false);

      let (command_path, final_args) = if is_js_server {
         // JS-based server requires Node.js runtime
         let node_path = if let Some(ref handle) = app_handle {
            // Get Node.js runtime asynchronously
            let runtime = NodeRuntime::get_or_install(handle)
               .await
               .context("Failed to get Node.js runtime for JS-based language server")?;
            runtime.binary_path().clone()
         } else {
            // Fallback: try to find node on system PATH
            which::which("node").context(
               "No AppHandle provided and Node.js not found on PATH for JS-based language server",
            )?
         };

         // Build args: node <server_path> <original_args>
         let mut node_args = vec![server_path.to_string_lossy().to_string()];
         node_args.extend(args);

         log::info!(
            "Starting JS-based language server with Node.js: {:?} {:?}",
            node_path,
            node_args
         );
         (node_path, node_args)
      } else {
         log::info!(
            "Starting native language server: {:?} {:?}",
            server_path,
            args
         );
         (server_path, args)
      };

      let mut child = Command::new(&command_path)
         .args(&final_args)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped())
         .spawn()
         .with_context(|| {
            format!(
               "Failed to spawn LSP server: command={:?}, args={:?}",
               command_path, final_args
            )
         })?;

      log::info!("Language server process started with PID: {:?}", child.id());

      let stdin = child.stdin.take().context("Failed to get stdin")?;
      let stdout = child.stdout.take().context("Failed to get stdout")?;
      let stderr = child.stderr.take().context("Failed to get stderr")?;

      let (stdin_tx, stdin_rx) = bounded::<String>(100);
      let pending_requests = Arc::new(Mutex::new(HashMap::new()));
      let pending_requests_clone = Arc::clone(&pending_requests);
      let app_handle_clone = app_handle.clone();

      // Stderr reader thread
      thread::spawn(move || {
         let mut stderr = BufReader::new(stderr);
         let mut line = String::new();
         loop {
            line.clear();
            match stderr.read_line(&mut line) {
               Ok(0) => break, // EOF
               Ok(_) => {
                  if !line.trim().is_empty() {
                     log::error!("LSP stderr: {}", line.trim());
                  }
               }
               Err(e) => {
                  log::error!("Error reading LSP stderr: {}", e);
                  break;
               }
            }
         }
      });

      // Stdin writer thread
      thread::spawn(move || {
         let mut stdin = stdin;
         while let Ok(msg) = stdin_rx.recv() {
            if stdin.write_all(msg.as_bytes()).is_err() {
               break;
            }
            if stdin.flush().is_err() {
               break;
            }
         }
      });

      // Stdout reader thread
      thread::spawn(move || {
         let mut reader = BufReader::new(stdout);
         loop {
            let mut headers: HashMap<String, String> = HashMap::new();
            let mut line = String::new();

            // Read headers
            loop {
               line.clear();
               if reader.read_line(&mut line).is_err() {
                  return;
               }

               if line == "\r\n" || line == "\n" {
                  break;
               }

               if let Some((key, value)) = line.trim_end().split_once(": ") {
                  headers.insert(key.to_string(), value.to_string());
               }
            }

            // Get content length
            let content_length = headers
               .get("Content-Length")
               .and_then(|s| s.parse::<usize>().ok())
               .unwrap_or(0);

            if content_length == 0 {
               continue;
            }

            // Read content
            let mut content = vec![0u8; content_length];
            if reader.read_exact(&mut content).is_err() {
               return;
            }

            if let Ok(content_str) = String::from_utf8(content)
               && let Ok(message) = serde_json::from_str::<Value>(&content_str)
            {
               // Log all messages for debugging
               let method = message.get("method").and_then(|m| m.as_str());
               if let Some(m) = method {
                  log::info!("LSP Notification received: {}", m);
               }

               // Check if this is a response (has id) or notification (no id)
               if message.get("id").is_some() {
                  Self::handle_response(message, &pending_requests_clone);
               } else if message.get("method").is_some() {
                  Self::handle_notification(message, &app_handle_clone);
               }
            }
         }
      });

      let client = Self {
         request_counter: Arc::new(AtomicU64::new(1)),
         stdin_tx,
         pending_requests,
         capabilities: Arc::new(Mutex::new(None)),
      };

      // Don't initialize here - we'll do it separately to avoid runtime issues
      log::info!("LSP client created, initialization will happen separately");

      Ok((client, child))
   }

   pub async fn initialize(&self, root_uri: Url) -> Result<()> {
      log::info!("Initializing LSP server with root_uri: {}", root_uri);

      // Build client capabilities with text document sync and diagnostics support
      let text_document_capabilities = TextDocumentClientCapabilities {
         synchronization: Some(TextDocumentSyncClientCapabilities {
            dynamic_registration: Some(true),
            will_save: Some(true),
            will_save_wait_until: Some(true),
            did_save: Some(true),
         }),
         completion: Some(CompletionClientCapabilities {
            dynamic_registration: Some(true),
            completion_item: Some(CompletionItemCapability {
               snippet_support: Some(true),
               commit_characters_support: Some(true),
               documentation_format: Some(vec![MarkupKind::Markdown, MarkupKind::PlainText]),
               deprecated_support: Some(true),
               preselect_support: Some(true),
               ..Default::default()
            }),
            ..Default::default()
         }),
         hover: Some(HoverClientCapabilities {
            dynamic_registration: Some(true),
            content_format: Some(vec![MarkupKind::Markdown, MarkupKind::PlainText]),
         }),
         definition: Some(GotoCapability {
            dynamic_registration: Some(true),
            link_support: Some(true),
         }),
         references: Some(DynamicRegistrationClientCapabilities {
            dynamic_registration: Some(true),
         }),
         publish_diagnostics: Some(PublishDiagnosticsClientCapabilities {
            related_information: Some(true),
            tag_support: Some(TagSupport {
               value_set: vec![DiagnosticTag::UNNECESSARY, DiagnosticTag::DEPRECATED],
            }),
            version_support: Some(true),
            code_description_support: Some(true),
            data_support: Some(true),
         }),
         ..Default::default()
      };

      let init_params = InitializeParams {
         process_id: Some(std::process::id()),
         #[allow(deprecated)]
         root_uri: Some(root_uri),
         capabilities: ClientCapabilities {
            text_document: Some(text_document_capabilities),
            ..Default::default()
         },
         ..Default::default()
      };

      let initialize_result: InitializeResult =
         self.request::<request::Initialize>(init_params).await?;
      log::info!("LSP initialized successfully");

      if let Some(caps) = initialize_result.capabilities.into() {
         *self.capabilities.lock().unwrap() = Some(caps);
      }

      // Send initialized notification
      self.notify::<notification::Initialized>(InitializedParams {})?;

      Ok(())
   }

   fn handle_response(response: Value, pending: &PendingRequests) {
      if let Some(id) = response.get("id").and_then(|id| id.as_u64())
         && let Some(tx) = pending.lock().unwrap().remove(&id)
      {
         if let Some(error) = response.get("error") {
            let _ = tx.send(Err(anyhow::anyhow!("LSP error: {:?}", error)));
         } else if let Some(result) = response.get("result") {
            let _ = tx.send(Ok(result.clone()));
         }
      }
   }

   fn handle_notification(notification: Value, app_handle: &Option<AppHandle>) {
      let method = notification.get("method").and_then(|m| m.as_str());
      let params = notification.get("params");

      log::info!(
         "handle_notification called with method: {:?}, has_params: {}, has_app_handle: {}",
         method,
         params.is_some(),
         app_handle.is_some()
      );

      match method {
         Some("textDocument/publishDiagnostics") => {
            log::info!("Processing publishDiagnostics notification");
            if let Some(params) = params {
               log::info!("Diagnostics params: {:?}", params);

               // Parse diagnostics
               match serde_json::from_value::<PublishDiagnosticsParams>(params.clone()) {
                  Ok(diagnostic_params) => {
                     log::info!(
                        "Parsed diagnostics: uri={}, count={}",
                        diagnostic_params.uri,
                        diagnostic_params.diagnostics.len()
                     );
                     // Emit event to frontend
                     if let Some(app) = app_handle {
                        match app.emit("lsp://diagnostics", &diagnostic_params) {
                           Ok(_) => log::info!(
                              "Successfully emitted diagnostics for file: {}",
                              diagnostic_params.uri
                           ),
                           Err(e) => log::error!("Failed to emit diagnostics: {}", e),
                        }
                     } else {
                        log::error!("No app_handle available to emit diagnostics");
                     }
                  }
                  Err(e) => {
                     log::error!("Failed to parse diagnostics params: {}", e);
                  }
               }
            } else {
               log::warn!("publishDiagnostics notification has no params");
            }
         }
         Some(method_name) => {
            log::info!("Unhandled LSP notification: {}", method_name);
         }
         None => {
            log::warn!("Received notification without method");
         }
      }
   }

   pub async fn request<R>(&self, params: R::Params) -> Result<R::Result>
   where
      R: lsp_types::request::Request,
      R::Params: serde::Serialize,
      R::Result: serde::de::DeserializeOwned,
   {
      let id = self.request_counter.fetch_add(1, Ordering::SeqCst);
      let (tx, rx) = oneshot::channel();

      self.pending_requests.lock().unwrap().insert(id, tx);

      let request = json!({
          "jsonrpc": "2.0",
          "id": id,
          "method": R::METHOD,
          "params": params,
      });

      log::debug!("LSP Request {}: {}", id, R::METHOD);

      let msg = format!(
         "Content-Length: {}\r\n\r\n{}",
         request.to_string().len(),
         request
      );

      self.stdin_tx.send(msg).context("Failed to send request")?;

      let response = rx.await.context("Request cancelled")??;
      serde_json::from_value(response).context("Failed to deserialize response")
   }

   pub fn notify<N>(&self, params: N::Params) -> Result<()>
   where
      N: lsp_types::notification::Notification,
      N::Params: serde::Serialize,
   {
      let notification = json!({
          "jsonrpc": "2.0",
          "method": N::METHOD,
          "params": params,
      });

      let msg = format!(
         "Content-Length: {}\r\n\r\n{}",
         notification.to_string().len(),
         notification
      );

      self
         .stdin_tx
         .send(msg)
         .context("Failed to send notification")?;
      Ok(())
   }

   pub async fn text_document_completion(
      &self,
      params: CompletionParams,
   ) -> Result<Option<CompletionResponse>> {
      log::info!(
         "Sending completion request to LSP server: {:?}",
         params.text_document_position.position
      );
      let result = self.request::<request::Completion>(params).await;
      match &result {
         Ok(Some(response)) => {
            let count = match response {
               CompletionResponse::Array(items) => items.len(),
               CompletionResponse::List(list) => list.items.len(),
            };
            log::info!("LSP server returned {} completions", count);
         }
         Ok(None) => log::warn!("LSP server returned None for completions"),
         Err(e) => log::error!("LSP completion request failed: {}", e),
      }
      result
   }

   pub async fn text_document_hover(&self, params: HoverParams) -> Result<Option<Hover>> {
      self.request::<request::HoverRequest>(params).await
   }

   pub async fn text_document_definition(
      &self,
      params: GotoDefinitionParams,
   ) -> Result<Option<GotoDefinitionResponse>> {
      self.request::<request::GotoDefinition>(params).await
   }

   pub fn text_document_did_open(&self, params: DidOpenTextDocumentParams) -> Result<()> {
      self.notify::<notification::DidOpenTextDocument>(params)
   }

   pub fn text_document_did_change(&self, params: DidChangeTextDocumentParams) -> Result<()> {
      self.notify::<notification::DidChangeTextDocument>(params)
   }

   pub fn text_document_did_close(&self, params: DidCloseTextDocumentParams) -> Result<()> {
      self.notify::<notification::DidCloseTextDocument>(params)
   }
}
