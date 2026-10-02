use crate::runtime::AthasAppHandle as AppHandle;
use anyhow::{Context, Result, bail};
use athas_runtime::{NodeRuntime, process::configure_background_command};
use crossbeam_channel::{Sender, bounded};
use lsp_types::*;
use serde_json::{Value, json};
use std::{
   collections::HashMap,
   env,
   ffi::{OsStr, OsString},
   fs,
   io::{BufRead, BufReader, Read, Write},
   path::{Path, PathBuf},
   process::{Child, Command, Stdio},
   sync::{
      Arc, Mutex,
      atomic::{AtomicBool, AtomicU64, Ordering},
   },
   thread,
};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

type ResponseSender = oneshot::Sender<Result<Value>>;

#[derive(Default)]
struct PendingRequestState {
   requests: HashMap<u64, ResponseSender>,
   closed_reason: Option<String>,
}

/// Requests waiting for a response. Once the stdout reader stops, the map is
/// closed under the same lock that drains it, so a request registered while
/// the server dies either lands before the drain and receives its error, or
/// sees the closed state and fails immediately. It can never be inserted
/// after the drain and wait forever.
#[derive(Clone, Default)]
struct PendingRequests(Arc<Mutex<PendingRequestState>>);

impl PendingRequests {
   fn register(&self, id: u64, tx: ResponseSender) -> Result<()> {
      let mut state = self.0.lock().unwrap();
      if let Some(reason) = &state.closed_reason {
         bail!("LSP server is not running: {reason}");
      }
      state.requests.insert(id, tx);
      Ok(())
   }

   fn take(&self, id: u64) -> Option<ResponseSender> {
      self.0.lock().unwrap().requests.remove(&id)
   }

   fn close(&self, reason: &str) {
      let drained: Vec<ResponseSender> = {
         let mut state = self.0.lock().unwrap();
         state
            .closed_reason
            .get_or_insert_with(|| reason.to_string());
         state.requests.drain().map(|(_, tx)| tx).collect()
      };
      for tx in drained {
         let _ = tx.send(Err(anyhow::anyhow!(reason.to_string())));
      }
   }

   #[cfg(test)]
   fn is_empty(&self) -> bool {
      self.0.lock().unwrap().requests.is_empty()
   }
}

pub type LspServerEnv = HashMap<String, String>;
static NEXT_CLIENT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct LspServerContext {
   root_uri: Option<Url>,
   settings: Value,
}

fn find_node_modules_dir(server_path: &Path) -> Option<PathBuf> {
   server_path
      .ancestors()
      .find(|path| path.file_name() == Some(OsStr::new("node_modules")))
      .map(Path::to_path_buf)
}

fn prepend_env_path(env_overrides: &mut LspServerEnv, key: &str, path: PathBuf) {
   if !path.exists() {
      return;
   }

   let existing = env_overrides
      .get(key)
      .map(|value| OsString::from(value.as_str()))
      .or_else(|| env::var_os(key));
   let mut paths = vec![path];

   if let Some(existing) = existing {
      paths.extend(env::split_paths(&existing));
   }

   if let Ok(joined) = env::join_paths(paths) {
      env_overrides.insert(key.to_string(), joined.to_string_lossy().to_string());
   }
}

fn patch_node_package_env(server_path: &Path, env_overrides: &mut LspServerEnv) {
   let Some(node_modules_dir) = find_node_modules_dir(server_path) else {
      return;
   };

   prepend_env_path(env_overrides, "NODE_PATH", node_modules_dir.clone());
   prepend_env_path(env_overrides, "PATH", node_modules_dir.join(".bin"));
}

fn workspace_cwd(workspace_path: Option<&Path>) -> Option<PathBuf> {
   let workspace_path = workspace_path?;
   if workspace_path.is_dir() {
      Some(workspace_path.to_path_buf())
   } else {
      None
   }
}

fn has_javascript_extension(server_path: &Path) -> bool {
   server_path
      .extension()
      .map(|ext| ext == OsStr::new("js") || ext == OsStr::new("mjs") || ext == OsStr::new("cjs"))
      .unwrap_or(false)
}

fn has_node_shebang(server_path: &Path) -> bool {
   let Ok(mut file) = fs::File::open(server_path) else {
      return false;
   };

   let mut buffer = [0_u8; 128];
   let Ok(bytes_read) = file.read(&mut buffer) else {
      return false;
   };

   let contents = String::from_utf8_lossy(&buffer[..bytes_read]);
   let first_line = contents.lines().next().unwrap_or_default().trim();

   first_line.starts_with("#!") && first_line.contains("node")
}

fn is_node_script_server(server_path: &Path) -> bool {
   has_javascript_extension(server_path) || has_node_shebang(server_path)
}

fn configuration_value(settings: &Value, section: &str) -> Value {
   section
      .split('.')
      .try_fold(settings, |current, key| current.get(key))
      .cloned()
      .unwrap_or(Value::Null)
}

/// Parses a `Content-Length` header line. Header names are case-insensitive,
/// and whitespace around the name and value is ignored.
fn parse_content_length_header(line: &str) -> Option<usize> {
   let (name, value) = line.split_once(':')?;
   if !name.trim().eq_ignore_ascii_case("content-length") {
      return None;
   }
   value.trim().parse().ok()
}

/// Reads one base-protocol message body from the server. Returns `Ok(None)`
/// when the stream ends between messages. Headers other than
/// `Content-Length` are skipped, and header blocks without a usable length
/// are dropped so the reader can resynchronize on the next message.
fn read_frame(reader: &mut impl BufRead) -> std::io::Result<Option<Vec<u8>>> {
   let mut line = String::new();
   loop {
      let mut content_length = None;
      loop {
         line.clear();
         if reader.read_line(&mut line)? == 0 {
            return Ok(None);
         }
         if line.trim().is_empty() {
            break;
         }
         if let Some(length) = parse_content_length_header(&line) {
            content_length = Some(length);
         }
      }

      let Some(content_length) = content_length.filter(|length| *length > 0) else {
         continue;
      };

      let mut content = vec![0u8; content_length];
      reader.read_exact(&mut content)?;
      return Ok(Some(content));
   }
}

