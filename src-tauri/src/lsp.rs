use anyhow::{Context, bail};
use lsp_types::notification::{self, Notification};
use lsp_types::request::{Completion, HoverRequest, Initialize};
use lsp_types::{
    ClientCapabilities, ClientInfo, CodeActionCapabilityResolveSupport,
    CodeActionClientCapabilities, CodeActionKind, CodeActionKindLiteralSupport,
    CompletionClientCapabilities, CompletionContext, CompletionItemCapability,
    CompletionItemCapabilityResolveSupport, CompletionItemKind, CompletionItemKindCapability,
    CompletionItemTag, CompletionParams, CompletionResponse, CompletionTriggerKind, Diagnostic,
    DiagnosticTag, DidChangeTextDocumentParams, DidChangeWatchedFilesClientCapabilities,
    DidCloseTextDocumentParams, DidOpenTextDocumentParams, DocumentSymbolClientCapabilities,
    DynamicRegistrationClientCapabilities, FailureHandlingKind, GotoCapability,
    HoverClientCapabilities, HoverParams, InitializeParams, InitializedParams, InsertTextMode,
    InsertTextModeSupport, LogMessageParams, MarkupKind, MessageActionItemCapabilities,
    ParameterInformationSettings, PartialResultParams, Position, PrepareSupportDefaultBehavior,
    PublishDiagnosticsClientCapabilities, PublishDiagnosticsParams, ResourceOperationKind,
    ShowDocumentClientCapabilities, ShowMessageRequestClientCapabilities,
    SignatureHelpClientCapabilities, SignatureInformationSettings, SymbolKind,
    SymbolKindCapability, SymbolTag, TagSupport, TextDocumentClientCapabilities,
    TextDocumentContentChangeEvent, TextDocumentIdentifier, TextDocumentItem,
    TextDocumentPositionParams, TextDocumentSyncClientCapabilities, TraceValue,
    VersionedTextDocumentIdentifier, WindowClientCapabilities, WorkDoneProgressParams,
    WorkspaceClientCapabilities, WorkspaceEditClientCapabilities, WorkspaceFolder,
    WorkspaceSymbolClientCapabilities,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, Url};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use tokio::sync::{mpsc, oneshot};

#[derive(Debug)]
pub struct PendingRequest {
    sender: oneshot::Sender<serde_json::Value>,
}

#[derive(Debug)]
pub struct LSPProcess {
    pub process: Child,
    pub stdin: ChildStdin,
    pub request_id: Arc<Mutex<i32>>,
    pub pending_requests: Arc<Mutex<HashMap<i32, PendingRequest>>>,
}

impl LSPProcess {
    async fn send_request<R: lsp_types::request::Request>(
        &mut self,
        params: R::Params,
    ) -> anyhow::Result<R::Result> {
        let id = self.next_request_id().await;
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": R::METHOD,
            "params": params
        });

        let (sender, receiver) = oneshot::channel();

        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(id, PendingRequest { sender });
        }

        self.send_message(&request).await?;

        match tokio::time::timeout(std::time::Duration::from_secs(15), receiver).await {
            Ok(Ok(response)) => serde_json::from_value(response)
                .with_context(|| format!("failed to deserialize lsp response for {}", R::METHOD)),

            Ok(Err(_)) => bail!("request {} cancelled", R::METHOD),
            Err(_) => bail!("request {} timeout", R::METHOD),
        }
    }

    async fn send_notification<N: Notification>(
        &mut self,
        params: N::Params,
    ) -> anyhow::Result<()> {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": N::METHOD,
            "params": serde_json::to_value(params).unwrap()
        });
        self.send_message(&notification).await
    }

    async fn next_request_id(&self) -> i32 {
        let mut id = self.request_id.lock().await;
        *id += 1;
        *id
    }

    async fn send_message(&mut self, message: &serde_json::Value) -> anyhow::Result<()> {
        let content =
            serde_json::to_string(message).context("failed to serialize message".to_string())?;

        let header = format!("Content-Length: {}\r\n\r\n", content.len());
        let payload = format!("{header}{content}");

        self.stdin.write_all(payload.as_bytes()).await?;
        self.stdin.flush().await?;

        Ok(())
    }
}

pub struct LSPState {
    processes: Mutex<HashMap<String, Arc<Mutex<LSPProcess>>>>,
}

