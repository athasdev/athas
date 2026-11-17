//! Codex as an in-process ACP agent: ACP requests from the session view on one side, the Codex
//! app-server's JSON-RPC on the other. Prompts become turns, item events become message chunks
//! and tool calls, approvals become permission questions, and Athas's dynamic tools are answered
//! by the app through [`HostCall`]s.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, PoisonError},
};

use futures::{
    FutureExt as _, StreamExt as _,
    channel::{mpsc, oneshot},
    future::BoxFuture,
    stream::FuturesUnordered,
};
use serde_json::{Map, Value, json};

use super::{CodexModel, CodexSettings};
use crate::acp::{
    rpc::{Incoming, RpcConnection, RpcError, Transport},
    schema as acp,
};

/// Command output shown in a tool call, from the end.
const SHOWN_OUTPUT_CHARS: usize = 4000;
const MODEL_OPTION: &str = "model";
const EFFORT_OPTION: &str = "effort";
const DEFAULT_MODEL: &str = "default";
const DEFAULT_EFFORTS: &[&str] = &["low", "medium", "high"];

/// A dynamic tool Codex called that needs the app: open a pull request or issue, or run the
/// hosted browser. The answer is the tool result Codex takes (`contentItems`, `success`).
pub struct HostCall {
    pub tool: String,
    pub arguments: Value,
    /// Unique per call, for the hosted browser's request id.
    pub call_id: String,
    pub respond: oneshot::Sender<Value>,
}

pub type HostCalls = mpsc::UnboundedSender<HostCall>;

/// Hears the settings whenever the session changes the model, effort or mode.
pub type SaveSettings = Arc<dyn Fn(&CodexSettings) + Send + Sync>;

pub struct CodexConfig {
    pub cwd: PathBuf,
    pub settings: CodexSettings,
    /// The hosted browser's tool definition, when it is offered.
    pub browser_tool: Option<Value>,
    pub host: Option<HostCalls>,
    pub save_settings: Option<SaveSettings>,
}

type TurnResult = Result<&'static str, RpcError>;

#[derive(Default)]
struct State {
    initialized: bool,
    settings: CodexSettings,
    models: Vec<CodexModel>,
    thread_id: Option<String>,
    turn_id: Option<String>,
    /// Stop was pressed before Codex named the turn: it is interrupted as soon as it has an id,
    /// instead of running on unwatched.
    interrupt_pending: bool,
    turn: Option<oneshot::Sender<TurnResult>>,
    /// Command output so far, by item id.
    outputs: HashMap<String, String>,
}

