//! Codex, through its own app-server protocol rather than ACP: `codex app-server` speaks
//! JSON-RPC on stdio with native threads, approvals, skills and review. [`server`] puts an ACP
//! face on it in-process, as the built-in agent does, so a session runs Codex like any other agent.
//!
//! Ported from Athas's `crates/ai/src/codex/*` and `features/ai/integrations/codex/*`.

pub mod probe;
mod server;

#[cfg(test)]
mod tests;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

pub use server::{CodexConfig, HostCall, HostCalls, serve};

/// The agent id Codex sessions carry. `codex-acp` is the ACP adapter, a different agent.
pub const AGENT_ID: &str = "codex";
pub const NAME: &str = "Codex";
pub const BINARY: &str = "codex";
pub const ARGS: &[&str] = &["app-server", "--listen", "stdio://"];
pub const INSTALL_HINT: &str = "npm install -g @openai/codex";

pub const OPEN_PULL_REQUEST_TOOL: &str = "athas_open_pull_request";
pub const OPEN_ISSUE_TOOL: &str = "athas_open_issue";
pub const SET_CHAT_TITLE_TOOL: &str = "athas_set_chat_title";
pub const BROWSER_TOOL: &str = "athas_browser";

/// The bridge's extension method listing Codex's own skills (`skills/list`).
pub const SKILLS_METHOD: &str = "_athas/codex_skills";

/// The bridge's extension method reading Codex's models again (`model/list`), answering with the
/// session's config options.
pub const MODELS_METHOD: &str = "_athas/codex_models";

/// How long a models read stays fresh (`CATALOG_STALE_MS`), and how long Codex gets to answer a
/// catalog read (`withCatalogTimeout`).
pub const CATALOG_STALE: std::time::Duration = std::time::Duration::from_secs(30);
pub const CATALOG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
pub const CATALOG_TIMEOUT_MESSAGE: &str = "Codex took too long to respond. Try again.";

static CATALOG_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Which catalog the models and skills sessions read belong to; signing out starts a new one.
pub fn catalog_generation() -> u64 {
    CATALOG_GENERATION.load(std::sync::atomic::Ordering::Relaxed)
}

/// Drops every catalog read (`clearCodexCatalog`), so a signed-out account's models and skills
/// are read again rather than shown.
pub fn clear_catalog() {
    CATALOG_GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}

/// A skill Codex knows, attached to a prompt as `$name`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexSkill {
    pub name: String,
    pub description: String,
    pub path: String,
    pub scope: String,
    pub enabled: bool,
}

/// Codex's `skills/list` answer: its skills, each once, and the errors of skills it could not
/// load (`normalizeCodexSkills`).
pub fn normalize_skills(value: &Value) -> (Vec<CodexSkill>, Vec<String>) {
    let text = |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_string();
    let mut skills = Vec::new();
    let mut errors = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for entry in value.get("data").and_then(Value::as_array).into_iter().flatten() {
        for skill in entry.get("skills").and_then(Value::as_array).into_iter().flatten() {
            let (name, path) = (text(skill, "name"), text(skill, "path"));
            let key = if path.is_empty() { name.clone() } else { path.clone() };
            if name.is_empty() || !seen.insert(key) {
                continue;
            }
            let description = Some(text(skill, "description")).filter(|description| !description.is_empty()).unwrap_or_else(|| text(skill, "shortDescription"));
            skills.push(CodexSkill { name, description, path, scope: text(skill, "scope"), enabled: skill.get("enabled").and_then(Value::as_bool) != Some(false) });
        }
        for error in entry.get("errors").and_then(Value::as_array).into_iter().flatten() {
            let message = text(error, "message");
            if !message.is_empty() {
                errors.push(message);
            }
        }
    }
    (skills, errors)
}

pub fn is_codex(agent: &str) -> bool {
    agent == AGENT_ID
}

/// What a thread and its turns start with (`athas-codex-integration-settings`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CodexSettings {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub personality: Option<String>,
    pub approval_policy: Option<String>,
    pub sandbox: Option<String>,
    pub developer_instructions: Option<String>,
    pub service_tier: Option<String>,
    pub collaboration_mode: Option<String>,
}

