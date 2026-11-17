//! The built-in agent as an ACP agent that runs in-process: the session view talks to it over an
//! in-memory transport exactly as it talks to Claude or Gemini, so the transcript, permission
//! prompts, terminals and plans work the same. Model requests go through `ai_providers`; files
//! are read and changed with `ai_tools`; commands run in the client's terminals
//! (`terminal/create`) so the user sees their output live.
//!
//! Ported from Athas's `intelligence/services/intelligence-agent.ts`,
//! `intelligence-agent-permissions.ts`, `intelligence-command-allowlist.ts` and
//! `intelligence-mcp.ts`.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use ai_mcp::{McpClient, McpServerConfig, McpTool};
use ai_providers::{
    AgentConfig, AgentEvent, AgentHost, CancelToken, Connection, Message, Part, ProviderSettings, Role, SecretStore, StepLimits,
    StopReason, ToolCall, ToolResult, ToolSpec, catalog, secrets,
};
use futures::{FutureExt as _, StreamExt as _, future::BoxFuture, stream::FuturesUnordered};
use serde_json::{Value, json};

use super::{
    prompt::{self, Mode},
    tools,
};
use crate::acp::{
    rpc::{Incoming, RpcConnection, RpcError, Transport},
    schema as acp,
};

/// Waits; the app passes GPUI's timer, tests a thread.
pub type Sleep = Arc<dyn Fn(Duration) -> BoxFuture<'static, ()> + Send + Sync>;

/// Hears every file the agent writes or deletes, for review and checkpoints.
pub type WriteHook = Arc<dyn Fn(crate::review::FileChange) + Send + Sync>;

/// Whether an open editor holds unsaved edits to the file at this absolute path
/// (`hasUnsavedBuffer`); asked before the agent writes it.
pub type UnsavedCheck = Arc<dyn Fn(PathBuf) -> BoxFuture<'static, bool> + Send + Sync>;

/// Why a write to a file with unsaved editor changes was refused (`UNSAVED_CHANGES`).
pub const UNSAVED_CHANGES: &str = "The editor has unsaved changes to this file. Ask the user to save or discard them first.";

/// How long one command may run before it is stopped.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const MCP_START_TIMEOUT: Duration = Duration::from_secs(30);
const MCP_CALL_TIMEOUT: Duration = Duration::from_secs(120);
/// Command output the model gets, from the end.
const COMMAND_OUTPUT_CHARS: usize = 30_000;
const TERMINAL_OUTPUT_BYTES: u64 = 256 * 1024;
/// Lines of a list or search shown in the transcript.
const SHOWN_LINES: usize = 60;
const MODEL_OPTION: &str = "model";

/// What the built-in agent needs from the app.
pub struct BuiltinConfig {
    /// Where commands run.
    pub cwd: PathBuf,
    /// The project the workspace tools work in; `None` for a chat of no project.
    pub root: Option<PathBuf>,
    pub provider: ProviderSettings,
    pub mode: Mode,
    pub max_steps: usize,
    pub user_rules: String,
    pub mcp_servers: Vec<McpServerConfig>,
    /// The conversation so far, when a saved session reopens.
    pub history: Vec<Message>,
    pub secrets: Arc<dyn SecretStore>,
    pub sleep: Sleep,
    pub on_write: Option<WriteHook>,
    pub unsaved: Option<UnsavedCheck>,
}

/// Serves ACP on `transport` until the client hangs up.
pub async fn serve(transport: Transport, config: BuiltinConfig) {
    let (rpc, mut incoming, reader) = RpcConnection::new(transport);
    let agent = Arc::new(Agent::new(rpc.clone(), config));
    let mut handlers: FuturesUnordered<BoxFuture<'static, (Value, Result<Value, RpcError>)>> = FuturesUnordered::new();
    let mut reader = reader.boxed().fuse();
    loop {
        futures::select! {
            _ = reader => {}
            message = incoming.next() => match message {
                Some(Incoming::Response { id, result }) => rpc.resolve(id, result),
                Some(Incoming::Notification { method, .. }) => {
                    if method == "session/cancel" {
                        agent.cancel();
                    }
                }
                Some(Incoming::Request { id, method, params }) => {
                    let agent = agent.clone();
                    handlers.push(async move { (id, agent.handle(&method, params).await) }.boxed());
                }
                None => break,
            },
            answered = handlers.select_next_some() => {
                let (id, result) = answered;
                rpc.respond(id, result);
            }
        }
    }
    agent.cancel();
    rpc.fail_pending();
}

struct Agent {
    rpc: Arc<RpcConnection>,
    cwd: PathBuf,
    root: Option<PathBuf>,
    user_rules: String,
    max_steps: usize,
    mcp_servers: Vec<McpServerConfig>,
    secrets: Arc<dyn SecretStore>,
    sleep: Sleep,
    on_write: Option<WriteHook>,
    unsaved: Option<UnsavedCheck>,
    state: Arc<Mutex<State>>,
}

struct State {
    session_id: Option<String>,
    mode: Mode,
    provider: ProviderSettings,
    history: Vec<Message>,
    cancel: Option<CancelToken>,
    /// What the agent last read or wrote of each file, so an edit can check nothing changed since.
    read_files: HashMap<String, String>,
    /// Command prefixes the user always allowed in this session.
    allowed_prefixes: Vec<String>,
    /// MCP tools the user always allowed, as `server/tool`.
    allowed_mcp: HashSet<String>,
    mcp: Option<Arc<McpSet>>,
    /// The session's tokens and cost so far.
    input_tokens: u64,
    output_tokens: u64,
    cost: Option<f64>,
}

/// The user's MCP servers that started, with their tools.
#[derive(Default)]
struct McpSet {
    servers: Vec<(Arc<McpClient>, Vec<McpTool>)>,
    notices: Vec<String>,
}