#[derive(Clone)]
pub struct LspClient {
   id: String,
   request_counter: Arc<AtomicU64>,
   stdin_tx: Sender<String>,
   pending_requests: PendingRequests,
   capabilities: Arc<Mutex<Option<ServerCapabilities>>>,
   is_running: Arc<AtomicBool>,
   server_context: Arc<Mutex<LspServerContext>>,
}

impl LspClient {
   pub(crate) fn text_document_sync_kind(&self) -> Option<TextDocumentSyncKind> {
      self
         .capabilities
         .lock()
         .unwrap()
         .as_ref()
         .and_then(|capabilities| capabilities.text_document_sync.as_ref())
         .and_then(|capability| match capability {
            TextDocumentSyncCapability::Kind(kind) => Some(*kind),
            TextDocumentSyncCapability::Options(options) => options.change,
         })
   }

   pub(crate) fn should_include_text_on_save(&self) -> bool {
      self
         .capabilities
         .lock()
         .unwrap()
         .as_ref()
         .and_then(|capabilities| capabilities.text_document_sync.as_ref())
         .and_then(|capability| match capability {
            TextDocumentSyncCapability::Kind(_) => None,
            TextDocumentSyncCapability::Options(options) => options.save.as_ref(),
         })
         .is_some_and(|save| match save {
            TextDocumentSyncSaveOptions::Supported(_) => false,
            TextDocumentSyncSaveOptions::SaveOptions(options) => {
               options.include_text.unwrap_or(false)
            }
         })
   }