struct Bridge {
    acp: Arc<RpcConnection>,
    codex: Arc<RpcConnection>,
    cwd: PathBuf,
    browser_tool: Option<Value>,
    host: Option<HostCalls>,
    save_settings: Option<SaveSettings>,
    state: Mutex<State>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The app-server takes JSON-RPC without the `jsonrpc` member.
pub(super) fn plain_json_rpc(transport: Transport) -> (Transport, impl Future<Output = ()> + Send + 'static) {
    let Transport { outgoing, incoming } = transport;
    let (tx, mut rx) = mpsc::unbounded::<String>();
    let forward = async move {
        while let Some(line) = rx.next().await {
            if outgoing.unbounded_send(line.replacen("\"jsonrpc\":\"2.0\",", "", 1)).is_err() {
                break;
            }
        }
    };
    (Transport { outgoing: tx, incoming }, forward)
}

/// Serves ACP on `client`, driving the Codex app-server on `codex`, until either side hangs up.
pub async fn serve(client: Transport, codex: Transport, config: CodexConfig) {
    let (codex, forward) = plain_json_rpc(codex);
    let (acp_rpc, mut acp_in, acp_reader) = RpcConnection::new(client);
    let (codex_rpc, mut codex_in, codex_reader) = RpcConnection::new(codex);
    let bridge = Arc::new(Bridge {
        acp: acp_rpc.clone(),
        codex: codex_rpc.clone(),
        cwd: config.cwd,
        browser_tool: config.browser_tool,
        host: config.host,
        save_settings: config.save_settings,
        state: Mutex::new(State { settings: config.settings, ..Default::default() }),
    });
    let mut handlers: FuturesUnordered<BoxFuture<'static, ()>> = FuturesUnordered::new();
    let mut acp_reader = acp_reader.boxed().fuse();
    let mut codex_reader = codex_reader.boxed().fuse();
    let mut forward = forward.boxed().fuse();
    let mut codex_closed = false;
    loop {
        futures::select! {
            _ = acp_reader => {}
            _ = codex_reader => {}
            _ = forward => {}
            message = acp_in.next() => match message {
                Some(Incoming::Response { id, result }) => acp_rpc.resolve(id, result),
                Some(Incoming::Notification { method, .. }) => {
                    if method == "session/cancel" {
                        handlers.push(bridge.clone().interrupt().boxed());
                    }
                }
                Some(Incoming::Request { id, method, params }) => {
                    let bridge = bridge.clone();
                    handlers.push(async move {
                        let result = bridge.clone().handle(&method, params).await;
                        bridge.acp.respond(id, result);
                    }.boxed());
                }
                None => break,
            },
            message = codex_in.next() => match message {
                Some(Incoming::Response { id, result }) => codex_rpc.resolve(id, result),
                Some(Incoming::Notification { method, params }) => bridge.on_notification(&method, &params),
                Some(Incoming::Request { id, method, params }) => handlers.push(bridge.clone().on_request(id, method, params).boxed()),
                None => {
                    codex_closed = true;
                    codex_rpc.fail_pending();
                    bridge.finish_turn(Err(RpcError::new(RpcError::DISCONNECTED, "Codex app-server exited")));
                }
            },
            _ = handlers.select_next_some() => {}
        }
        if codex_closed && handlers.is_empty() {
            break;
        }
    }
    bridge.finish_turn(Err(RpcError::new(RpcError::DISCONNECTED, "The session closed")));
    acp_rpc.fail_pending();
    codex_rpc.fail_pending();
    codex_rpc.close();
}

impl Bridge {
    async fn handle(self: Arc<Self>, method: &str, params: Value) -> Result<Value, RpcError> {
        match method {
            "initialize" => Ok(json!({
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": true,
                    "sessionCapabilities": { "list": {}, "delete": {} },
                    "promptCapabilities": { "image": true, "audio": false, "embeddedContext": false },
                    "mcpCapabilities": { "http": false, "sse": false },
                },
                "authMethods": [],
                "agentInfo": { "name": "codex", "title": super::NAME, "version": env!("CARGO_PKG_VERSION") },
            })),
            "authenticate" => Ok(json!({})),
            "session/new" => self.open(None).await,
            "session/list" => self.list_threads(params).await,
            "session/delete" => {
                self.ensure_initialized().await?;
                let id = params.get("sessionId").and_then(Value::as_str).ok_or_else(|| RpcError::invalid_params("sessionId is required"))?;
                self.codex.request_value("thread/delete", json!({ "threadId": id })).await?;
                Ok(json!({}))
            }
            "session/load" => {
                let id = params.get("sessionId").and_then(Value::as_str).ok_or_else(|| RpcError::invalid_params("sessionId is required"))?;
                self.open(Some(id.to_string())).await
            }
            "session/set_mode" => {
                let mode = params.get("modeId").and_then(Value::as_str).filter(|mode| ["default", "plan"].contains(mode)).ok_or_else(|| RpcError::invalid_params("unknown mode"))?;
                self.change_settings(|settings| settings.collaboration_mode = Some(mode.to_string()));
                Ok(json!({}))
            }
            "session/set_config_option" => {
                let option = params.get("configId").and_then(Value::as_str).unwrap_or_default();
                let value = params.get("value").and_then(Value::as_str).unwrap_or_default().to_string();
                match option {
                    MODEL_OPTION => {
                        let models = lock(&self.state).models.clone();
                        self.change_settings(|settings| {
                            settings.model = (value != DEFAULT_MODEL).then(|| value.clone());
                            let model = models.iter().find(|model| if value == DEFAULT_MODEL { model.is_default } else { model.id == value });
                            if let Some(effort) = model.and_then(|model| super::effort_for_model(model, settings.effort.as_deref())) {
                                settings.effort = Some(effort);
                            }
                        });
                    }
                    EFFORT_OPTION => self.change_settings(|settings| settings.effort = Some(value)),
                    other => return Err(RpcError::invalid_params(format!("unknown option {other}"))),
                }
                Ok(json!({ "configOptions": self.config_options() }))
            }
            "session/prompt" => self.prompt(params).await,
            super::MODELS_METHOD => {
                self.ensure_initialized().await?;
                let models = self.codex.request_value("model/list", json!({ "limit": 100, "includeHidden": false })).await?;
                lock(&self.state).models = super::normalize_models(&models);
                Ok(json!({ "configOptions": self.config_options() }))
            }
            super::SKILLS_METHOD => {
                self.ensure_initialized().await?;
                let force = params.get("force").and_then(Value::as_bool).unwrap_or(false);
                self.codex.request_value("skills/list", json!({ "cwds": [self.cwd.to_string_lossy()], "forceReload": force })).await
            }
            other => Err(RpcError::method_not_found(other)),
        }
    }