impl McpSet {
    fn find(&self, model_name: &str) -> Option<(Arc<McpClient>, McpTool)> {
        self.servers.iter().find_map(|(client, tools)| {
            tools.iter().find(|tool| ai_mcp::model_tool_name(client.name(), &tool.name) == model_name).map(|tool| (client.clone(), tool.clone()))
        })
    }

    fn specs(&self, read_only: bool) -> Vec<ToolSpec> {
        self.servers
            .iter()
            .flat_map(|(client, tools)| {
                tools.iter().filter(move |tool| !read_only || tool.read_only).map(|tool| ToolSpec {
                    name: ai_mcp::model_tool_name(client.name(), &tool.name),
                    description: format!("[{}] {}", client.name(), tool.description),
                    input_schema: tool.input_schema.clone(),
                })
            })
            .collect()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn answer(value: Value) -> Result<Value, RpcError> {
    Ok(value)
}

impl Agent {
    fn new(rpc: Arc<RpcConnection>, config: BuiltinConfig) -> Self {
        let state = State {
            session_id: None,
            mode: config.mode,
            provider: config.provider,
            history: config.history,
            cancel: None,
            read_files: HashMap::new(),
            allowed_prefixes: Vec::new(),
            allowed_mcp: HashSet::new(),
            mcp: None,
            input_tokens: 0,
            output_tokens: 0,
            cost: None,
        };
        Self {
            rpc,
            cwd: config.cwd,
            root: config.root,
            user_rules: config.user_rules,
            max_steps: config.max_steps,
            mcp_servers: config.mcp_servers,
            secrets: config.secrets,
            sleep: config.sleep,
            on_write: config.on_write,
            unsaved: config.unsaved,
            state: Arc::new(Mutex::new(state)),
        }
    }

    fn cancel(&self) {
        if let Some(cancel) = lock(&self.state).cancel.take() {
            cancel.cancel();
        }
    }

    async fn handle(self: Arc<Self>, method: &str, params: Value) -> Result<Value, RpcError> {
        match method {
            "initialize" => answer(json!({
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": false,
                    "promptCapabilities": { "image": true, "audio": false, "embeddedContext": true },
                    "mcpCapabilities": { "http": false, "sse": false },
                },
                "authMethods": [],
                "agentInfo": { "name": "athas", "title": super::NAME, "version": env!("CARGO_PKG_VERSION") },
            })),
            "authenticate" => answer(json!({})),
            "session/new" => {
                let id = format!("athas-{}", now_millis());
                lock(&self.state).session_id = Some(id.clone());
                answer(json!({ "sessionId": id, "modes": self.modes(), "configOptions": self.config_options() }))
            }
            "session/set_mode" => {
                let mode = params.get("modeId").and_then(Value::as_str).and_then(Mode::from_id).ok_or_else(|| RpcError::invalid_params("unknown mode"))?;
                lock(&self.state).mode = mode;
                answer(json!({}))
            }
            "session/set_config_option" => {
                let option = params.get("configId").and_then(Value::as_str).unwrap_or_default();
                let value = params.get("value").and_then(Value::as_str).unwrap_or_default();
                if option != MODEL_OPTION {
                    return Err(RpcError::invalid_params(format!("unknown option {option}")));
                }
                let (provider, model) = value.split_once("::").ok_or_else(|| RpcError::invalid_params("unknown model"))?;
                {
                    let mut state = lock(&self.state);
                    state.provider.provider_id = provider.to_string();
                    state.provider.model_id = model.to_string();
                }
                answer(json!({ "configOptions": self.config_options() }))
            }
            "session/prompt" => self.prompt(params).await,
            other => Err(RpcError::method_not_found(other)),
        }
    }

    fn modes(&self) -> Value {
        let current = lock(&self.state).mode;
        json!({
            "currentModeId": current.id(),
            "availableModes": Mode::ALL.iter().map(|mode| json!({ "id": mode.id(), "name": mode.name(), "description": mode.description() })).collect::<Vec<_>>(),
        })
    }

    /// The model picker: Athas's models, and those of every provider with a key or an endpoint.
    fn config_options(&self) -> Value {
        let provider = lock(&self.state).provider.clone();
        let current = format!("{}::{}", provider.provider_id, provider.model_id);
        let mut groups = Vec::new();
        for candidate in catalog::PROVIDERS {
            let selected = candidate.id == provider.provider_id;
            let usable = match candidate.id {
                catalog::ATHAS => true,
                catalog::CUSTOM => !provider.custom_base_url.trim().is_empty(),
                catalog::OLLAMA => selected,
                _ => secrets::api_key(self.secrets.as_ref(), candidate).is_some(),
            };
            if !usable && !selected {
                continue;
            }
            let mut options: Vec<Value> = candidate
                .models
                .iter()
                .map(|model| json!({ "value": format!("{}::{}", candidate.id, model.id), "name": model.name }))
                .collect();
            if selected && !provider.model_id.is_empty() && candidate.model(&provider.model_id).is_none() {
                options.push(json!({ "value": current, "name": provider.model_id }));
            }
            if !options.is_empty() {
                groups.push(json!({ "group": candidate.id, "name": candidate.name, "options": options }));
            }
        }
        json!([{ "id": MODEL_OPTION, "name": "Model", "category": "model", "type": "select", "currentValue": current, "options": groups }])
    }

    fn notify(&self, session_id: &str, update: Value) {
        self.rpc.notify("session/update", json!({ "sessionId": session_id, "update": update }));
    }

    async fn prompt(self: Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let request: acp::PromptRequest = serde_json::from_value(params).map_err(RpcError::invalid_params)?;
        let session_id = request.session_id.0.to_string();
        let cancel = CancelToken::default();
        let (provider, mode) = {
            let mut state = lock(&self.state);
            state.cancel = Some(cancel.clone());
            (state.provider.clone(), state.mode)
        };
        // The team's settings must be readable and the organization must allow the agent and,
        // for personal keys, BYOK (`getIntelligenceConnection("agent")`).
        if let Err(problem) = ai_providers::check_task_connection(ai_providers::GateTask::Agent, &provider.provider_id) {
            lock(&self.state).cancel = None;
            return Err(RpcError::internal(problem.to_string()));
        }
        let connection = Connection::resolve(&provider, self.secrets.as_ref()).map_err(|error| RpcError::internal(error.to_string()))?;
        let policy = ai_tools::context_policy(self.root.as_deref()).map_err(RpcError::internal)?;
        let accepts_images = connection.supports_images();
        let message = self.user_message(&request.prompt, &policy);
        let context = request_context(&request, &policy);
        let mcp = self.mcp(&session_id).await;
        let mut tool_specs = tools::workspace_tools(self.root.is_some(), mode.read_only());
        tool_specs.extend(mcp.specs(mode.read_only()));
        // Ollama rejects tools for models that cannot call them. Say so up front in Agent mode
        // rather than letting the model claim edits it never made; Ask and Plan answer without
        // the workspace (`resolveOllamaToolSupport`).
        if connection.provider.id == ai_providers::catalog::OLLAMA && !tool_specs.is_empty() {
            let key = ai_providers::secrets::api_key(self.secrets.as_ref(), connection.provider);
            let capabilities = ai_providers::connection::ollama_model_capabilities(&provider.ollama_base_url, &connection.model, key.as_deref()).await;
            if ai_providers::OllamaToolSupport::from_capabilities(capabilities.as_deref()) == ai_providers::OllamaToolSupport::Unsupported {
                if !mode.read_only() {
                    lock(&self.state).cancel = None;
                    return Err(RpcError::internal(ai_providers::connection::ollama_no_tools_message(&connection.model)));
                }
                let notice = ai_providers::connection::ollama_read_only_no_tools_notice(&connection.model);
                self.notify(&session_id, json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": format!("_{notice}_\n\n") } }));
                tool_specs.clear();
            }
        }
        let mut system = prompt::system_prompt_for(mode, self.root.as_deref(), &self.user_rules, &context);
        if let Some(extra) = ai_providers::external::system_prompt_context(&provider.provider_id).await {
            system = format!("{system}\n\n{extra}");
        }
        let config = AgentConfig {
            system,
            tools: tool_specs,
            max_steps: self.max_steps,
            max_tokens: connection.default_max_tokens(),
            limits: StepLimits::for_provider(connection.provider.id),
        };
        let mut history = std::mem::take(&mut lock(&self.state).history);
        history.push(message);
        // A long chat is cut down to what the hosted endpoint takes, its oldest turns summarised
        // (`fitMessagesToProviderLimits`).
        if let Some(limits) = ai_providers::RequestLimits::for_provider(connection.provider.id) {
            let instruction_bytes = config.system.len() + serde_json::to_string(&config.tools).map_or(0, |tools| tools.len());
            ai_providers::fit_request_to_limits(&mut history, instruction_bytes, limits, summarize_messages);
        }
        // Images go only to models that read them, and within the hosted endpoint's limits
        // (`fitMessagesToProviderLimits`).
        let sent_images = ai_providers::current_image_count(&history);
        if !accepts_images {
            ai_providers::strip_images(&mut history);
        } else if connection.provider.is_hosted() {
            ai_providers::fit_hosted_images(&mut history);
        }
        let omitted_images = sent_images - ai_providers::current_image_count(&history);
        let model_name = connection.model_info().map_or_else(|| connection.model.clone(), |model| model.name.to_string());
        let notices: Vec<String> = (omitted_images > 0).then(|| ai_providers::images_omitted_notice(omitted_images, accepts_images, &model_name)).into_iter().collect();
        let host = TurnHost {
            agent: self.clone(),
            session_id: session_id.clone(),
            mcp,
            context_window: connection.context_window(),
            cancel: cancel.clone(),
            cost_base: lock(&self.state).cost.unwrap_or_default(),
        };
        let result = ai_providers::run_turn(&connection, &config, &mut history, &host, &cancel).await;
        {
            let mut state = lock(&self.state);
            state.history = history;
            state.cancel = None;
        }
        let outcome = result.map_err(|error| RpcError::internal(error.message))?;
        let stop = match outcome.stop {
            StopReason::EndTurn => "end_turn",
            StopReason::MaxSteps => "max_turn_requests",
            StopReason::MaxTokens => "max_tokens",
            StopReason::Refusal => "refusal",
            StopReason::Cancelled => "cancelled",
        };
        let usage = &outcome.usage;
        let mut response = json!({ "stopReason": stop, "_meta": { "steps": outcome.steps } });
        if !notices.is_empty() {
            response["_meta"]["athasNotices"] = json!(notices);
        }
        if usage.input_tokens + usage.output_tokens > 0 {
            response["usage"] = json!({
                "totalTokens": usage.input_tokens + usage.output_tokens,
                "inputTokens": usage.input_tokens,
                "outputTokens": usage.output_tokens,
                "cachedReadTokens": usage.cache_read_tokens,
                "cachedWriteTokens": usage.cache_write_tokens,
            });
        }
        if let Some(cost) = outcome.cost {
            response["_meta"]["costUsd"] = json!(cost);
        }
        answer(response)
    }

    /// The prompt as the model reads it: text, images, and the text of mentioned files.
    fn user_message(&self, blocks: &[acp::ContentBlock], policy: &ai_tools::ContextPolicy) -> Message {
        let mut text = String::new();
        let mut parts = Vec::new();
        let mut files: Vec<(String, String)> = Vec::new();
        for block in blocks {
            match block {
                acp::ContentBlock::Text(block) => text.push_str(&block.text),
                acp::ContentBlock::Image(image) => {
                    parts.push(Part::Image { media_type: image.mime_type.clone(), data: image.data.clone() });
                }
                acp::ContentBlock::ResourceLink(link) if !context_uri_allowed(&link.uri, policy) => {}
                acp::ContentBlock::ResourceLink(link) => {
                    let path = link.uri.strip_prefix("file://").map(PathBuf::from);
                    let attached = path.as_deref().and_then(|path| self.mentioned_file(path));
                    match attached {
                        Some(file) => files.push(file),
                        None => text.push_str(&format!("\n\nAttached: {}", link.uri)),
                    }
                }
                acp::ContentBlock::Resource(resource) => {
                    if let acp::EmbeddedResourceResource::TextResourceContents(contents) = &resource.resource
                        && context_uri_allowed(&contents.uri, policy)
                    {
                        let fence = if contents.text.contains("```") { "````" } else { "```" };
                        text.push_str(&format!("\n\nAttached {}:\n{fence}\n{}\n{fence}", contents.uri, contents.text));
                    }
                }
                _ => {}
            }
        }
        // Mentioned files share one budget, each within its own share (`applyAttachmentBudget`).
        let budget = crate::context_budget::DEFAULT_ATTACHMENT_BUDGET;
        let (fitted, _, _) = crate::context_budget::apply_attachment_budget(files.iter().map(|(_, content)| content.as_str()), budget);
        for ((relative, _), file) in files.iter().zip(fitted) {
            let fence = code_fence(&file.content);
            let note = if file.truncated { " [truncated to fit the context budget; read the file for the rest]" } else { "" };
            text.push_str(&format!("\n\nAttached file {relative}{note}:\n{fence}\n{}\n{fence}", file.content));
        }
        parts.insert(0, Part::Text { text });
        Message { role: Role::User, content: parts }
    }

    /// A mentioned file inside the project: its relative path and text, which also counts as read.
    fn mentioned_file(&self, path: &Path) -> Option<(String, String)> {
        let root = self.root.as_deref()?;
        let relative = path.strip_prefix(root).ok()?.to_string_lossy().replace('\\', "/");
        let content = ai_tools::read_file(root, &relative).ok()?;
        lock(&self.state).read_files.insert(relative.clone(), content.clone());
        Some((relative, content))
    }

    /// Connects the user's MCP servers on the first prompt, and says which could not start.
    async fn mcp(&self, session_id: &str) -> Arc<McpSet> {
        if let Some(mcp) = lock(&self.state).mcp.clone() {
            return mcp;
        }
        let mut set = McpSet::default();
        for config in &self.mcp_servers {
            let name = config.setting.name.trim().to_string();
            // Starting and listing tools share the deadline: a server that starts but never
            // answers `tools/list` would otherwise hold the first prompt forever.
            let start = async {
                let client = McpClient::start(config, self.root.as_deref(), crate::acp::resolve_command).await?;
                let tools = client.list_tools().await?;
                Ok::<_, String>((Arc::new(client), tools))
            };
            let listed = futures::select_biased! {
                listed = start.fuse() => listed,
                _ = (self.sleep)(MCP_START_TIMEOUT).fuse() => Err(format!("{name} did not answer within 30 seconds")),
            };
            match listed {
                Ok(server) => set.servers.push(server),
                Err(error) => set.notices.push(format!("MCP server {name} is unavailable: {error}")),
            }
        }
        for notice in &set.notices {
            self.notify(session_id, json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": format!("_{notice}_\n\n") } }));
        }
        let set = Arc::new(set);
        lock(&self.state).mcp = Some(set.clone());
        set
    }
}

fn now_millis() -> u128 {
    web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|time| time.as_millis()).unwrap_or_default()
}

/// One turn's side of the loop: it reports progress as session updates and runs tools.
#[derive(Clone)]
struct TurnHost {
    agent: Arc<Agent>,
    session_id: String,
    mcp: Arc<McpSet>,
    context_window: u64,
    cancel: CancelToken,
    /// The session's cost before this turn; the loop reports the turn's own.
    cost_base: f64,
}

/// How a tool call ended, for the model and for the transcript.
struct Finished {
    result: ToolResult,
    /// `completed` or `failed`; `None` leaves the status the client set (a declined call).
    status: Option<&'static str>,
    content: Vec<Value>,
    meta: Option<Value>,
    /// What the transcript shows for the call in place of its content (`display`).
    raw_output: Option<Value>,
}

impl Finished {
    fn ok(result: ToolResult, content: Vec<Value>) -> Self {
        Self { result, status: Some("completed"), content, meta: None, raw_output: None }
    }

    fn failed(message: String) -> Self {
        let content = vec![text_content(&message)];
        Self { result: ToolResult::error(message), status: Some("failed"), content, meta: None, raw_output: None }
    }

    fn declined(result: ToolResult) -> Self {
        Self { result, status: None, content: Vec::new(), meta: None, raw_output: None }
    }
}

/// `show_view`: the view checked as an extension view, shown under the call as `athas_ui`
/// output while the model hears `{ shown: true }`.
fn show_view(input: &Value) -> Finished {
    let view = input.get("view").cloned().unwrap_or(Value::Null);
    match extension_host::view::parse_view(&view) {
        Ok(node) => {
            let view = serde_json::to_value(node).unwrap_or(view);
            let mut finished = Finished::ok(ToolResult::json(&json!({ "shown": true })), Vec::new());
            finished.raw_output = Some(json!({ "type": "athas_ui", "view": view }));
            finished
        }
        Err(error) => Finished::failed(error.to_string()),
    }
}

fn text_content(text: &str) -> Value {
    json!({ "type": "content", "content": { "type": "text", "text": text } })
}

impl AgentHost for TurnHost {
    fn event(&self, event: AgentEvent) {
        let update = match event {
            AgentEvent::Text(text) => json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": text } }),
            AgentEvent::Thinking(text) => json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": text } }),
            AgentEvent::Usage { step, cost, .. } => {
                let (input, output, total_cost) = {
                    let mut state = lock(&self.agent.state);
                    state.input_tokens += step.input_tokens + step.cache_read_tokens + step.cache_write_tokens;
                    state.output_tokens += step.output_tokens;
                    if let Some(cost) = cost {
                        state.cost = Some(self.cost_base + cost);
                    }
                    (state.input_tokens, state.output_tokens, state.cost)
                };
                let mut update = json!({
                    "sessionUpdate": "usage_update",
                    "used": step.context_tokens(),
                    "size": self.context_window,
                    "_meta": { "inputTokens": input, "outputTokens": output },
                });
                if let Some(cost) = total_cost {
                    update["cost"] = json!({ "amount": cost, "currency": "USD" });
                }
                update
            }
            AgentEvent::Model(_) => return,
        };
        self.agent.notify(&self.session_id, update);
    }

    fn call_tool(&self, call: ToolCall) -> BoxFuture<'static, ToolResult> {
        let host = self.clone();
        async move { host.run_tool(call).await }.boxed()
    }
}

impl TurnHost {
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        lock(&self.agent.state)
    }