impl Default for CodexSettings {
    fn default() -> Self {
        Self {
            model: None,
            effort: Some("medium".into()),
            personality: None,
            approval_policy: Some("on-request".into()),
            sandbox: Some("workspace-write".into()),
            developer_instructions: None,
            service_tier: None,
            collaboration_mode: Some("default".into()),
        }
    }
}

pub const SANDBOX_OPTIONS: &[(&str, &str)] = &[("read-only", "Read only"), ("workspace-write", "Workspace write"), ("danger-full-access", "Full access")];
pub const APPROVAL_OPTIONS: &[(&str, &str)] = &[("on-request", "Ask when needed"), ("untrusted", "Untrusted commands"), ("never", "Never ask")];

/// The `codex` program on the search path.
#[cfg(not(target_family = "wasm"))]
pub fn resolve() -> Option<PathBuf> {
    crate::acp::agents::find_on_path(BINARY, &crate::acp::agents::search_path())
}

pub fn is_installed() -> bool {
    #[cfg(not(target_family = "wasm"))]
    {
        resolve().is_some()
    }
    #[cfg(target_family = "wasm")]
    {
        false
    }
}

fn settings_path() -> Option<PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    {
        dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("codex.json"))
    }
    #[cfg(target_family = "wasm")]
    {
        None
    }
}

impl CodexSettings {
    pub fn load() -> Self {
        settings_path().and_then(|path| std::fs::read_to_string(path).ok()).and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
    }

    pub fn save(&self) {
        let Some(path) = settings_path() else { return };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_vec_pretty(self) {
            let _ = std::fs::write(path, text);
        }
    }
}

fn insert_optional(params: &mut Map<String, Value>, key: &str, value: Option<&String>) {
    if let Some(value) = value {
        params.insert(key.to_string(), json!(value));
    }
}

pub(crate) fn apply_thread_settings(params: &mut Map<String, Value>, settings: &CodexSettings) {
    insert_optional(params, "model", settings.model.as_ref());
    insert_optional(params, "personality", settings.personality.as_ref());
    insert_optional(params, "approvalPolicy", settings.approval_policy.as_ref());
    insert_optional(params, "sandbox", settings.sandbox.as_ref());
    insert_optional(params, "developerInstructions", settings.developer_instructions.as_ref());
    insert_optional(params, "serviceTier", settings.service_tier.as_ref());
}

pub(crate) fn apply_turn_settings(params: &mut Map<String, Value>, settings: &CodexSettings) {
    insert_optional(params, "model", settings.model.as_ref());
    insert_optional(params, "effort", settings.effort.as_ref());
    insert_optional(params, "personality", settings.personality.as_ref());
    insert_optional(params, "approvalPolicy", settings.approval_policy.as_ref());
    insert_optional(params, "serviceTier", settings.service_tier.as_ref());
    if let Some(mode) = settings.collaboration_mode.as_deref() {
        params.insert(
            "collaborationMode".to_string(),
            json!({
                "mode": mode,
                "settings": {
                    "model": settings.model.as_deref().unwrap_or("gpt-5.6-sol"),
                    "reasoning_effort": settings.effort,
                }
            }),
        );
    }
}

/// The host tools Codex may call: open a pull request or issue as a tab, the hosted browser, and
/// naming the chat.
pub fn dynamic_tools(browser: Option<Value>) -> Value {
    let mut tools = vec![
        json!({
            "type": "function",
            "name": OPEN_PULL_REQUEST_TOOL,
            "description": "Open a GitHub pull request as a native editor tab in Athas. After creating a pull request for the current workspace, call this tool before finishing instead of only returning its web link.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "number": { "type": "integer", "minimum": 1, "description": "The GitHub pull request number" },
                    "title": { "type": "string", "description": "The pull request title, when known" }
                },
                "required": ["number"],
                "additionalProperties": false
            }
        }),
        json!({
            "type": "function",
            "name": OPEN_ISSUE_TOOL,
            "description": "Open a GitHub issue as a native editor tab in Athas. After creating an issue for the current workspace, call this tool before finishing instead of only returning its web link or opening the system browser.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "number": { "type": "integer", "minimum": 1, "description": "The GitHub issue number" },
                    "title": { "type": "string", "description": "The issue title, when known" }
                },
                "required": ["number"],
                "additionalProperties": false
            }
        }),
    ];
    tools.extend(browser);
    tools.push(json!({
        "type": "function",
        "name": SET_CHAT_TITLE_TOOL,
        "description": "Rename the current Athas chat. On the first turn of a newly started Athas conversation, call this exactly once with a concise title inferred from the user's request.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": { "type": "string", "minLength": 1, "maxLength": 80, "description": "A concise title, preferably one to four words" }
            },
            "required": ["title"],
            "additionalProperties": false
        }
    }));
    Value::Array(tools)
}

