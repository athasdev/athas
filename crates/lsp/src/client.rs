use anyhow::{Context, Result};
use athas_runtime::NodeRuntime;
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
use tauri::{AppHandle, Emitter, Manager};
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
            let managed_root = handle
               .path()
               .app_data_dir()
               .map(|dir| dir.join("runtimes"))
               .context("Failed to resolve runtime directory for JS-based language server")?;
            let runtime = NodeRuntime::get_or_install(Some(&managed_root))
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
      let app_handle_crash = app_handle.clone();
      thread::spawn(move || {
         let mut reader = BufReader::new(stdout);
         loop {
            let mut headers: HashMap<String, String> = HashMap::new();
            let mut line = String::new();

            // Read headers
            loop {
               line.clear();
               match reader.read_line(&mut line) {
                  Ok(0) => {
                     // EOF — server process has exited
                     log::warn!("LSP server stdout closed (server crashed or exited)");
                     if let Some(ref app) = app_handle_crash {
                        let _ = app.emit("lsp://server-crashed", json!({}));
                     }
                     return;
                  }
                  Err(e) => {
                     log::error!("Error reading LSP stdout: {}", e);
                     if let Some(ref app) = app_handle_crash {
                        let _ = app.emit("lsp://server-crashed", json!({ "error": e.to_string() }));
                     }
                     return;
                  }
                  Ok(_) => {}
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
               log::warn!("LSP server stdout read error (server may have crashed)");
               if let Some(ref app) = app_handle_crash {
                  let _ = app.emit("lsp://server-crashed", json!({}));
               }
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

   pub async fn initialize(
      &self,
      root_uri: Url,
      initialization_options: Option<Value>,
   ) -> Result<()> {
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
         signature_help: Some(SignatureHelpClientCapabilities {
            dynamic_registration: Some(true),
            signature_information: Some(SignatureInformationSettings {
               documentation_format: Some(vec![MarkupKind::Markdown, MarkupKind::PlainText]),
               parameter_information: Some(ParameterInformationSettings {
                  label_offset_support: Some(true),
               }),
               active_parameter_support: Some(true),
            }),
            context_support: Some(true),
         }),
         definition: Some(GotoCapability {
            dynamic_registration: Some(true),
            link_support: Some(true),
         }),
         semantic_tokens: Some(SemanticTokensClientCapabilities {
            dynamic_registration: Some(true),
            requests: SemanticTokensClientCapabilitiesRequests {
               full: Some(SemanticTokensFullOptions::Bool(true)),
               range: Some(true),
            },
            token_types: vec![
               SemanticTokenType::NAMESPACE,
               SemanticTokenType::TYPE,
               SemanticTokenType::CLASS,
               SemanticTokenType::ENUM,
               SemanticTokenType::INTERFACE,
               SemanticTokenType::STRUCT,
               SemanticTokenType::TYPE_PARAMETER,
               SemanticTokenType::PARAMETER,
               SemanticTokenType::VARIABLE,
               SemanticTokenType::PROPERTY,
               SemanticTokenType::ENUM_MEMBER,
               SemanticTokenType::EVENT,
               SemanticTokenType::FUNCTION,
               SemanticTokenType::METHOD,
               SemanticTokenType::MACRO,
               SemanticTokenType::KEYWORD,
               SemanticTokenType::MODIFIER,
               SemanticTokenType::COMMENT,
               SemanticTokenType::STRING,
               SemanticTokenType::NUMBER,
               SemanticTokenType::REGEXP,
               SemanticTokenType::OPERATOR,
               SemanticTokenType::DECORATOR,
            ],
            token_modifiers: vec![
               SemanticTokenModifier::DECLARATION,
               SemanticTokenModifier::DEFINITION,
               SemanticTokenModifier::READONLY,
               SemanticTokenModifier::STATIC,
               SemanticTokenModifier::DEPRECATED,
               SemanticTokenModifier::ABSTRACT,
               SemanticTokenModifier::ASYNC,
               SemanticTokenModifier::MODIFICATION,
               SemanticTokenModifier::DOCUMENTATION,
               SemanticTokenModifier::DEFAULT_LIBRARY,
            ],
            formats: vec![TokenFormat::RELATIVE],
            overlapping_token_support: Some(false),
            multiline_token_support: Some(true),
            server_cancel_support: Some(false),
            augments_syntax_tokens: Some(true),
         }),
         inlay_hint: Some(InlayHintClientCapabilities {
            dynamic_registration: Some(true),
            resolve_support: None,
         }),
         document_symbol: Some(DocumentSymbolClientCapabilities {
            dynamic_registration: Some(true),
            symbol_kind: None,
            hierarchical_document_symbol_support: Some(true),
            tag_support: None,
         }),
         references: Some(DynamicRegistrationClientCapabilities {
            dynamic_registration: Some(true),
         }),
         rename: Some(RenameClientCapabilities {
            dynamic_registration: Some(true),
            prepare_support: Some(true),
            prepare_support_default_behavior: None,
            honors_change_annotations: Some(false),
         }),
         code_lens: Some(CodeLensClientCapabilities {
            dynamic_registration: Some(true),
         }),
         code_action: Some(CodeActionClientCapabilities {
            dynamic_registration: Some(true),
            is_preferred_support: Some(true),
            disabled_support: Some(true),
            data_support: Some(true),
            ..Default::default()
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
         initialization_options,
         capabilities: ClientCapabilities {
            text_document: Some(text_document_capabilities),
            workspace: Some(WorkspaceClientCapabilities {
               execute_command: Some(DynamicRegistrationClientCapabilities {
                  dynamic_registration: Some(true),
               }),
               ..Default::default()
            }),
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
         Some("window/logMessage") => {
            if let Some(params) = params {
               match serde_json::from_value::<LogMessageParams>(params.clone()) {
                  Ok(log_message) => match log_message.typ {
                     MessageType::ERROR => log::error!("LSP logMessage: {}", log_message.message),
                     MessageType::WARNING => log::warn!("LSP logMessage: {}", log_message.message),
                     MessageType::INFO => log::info!("LSP logMessage: {}", log_message.message),
                     MessageType::LOG => log::debug!("LSP logMessage: {}", log_message.message),
                     _ => log::debug!("LSP logMessage: {}", log_message.message),
                  },
                  Err(e) => {
                     log::warn!(
                        "Failed to parse window/logMessage notification params: {}",
                        e
                     )
                  }
               }
            } else {
               log::warn!("window/logMessage notification has no params");
            }
         }
         Some(method_name) => {
            log::debug!("Unhandled LSP notification: {}", method_name);
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

   pub async fn text_document_code_lens(
      &self,
      params: CodeLensParams,
   ) -> Result<Option<Vec<CodeLens>>> {
      self.request::<request::CodeLensRequest>(params).await
   }

   pub async fn text_document_code_action(
      &self,
      params: CodeActionParams,
   ) -> Result<Option<CodeActionResponse>> {
      self.request::<request::CodeActionRequest>(params).await
   }

   pub async fn text_document_semantic_tokens_full(
      &self,
      params: SemanticTokensParams,
   ) -> Result<Option<SemanticTokensResult>> {
      self
         .request::<request::SemanticTokensFullRequest>(params)
         .await
   }

   pub async fn text_document_inlay_hint(
      &self,
      params: InlayHintParams,
   ) -> Result<Option<Vec<InlayHint>>> {
      self.request::<request::InlayHintRequest>(params).await
   }

   pub async fn text_document_document_symbol(
      &self,
      params: DocumentSymbolParams,
   ) -> Result<Option<DocumentSymbolResponse>> {
      self.request::<request::DocumentSymbolRequest>(params).await
   }

   pub async fn text_document_signature_help(
      &self,
      params: SignatureHelpParams,
   ) -> Result<Option<SignatureHelp>> {
      self.request::<request::SignatureHelpRequest>(params).await
   }

   pub async fn text_document_references(
      &self,
      params: ReferenceParams,
   ) -> Result<Option<Vec<Location>>> {
      self.request::<request::References>(params).await
   }

   pub async fn text_document_rename(&self, params: RenameParams) -> Result<Option<WorkspaceEdit>> {
      self.request::<request::Rename>(params).await
   }

   pub async fn text_document_prepare_rename(
      &self,
      params: TextDocumentPositionParams,
   ) -> Result<Option<PrepareRenameResponse>> {
      self.request::<request::PrepareRenameRequest>(params).await
   }

   pub async fn workspace_execute_command(
      &self,
      params: ExecuteCommandParams,
   ) -> Result<Option<Value>> {
      self.request::<request::ExecuteCommand>(params).await
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