    fn root(&self) -> Result<&Path, String> {
        self.agent.root.as_deref().ok_or_else(|| "No project is open, so there are no workspace files.".to_string())
    }

    fn absolute(&self, path: &str) -> String {
        match &self.agent.root {
            Some(root) => root.join(path).display().to_string(),
            None => path.to_string(),
        }
    }

    async fn run_tool(&self, call: ToolCall) -> ToolResult {
        let (title, kind) = tools::describe(&call.name, &call.input);
        let path = call.input.get("path").and_then(Value::as_str).filter(|path| !path.is_empty());
        let mut locations = Vec::new();
        if let Some(path) = path
            && self.agent.root.is_some()
        {
            let mut location = json!({ "path": self.absolute(path) });
            if let Some(line) = call.input.get("startLine").and_then(Value::as_u64) {
                location["line"] = json!(line);
            }
            locations.push(location);
        }
        self.agent.notify(
            &self.session_id,
            json!({
                "sessionUpdate": "tool_call",
                "toolCallId": call.id,
                "title": title,
                "kind": kind,
                "status": "in_progress",
                "locations": locations,
                "rawInput": call.input,
            }),
        );
        // A file the editor holds unsaved edits to is not written over; an edit or deletion first
        // needs the file read, as the tools themselves say.
        let guarded = match call.name.as_str() {
            tools::EDIT_FILE | tools::DELETE_FILE => path.filter(|path| self.state().read_files.contains_key(*path)),
            tools::WRITE_FILE => path,
            _ => None,
        };
        let unsaved = match (guarded, &self.agent.unsaved) {
            (Some(path), Some(check)) if self.agent.root.is_some() => check(PathBuf::from(self.absolute(path))).await,
            _ => false,
        };
        let finished = match call.name.as_str() {
            _ if unsaved => Finished::failed(UNSAVED_CHANGES.to_string()),
            tools::READ_FILE => self.read_file(&call.input),
            tools::LIST_FILES => self.list_files(&call.input),
            tools::SEARCH_FILES => self.search_files(&call.input),
            tools::EDIT_FILE => self.edit_file(&call.input),
            tools::WRITE_FILE => self.write_file(&call.input),
            tools::DELETE_FILE => self.delete_file(&call, &title).await,
            tools::RUN_COMMAND => self.run_command(&call, &title).await,
            tools::TODO_WRITE => self.todo_write(&call.input),
            tools::SHOW_VIEW => show_view(&call.input),
            name if name.starts_with("mcp__") => self.mcp_tool(&call, &title).await,
            other => Finished::failed(format!("There is no tool named {other}.")),
        };
        let mut update = json!({ "sessionUpdate": "tool_call_update", "toolCallId": call.id, "content": finished.content });
        if let Some(status) = finished.status {
            update["status"] = json!(status);
        }
        if let Some(meta) = finished.meta {
            update["_meta"] = meta;
        }
        if let Some(raw_output) = finished.raw_output {
            update["rawOutput"] = raw_output;
        }
        self.agent.notify(&self.session_id, update);
        finished.result
    }