    fn change_settings(&self, change: impl FnOnce(&mut CodexSettings)) {
        let settings = {
            let mut state = lock(&self.state);
            change(&mut state.settings);
            state.settings.clone()
        };
        if let Some(save) = &self.save_settings {
            save(&settings);
        }
    }

    async fn ensure_initialized(&self) -> Result<(), RpcError> {
        if lock(&self.state).initialized {
            return Ok(());
        }
        self.codex
            .request_value(
                "initialize",
                json!({
                    "clientInfo": { "name": "athas", "title": "Athas", "version": env!("CARGO_PKG_VERSION") },
                    "capabilities": { "experimentalApi": true },
                }),
            )
            .await?;
        self.codex.notify("initialized", json!({}));
        let account = self.codex.request_value("account/read", json!({ "refreshToken": false })).await?;
        if account.get("account").is_none_or(Value::is_null) && account.get("requiresOpenaiAuth").and_then(Value::as_bool) == Some(true) {
            return Err(RpcError::new(RpcError::AUTH_REQUIRED, "Sign in to Codex with `codex login`"));
        }
        if let Ok(models) = self.codex.request_value("model/list", json!({ "limit": 100, "includeHidden": false })).await {
            lock(&self.state).models = super::normalize_models(&models);
        }
        lock(&self.state).initialized = true;
        Ok(())
    }