   pub async fn start(
      server_path: PathBuf,
      args: Vec<String>,
      _root_uri: Url,
      app_handle: Option<AppHandle>,
      workspace_path: Option<PathBuf>,
      mut env_overrides: LspServerEnv,
   ) -> Result<(Self, Child)> {
      // Check if this is a JavaScript-based language server. Some npm package
      // bins are extensionless shebang scripts, which cannot be spawned
      // directly on Windows and should still run through managed Node.
      let is_js_server = is_node_script_server(&server_path);

      let (command_path, final_args) = if is_js_server {
         // JS-based server requires Node.js runtime
         let node_path = if let Some(ref handle) = app_handle {
            // Get Node.js runtime asynchronously
            let managed_root = handle
               .path()
               .app_data_dir()
               .map(|dir| dir.join("runtimes"))
               .context("Failed to resolve runtime directory for JS-based language server")?;
            let runtime = NodeRuntime::get_or_install_managed_first(Some(&managed_root))
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
         patch_node_package_env(&server_path, &mut env_overrides);
         (node_path, node_args)
      } else {
         log::info!(
            "Starting native language server: {:?} {:?}",
            server_path,
            args
         );
         (server_path, args)
      };

      let cwd = workspace_cwd(workspace_path.as_deref());
      let mut command = Command::new(&command_path);
      let command = configure_background_command(&mut command);
      command
         .args(&final_args)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped());
      if let Some(cwd) = cwd.as_ref() {
         command.current_dir(cwd);
      }
      if !env_overrides.is_empty() {
         command.envs(&env_overrides);
      }

      let mut child = command.spawn().with_context(|| {
         format!(
            "Failed to spawn LSP server: command={:?}, args={:?}, cwd={:?}",
            command_path, final_args, cwd
         )
      })?;

      log::info!("Language server process started with PID: {:?}", child.id());

      let stdin = child.stdin.take().context("Failed to get stdin")?;
      let stdout = child.stdout.take().context("Failed to get stdout")?;
      let stderr = child.stderr.take().context("Failed to get stderr")?;

      let (stdin_tx, stdin_rx) = bounded::<String>(100);
      let client_id = format!("lsp-{}", NEXT_CLIENT_ID.fetch_add(1, Ordering::SeqCst));
      let pending_requests = PendingRequests::default();
      let pending_requests_clone = pending_requests.clone();
      let app_handle_clone = app_handle.clone();
      let server_request_app_handle = app_handle.clone();
      let server_request_client_id = client_id.clone();
      let server_request_stdin_tx = stdin_tx.clone();
      let server_context = Arc::new(Mutex::new(LspServerContext::default()));
      let server_context_clone = Arc::clone(&server_context);
      let is_running = Arc::new(AtomicBool::new(true));
      let is_running_clone = Arc::clone(&is_running);

      let mark_stopped =
         |reason: String, pending_requests: &PendingRequests, is_running: &Arc<AtomicBool>| {
            is_running.store(false, Ordering::SeqCst);
            pending_requests.close(&reason);
         };

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
            let content = match read_frame(&mut reader) {
               Ok(Some(content)) => content,
               Ok(None) => {
                  log::warn!("LSP server stdout closed (server crashed or exited)");
                  mark_stopped(
                     "LSP server stdout closed (server crashed or exited)".to_string(),
                     &pending_requests_clone,
                     &is_running_clone,
                  );
                  return;
               }
               Err(e) => {
                  log::error!("Error reading LSP stdout: {}", e);
                  mark_stopped(
                     format!("Error reading LSP stdout: {e}"),
                     &pending_requests_clone,
                     &is_running_clone,
                  );
                  return;
               }
            };

            if let Ok(content_str) = String::from_utf8(content)
               && let Ok(message) = serde_json::from_str::<Value>(&content_str)
            {
               // Log all messages for debugging
               let method = message.get("method").and_then(|m| m.as_str());
               if let Some(m) = method {
                  log::info!("LSP Notification received: {}", m);
               }

               if message.get("id").is_some() && message.get("method").is_some() {
                  Self::handle_server_request(
                     message,
                     &server_request_stdin_tx,
                     &server_context_clone,
                     &server_request_app_handle,
                     &server_request_client_id,
                  );
               } else if message.get("id").is_some() {
                  Self::handle_response(message, &pending_requests_clone);
               } else if message.get("method").is_some() {
                  Self::handle_notification(message, &app_handle_clone);
               }
            }
         }
      });

      let client = Self {
         id: client_id,
         request_counter: Arc::new(AtomicU64::new(1)),
         stdin_tx,
         pending_requests,
         capabilities: Arc::new(Mutex::new(None)),
         is_running,
         server_context,
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

      if let Ok(mut context) = self.server_context.lock() {
         context.root_uri = Some(root_uri.clone());
         context.settings = initialization_options
            .as_ref()
            .and_then(|options| options.get("settings"))
            .cloned()
            .unwrap_or(Value::Null);
      }

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
               tag_support: Some(TagSupport {
                  value_set: vec![CompletionItemTag::DEPRECATED],
               }),
               insert_replace_support: Some(true),
               resolve_support: Some(CompletionItemCapabilityResolveSupport {
                  properties: vec![
                     "documentation".to_string(),
                     "detail".to_string(),
                     "additionalTextEdits".to_string(),
                     "command".to_string(),
                  ],
               }),
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
         document_highlight: Some(DynamicRegistrationClientCapabilities {
            dynamic_registration: Some(true),
         }),
         folding_range: Some(FoldingRangeClientCapabilities {
            dynamic_registration: Some(true),
            range_limit: None,
            line_folding_only: Some(false),
            folding_range_kind: None,
            folding_range: None,
         }),
         selection_range: Some(SelectionRangeClientCapabilities {
            dynamic_registration: Some(true),
         }),
         call_hierarchy: Some(DynamicRegistrationClientCapabilities {
            dynamic_registration: Some(true),
         }),
         type_hierarchy: Some(DynamicRegistrationClientCapabilities {
            dynamic_registration: Some(true),
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
               apply_edit: Some(true),
               workspace_edit: Some(WorkspaceEditClientCapabilities {
                  document_changes: Some(true),
                  ..Default::default()
               }),
               configuration: Some(true),
               execute_command: Some(DynamicRegistrationClientCapabilities {
                  dynamic_registration: Some(true),
               }),
               workspace_folders: Some(true),
               symbol: Some(WorkspaceSymbolClientCapabilities {
                  dynamic_registration: Some(false),
                  ..Default::default()
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

   fn send_json_rpc_message(stdin_tx: &Sender<String>, message: Value) -> Result<()> {
      let payload = message.to_string();
      let framed = format!("Content-Length: {}\r\n\r\n{}", payload.len(), payload);
      stdin_tx.send(framed).context("Failed to send LSP response")
   }

   fn send_server_response(stdin_tx: &Sender<String>, id: Value, result: Value) -> Result<()> {
      Self::send_json_rpc_message(
         stdin_tx,
         json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
         }),
      )
   }

   fn send_server_error(
      stdin_tx: &Sender<String>,
      id: Value,
      code: i32,
      message: &str,
   ) -> Result<()> {
      Self::send_json_rpc_message(
         stdin_tx,
         json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
               "code": code,
               "message": message,
            },
         }),
      )
   }

   fn handle_response(response: Value, pending: &PendingRequests) {
      if let Some(id) = response.get("id").and_then(|id| id.as_u64())
         && let Some(tx) = pending.take(id)
      {
         if let Some(error) = response.get("error") {
            let _ = tx.send(Err(anyhow::anyhow!("LSP error: {:?}", error)));
         } else if let Some(result) = response.get("result") {
            let _ = tx.send(Ok(result.clone()));
         }
      }
   }

   fn handle_server_request(
      request: Value,
      stdin_tx: &Sender<String>,
      server_context: &Arc<Mutex<LspServerContext>>,
      app_handle: &Option<AppHandle>,
      client_id: &str,
   ) {
      let id = request.get("id").cloned().unwrap_or(Value::Null);
      let method = request.get("method").and_then(|method| method.as_str());

      let response = match method {
         Some("workspace/configuration") => {
            let items = request
               .get("params")
               .and_then(|params| params.get("items"))
               .and_then(|items| items.as_array())
               .cloned()
               .unwrap_or_default();
            let settings = server_context
               .lock()
               .map(|context| context.settings.clone())
               .unwrap_or(Value::Null);
            let values = items
               .iter()
               .map(|item| {
                  item
                     .get("section")
                     .and_then(Value::as_str)
                     .map(|section| configuration_value(&settings, section))
                     .unwrap_or(Value::Null)
               })
               .collect();
            Self::send_server_response(stdin_tx, id, Value::Array(values))
         }
         Some("workspace/workspaceFolders") => {
            let folders = server_context
               .lock()
               .ok()
               .and_then(|context| context.root_uri.clone())
               .map(|root_uri| {
                  let name = root_uri
                     .path_segments()
                     .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
                     .unwrap_or("workspace");
                  json!([{ "uri": root_uri, "name": name }])
               })
               .unwrap_or_else(|| json!([]));
            Self::send_server_response(stdin_tx, id, folders)
         }
         Some("client/registerCapability" | "client/unregisterCapability") => {
            Self::send_server_response(stdin_tx, id, Value::Null)
         }
         Some("window/showMessageRequest") => Self::send_server_response(stdin_tx, id, Value::Null),
         Some("workspace/applyEdit") => {
            let edit = request
               .get("params")
               .and_then(|params| params.get("edit"))
               .cloned();

            match (app_handle, edit) {
               (Some(app), Some(edit)) => app
                  .emit(
                     "lsp://workspace-edit",
                     json!({
                        "clientId": client_id,
                        "requestId": id,
                        "edit": edit,
                     }),
                  )
                  .map_err(anyhow::Error::from),
               _ => Self::send_server_response(
                  stdin_tx,
                  id,
                  json!({
                     "applied": false,
                     "failureReason": "The workspace edit request was invalid",
                  }),
               ),
            }
         }
         Some(method_name) => Self::send_server_error(
            stdin_tx,
            id,
            -32601,
            &format!("Unhandled server request: {}", method_name),
         ),
         None => Self::send_server_error(stdin_tx, id, -32600, "Invalid server request"),
      };

      if let Err(error) = response {
         log::warn!("Failed to respond to LSP server request: {}", error);
      }
   }

   pub fn id(&self) -> &str {
      &self.id
   }

   pub fn respond_workspace_edit(
      &self,
      request_id: Value,
      applied: bool,
      failure_reason: Option<String>,
   ) -> Result<()> {
      Self::send_server_response(
         &self.stdin_tx,
         request_id,
         json!({
            "applied": applied,
            "failureReason": failure_reason,
         }),
      )
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
      let response = self
         .request_value(R::METHOD, serde_json::to_value(params)?)
         .await?;
      serde_json::from_value(response).context("Failed to deserialize response")
   }

   pub async fn request_value(&self, method: &str, params: Value) -> Result<Value> {
      if !self.is_running.load(Ordering::SeqCst) {
         bail!("LSP server is not running");
      }

      let id = self.request_counter.fetch_add(1, Ordering::SeqCst);
      let (tx, rx) = oneshot::channel();

      self.pending_requests.register(id, tx)?;

      let request = json!({
          "jsonrpc": "2.0",
          "id": id,
          "method": method,
          "params": params,
      });

      log::debug!("LSP Request {}: {}", id, method);

      let msg = format!(
         "Content-Length: {}\r\n\r\n{}",
         request.to_string().len(),
         request
      );

      if let Err(error) = self.stdin_tx.send(msg) {
         self.pending_requests.take(id);
         return Err(error).context("Failed to send request");
      }

      rx.await.context("Request cancelled")?
   }

   pub fn notify<N>(&self, params: N::Params) -> Result<()>
   where
      N: lsp_types::notification::Notification,
      N::Params: serde::Serialize,
   {
      if !self.is_running.load(Ordering::SeqCst) {
         bail!("LSP server is not running");
      }

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

   pub fn is_running(&self) -> bool {
      self.is_running.load(Ordering::SeqCst)
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

   pub async fn completion_item_resolve(&self, item: CompletionItem) -> Result<CompletionItem> {
      self.request::<request::ResolveCompletionItem>(item).await
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

   pub async fn text_document_implementation(
      &self,
      params: GotoDefinitionParams,
   ) -> Result<Option<GotoDefinitionResponse>> {
      self.request::<request::GotoImplementation>(params).await
   }

   pub async fn text_document_type_definition(
      &self,
      params: GotoDefinitionParams,
   ) -> Result<Option<GotoDefinitionResponse>> {
      self.request::<request::GotoTypeDefinition>(params).await
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

   pub fn supports_code_lens(&self) -> bool {
      self
         .capabilities
         .lock()
         .unwrap()
         .as_ref()
         .and_then(|capabilities| capabilities.code_lens_provider.as_ref())
         .is_some()
   }

   pub fn supports_code_actions(&self) -> bool {
      match self
         .capabilities
         .lock()
         .unwrap()
         .as_ref()
         .and_then(|capabilities| capabilities.code_action_provider.as_ref())
      {
         Some(CodeActionProviderCapability::Simple(enabled)) => *enabled,
         Some(CodeActionProviderCapability::Options(_)) => true,
         None => false,
      }
   }

   pub async fn text_document_semantic_tokens_full(
      &self,
      params: SemanticTokensParams,
   ) -> Result<Option<SemanticTokensResult>> {
      self
         .request::<request::SemanticTokensFullRequest>(params)
         .await
   }

   pub fn semantic_token_legend(&self) -> (Vec<String>, Vec<String>) {
      let capabilities = self.capabilities.lock().unwrap();
      let Some(provider) = capabilities
         .as_ref()
         .and_then(|capabilities| capabilities.semantic_tokens_provider.as_ref())
      else {
         return (Vec::new(), Vec::new());
      };

      let legend = match provider {
         SemanticTokensServerCapabilities::SemanticTokensOptions(options) => &options.legend,
         SemanticTokensServerCapabilities::SemanticTokensRegistrationOptions(options) => {
            &options.semantic_tokens_options.legend
         }
      };

      let token_types = legend
         .token_types
         .iter()
         .map(|token_type| token_type.as_str().to_string())
         .collect();
      let token_modifiers = legend
         .token_modifiers
         .iter()
         .map(|modifier| modifier.as_str().to_string())
         .collect();

      (token_types, token_modifiers)
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

   pub async fn workspace_symbol(
      &self,
      params: WorkspaceSymbolParams,
   ) -> Result<Option<WorkspaceSymbolResponse>> {
      self
         .request::<request::WorkspaceSymbolRequest>(params)
         .await
   }

   pub async fn text_document_signature_help(
      &self,
      params: SignatureHelpParams,
   ) -> Result<Option<SignatureHelp>> {
      self.request::<request::SignatureHelpRequest>(params).await
   }

   pub async fn text_document_formatting(
      &self,
      params: DocumentFormattingParams,
   ) -> Result<Option<Vec<TextEdit>>> {
      self.request::<request::Formatting>(params).await
   }

   pub async fn text_document_range_formatting(
      &self,
      params: DocumentRangeFormattingParams,
   ) -> Result<Option<Vec<TextEdit>>> {
      self.request::<request::RangeFormatting>(params).await
   }

   pub async fn text_document_folding_range(
      &self,
      params: FoldingRangeParams,
   ) -> Result<Option<Vec<FoldingRange>>> {
      self.request::<request::FoldingRangeRequest>(params).await
   }

   pub async fn text_document_selection_range(
      &self,
      params: SelectionRangeParams,
   ) -> Result<Option<Vec<SelectionRange>>> {
      self.request::<request::SelectionRangeRequest>(params).await
   }

   pub async fn text_document_document_highlight(
      &self,
      params: DocumentHighlightParams,
   ) -> Result<Option<Vec<DocumentHighlight>>> {
      self
         .request::<request::DocumentHighlightRequest>(params)
         .await
   }

   pub async fn text_document_prepare_call_hierarchy(
      &self,
      params: CallHierarchyPrepareParams,
   ) -> Result<Option<Vec<CallHierarchyItem>>> {
      self.request::<request::CallHierarchyPrepare>(params).await
   }

   pub async fn call_hierarchy_incoming_calls(
      &self,
      params: CallHierarchyIncomingCallsParams,
   ) -> Result<Option<Vec<CallHierarchyIncomingCall>>> {
      self
         .request::<request::CallHierarchyIncomingCalls>(params)
         .await
   }

   pub async fn call_hierarchy_outgoing_calls(
      &self,
      params: CallHierarchyOutgoingCallsParams,
   ) -> Result<Option<Vec<CallHierarchyOutgoingCall>>> {
      self
         .request::<request::CallHierarchyOutgoingCalls>(params)
         .await
   }

   pub async fn text_document_prepare_type_hierarchy(
      &self,
      params: TypeHierarchyPrepareParams,
   ) -> Result<Option<Vec<TypeHierarchyItem>>> {
      self.request::<request::TypeHierarchyPrepare>(params).await
   }

   pub async fn type_hierarchy_supertypes(
      &self,
      params: TypeHierarchySupertypesParams,
   ) -> Result<Option<Vec<TypeHierarchyItem>>> {
      self
         .request::<request::TypeHierarchySupertypes>(params)
         .await
   }

   pub async fn type_hierarchy_subtypes(
      &self,
      params: TypeHierarchySubtypesParams,
   ) -> Result<Option<Vec<TypeHierarchyItem>>> {
      self.request::<request::TypeHierarchySubtypes>(params).await
   }

   pub async fn text_document_on_type_formatting(
      &self,
      params: DocumentOnTypeFormattingParams,
   ) -> Result<Option<Vec<TextEdit>>> {
      self.request::<request::OnTypeFormatting>(params).await
   }

   pub fn signature_help_trigger_characters(&self) -> Vec<String> {
      self
         .capabilities
         .lock()
         .unwrap()
         .as_ref()
         .and_then(|capabilities| capabilities.signature_help_provider.as_ref())
         .and_then(|provider| provider.trigger_characters.clone())
         .unwrap_or_default()
   }

   pub fn on_type_formatting_trigger_characters(&self) -> Vec<String> {
      self
         .capabilities
         .lock()
         .unwrap()
         .as_ref()
         .and_then(|capabilities| capabilities.document_on_type_formatting_provider.as_ref())
         .map(|provider| {
            std::iter::once(provider.first_trigger_character.clone())
               .chain(provider.more_trigger_character.clone().unwrap_or_default())
               .collect()
         })
         .unwrap_or_default()
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

   pub async fn java_class_file_contents(&self, uri: Url) -> Result<String> {
      let response = self
         .request_value("java/classFileContents", json!({ "uri": uri }))
         .await?;
      serde_json::from_value(response).context("Failed to deserialize Java class file contents")
   }

   pub fn text_document_did_open(&self, params: DidOpenTextDocumentParams) -> Result<()> {
      self.notify::<notification::DidOpenTextDocument>(params)
   }

   pub fn text_document_did_change(&self, params: DidChangeTextDocumentParams) -> Result<()> {
      self.notify::<notification::DidChangeTextDocument>(params)
   }

   pub fn text_document_did_save(&self, params: DidSaveTextDocumentParams) -> Result<()> {
      self.notify::<notification::DidSaveTextDocument>(params)
   }

   pub fn text_document_did_close(&self, params: DidCloseTextDocumentParams) -> Result<()> {
      self.notify::<notification::DidCloseTextDocument>(params)
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::{env, ffi::OsStr, fs};

   #[test]
   fn resolves_nested_workspace_configuration_sections() {
      let settings = json!({
         "java": {
            "format": { "enabled": true },
            "signatureHelp": { "enabled": true }
         }
      });

      assert_eq!(
         configuration_value(&settings, "java.format"),
         json!({ "enabled": true })
      );
      assert_eq!(
         configuration_value(&settings, "java.signatureHelp.enabled"),
         json!(true)
      );
      assert_eq!(configuration_value(&settings, "java.missing"), Value::Null);
   }

   #[test]
   fn patches_node_package_env_from_js_entrypoint() {
      let temp = tempfile::tempdir().unwrap();
      let package_dir = temp
         .path()
         .join("bun")
         .join("@vtsls")
         .join("language-server");
      let node_modules_dir = package_dir.join("node_modules");
      let bin_dir = node_modules_dir.join(".bin");
      let entrypoint = node_modules_dir
         .join("@vtsls")
         .join("language-server")
         .join("bin")
         .join("vtsls.js");
      fs::create_dir_all(&bin_dir).unwrap();
      fs::create_dir_all(entrypoint.parent().unwrap()).unwrap();

      let mut env_overrides = LspServerEnv::new();
      patch_node_package_env(&entrypoint, &mut env_overrides);

      let node_path = env_overrides.get("NODE_PATH").unwrap();
      assert_eq!(
         env::split_paths(OsStr::new(node_path)).next().unwrap(),
         node_modules_dir
      );

      let path = env_overrides.get("PATH").unwrap();
      assert_eq!(env::split_paths(OsStr::new(path)).next().unwrap(), bin_dir);
   }

   #[test]
   fn treats_extensionless_node_shebang_as_node_script_server() {
      let temp = tempfile::tempdir().unwrap();
      let server_path = temp.path().join("vscode-css-language-server");
      fs::write(
         &server_path,
         "#!/usr/bin/env node\nrequire('../cssServerMain')\n",
      )
      .unwrap();

      assert!(is_node_script_server(&server_path));
   }

   #[test]
   fn does_not_treat_plain_extensionless_binary_as_node_script_server() {
      let temp = tempfile::tempdir().unwrap();
      let server_path = temp.path().join("native-language-server");
      fs::write(&server_path, "not a shebang script").unwrap();

      assert!(!is_node_script_server(&server_path));
   }

   #[test]
   fn uses_workspace_directory_as_process_cwd() {
      let temp = tempfile::tempdir().unwrap();
      let file_path = temp.path().join("file.ts");
      fs::write(&file_path, "").unwrap();

      assert_eq!(
         workspace_cwd(Some(temp.path())).as_deref(),
         Some(temp.path())
      );
      assert_eq!(workspace_cwd(Some(&file_path)), None);
      assert_eq!(workspace_cwd(None), None);
   }

   #[test]
   fn responds_to_server_workspace_edits() {
      let (stdin_tx, stdin_rx) = bounded(1);
      let client = LspClient {
         id: "test-client".to_string(),
         request_counter: Arc::new(AtomicU64::new(1)),
         stdin_tx,
         pending_requests: PendingRequests::default(),
         capabilities: Arc::new(Mutex::new(None)),
         is_running: Arc::new(AtomicBool::new(true)),
         server_context: Arc::new(Mutex::new(LspServerContext::default())),
      };

      client
         .respond_workspace_edit(json!(42), false, Some("Unsupported edit".to_string()))
         .unwrap();

      let framed = stdin_rx.recv().unwrap();
      let payload = framed.split("\r\n\r\n").nth(1).unwrap();
      let response: Value = serde_json::from_str(payload).unwrap();
      assert_eq!(response["id"], json!(42));
      assert_eq!(response["result"]["applied"], json!(false));
      assert_eq!(response["result"]["failureReason"], "Unsupported edit");
   }

   fn test_client() -> (LspClient, crossbeam_channel::Receiver<String>) {
      let (stdin_tx, stdin_rx) = bounded(16);
      let client = LspClient {
         id: "test-client".to_string(),
         request_counter: Arc::new(AtomicU64::new(1)),
         stdin_tx,
         pending_requests: PendingRequests::default(),
         capabilities: Arc::new(Mutex::new(None)),
         is_running: Arc::new(AtomicBool::new(true)),
         server_context: Arc::new(Mutex::new(LspServerContext::default())),
      };
      (client, stdin_rx)
   }

   fn decode_frame(framed: &str) -> Value {
      let (header, payload) = framed.split_once("\r\n\r\n").unwrap();
      let length: usize = header
         .strip_prefix("Content-Length: ")
         .unwrap()
         .parse()
         .unwrap();
      assert_eq!(length, payload.len(), "Content-Length must count bytes");
      serde_json::from_str(payload).unwrap()
   }

   fn set_capabilities(client: &LspClient, capabilities: Value) {
      *client.capabilities.lock().unwrap() = Some(serde_json::from_value(capabilities).unwrap());
   }

   fn server_request(client: &LspClient, request: Value) {
      LspClient::handle_server_request(
         request,
         &client.stdin_tx,
         &client.server_context,
         &None,
         client.id(),
      );
   }

   #[tokio::test]
   async fn frames_requests_with_byte_length_and_resolves_matching_response() {
      let (client, stdin_rx) = test_client();
      let request_client = client.clone();
      let request = tokio::spawn(async move {
         request_client
            .request_value("test/echo", json!({ "text": "héllo wörld ✓" }))
            .await
      });

      let framed = tokio::task::spawn_blocking(move || stdin_rx.recv().unwrap())
         .await
         .unwrap();
      let message = decode_frame(&framed);
      assert_eq!(message["jsonrpc"], "2.0");
      assert_eq!(message["method"], "test/echo");
      assert_eq!(message["params"]["text"], "héllo wörld ✓");
      let id = message["id"].as_u64().unwrap();

      LspClient::handle_response(
         json!({ "id": id, "result": { "ok": true } }),
         &client.pending_requests,
      );

      assert_eq!(request.await.unwrap().unwrap(), json!({ "ok": true }));
      assert!(client.pending_requests.is_empty());
   }

   #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
   async fn request_ids_increase_and_responses_route_by_id() {
      let (client, stdin_rx) = test_client();
      let first_client = client.clone();
      let second_client = client.clone();
      let first = tokio::spawn(async move { first_client.request_value("a", json!(null)).await });
      let first_id = decode_frame(&stdin_rx.recv().unwrap())["id"]
         .as_u64()
         .unwrap();
      let second = tokio::spawn(async move { second_client.request_value("b", json!(null)).await });
      let second_id = decode_frame(&stdin_rx.recv().unwrap())["id"]
         .as_u64()
         .unwrap();
      assert_eq!(second_id, first_id + 1);

      let pending = &client.pending_requests;
      LspClient::handle_response(json!({ "id": 9999, "result": "stray" }), pending);
      LspClient::handle_response(json!({ "id": second_id, "result": "second" }), pending);
      LspClient::handle_response(
         json!({ "id": first_id, "error": { "code": -32601, "message": "Method not found" } }),
         pending,
      );

      assert_eq!(second.await.unwrap().unwrap(), json!("second"));
      let error = first.await.unwrap().unwrap_err();
      assert!(error.to_string().contains("Method not found"), "{error}");
      assert!(crate::manager_support::is_unsupported_method(&error, "a"));
   }

   #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
   async fn null_result_resolves_as_null() {
      let (client, stdin_rx) = test_client();
      let request_client = client.clone();
      let request =
         tokio::spawn(async move { request_client.request_value("x", json!(null)).await });
      let id = decode_frame(&stdin_rx.recv().unwrap())["id"].clone();

      LspClient::handle_response(
         json!({ "id": id, "result": null }),
         &client.pending_requests,
      );

      assert_eq!(request.await.unwrap().unwrap(), Value::Null);
   }

   #[tokio::test]
   async fn rejects_requests_and_notifications_after_server_stops() {
      let (client, stdin_rx) = test_client();
      client.is_running.store(false, Ordering::SeqCst);

      let error = client.request_value("x", json!(null)).await.unwrap_err();
      assert!(error.to_string().contains("not running"));
      assert!(
         client
            .notify::<notification::Initialized>(InitializedParams {})
            .is_err()
      );
      assert!(stdin_rx.try_recv().is_err());
      assert!(client.pending_requests.is_empty());
   }

   #[tokio::test]
   async fn a_request_that_misses_the_shutdown_drain_fails_immediately() {
      let (client, stdin_rx) = test_client();
      // The stdout reader drained the pending map after this request passed
      // its is_running check but before it registered.
      client
         .pending_requests
         .close("LSP server stdout closed (server crashed or exited)");
      assert!(client.is_running());

      let error = tokio::time::timeout(
         std::time::Duration::from_secs(5),
         client.request_value("x", json!(null)),
      )
      .await
      .expect("request should fail instead of waiting for a response")
      .unwrap_err();

      assert!(error.to_string().contains("stdout closed"), "{error}");
      assert!(stdin_rx.try_recv().is_err());
      assert!(client.pending_requests.is_empty());
   }

   #[tokio::test]
   async fn drops_the_pending_entry_when_the_request_cannot_be_written() {
      let (client, stdin_rx) = test_client();
      drop(stdin_rx);

      let error = client.request_value("x", json!(null)).await.unwrap_err();

      assert!(
         error.to_string().contains("Failed to send request"),
         "{error}"
      );
      assert!(client.pending_requests.is_empty());
   }

   #[test]
   fn frames_notifications_without_an_id() {
      let (client, stdin_rx) = test_client();
      client.notify::<notification::Exit>(()).unwrap();

      let message = decode_frame(&stdin_rx.recv().unwrap());
      assert_eq!(message["method"], "exit");
      assert!(message.get("id").is_none());
   }

   #[test]
   fn answers_workspace_configuration_from_initialization_settings() {
      let (client, stdin_rx) = test_client();
      client.server_context.lock().unwrap().settings = json!({
         "python": { "analysis": { "typeCheckingMode": "strict" } }
      });

      server_request(
         &client,
         json!({
            "id": 7,
            "method": "workspace/configuration",
            "params": { "items": [
               { "section": "python.analysis" },
               { "section": "python.missing" },
               { "scopeUri": "file:///tmp" }
            ] }
         }),
      );

      let response = decode_frame(&stdin_rx.recv().unwrap());
      assert_eq!(response["id"], 7);
      assert_eq!(
         response["result"],
         json!([{ "typeCheckingMode": "strict" }, null, null])
      );
   }

   #[test]
   fn answers_workspace_folders_from_root_uri() {
      let (client, stdin_rx) = test_client();
      server_request(
         &client,
         json!({ "id": "a", "method": "workspace/workspaceFolders" }),
      );
      assert_eq!(decode_frame(&stdin_rx.recv().unwrap())["result"], json!([]));

      client.server_context.lock().unwrap().root_uri =
         Some(Url::parse("file:///home/user/my-project/").unwrap());
      server_request(
         &client,
         json!({ "id": "b", "method": "workspace/workspaceFolders" }),
      );

      let response = decode_frame(&stdin_rx.recv().unwrap());
      assert_eq!(response["id"], "b");
      assert_eq!(
         response["result"],
         json!([{ "uri": "file:///home/user/my-project/", "name": "my-project" }])
      );
   }

   #[test]
   fn acknowledges_and_rejects_other_server_requests() {
      let (client, stdin_rx) = test_client();

      server_request(
         &client,
         json!({ "id": 1, "method": "client/registerCapability" }),
      );
      let response = decode_frame(&stdin_rx.recv().unwrap());
      assert_eq!(response["result"], Value::Null);
      assert!(response.get("error").is_none());

      server_request(
         &client,
         json!({ "id": 2, "method": "workspace/applyEdit", "params": {} }),
      );
      let response = decode_frame(&stdin_rx.recv().unwrap());
      assert_eq!(response["result"]["applied"], false);

      server_request(&client, json!({ "id": 3, "method": "custom/unknown" }));
      let response = decode_frame(&stdin_rx.recv().unwrap());
      assert_eq!(response["id"], 3);
      assert_eq!(response["error"]["code"], -32601);
      assert!(
         response["error"]["message"]
            .as_str()
            .unwrap()
            .contains("custom/unknown")
      );

      server_request(&client, json!({ "id": 4 }));
      let response = decode_frame(&stdin_rx.recv().unwrap());
      assert_eq!(response["error"]["code"], -32600);
   }

   #[test]
   fn reports_capabilities_advertised_by_the_server() {
      let (client, _stdin_rx) = test_client();
      assert!(!client.supports_code_actions());
      assert!(!client.supports_code_lens());
      assert_eq!(client.semantic_token_legend(), (Vec::new(), Vec::new()));
      assert!(client.signature_help_trigger_characters().is_empty());
      assert!(client.on_type_formatting_trigger_characters().is_empty());

      set_capabilities(&client, json!({ "codeActionProvider": false }));
      assert!(!client.supports_code_actions());

      set_capabilities(
         &client,
         json!({
            "codeActionProvider": { "codeActionKinds": ["quickfix"] },
            "codeLensProvider": { "resolveProvider": false },
            "semanticTokensProvider": {
               "legend": { "tokenTypes": ["class", "function"], "tokenModifiers": ["static"] },
               "full": true
            },
            "signatureHelpProvider": { "triggerCharacters": ["(", ","] },
            "documentOnTypeFormattingProvider": {
               "firstTriggerCharacter": "}",
               "moreTriggerCharacter": [";", "\n"]
            }
         }),
      );
      assert!(client.supports_code_actions());
      assert!(client.supports_code_lens());
      assert_eq!(
         client.semantic_token_legend(),
         (
            vec!["class".to_string(), "function".to_string()],
            vec!["static".to_string()]
         )
      );
      assert_eq!(client.signature_help_trigger_characters(), vec!["(", ","]);
      assert_eq!(
         client.on_type_formatting_trigger_characters(),
         vec!["}", ";", "\n"]
      );
   }

   #[tokio::test]
   async fn initializes_against_a_real_process_and_stores_capabilities() {
      let temp = tempfile::tempdir().unwrap();
      let server = crate::test_support::start_fake_server(temp.path()).await;

      server
         .client
         .initialize(
            Url::from_file_path(temp.path()).unwrap(),
            Some(json!({
               "fakeCapabilities": { "codeLensProvider": {}, "codeActionProvider": true }
            })),
         )
         .await
         .unwrap();

      assert!(server.client.is_running());
      assert!(server.client.supports_code_lens());
      assert!(server.client.supports_code_actions());
   }

   #[tokio::test]
   async fn reassembles_fragmented_messages_with_extra_headers() {
      let temp = tempfile::tempdir().unwrap();
      let server = crate::test_support::start_fake_server(temp.path()).await;
      let params = json!({ "text": "ünïcödé ".repeat(64), "n": 42 });

      let response = server
         .client
         .request_value("test/fragmented", params.clone())
         .await
         .unwrap();

      assert_eq!(response, params);
   }

   #[tokio::test]
   async fn accepts_headers_in_any_case_order_and_spacing() {
      let temp = tempfile::tempdir().unwrap();
      let server = crate::test_support::start_fake_server(temp.path()).await;
      let params = json!({ "text": "ünïcödé", "n": 7 });

      let response = server
         .client
         .request_value("test/looseHeaders", params.clone())
         .await
         .unwrap();

      assert_eq!(response, params);
   }

   fn read_frames(stream: &str) -> (Vec<Value>, std::io::Result<Option<Vec<u8>>>) {
      let mut reader = std::io::Cursor::new(stream.as_bytes().to_vec());
      let mut frames = Vec::new();
      loop {
         match read_frame(&mut reader) {
            Ok(Some(body)) => frames.push(serde_json::from_slice(&body).unwrap()),
            end => return (frames, end),
         }
      }
   }

   #[test]
   fn parses_content_length_regardless_of_header_case_and_whitespace() {
      for line in [
         "Content-Length: 12\r\n",
         "content-length: 12\r\n",
         "CONTENT-LENGTH:12\r\n",
         "  Content-length :   12  \r\n",
         "Content-Length: 12\n",
      ] {
         assert_eq!(parse_content_length_header(line), Some(12), "{line:?}");
      }

      for line in [
         "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n",
         "Content-Length-Extra: 12\r\n",
         "Content-Length: twelve\r\n",
         "Content-Length 12\r\n",
      ] {
         assert_eq!(parse_content_length_header(line), None, "{line:?}");
      }
   }

   #[test]
   fn reads_consecutive_frames_with_mixed_headers() {
      let first = r#"{"id":1}"#;
      let second = r#"{"id":2}"#;
      let stream = format!(
         "content-length: {}\r\nX-Trace: a\r\n\r\n{first}Content-Type: \
          application/vscode-jsonrpc\nCONTENT-LENGTH:{}\n\n{second}",
         first.len(),
         second.len()
      );

      let (frames, end) = read_frames(&stream);

      assert_eq!(frames, vec![json!({ "id": 1 }), json!({ "id": 2 })]);
      assert!(matches!(end, Ok(None)));
   }

   #[test]
   fn skips_header_blocks_without_a_usable_length() {
      let body = r#"{"ok":true}"#;
      let stream = format!(
         "\r\nX-Only: header\r\n\r\nContent-Length: 0\r\n\r\nContent-Length: {}\r\n\r\n{body}",
         body.len()
      );

      let (frames, end) = read_frames(&stream);

      assert_eq!(frames, vec![json!({ "ok": true })]);
      assert!(matches!(end, Ok(None)));
   }

   #[test]
   fn reports_a_truncated_body_as_an_error() {
      let (frames, end) = read_frames("Content-Length: 50\r\n\r\n{\"id\":1}");

      assert!(frames.is_empty());
      assert_eq!(end.unwrap_err().kind(), std::io::ErrorKind::UnexpectedEof);
   }

   #[tokio::test]
   async fn matches_out_of_order_responses_to_their_requests() {
      let temp = tempfile::tempdir().unwrap();
      let server = crate::test_support::start_fake_server(temp.path()).await;

      let (first, second) = tokio::join!(
         server.client.request_value("test/reverse", json!("first")),
         server.client.request_value("test/reverse", json!("second")),
      );

      assert_eq!(first.unwrap(), json!("first"));
      assert_eq!(second.unwrap(), json!("second"));
   }

   #[tokio::test]
   async fn surfaces_error_responses_from_a_real_process() {
      let temp = tempfile::tempdir().unwrap();
      let server = crate::test_support::start_fake_server(temp.path()).await;

      let error = server
         .client
         .request_value("test/error", json!(null))
         .await
         .unwrap_err();

      assert!(error.to_string().contains("-32601"), "{error}");
      assert_eq!(
         server
            .client
            .request_value("test/echo", json!(1))
            .await
            .unwrap(),
         json!(1)
      );
   }

   #[tokio::test]
   async fn answers_server_requests_over_stdio() {
      let temp = tempfile::tempdir().unwrap();
      let server = crate::test_support::start_fake_server(temp.path()).await;
      server
         .client
         .initialize(
            Url::from_file_path(temp.path()).unwrap(),
            Some(json!({ "settings": { "fake": { "level": 2 } } })),
         )
         .await
         .unwrap();

      let response = server
         .client
         .request_value(
            "test/serverRequest",
            json!({
               "method": "workspace/configuration",
               "params": { "items": [{ "section": "fake.level" }] }
            }),
         )
         .await
         .unwrap();

      assert_eq!(response["id"], "srv-1");
      assert_eq!(response["result"], json!([2]));
   }

   #[tokio::test]
   async fn fails_pending_requests_when_the_server_exits() {
      let temp = tempfile::tempdir().unwrap();
      let server = crate::test_support::start_fake_server(temp.path()).await;

      let error = tokio::time::timeout(
         std::time::Duration::from_secs(30),
         server.client.request_value("test/crash", json!(null)),
      )
      .await
      .expect("pending request should fail instead of hanging")
      .unwrap_err();

      assert!(error.to_string().contains("stdout closed"), "{error}");
      assert!(!server.client.is_running());
      assert!(
         server
            .client
            .request_value("test/echo", json!(null))
            .await
            .unwrap_err()
            .to_string()
            .contains("not running")
      );
   }

   #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
   async fn every_request_in_flight_during_a_crash_resolves() {
      let temp = tempfile::tempdir().unwrap();
      let server = crate::test_support::start_fake_server(temp.path()).await;
      let crash_client = server.client.clone();
      let crash =
         tokio::spawn(async move { crash_client.request_value("test/crash", json!(null)).await });
      let racing: Vec<_> = (0..32)
         .map(|n| {
            let client = server.client.clone();
            tokio::spawn(async move { client.request_value("test/echo", json!(n)).await })
         })
         .collect();

      tokio::time::timeout(std::time::Duration::from_secs(30), async {
         assert!(crash.await.unwrap().is_err());
         for request in racing {
            let _ = request.await.unwrap();
         }
      })
      .await
      .expect("no request may wait forever once the server has exited");

      assert!(!server.client.is_running());
   }
}