    fn read_file(&self, input: &Value) -> Finished {
        let result = (|| {
            let root = self.root()?;
            let path = input.get("path").and_then(Value::as_str).ok_or("path is required")?;
            let start = input.get("startLine").and_then(Value::as_u64).unwrap_or(1).max(1) as usize;
            let content = ai_tools::read_file(root, path)?;
            let lines: Vec<&str> = content.split('\n').collect();
            let text: String = lines.iter().skip(start - 1).take(ai_tools::READ_LINES).copied().collect::<Vec<_>>().join("\n");
            let text: String = text.chars().take(ai_tools::READ_CHARS).collect();
            let total = lines.len();
            self.state().read_files.insert(path.to_string(), content);
            Ok::<_, String>(json!({ "path": path, "startLine": start, "totalLines": total, "text": text }))
        })();
        match result {
            Ok(value) => Finished::ok(ToolResult::json(&value), Vec::new()),
            Err(error) => Finished::failed(error),
        }
    }

    fn list_files(&self, input: &Value) -> Finished {
        let result = self.root().and_then(|root| {
            let options: ai_tools::ListOptions = serde_json::from_value(input.clone()).map_err(|error| error.to_string())?;
            ai_tools::list_files(root, &options)
        });
        match result {
            Ok(list) => {
                let mut shown: Vec<String> = list.files.iter().take(SHOWN_LINES).cloned().collect();
                if list.files.len() > SHOWN_LINES {
                    shown.push(format!("… {} more", list.files.len() - SHOWN_LINES));
                }
                let summary = format!("{} file{}\n```\n{}\n```", list.total, if list.total == 1 { "" } else { "s" }, shown.join("\n"));
                Finished::ok(ToolResult::json(&list), vec![text_content(&summary)])
            }
            Err(error) => Finished::failed(error),
        }
    }