    /// Starts a thread, or resumes `resume`.
    async fn open(&self, resume: Option<String>) -> Result<Value, RpcError> {
        self.ensure_initialized().await?;
        let resuming = resume.is_some();
        let result = match resume {
            Some(thread_id) => self
                .codex
                .request_value("thread/resume", json!({ "threadId": thread_id }))
                .await
                .map_err(|error| RpcError::new(RpcError::RESOURCE_NOT_FOUND, error.message))?,
            None => {
                let settings = lock(&self.state).settings.clone();
                let mut params = Map::from_iter([
                    ("serviceName".to_string(), json!("athas")),
                    ("cwd".to_string(), json!(self.cwd.to_string_lossy())),
                    ("ephemeral".to_string(), json!(false)),
                    ("dynamicTools".to_string(), super::dynamic_tools(self.browser_tool.clone())),
                ]);
                super::apply_thread_settings(&mut params, &settings);
                super::apply_athas_developer_instructions(&mut params);
                self.codex.request_value("thread/start", Value::Object(params)).await?
            }
        };
        let thread_id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::internal("Codex returned a thread without an id"))?
            .to_string();
        lock(&self.state).thread_id = Some(thread_id.clone());
        if resuming
            && let Ok(thread) = self.codex.request_value("thread/read", json!({ "threadId": thread_id, "includeTurns": true })).await
        {
            for update in super::thread_history_updates(&thread) {
                self.acp.notify("session/update", json!({ "sessionId": thread_id, "update": update }));
            }
        }
        Ok(json!({ "sessionId": thread_id, "modes": self.modes(), "configOptions": self.config_options() }))
    }

    /// The project's Codex threads as ACP sessions (`session/list` over `thread/list`).
    async fn list_threads(&self, params: Value) -> Result<Value, RpcError> {
        self.ensure_initialized().await?;
        let cwd = params.get("cwd").and_then(Value::as_str).map_or_else(|| self.cwd.to_string_lossy().into_owned(), str::to_string);
        let mut request = Map::from_iter([("limit".to_string(), json!(super::THREAD_LIMIT)), ("cwd".to_string(), json!(cwd))]);
        if let Some(cursor) = params.get("cursor").filter(|cursor| !cursor.is_null()) {
            request.insert("cursor".to_string(), cursor.clone());
        }
        let threads = self.codex.request_value("thread/list", Value::Object(request)).await?;
        let next = threads.get("nextCursor").and_then(Value::as_str).filter(|cursor| !cursor.is_empty());
        Ok(json!({ "sessions": super::threads_as_sessions(&threads, &cwd), "nextCursor": next }))
    }

    fn modes(&self) -> Value {
        let current = lock(&self.state).settings.collaboration_mode.clone().unwrap_or_else(|| "default".into());
        json!({
            "currentModeId": current,
            "availableModes": [
                { "id": "default", "name": "Agent", "description": "Codex edits files and runs commands" },
                { "id": "plan", "name": "Plan", "description": "Codex proposes a plan first" },
            ],
        })
    }

    fn config_options(&self) -> Value {
        let state = lock(&self.state);
        let current_model = state.settings.model.clone().unwrap_or_else(|| DEFAULT_MODEL.into());
        let mut models = vec![json!({ "value": DEFAULT_MODEL, "name": "Codex default" })];
        models.extend(state.models.iter().map(|model| {
            let mut option = json!({ "value": model.id, "name": model.name });
            if !model.description.is_empty() {
                option["description"] = json!(model.description);
            }
            option
        }));
        if current_model != DEFAULT_MODEL && !state.models.iter().any(|model| model.id == current_model) {
            models.push(json!({ "value": current_model, "name": current_model }));
        }
        let model = state.models.iter().find(|model| match &state.settings.model {
            Some(id) => &model.id == id,
            None => model.is_default,
        });
        let mut efforts: Vec<String> = match model {
            Some(model) if !model.efforts.is_empty() => model.efforts.clone(),
            _ => DEFAULT_EFFORTS.iter().map(|effort| effort.to_string()).collect(),
        };
        let default_effort = model.map(|model| model.default_effort.clone()).filter(|effort| !effort.is_empty());
        let effort = state.settings.effort.clone().unwrap_or_else(|| "medium".into());
        if !efforts.contains(&effort) {
            efforts.push(effort.clone());
        }
        json!([
            { "id": MODEL_OPTION, "name": "Model", "category": "model", "type": "select", "currentValue": current_model, "options": models },
            {
                "id": EFFORT_OPTION,
                "name": "Reasoning",
                "category": "thought_level",
                "type": "select",
                "currentValue": effort,
                "options": efforts
                    .iter()
                    .map(|effort| {
                        let mut option = json!({ "value": effort, "name": effort });
                        let description = model.and_then(|model| model.effort_descriptions.iter().find(|(value, _)| value == effort)).map(|(_, label)| label);
                        if let Some(description) = description.filter(|label| *label != effort) {
                            option["description"] = json!(description);
                        }
                        option
                    })
                    .collect::<Vec<_>>(),
                "_meta": { "defaultValue": default_effort },
            },
        ])
    }

    fn notify(&self, update: Value) {
        let Some(session) = lock(&self.state).thread_id.clone() else { return };
        self.acp.notify("session/update", json!({ "sessionId": session, "update": update }));
    }

    async fn prompt(&self, params: Value) -> Result<Value, RpcError> {
        let request: acp::PromptRequest = serde_json::from_value(params).map_err(RpcError::invalid_params)?;
        let mut text = String::new();
        let mut images = Vec::new();
        for block in &request.prompt {
            match block {
                acp::ContentBlock::Text(block) => text.push_str(&block.text),
                acp::ContentBlock::Image(image) => images.push(json!({ "type": "image", "url": format!("data:{};base64,{}", image.mime_type, image.data) })),
                acp::ContentBlock::ResourceLink(link) => {
                    let path = link.uri.strip_prefix("file://").unwrap_or(&link.uri);
                    text.push_str(&format!("\n\n@{path}"));
                }
                acp::ContentBlock::Resource(resource) => {
                    if let acp::EmbeddedResourceResource::TextResourceContents(contents) = &resource.resource {
                        let fence = if contents.text.contains("```") { "````" } else { "```" };
                        text.push_str(&format!("\n\nAttached {}:\n{fence}\n{}\n{fence}", contents.uri, contents.text));
                    }
                }
                _ => {}
            }
        }
        let mut input = Vec::new();
        if !text.is_empty() {
            input.push(json!({ "type": "text", "text": text, "text_elements": [] }));
        }
        input.extend(images);
        let (thread_id, settings, done) = {
            let mut state = lock(&self.state);
            let thread_id = state.thread_id.clone().ok_or_else(|| RpcError::invalid_params("no session"))?;
            let (tx, rx) = oneshot::channel();
            state.turn = Some(tx);
            state.turn_id = None;
            state.interrupt_pending = false;
            (thread_id, state.settings.clone(), rx)
        };
        let mut params = Map::from_iter([("threadId".to_string(), json!(thread_id)), ("input".to_string(), Value::Array(input))]);
        super::apply_turn_settings(&mut params, &settings);
        match self.codex.request_value("turn/start", Value::Object(params)).await {
            Ok(response) => {
                if let Some(turn_id) = response.pointer("/turn/id").and_then(Value::as_str) {
                    let stopped = {
                        let mut state = lock(&self.state);
                        if std::mem::take(&mut state.interrupt_pending) {
                            true
                        } else {
                            state.turn_id.get_or_insert_with(|| turn_id.to_string());
                            false
                        }
                    };
                    if stopped {
                        let _ = self.codex.request_value("turn/interrupt", json!({ "threadId": thread_id, "turnId": turn_id })).await;
                    }
                }
            }
            Err(error) => {
                lock(&self.state).turn = None;
                return Err(error);
            }
        }
        match done.await {
            Ok(Ok(stop)) => Ok(json!({ "stopReason": stop })),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(RpcError::new(RpcError::DISCONNECTED, "Codex app-server stopped")),
        }
    }

    async fn interrupt(self: Arc<Self>) {
        let (thread_id, turn_id) = {
            let state = lock(&self.state);
            (state.thread_id.clone(), state.turn_id.clone())
        };
        match (thread_id, turn_id) {
            (Some(thread_id), Some(turn_id)) => {
                if self.codex.request_value("turn/interrupt", json!({ "threadId": thread_id, "turnId": turn_id })).await.is_err() {
                    self.finish_turn(Ok("cancelled"));
                }
            }
            (Some(_), None) => {
                lock(&self.state).interrupt_pending = true;
                self.finish_turn(Ok("cancelled"));
            }
            _ => self.finish_turn(Ok("cancelled")),
        }
    }

    fn finish_turn(&self, result: TurnResult) {
        let turn = {
            let mut state = lock(&self.state);
            state.turn_id = None;
            state.outputs.clear();
            state.turn.take()
        };
        if let Some(turn) = turn {
            let _ = turn.send(result);
        }
    }

    /// Whether an event belongs to the thread and turn this session runs.
    fn is_current(&self, params: &Value) -> bool {
        let state = lock(&self.state);
        let Some(thread_id) = state.thread_id.as_deref() else { return false };
        if params.get("threadId").and_then(Value::as_str) != Some(thread_id) {
            return false;
        }
        let event_turn = params.get("turnId").and_then(Value::as_str).or_else(|| params.pointer("/turn/id").and_then(Value::as_str));
        match (state.turn_id.as_deref(), event_turn) {
            (Some(current), Some(event)) => current == event,
            _ => true,
        }
    }

    fn on_notification(&self, method: &str, params: &Value) {
        if method == "thread/name/updated" {
            let current = lock(&self.state).thread_id.clone();
            let title = params.get("threadName").and_then(Value::as_str).map(str::trim).unwrap_or_default();
            if current.as_deref() == params.get("threadId").and_then(Value::as_str) && !title.is_empty() {
                self.notify(json!({ "sessionUpdate": "session_info_update", "title": title }));
            }
            return;
        }
        if !self.is_current(params) {
            return;
        }
        match method {
            "turn/started" => {
                if let Some(turn_id) = params.pointer("/turn/id").and_then(Value::as_str) {
                    let mut state = lock(&self.state);
                    // A turn already stopped is not adopted: its events stay out of the chat until
                    // the `turn/start` answer interrupts it.
                    if !state.interrupt_pending {
                        state.turn_id = Some(turn_id.to_string());
                    }
                }
            }
            "item/agentMessage/delta" => {
                let delta = params.get("delta").and_then(Value::as_str).unwrap_or_default();
                let mut update = json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": delta } });
                if let Some(item) = params.get("itemId").and_then(Value::as_str) {
                    update["messageId"] = json!(item);
                }
                self.notify(update);
            }
            "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
                let delta = params.get("delta").and_then(Value::as_str).unwrap_or_default();
                self.notify(json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": delta } }));
            }
            "item/started" => {
                let Some(item) = params.get("item").filter(|item| super::is_tool_item(item)) else { return };
                let Some(id) = item.get("id").and_then(Value::as_str) else { return };
                self.notify(json!({
                    "sessionUpdate": "tool_call",
                    "toolCallId": id,
                    "title": super::item_title(item),
                    "kind": super::item_kind(item),
                    "status": "in_progress",
                    "locations": self.locations(item),
                    "content": self.diff_content(item),
                    "rawInput": item,
                }));
            }
            "item/commandExecution/outputDelta" => {
                let Some(id) = params.get("itemId").and_then(Value::as_str) else { return };
                let delta = params.get("delta").and_then(Value::as_str).unwrap_or_default();
                let output = {
                    let mut state = lock(&self.state);
                    let output = state.outputs.entry(id.to_string()).or_default();
                    output.push_str(delta);
                    output.clone()
                };
                self.notify(json!({ "sessionUpdate": "tool_call_update", "toolCallId": id, "content": [output_content(&output)] }));
            }
            "item/completed" => {
                let Some(item) = params.get("item").filter(|item| super::is_tool_item(item)) else { return };
                let Some(id) = item.get("id").and_then(Value::as_str) else { return };
                let failed = item.get("error").is_some_and(|error| !error.is_null())
                    || matches!(item.get("status").and_then(Value::as_str), Some("failed" | "declined"));
                let mut content = self.diff_content(item);
                if content.is_empty() {
                    let output = item
                        .get("aggregatedOutput")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| lock(&self.state).outputs.remove(id))
                        .or_else(|| item.pointer("/error/message").and_then(Value::as_str).map(str::to_string));
                    content.extend(output.filter(|output| !output.trim().is_empty()).map(|output| output_content(&output)));
                }
                self.notify(json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": id,
                    "status": if failed { "failed" } else { "completed" },
                    "content": content,
                    "rawOutput": item,
                }));
            }
            "thread/tokenUsage/updated" => {
                let used = params.pointer("/tokenUsage/total/totalTokens").and_then(Value::as_u64);
                let size = params.pointer("/tokenUsage/modelContextWindow").and_then(Value::as_u64);
                if let (Some(used), Some(size)) = (used, size) {
                    self.notify(json!({ "sessionUpdate": "usage_update", "used": used, "size": size }));
                }
            }
            "error" => {
                if params.get("willRetry").and_then(Value::as_bool) == Some(true) {
                    return;
                }
                let message = params
                    .pointer("/error/message")
                    .or_else(|| params.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Codex app-server error")
                    .to_string();
                self.finish_turn(Err(RpcError::internal(message)));
            }
            "turn/completed" => {
                let status = params.pointer("/turn/status").and_then(Value::as_str).unwrap_or_default();
                let result = match status {
                    "failed" => Err(RpcError::internal(params.pointer("/turn/error/message").and_then(Value::as_str).unwrap_or("Codex turn failed"))),
                    "interrupted" | "canceled" | "cancelled" => Ok("cancelled"),
                    _ => Ok("end_turn"),
                };
                self.finish_turn(result);
            }
            _ => {}
        }
    }

    fn absolute(&self, path: &str) -> PathBuf {
        let path = PathBuf::from(path);
        if path.is_absolute() { path } else { self.cwd.join(path) }
    }

    fn diff_content(&self, item: &Value) -> Vec<Value> {
        super::file_change_diffs(item)
            .into_iter()
            .map(|(path, old, new)| json!({ "type": "diff", "path": self.absolute(&path), "oldText": (!old.is_empty()).then_some(old), "newText": new }))
            .collect()
    }

    fn locations(&self, item: &Value) -> Vec<Value> {
        super::file_change_diffs(item).into_iter().map(|(path, ..)| json!({ "path": self.absolute(&path) })).collect()
    }

    async fn on_request(self: Arc<Self>, id: Value, method: String, params: Value) {
        let result = if method.ends_with("/requestApproval") {
            Ok(self.approve(&id, &method, &params).await)
        } else if method == "item/tool/call" {
            Ok(self.dynamic_tool(&id, &params).await)
        } else {
            Err(RpcError::method_not_found(&method))
        };
        self.codex.respond(id, result);
    }

    /// Asks the user whether Codex may run a command or change files.
    async fn approve(&self, id: &Value, method: &str, params: &Value) -> Value {
        let file_change = method.contains("fileChange");
        let tool_call_id = params.get("itemId").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("codex-approval-{id}"));
        let title = params
            .get("command")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| params.get("reason").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| if file_change { "Apply file changes".into() } else { "Run a command".into() });
        let session = lock(&self.state).thread_id.clone().unwrap_or_default();
        let request = json!({
            "sessionId": session,
            "toolCall": {
                "toolCallId": tool_call_id,
                "title": title,
                "kind": if file_change { "edit" } else { "execute" },
                "status": "pending",
            },
            "options": [
                { "optionId": "accept", "name": "Allow", "kind": "allow_once" },
                { "optionId": "decline", "name": "Deny", "kind": "reject_once" },
            ],
        });
        let answer = self.acp.request_value("session/request_permission", request).await.ok();
        let accepted = answer
            .as_ref()
            .and_then(|answer| answer.get("outcome"))
            .filter(|outcome| outcome.get("outcome").and_then(Value::as_str) == Some("selected"))
            .and_then(|outcome| outcome.get("optionId").and_then(Value::as_str))
            == Some("accept");
        json!({ "decision": if accepted { "accept" } else { "decline" } })
    }

    async fn dynamic_tool(&self, id: &Value, params: &Value) -> Value {
        let tool = params.get("tool").and_then(Value::as_str).unwrap_or_default().to_string();
        let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
        match tool.as_str() {
            super::SET_CHAT_TITLE_TOOL => match super::chat_title(&arguments) {
                Ok(title) => {
                    self.notify(json!({ "sessionUpdate": "session_info_update", "title": title }));
                    super::tool_result(format!("Athas chat renamed to \"{title}\"."), true)
                }
                Err(error) => super::tool_result(error, false),
            },
            super::OPEN_PULL_REQUEST_TOOL | super::OPEN_ISSUE_TOOL => {
                let resource = if tool == super::OPEN_PULL_REQUEST_TOOL { "pull request" } else { "issue" };
                if let Err(error) = super::resource_number(&arguments, resource) {
                    return super::tool_result(error, false);
                }
                self.host_call(&tool, arguments, id).await
            }
            super::BROWSER_TOOL if self.browser_tool.is_some() => self.host_call(&tool, arguments, id).await,
            other => super::tool_result(format!("Unknown Athas tool: {other}"), false),
        }
    }

    async fn host_call(&self, tool: &str, arguments: Value, id: &Value) -> Value {
        let call_id = {
            let state = lock(&self.state);
            format!("{}:{}:{id}", state.thread_id.as_deref().unwrap_or_default(), state.turn_id.as_deref().unwrap_or_default())
        };
        let Some(host) = &self.host else { return super::tool_result("Athas is not available to run this tool.", false) };
        let (respond, answer) = oneshot::channel();
        if host.unbounded_send(HostCall { tool: tool.to_string(), arguments, call_id, respond }).is_err() {
            return super::tool_result("Athas is not available to run this tool.", false);
        }
        answer.await.unwrap_or_else(|_| super::tool_result("Athas closed the session.", false))
    }
}

fn output_content(output: &str) -> Value {
    let skip = output.chars().count().saturating_sub(SHOWN_OUTPUT_CHARS);
    let shown: String = output.chars().skip(skip).collect();
    json!({ "type": "content", "content": { "type": "text", "text": format!("```\n{}\n```", shown.trim_end()) } })
}