impl LSPState {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

async fn handle_responses(
    mut reader: BufReader<tokio::process::ChildStdout>,
    pending_requests: Arc<Mutex<HashMap<i32, PendingRequest>>>,
    diagnostics_tx: mpsc::UnboundedSender<(String, Vec<Diagnostic>)>,
) {
    log::debug!("handle_responses");
    let mut buffer = String::new();
    loop {
        buffer.clear();
        let mut content_len: Option<usize> = None;

        // headers
        loop {
            match reader.read_line(&mut buffer).await {
                Ok(0) => {
                    log::error!("lsp stdout stream close.");
                    return;
                }
                Ok(_) => {
                    if buffer.trim().is_empty() {
                        // end of headers
                        break;
                    }
                    if let Some(length) = buffer.strip_prefix("Content-Length: ") {
                        content_len = length.trim().parse::<usize>().ok();
                    }
                    buffer.clear();
                }
                Err(e) => {
                    log::error!("error reading from lsp stdout: {e}");
                    return;
                }
            }
        }

        // body
        if let Some(length) = content_len {
            let mut body_buf = vec![0; length];
            if reader.read_exact(&mut body_buf).await.is_ok() {
                if let Ok(message) = serde_json::from_slice::<serde_json::Value>(&body_buf) {
                    handle_message(message, &pending_requests, &diagnostics_tx).await;
                } else {
                    log::error!("failed to parse lsp payload");
                }
            }
        }
    }
}

async fn handle_message(
    message: serde_json::Value,
    pending_requests: &Arc<Mutex<HashMap<i32, PendingRequest>>>,
    diagnostics_tx: &mpsc::UnboundedSender<(String, Vec<Diagnostic>)>,
) {
    if let Some(id_val) = message.get("id") {
        // lsp response to a request
        if let Some(id) = id_val.as_i64().map(|i| i as i32) {
            if let Some(pending) = pending_requests.lock().await.remove(&id) {
                let result = message.get("result").unwrap_or(&serde_json::Value::Null);
                let _ = pending.sender.send(result.clone());
            }
        }
    } else if let Some(method) = message.get("method").and_then(|m| m.as_str()) {
        // lsp notifications
        match method {
            notification::PublishDiagnostics::METHOD => {
                if let Ok(params) =
                    serde_json::from_value::<PublishDiagnosticsParams>(message["params"].clone())
                {
                    let _ = diagnostics_tx.send((params.uri.to_string(), params.diagnostics));
                }
            }
            notification::LogMessage::METHOD => {
                if let Ok(params) =
                    serde_json::from_value::<LogMessageParams>(message["params"].clone())
                {
                    log::info!("[LSP LOG]: {}", params.message);
                }
            }
            _ => {}
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StartLSPRequest {
    language: String,
    command: String,
    args: Vec<String>,
    working_dir: String,
    initialization_options: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn start_lsp_server(
    request: StartLSPRequest,
    state: State<'_, LSPState>,
    app_handle: AppHandle,
) -> Result<u32, String> {
    log::info!("starting lsp server for {}", request.language);
    let mut processes = state.processes.lock().await;

    // Stop existing process if any
    if let Some(existing) = processes.remove(&request.language) {
        log::info!("stopping existing lsp server for {}", request.language);
        let mut process = existing.lock().await;
        let _ = process.process.kill().await;
    }

    // Start new LSP process
    let mut child = Command::new(&request.command)
        .args(&request.args)
        .current_dir(&request.working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start LSP server {}: {}", request.command, e))?;

    let pid = child.id().expect("failed to get PID for new lsp process");
    let stdin = child.stdin.take().expect("stdin handle should exist");
    let stdout = child.stdout.take().expect("stdout handle should exist");

    let pending_requests = Arc::new(Mutex::new(HashMap::new()));

    let (diagnostics_tx, mut diagnostics_rx) = mpsc::unbounded_channel();
    let app_handle = app_handle.clone();
    tokio::spawn(async move {
        while let Some((uri, diagnostics)) = diagnostics_rx.recv().await {
            let _ = app_handle.emit(
                "lsp://diagnostics",
                serde_json::json!({ "uri": uri, "diagnostics": diagnostics }),
            );
        }
    });

    let reader = tokio::io::BufReader::new(stdout);
    tokio::spawn(handle_responses(
        reader,
        Arc::clone(&pending_requests),
        diagnostics_tx.clone(),
    ));

    let mut lsp_process = LSPProcess {
        process: child,
        stdin,
        request_id: Arc::new(Mutex::new(0)),
        pending_requests,
    };

    let initialize_params = InitializeParams {
        process_id: Some(pid),
        initialization_options: request.initialization_options,
        capabilities: ClientCapabilities {
            workspace: Some(WorkspaceClientCapabilities {
                apply_edit: Some(true),
                workspace_edit: Some(WorkspaceEditClientCapabilities {
                    document_changes: Some(true),
                    resource_operations: Some(vec![
                        ResourceOperationKind::Create,
                        ResourceOperationKind::Rename,
                        ResourceOperationKind::Delete,
                    ]),
                    failure_handling: Some(FailureHandlingKind::Transactional),
                    ..Default::default()
                }),
                did_change_configuration: Some(DynamicRegistrationClientCapabilities {
                    dynamic_registration: Some(true),
                }),
                did_change_watched_files: Some(DidChangeWatchedFilesClientCapabilities {
                    dynamic_registration: Some(true),
                    ..Default::default()
                }),
                symbol: Some(WorkspaceSymbolClientCapabilities {
                    dynamic_registration: Some(true),
                    symbol_kind: Some(SymbolKindCapability {
                        value_set: Some(vec![
                            SymbolKind::FILE,
                            SymbolKind::MODULE,
                            SymbolKind::NAMESPACE,
                            SymbolKind::PACKAGE,
                            SymbolKind::CLASS,
                            SymbolKind::METHOD,
                            SymbolKind::PROPERTY,
                            SymbolKind::FIELD,
                            SymbolKind::CONSTRUCTOR,
                            SymbolKind::ENUM,
                            SymbolKind::INTERFACE,
                            SymbolKind::FUNCTION,
                            SymbolKind::VARIABLE,
                            SymbolKind::CONSTANT,
                            SymbolKind::STRING,
                            SymbolKind::NUMBER,
                            SymbolKind::BOOLEAN,
                            SymbolKind::ARRAY,
                            SymbolKind::OBJECT,
                            SymbolKind::KEY,
                            SymbolKind::NULL,
                            SymbolKind::ENUM_MEMBER,
                            SymbolKind::STRUCT,
                            SymbolKind::EVENT,
                            SymbolKind::OPERATOR,
                            SymbolKind::TYPE_PARAMETER,
                        ]),
                    }),
                    ..Default::default()
                }),
                execute_command: Some(DynamicRegistrationClientCapabilities {
                    dynamic_registration: Some(true),
                }),
                workspace_folders: Some(true),
                configuration: Some(true),
                ..Default::default()
            }),
            text_document: Some(TextDocumentClientCapabilities {
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
                        documentation_format: Some(vec![
                            MarkupKind::Markdown,
                            MarkupKind::PlainText,
                        ]),
                        deprecated_support: Some(true),
                        preselect_support: Some(true),
                        tag_support: Some(TagSupport {
                            value_set: vec![CompletionItemTag::DEPRECATED],
                        }),
                        insert_replace_support: Some(true),
                        resolve_support: Some(CompletionItemCapabilityResolveSupport {
                            properties: vec!["documentation".to_string(), "detail".to_string()],
                        }),
                        insert_text_mode_support: Some(InsertTextModeSupport {
                            value_set: vec![
                                InsertTextMode::AS_IS,
                                InsertTextMode::ADJUST_INDENTATION,
                            ],
                        }),
                        ..Default::default()
                    }),
                    completion_item_kind: Some(CompletionItemKindCapability {
                        value_set: Some(vec![
                            CompletionItemKind::TEXT,
                            CompletionItemKind::METHOD,
                            CompletionItemKind::FUNCTION,
                            CompletionItemKind::CONSTRUCTOR,
                            CompletionItemKind::FIELD,
                            CompletionItemKind::VARIABLE,
                            CompletionItemKind::CLASS,
                            CompletionItemKind::INTERFACE,
                            CompletionItemKind::MODULE,
                            CompletionItemKind::PROPERTY,
                            CompletionItemKind::UNIT,
                            CompletionItemKind::VALUE,
                            CompletionItemKind::ENUM,
                            CompletionItemKind::KEYWORD,
                            CompletionItemKind::SNIPPET,
                            CompletionItemKind::COLOR,
                            CompletionItemKind::FILE,
                            CompletionItemKind::REFERENCE,
                        ]),
                    }),
                    context_support: Some(true),
                    ..Default::default()
                }),
                hover: Some(HoverClientCapabilities {
                    dynamic_registration: Some(true),
                    content_format: Some(vec![MarkupKind::Markdown, MarkupKind::PlainText]),
                }),
                signature_help: Some(SignatureHelpClientCapabilities {
                    dynamic_registration: Some(true),
                    signature_information: Some(SignatureInformationSettings {
                        documentation_format: Some(vec![
                            MarkupKind::Markdown,
                            MarkupKind::PlainText,
                        ]),
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
                references: Some(DynamicRegistrationClientCapabilities {
                    dynamic_registration: Some(true),
                }),

                document_highlight: Some(DynamicRegistrationClientCapabilities {
                    dynamic_registration: Some(true),
                }),

                document_symbol: Some(DocumentSymbolClientCapabilities {
                    dynamic_registration: Some(true),
                    symbol_kind: Some(SymbolKindCapability {
                        value_set: Some(vec![
                            SymbolKind::FILE,
                            SymbolKind::MODULE,
                            SymbolKind::NAMESPACE,
                            SymbolKind::PACKAGE,
                            SymbolKind::CLASS,
                            SymbolKind::METHOD,
                            SymbolKind::PROPERTY,
                            SymbolKind::FIELD,
                            SymbolKind::CONSTRUCTOR,
                            SymbolKind::ENUM,
                            SymbolKind::INTERFACE,
                            SymbolKind::FUNCTION,
                            SymbolKind::VARIABLE,
                            SymbolKind::CONSTANT,
                            SymbolKind::STRING,
                            SymbolKind::NUMBER,
                            SymbolKind::BOOLEAN,
                            SymbolKind::ARRAY,
                            SymbolKind::OBJECT,
                            SymbolKind::KEY,
                            SymbolKind::NULL,
                            SymbolKind::ENUM_MEMBER,
                            SymbolKind::STRUCT,
                            SymbolKind::EVENT,
                            SymbolKind::OPERATOR,
                            SymbolKind::TYPE_PARAMETER,
                        ]),
                    }),
                    hierarchical_document_symbol_support: Some(true),
                    tag_support: Some(TagSupport {
                        value_set: vec![SymbolTag::DEPRECATED],
                    }),
                }),
                code_action: Some(CodeActionClientCapabilities {
                    dynamic_registration: Some(true),
                    code_action_literal_support: Some(lsp_types::CodeActionLiteralSupport {
                        code_action_kind: CodeActionKindLiteralSupport {
                            value_set: vec![
                                CodeActionKind::EMPTY.as_str().to_string(),
                                CodeActionKind::QUICKFIX.as_str().to_string(),
                                CodeActionKind::REFACTOR.as_str().to_string(),
                                CodeActionKind::REFACTOR_EXTRACT.as_str().to_string(),
                                CodeActionKind::REFACTOR_INLINE.as_str().to_string(),
                                CodeActionKind::REFACTOR_REWRITE.as_str().to_string(),
                                CodeActionKind::SOURCE.as_str().to_string(),
                                CodeActionKind::SOURCE_ORGANIZE_IMPORTS.as_str().to_string(),
                            ],
                        },
                    }),
                    is_preferred_support: Some(true),
                    disabled_support: Some(true),
                    data_support: Some(true),
                    resolve_support: Some(CodeActionCapabilityResolveSupport {
                        properties: vec!["edit".to_string()],
                    }),
                    honors_change_annotations: Some(false),
                }),
                formatting: Some(DynamicRegistrationClientCapabilities {
                    dynamic_registration: Some(true),
                }),
                rename: Some(lsp_types::RenameClientCapabilities {
                    dynamic_registration: Some(true),
                    prepare_support: Some(true),
                    prepare_support_default_behavior: Some(
                        PrepareSupportDefaultBehavior::IDENTIFIER,
                    ),
                    honors_change_annotations: Some(true),
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
            }),
            window: Some(WindowClientCapabilities {
                work_done_progress: Some(true),
                show_message: Some(ShowMessageRequestClientCapabilities {
                    message_action_item: Some(MessageActionItemCapabilities {
                        additional_properties_support: Some(true),
                    }),
                }),
                show_document: Some(ShowDocumentClientCapabilities { support: true }),
            }),
            experimental: None,
            ..Default::default()
        },
        trace: Some(TraceValue::Off),
        workspace_folders: Some(vec![WorkspaceFolder {
            uri: Url::from_file_path(&request.working_dir).unwrap(),
            name: request.language.clone(),
        }]),
        client_info: Some(ClientInfo {
            name: env!("CARGO_PKG_NAME").to_string(),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        }),
        locale: Some("en".to_string()),
        ..Default::default()
    };

    let _ = lsp_process
        .send_request::<Initialize>(initialize_params)
        .await
        .map_err(|e| format!("failed to initialize {} server: {e}", request.language));

    let _ = lsp_process
        .send_notification::<notification::Initialized>(InitializedParams {})
        .await;

    processes.insert(request.language, Arc::new(Mutex::new(lsp_process)));

    Ok(pid)
}

#[tauri::command]
pub async fn stop_lsp_server(language: String, state: State<'_, LSPState>) -> Result<(), String> {
    if let Some(process_mutex) = state.processes.lock().await.get(&language) {
        let mut process = process_mutex.lock().await;
        let _ = process.process.kill().await;
    }

    Ok(())
}

#[tauri::command]
pub async fn lsp_did_open(
    language: String,
    uri: String,
    content: String,
    version: i32,
    state: State<'_, LSPState>,
) -> Result<(), String> {
    if let Some(process_mutex) = state.processes.lock().await.get(&language) {
        let params = DidOpenTextDocumentParams {
            text_document: TextDocumentItem {
                uri: Url::parse(&uri).map_err(|e| e.to_string())?,
                language_id: language,
                version,
                text: content,
            },
        };
        process_mutex
            .lock()
            .await
            .send_notification::<notification::DidOpenTextDocument>(params)
            .await
            .map_err(|e| format!("failed to send lsp/didOpen notification: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_change(
    language: String,
    uri: String,
    content: String,
    version: i32,
    state: State<'_, LSPState>,
) -> Result<(), String> {
    if let Some(process_mutex) = state.processes.lock().await.get(&language) {
        let params = DidChangeTextDocumentParams {
            text_document: VersionedTextDocumentIdentifier {
                uri: Url::parse(&uri).map_err(|e| e.to_string())?,
                version,
            },
            content_changes: vec![TextDocumentContentChangeEvent {
                range: None, // full sync
                range_length: None,
                text: content,
            }],
        };
        let _ = process_mutex
            .lock()
            .await
            .send_notification::<notification::DidChangeTextDocument>(params)
            .await
            .map_err(|e| format!("failed to send lsp/didChange notification: {e}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_close(
    language: String,
    uri: String,
    state: State<'_, LSPState>,
) -> Result<(), String> {
    if let Some(process_mutex) = state.processes.lock().await.get(&language) {
        let params = DidCloseTextDocumentParams {
            text_document: TextDocumentIdentifier {
                uri: Url::parse(&uri).map_err(|e| e.to_string())?,
            },
        };
        let _ = process_mutex
            .lock()
            .await
            .send_notification::<notification::DidCloseTextDocument>(params)
            .await
            .map_err(|e| format!("failed to send lsp/didClose notification: {e}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_completion(
    language: String,
    uri: String,
    line: u32,
    character: u32,
    state: State<'_, LSPState>,
) -> Result<CompletionResponse, String> {
    if let Some(process_mutex) = state.processes.lock().await.get(&language) {
        let params = CompletionParams {
            text_document_position: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier {
                    uri: Url::parse(&uri).map_err(|e| format!("invalid uri: {e}"))?,
                },
                position: Position { line, character },
            },
            work_done_progress_params: WorkDoneProgressParams::default(),
            partial_result_params: PartialResultParams::default(),
            context: Some(CompletionContext {
                trigger_kind: CompletionTriggerKind::INVOKED,
                trigger_character: None,
            }),
        };

        let mut lsp_process = process_mutex.lock().await;
        if let Ok(result) = lsp_process.send_request::<Completion>(params).await {
            match result {
                Some(response) => Ok(response),
                None => Err("completion results not found".to_string()),
            }
        } else {
            Err("error sending completion request".to_string())
        }
    } else {
        Err(format!("LSP server for {language} not found"))
    }
}

#[tauri::command]
pub async fn lsp_hover(
    language: String,
    uri: String,
    line: u32,
    character: u32,
    state: State<'_, LSPState>,
) -> Result<Option<serde_json::Value>, String> {
    if let Some(process_mutex) = state.processes.lock().await.get(&language) {
        let params = HoverParams {
            text_document_position_params: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier {
                    uri: Url::parse(&uri).map_err(|e| format!("invalid uri: {e}"))?,
                },
                position: Position { line, character },
            },
            work_done_progress_params: WorkDoneProgressParams::default(),
        };

        let mut lsp_process = process_mutex.lock().await;
        if let Ok(result) = lsp_process.send_request::<HoverRequest>(params).await {
            if let Some(hover) = result {
                // Convert the hover result to a JSON value for easier handling on the frontend
                Ok(Some(
                    serde_json::to_value(hover).map_err(|e| e.to_string())?,
                ))
            } else {
                Ok(None)
            }
        } else {
            Err("error sending hover request".to_string())
        }
    } else {
        Err(format!("LSP server for {language} not found"))
    }
}

#[tauri::command]
pub async fn list_lsp_servers(state: State<'_, LSPState>) -> Result<HashMap<String, u32>, String> {
    let servers = state.processes.lock().await;

    let mut result = HashMap::new();
    for (language, process) in servers.iter() {
        let process = process.lock().await;
        let pid = process.process.id().unwrap_or(0);
        result.insert(language.clone(), pid);
    }

    Ok(result)
}