    fn search_files(&self, input: &Value) -> Finished {
        let result = self.root().and_then(|root| {
            let options: ai_tools::SearchOptions = serde_json::from_value(input.clone()).map_err(|error| error.to_string())?;
            ai_tools::search_files(root, &options)
        });
        match result {
            Ok(found) => {
                let files: HashSet<&str> = found.matches.iter().map(|found| found.path.as_str()).collect();
                let lines: Vec<String> =
                    found.matches.iter().take(SHOWN_LINES).map(|found| format!("{}:{}: {}", found.path, found.line, found.text.trim())).collect();
                let summary = if found.matches.is_empty() {
                    "No matches".to_string()
                } else {
                    format!(
                        "{} match{} in {} file{}\n```\n{}\n```",
                        found.matches.len(),
                        if found.matches.len() == 1 { "" } else { "es" },
                        files.len(),
                        if files.len() == 1 { "" } else { "s" },
                        lines.join("\n")
                    )
                };
                Finished::ok(ToolResult::json(&found), vec![text_content(&summary)])
            }
            Err(error) => Finished::failed(error),
        }
    }

    fn landed(&self, path: &str, write: ai_tools::FileWrite) -> Vec<Value> {
        let diff = json!({ "type": "diff", "path": write.path, "oldText": write.previous_content, "newText": write.content });
        if let Some(hook) = &self.agent.on_write {
            hook(crate::review::FileChange { path: write.path.clone(), previous: write.previous_content.clone(), content: Some(write.content.clone()) });
        }
        self.state().read_files.insert(path.to_string(), write.content);
        vec![diff]
    }