pub(crate) fn apply_athas_developer_instructions(params: &mut Map<String, Value>) {
    let host_instructions = "On the first turn of a newly started Athas conversation, infer a concise one-to-four-word \
title from the user's request and MUST call athas_set_chat_title exactly once before the \
final response. Opening the native Athas tab is a required final step of GitHub pull \
request and issue creation workflows. Whenever you successfully create a pull request or \
issue for the current workspace, you MUST immediately call the matching Athas dynamic tool \
before your final response without waiting for the user to ask. Also call the matching \
tool whenever the user asks to open one. Never open supported GitHub resources in the \
system browser.";
    let instructions = params
        .get("developerInstructions")
        .and_then(Value::as_str)
        .map(|current| format!("{current}\n\n{host_instructions}"))
        .unwrap_or_else(|| host_instructions.to_string());
    params.insert("developerInstructions".to_string(), json!(instructions));
}

/// A tool's answer, as Codex takes it.
pub(crate) fn tool_result(text: impl Into<String>, success: bool) -> Value {
    json!({ "contentItems": [{ "type": "inputText", "text": text.into() }], "success": success })
}

/// What `athas_set_chat_title` asks for: the cleaned title, or why it can't be used.
pub(crate) fn chat_title(args: &Value) -> Result<String, &'static str> {
    let title = args.get("title").and_then(Value::as_str).unwrap_or_default();
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err("A chat title is required.");
    }
    Ok(title.chars().take(80).collect())
}

/// The pull request or issue number `athas_open_*` asks for.
pub(crate) fn resource_number(args: &Value, resource: &str) -> Result<(u64, Option<String>), String> {
    let Some(input) = args.as_object() else { return Err(format!("A {resource} number is required.")) };
    let number = input.get("number").and_then(Value::as_u64).filter(|number| *number >= 1);
    let Some(number) = number else { return Err(format!("The {resource} number must be a positive integer.")) };
    let title = input.get("title").and_then(Value::as_str).map(str::trim).filter(|title| !title.is_empty()).map(str::to_string);
    Ok((number, title))
}

/// A model `model/list` offers.
#[derive(Clone, Debug, PartialEq)]
pub struct CodexModel {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub default_effort: String,
    pub efforts: Vec<String>,
    /// What the model is for, shown beside it in the model menu.
    pub description: String,
    /// Each effort's explanation (`supportedReasoningEfforts[].description`), by effort.
    pub effort_descriptions: Vec<(String, String)>,
}