    fn edit_file(&self, input: &Value) -> Finished {
        let result = (|| {
            let root = self.root()?;
            let path = input.get("path").and_then(Value::as_str).ok_or("path is required")?;
            let edits: Vec<ai_tools::Replacement> =
                serde_json::from_value(input.get("edits").cloned().unwrap_or_default()).map_err(|error| format!("Invalid edits: {error}"))?;
            let expected = self.state().read_files.get(path).cloned().ok_or("Read this file before editing it.")?;
            let write = ai_tools::edit_file(root, path, &expected, &edits)?;
            Ok::<_, String>((path.to_string(), write))
        })();
        match result {
            Ok((path, write)) => {
                let content = self.landed(&path, write);
                Finished::ok(ToolResult::json(&json!({ "applied": true, "path": path })), content)
            }
            Err(error) => Finished::failed(error),
        }
    }

    fn write_file(&self, input: &Value) -> Finished {
        let result = (|| {
            let root = self.root()?;
            let path = input.get("path").and_then(Value::as_str).ok_or("path is required")?;
            let content = input.get("content").and_then(Value::as_str).ok_or("content is required")?;
            let expected = self.state().read_files.get(path).cloned();
            let write = ai_tools::write_file(root, path, expected.as_deref(), content)?;
            Ok::<_, String>((path.to_string(), write))
        })();
        match result {
            Ok((path, write)) => {
                let created = write.previous_content.is_none();
                let content = self.landed(&path, write);
                Finished::ok(ToolResult::json(&json!({ "written": true, "created": created, "path": path })), content)
            }
            Err(error) => Finished::failed(error),
        }
    }

    async fn delete_file(&self, call: &ToolCall, title: &str) -> Finished {
        let (root, path, expected) = match (|| {
            let root = self.root()?.to_path_buf();
            let path = call.input.get("path").and_then(Value::as_str).ok_or("path is required")?.to_string();
            let expected = self.state().read_files.get(&path).cloned().ok_or("Read this file before deleting it.")?;
            Ok::<_, String>((root, path, expected))
        })() {
            Ok(found) => found,
            Err(error) => return Finished::failed(error),
        };
        let preview = vec![json!({ "type": "diff", "path": self.absolute(&path), "oldText": expected, "newText": "" })];
        let choice = self.ask(&call.id, title, "delete", preview, &[("allow", "Delete", "allow_once"), ("deny", "Keep", "reject_once")]).await;
        if choice.as_deref() != Some("allow") {
            return Finished::declined(ToolResult::json(&json!({ "deleted": false, "reason": "The user declined the deletion." })));
        }
        match ai_tools::delete_file(&root, &path, &expected) {
            Ok(_) => {
                self.state().read_files.remove(&path);
                if let Some(hook) = &self.agent.on_write {
                    hook(crate::review::FileChange { path: PathBuf::from(self.absolute(&path)), previous: Some(expected), content: None });
                }
                Finished::ok(ToolResult::json(&json!({ "deleted": true, "path": path })), Vec::new())
            }
            Err(error) => Finished::failed(error),
        }
    }

    async fn run_command(&self, call: &ToolCall, title: &str) -> Finished {
        let Some(command) = call.input.get("command").and_then(Value::as_str).map(str::to_string) else {
            return Finished::failed("command is required".into());
        };
        let root = match self.root() {
            Ok(root) => root.to_path_buf(),
            Err(_) => self.agent.cwd.clone(),
        };
        let mut prefixes = self.state().allowed_prefixes.clone();
        prefixes.extend(crate::allowlist::commands(&root));
        if !ai_tools::command_auto_approved(&root, &command, &prefixes) {
            let prefix = ai_tools::command_policy::command_allow_prefix(&command);
            let always = prefix.as_ref().map(|prefix| format!("Always allow {prefix}"));
            let mut options = vec![("allow", "Allow", "allow_once")];
            if let Some(always) = &always {
                options.push(("always", always.as_str(), "allow_always"));
            }
            options.push(("deny", "Deny", "reject_once"));
            let choice = self.ask(&call.id, title, "execute", Vec::new(), &options).await;
            match choice.as_deref() {
                Some("allow") => {}
                Some("always") => {
                    if let Some(prefix) = prefix {
                        crate::allowlist::allow_command(&root, &prefix);
                        self.state().allowed_prefixes.push(prefix);
                    }
                }
                _ => return Finished::declined(ToolResult::json(&json!({ "executed": false, "reason": "The user declined the command." }))),
            }
        }
        if self.cancel.is_cancelled() {
            return Finished::failed("Stopped".into());
        }
        let snapshot = ai_tools::workspace_changes::snapshot_workspace(&root).ok();
        let created = self
            .agent
            .rpc
            .request_value(
                "terminal/create",
                json!({ "sessionId": self.session_id, "command": command, "cwd": root, "outputByteLimit": TERMINAL_OUTPUT_BYTES }),
            )
            .await;
        let terminal_id = match created {
            Ok(value) => value.get("terminalId").and_then(Value::as_str).unwrap_or_default().to_string(),
            Err(error) => return Finished::failed(format!("Could not run the command: {error}")),
        };
        self.agent.notify(
            &self.session_id,
            json!({ "sessionUpdate": "tool_call_update", "toolCallId": call.id, "status": "in_progress", "content": [{ "type": "terminal", "terminalId": terminal_id }] }),
        );
        let terminal = json!({ "sessionId": self.session_id, "terminalId": terminal_id });
        let mut timed_out = false;
        let exited = futures::select_biased! {
            exit = self.agent.rpc.request_value("terminal/wait_for_exit", terminal.clone()).fuse() => exit.ok(),
            _ = self.cancel.cancelled().fuse() => None,
            _ = (self.agent.sleep)(COMMAND_TIMEOUT).fuse() => {
                timed_out = true;
                None
            }
        };
        if exited.is_none() {
            let _ = self.agent.rpc.request_value("terminal/kill", terminal.clone()).await;
        }
        let output = self.agent.rpc.request_value("terminal/output", terminal.clone()).await.unwrap_or_default();
        let _ = self.agent.rpc.request_value("terminal/release", terminal).await;
        let text = output.get("output").and_then(Value::as_str).unwrap_or_default().to_string();
        let exit_code = exited
            .as_ref()
            .and_then(|exit| exit.get("exitCode"))
            .or_else(|| output.pointer("/exitStatus/exitCode"))
            .and_then(Value::as_i64);
        let tail_start = text.char_indices().rev().nth(COMMAND_OUTPUT_CHARS).map_or(0, |(index, _)| index);
        let mut result = json!({
            "exitCode": exit_code,
            "output": &text[tail_start..],
            "truncated": tail_start > 0 || output.get("truncated").and_then(Value::as_bool).unwrap_or(false),
            "timedOut": timed_out,
        });
        self.land_command_changes(&root, snapshot, &mut result);
        let mut meta = json!({ "terminal_output": { "terminal_id": terminal_id, "data": text } });
        if let Some(code) = exit_code {
            meta["terminal_exit"] = json!({ "terminal_id": terminal_id, "exit_code": code });
        }
        let status = if exit_code == Some(0) { "completed" } else { "failed" };
        Finished { result: ToolResult::json(&result), status: Some(status), content: Vec::new(), meta: Some(meta), raw_output: None }
    }

    /// Records the files a command changed like the agent's own writes, so they can be reviewed
    /// and a checkpoint restore undoes them. What the model gets back names the files, not their
    /// text.
    fn land_command_changes(&self, root: &Path, snapshot: Option<ai_tools::workspace_changes::WorkspaceSnapshot>, result: &mut Value) {
        let Some(changes) = snapshot.and_then(|snapshot| ai_tools::workspace_changes::diff_workspace(&snapshot).ok()) else {
            result["fileChanges"] = json!("The workspace could not be checked for changes.");
            return;
        };
        let relative = |path: &Path| path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
        for change in &changes.changes {
            if let Some(hook) = &self.agent.on_write {
                hook(crate::review::FileChange { path: change.path.clone(), previous: change.previous_content.clone(), content: change.content.clone() });
            }
        }
        let mut notes: Vec<String> =
            changes.skipped.iter().map(|skipped| format!("{} changed but is not in the review: {}", relative(&skipped.path), skipped.reason)).collect();
        if changes.incomplete {
            notes.push("Some changed files were not checked; the workspace or the change is too large.".into());
        }
        if !changes.changes.is_empty() {
            result["changedFiles"] = json!(changes.changes.iter().map(|change| relative(&change.path)).collect::<Vec<_>>());
        }
        if !notes.is_empty() {
            result["unreviewedChanges"] = json!(notes);
        }
    }

    fn todo_write(&self, input: &Value) -> Finished {
        let todos = input.get("todos").and_then(Value::as_array).cloned().unwrap_or_default();
        let entries: Vec<Value> = todos
            .iter()
            .filter_map(|todo| {
                let content = todo.get("content").and_then(Value::as_str)?;
                let status = match todo.get("status").and_then(Value::as_str) {
                    Some("in_progress") => "in_progress",
                    Some("completed") => "completed",
                    _ => "pending",
                };
                let priority = match todo.get("priority").and_then(Value::as_str) {
                    Some("high") => "high",
                    Some("low") => "low",
                    _ => "medium",
                };
                Some(json!({ "content": content, "status": status, "priority": priority }))
            })
            .collect();
        let completed = entries.iter().filter(|entry| entry["status"] == "completed").count();
        let total = entries.len();
        self.agent.notify(&self.session_id, json!({ "sessionUpdate": "plan", "entries": entries }));
        Finished::ok(ToolResult::json(&json!({ "updated": true, "completed": completed, "total": total })), Vec::new())
    }