pub fn normalize_models(value: &Value) -> Vec<CodexModel> {
    let data = value.get("data").or_else(|| value.get("models")).and_then(Value::as_array).cloned().unwrap_or_default();
    data.iter()
        .filter_map(|model| {
            let id = model.get("model").or_else(|| model.get("id")).and_then(Value::as_str).filter(|id| !id.is_empty())?;
            if model.get("hidden").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let name = model.get("displayName").or_else(|| model.get("name")).and_then(Value::as_str).filter(|name| !name.is_empty()).unwrap_or(id);
            let supported: Vec<(String, String)> = model
                .get("supportedReasoningEfforts")
                .and_then(Value::as_array)
                .map(|efforts| {
                    efforts
                        .iter()
                        .filter_map(|effort| {
                            let value = effort.get("reasoningEffort").and_then(Value::as_str).filter(|value| !value.is_empty())?;
                            let label = effort.get("description").and_then(Value::as_str).filter(|label| !label.is_empty()).unwrap_or(value);
                            Some((value.to_string(), label.to_string()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let efforts = supported.iter().map(|(value, _)| value.clone()).collect();
            Some(CodexModel {
                id: id.to_string(),
                name: name.to_string(),
                is_default: model.get("isDefault").and_then(Value::as_bool) == Some(true),
                default_effort: model.get("defaultReasoningEffort").and_then(Value::as_str).unwrap_or_default().to_string(),
                efforts,
                description: model.get("description").and_then(Value::as_str).unwrap_or_default().to_string(),
                effort_descriptions: supported,
            })
        })
        .collect()
}

/// Threads listed for importing, at most (`CODEX_THREAD_LIMIT`).
pub const THREAD_LIMIT: usize = 50;

/// `thread/list` threads as ACP session infos: the name, else the preview's first line, as the
/// title, and the update time (seconds) as ISO 8601.
pub fn threads_as_sessions(value: &Value, cwd: &str) -> Vec<Value> {
    let data = value.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
    data.iter()
        .filter_map(|thread| {
            let id = thread.get("id").and_then(Value::as_str).filter(|id| !id.is_empty())?;
            let name = thread.get("name").and_then(Value::as_str).map(str::trim).unwrap_or_default();
            let preview = thread.get("preview").and_then(Value::as_str).map(str::trim).unwrap_or_default().lines().next().unwrap_or_default();
            let title = if !name.is_empty() { name } else if !preview.is_empty() { preview } else { "Codex thread" };
            let updated_at = thread
                .get("updatedAt")
                .and_then(Value::as_f64)
                .and_then(|seconds| chrono::DateTime::from_timestamp(seconds as i64, 0))
                .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
            let cwd = thread.get("cwd").and_then(Value::as_str).filter(|cwd| !cwd.is_empty()).unwrap_or(cwd);
            Some(serde_json::json!({ "sessionId": id, "cwd": cwd, "title": title, "updatedAt": updated_at }))
        })
        .collect()
}

/// A `thread/read` answer with its turns as the ACP updates a session load replays
/// (`codex-thread-history.ts`): each user message on its own, and a turn's agent messages joined
/// into the answer after it. Tool calls, reasoning and file changes stay in the thread.
pub fn thread_history_updates(value: &Value) -> Vec<Value> {
    let turns = value.pointer("/thread/turns").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut updates = Vec::new();
    for turn in &turns {
        let mut answer: Vec<&str> = Vec::new();
        for item in turn.get("items").and_then(Value::as_array).into_iter().flatten() {
            match item.get("type").and_then(Value::as_str) {
                Some("userMessage") => {
                    let text: Vec<&str> = item
                        .get("content")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                        .filter_map(|part| part.get("text").and_then(Value::as_str))
                        .filter(|text| !text.is_empty())
                        .collect();
                    if !text.is_empty() {
                        updates.push(serde_json::json!({ "sessionUpdate": "user_message_chunk", "content": { "type": "text", "text": text.join("\n\n") } }));
                    }
                }
                Some("agentMessage") => {
                    if let Some(text) = item.get("text").and_then(Value::as_str).filter(|text| !text.is_empty()) {
                        answer.push(text);
                    }
                }
                _ => {}
            }
        }
        if !answer.is_empty() {
            updates.push(serde_json::json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": answer.join("\n\n") } }));
        }
    }
    updates
}

/// The effort to keep when switching to `model`: the current one if it supports it, else its
/// default, else its first.
pub fn effort_for_model(model: &CodexModel, current: Option<&str>) -> Option<String> {
    current
        .filter(|effort| model.efforts.iter().any(|candidate| candidate == effort))
        .map(str::to_string)
        .or_else(|| model.efforts.iter().find(|effort| **effort == model.default_effort).cloned())
        .or_else(|| model.efforts.first().cloned())
}

/// The old and new text of a unified diff's hunks.
fn hunks_to_texts(diff: &str) -> (String, String) {
    let mut old_lines = Vec::new();
    let mut new_lines = Vec::new();
    let mut in_hunk = false;
    for line in diff.split('\n') {
        if line.starts_with("@@") {
            in_hunk = true;
            continue;
        }
        if !in_hunk || line.starts_with('\\') {
            continue;
        }
        if let Some(added) = line.strip_prefix('+') {
            new_lines.push(added);
        } else if let Some(removed) = line.strip_prefix('-') {
            old_lines.push(removed);
        } else {
            let context = line.strip_prefix(' ').unwrap_or(line);
            old_lines.push(context);
            new_lines.push(context);
        }
    }
    (old_lines.join("\n"), new_lines.join("\n"))
}

/// The files a `fileChange` item changed, as `(path, old text, new text)`. Codex sends a unified
/// diff for an update and the whole file for an added or deleted one.
pub fn file_change_diffs(item: &Value) -> Vec<(String, String, String)> {
    if item.get("type").and_then(Value::as_str) != Some("fileChange") {
        return Vec::new();
    }
    let Some(changes) = item.get("changes").and_then(Value::as_array) else { return Vec::new() };
    changes
        .iter()
        .filter_map(|change| {
            let path = change.get("path").and_then(Value::as_str)?.to_string();
            let diff = change.get("diff").and_then(Value::as_str).unwrap_or_default();
            let kind = match change.get("kind") {
                Some(Value::String(kind)) => kind.as_str(),
                Some(kind) => kind.get("type").and_then(Value::as_str).unwrap_or("update"),
                None => "update",
            };
            let whole = !diff.contains("\n@@");
            Some(match kind {
                "add" if whole => (path, String::new(), diff.to_string()),
                "delete" if whole => (path, diff.to_string(), String::new()),
                _ => {
                    let (old, new) = hunks_to_texts(diff);
                    (path, old, new)
                }
            })
        })
        .collect()
}

/// Item types Codex reports as tool calls.
const TOOL_ITEM_TYPES: &[&str] = &[
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabAgentToolCall",
    "subAgentActivity",
    "webSearch",
    "imageView",
    "sleep",
    "imageGeneration",
];

pub(crate) fn is_tool_item(item: &Value) -> bool {
    item.get("type").and_then(Value::as_str).is_some_and(|kind| TOOL_ITEM_TYPES.contains(&kind))
}

/// A tool item's title in the transcript.
pub(crate) fn item_title(item: &Value) -> String {
    if item.get("type").and_then(Value::as_str) == Some("fileChange") {
        let paths: Vec<String> = file_change_diffs(item)
            .into_iter()
            .map(|(path, ..)| std::path::Path::new(&path).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or(path))
            .collect();
        if !paths.is_empty() {
            return format!("Edit {}", paths.join(", "));
        }
    }
    ["command", "tool", "name", "type"]
        .iter()
        .find_map(|key| item.get(*key).and_then(Value::as_str).filter(|text| !text.is_empty()))
        .unwrap_or("Codex tool")
        .to_string()
}

pub(crate) fn item_kind(item: &Value) -> &'static str {
    match item.get("type").and_then(Value::as_str) {
        Some("fileChange") => "edit",
        Some("commandExecution") => "execute",
        Some("webSearch") => "fetch",
        _ => "other",
    }
}

/// The hosted browser, which `browser_view` provides: its tool definition and a run of one call
/// (`arguments`, call id, chat id) that answers `(success, text)`.
pub struct BrowserHook {
    pub definition: Value,
    pub run: std::rc::Rc<dyn Fn(Value, String, Option<String>, &mut gpui::App) -> gpui::Task<(bool, String)>>,
}

impl gpui::Global for BrowserHook {}

/// Offers Codex the hosted browser; the workbench calls this at start-up.
pub fn set_browser_hook(hook: BrowserHook, cx: &mut gpui::App) {
    cx.set_global(hook);
}

#[cfg_attr(target_family = "wasm", allow(dead_code))]
pub(crate) fn browser_tool(cx: &gpui::App) -> Option<Value> {
    cx.try_global::<BrowserHook>().map(|hook| hook.definition.clone())
}

#[cfg_attr(target_family = "wasm", allow(dead_code))]
pub(crate) fn run_browser_tool(arguments: Value, call_id: String, chat_id: Option<String>, cx: &mut gpui::App) -> gpui::Task<Value> {
    let Some(run) = cx.try_global::<BrowserHook>().map(|hook| hook.run.clone()) else {
        return gpui::Task::ready(tool_result("Athas Browser is unavailable.", false));
    };
    let task = run(arguments, call_id, chat_id, cx);
    cx.spawn(async move |_| {
        let (success, text) = task.await;
        tool_result(text, success)
    })
}