    async fn mcp_tool(&self, call: &ToolCall, title: &str) -> Finished {
        let Some((client, tool)) = self.mcp.find(&call.name) else {
            return Finished::failed(format!("The MCP tool {} is not available.", call.name));
        };
        let key = format!("{}/{}", client.name(), tool.name);
        if !self.state().allowed_mcp.contains(&key) && !crate::allowlist::mcp_allowed(client.name(), &tool.name) {
            let input = serde_json::to_string_pretty(&call.input).unwrap_or_default();
            let preview: String = input.chars().take(4000).collect();
            let note = format!(
                "MCP server: {}\nTool: {}\n\nInput:\n```json\n{preview}\n```\n\nMCP tools run outside Athas and can change data or reach the network.",
                client.name(),
                tool.name
            );
            let always = format!("Always allow {}", tool.name);
            let options = [("allow", "Allow", "allow_once"), ("always", always.as_str(), "allow_always"), ("deny", "Deny", "reject_once")];
            match self.ask(&call.id, title, "other", vec![text_content(&note)], &options).await.as_deref() {
                Some("allow") => {}
                Some("always") => {
                    crate::allowlist::allow_mcp(client.name(), &tool.name);
                    self.state().allowed_mcp.insert(key);
                }
                _ => return Finished::declined(ToolResult::error("The user declined the MCP tool call.")),
            }
        }
        let output = futures::select_biased! {
            output = client.call_tool(&tool.name, call.input.clone()).fuse() => output,
            _ = self.cancel.cancelled().fuse() => Err("Stopped".to_string()),
            _ = (self.agent.sleep)(MCP_CALL_TIMEOUT).fuse() => Err(format!("{} did not answer within 2 minutes", client.name())),
        };
        match output {
            Ok(output) => {
                let shown: String = output.content.chars().take(4000).collect();
                let content = vec![text_content(&format!("```\n{shown}\n```"))];
                let result = ToolResult { content: output.content, is_error: output.is_error };
                Finished { status: Some(if result.is_error { "failed" } else { "completed" }), result, content, meta: None, raw_output: None }
            }
            Err(error) => Finished::failed(error),
        }
    }

    /// Asks the user through the client; the chosen option's id, or `None` when declined,
    /// dismissed or stopped.
    async fn ask(&self, tool_call_id: &str, title: &str, kind: &str, content: Vec<Value>, options: &[(&str, &str, &str)]) -> Option<String> {
        let params = json!({
            "sessionId": self.session_id,
            "toolCall": { "toolCallId": tool_call_id, "title": title, "kind": kind, "status": "pending", "content": content },
            "options": options.iter().map(|(id, name, kind)| json!({ "optionId": id, "name": name, "kind": kind })).collect::<Vec<_>>(),
        });
        let answer = futures::select_biased! {
            answer = self.agent.rpc.request_value("session/request_permission", params).fuse() => answer.ok()?,
            _ = self.cancel.cancelled().fuse() => return None,
        };
        let outcome = answer.get("outcome")?;
        (outcome.get("outcome").and_then(Value::as_str) == Some("selected"))
            .then(|| outcome.get("optionId").and_then(Value::as_str).map(str::to_string))
            .flatten()
    }
}

/// The file the user edits and the team's instructions (`_meta.athas`), and the files the prompt
/// attaches.
/// Whether a prompt block's `file://` resource may reach the model under the context policy.
fn context_uri_allowed(uri: &str, policy: &ai_tools::ContextPolicy) -> bool {
    match uri.strip_prefix("file://") {
        Some(path) => policy.allows(Path::new(path.split('#').next().unwrap_or(path)), false),
        None => true,
    }
}

fn request_context(request: &acp::PromptRequest, policy: &ai_tools::ContextPolicy) -> prompt::RequestContext {
    let athas = request.meta.as_ref().and_then(|meta| meta.get("athas"));
    let active_file = athas.and_then(|athas| athas.get("activeFile")).and_then(Value::as_str).map(PathBuf::from).filter(|path| policy.allows(path, false));
    let team_instructions = athas.and_then(|athas| athas.get("teamInstructions")).and_then(Value::as_str).map(str::to_string);
    let file_path = |uri: &str| uri.strip_prefix("file://").map(|path| PathBuf::from(path.split('#').next().unwrap_or(path)));
    // Editor files the message attaches as open tabs or selections (`openBuffers`).
    let open_buffers = athas.and_then(|athas| athas.get("openBuffers")).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(PathBuf::from);
    let context_paths = request
        .prompt
        .iter()
        .filter_map(|block| match block {
            acp::ContentBlock::ResourceLink(link) => file_path(&link.uri),
            acp::ContentBlock::Resource(resource) => match &resource.resource {
                acp::EmbeddedResourceResource::TextResourceContents(contents) => file_path(&contents.uri),
                _ => None,
            },
            _ => None,
        })
        .chain(open_buffers)
        .filter(|path| policy.allows(path, false))
        .fold(Vec::new(), |mut paths: Vec<PathBuf>, path| {
            if !paths.contains(&path) {
                paths.push(path);
            }
            paths
        });
    let active_language = athas.and_then(|athas| athas.get("activeFileLanguage")).and_then(Value::as_str).map(str::to_string);
    let active_dirty = athas.and_then(|athas| athas.get("activeFileDirty")).and_then(Value::as_bool).unwrap_or(false);
    prompt::RequestContext { active_file, active_language, active_dirty, context_paths, team_instructions }
}

/// The extractive summary of the turns a fitted request leaves out.
fn summarize_messages(messages: &[Message]) -> String {
    let texts: Vec<(bool, String)> = messages.iter().filter(|message| message.role != Role::Tool).map(|message| (message.role == Role::User, message.text())).collect();
    let borrowed: Vec<(bool, &str)> = texts.iter().map(|(user, text)| (*user, text.as_str())).collect();
    crate::compaction::summarize(&borrowed)
}

/// A fence longer than any run of backticks in `content` (`codeFence`).
fn code_fence(content: &str) -> String {
    let mut longest = 2;
    let mut run = 0;
    for char in content.chars() {
        run = if char == '`' { run + 1 } else { 0 };
        longest = longest.max(run);
    }
    "`".repeat(longest + 1)
}
