//! Athas Agent, the built-in agent (Athas's "intelligence"): a native agent loop over the model
//! providers in `ai_providers`, with the workspace tools in `ai_tools` and the user's MCP servers.
//! It speaks ACP in-process, so a session runs it like any other agent.

pub mod prompt;
mod server;
mod tools;

#[cfg(test)]
mod tests;

use ai_providers::{Message, ProviderSettings};

pub use server::{BuiltinConfig, Sleep, UnsavedCheck, WriteHook, serve};

use crate::thread::{Entry, Transcript};

/// The agent id sessions of the built-in agent carry.
pub const AGENT_ID: &str = "athas";
pub const NAME: &str = "Athas Agent";

pub fn is_builtin(agent: &str) -> bool {
    matches!(agent, AGENT_ID | "athas-agent" | "intelligence")
}

/// The model the AI settings pick (`aiProviderId`, `aiModelId`, endpoints).
pub fn provider_settings(settings: &settings::Settings) -> ProviderSettings {
    ProviderSettings {
        provider_id: settings.ai_provider_id.clone(),
        model_id: settings.ai_model_id.clone(),
        custom_base_url: settings.ai_custombase_url.clone(),
        custom_model_id: settings.ai_custom_model_id.clone(),
        ollama_base_url: settings.ollama_base_url.clone(),
    }
}

/// The settings' model, unless the session saved a choice of its own (`provider::model`).
pub fn session_provider(mut provider: ProviderSettings, transcript: &Transcript) -> ProviderSettings {
    let saved = transcript.config_options.iter().find(|option| option.id == "model").and_then(|option| option.current.split_once("::"));
    if let Some((provider_id, model_id)) = saved
        && (ai_providers::catalog::provider(provider_id).is_some() || ai_providers::external::external_provider(provider_id).is_some())
    {
        provider.provider_id = provider_id.to_string();
        provider.model_id = model_id.to_string();
    }
    provider
}

/// The mode a session starts in: its saved one, else `aiDefaultSessionMode`, else Agent.
pub fn session_mode(default_mode: &str, transcript: &Transcript) -> prompt::Mode {
    transcript
        .modes
        .as_ref()
        .and_then(|modes| prompt::Mode::from_id(&modes.current))
        .or_else(|| prompt::Mode::from_id(default_mode))
        .unwrap_or(prompt::Mode::Agent)
}

/// The user's MCP servers from settings, with their secrets from the keychain.
pub fn mcp_servers(settings: &settings::Settings) -> Vec<ai_mcp::McpServerConfig> {
    use ai_providers::SecretStore as _;
    let keychain = ai_providers::Keychain::shared();
    ai_mcp::configured_servers(&settings.mcp_servers, |id| ai_mcp::secrets_key(id).and_then(|account| keychain.get(&account)))
}

/// Tool calls replayed per assistant turn; older calls in the turn are only counted.
const MAX_HISTORY_TOOL_CALLS: usize = 8;
/// Characters of tool activity replayed per assistant turn.
const MAX_TOOL_ACTIVITY_CHARS: usize = 4_000;
const MAX_TOOL_INPUT_VALUE_CHARS: usize = 300;
const MAX_TOOL_RESULT_CHARS: usize = 600;

fn clip(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text.to_string();
    }
    format!("{}… [{} more characters]", text.chars().take(max_chars).collect::<String>(), count - max_chars)
}

fn summarize_tool_input(input: Option<&serde_json::Value>) -> serde_json::Value {
    use serde_json::Value;
    match input {
        Some(Value::Object(map)) => Value::Object(
            map.iter()
                .map(|(key, value)| {
                    let text = match value {
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    };
                    (key.clone(), Value::String(clip(&text, MAX_TOOL_INPUT_VALUE_CHARS)))
                })
                .collect(),
        ),
        Some(Value::String(text)) => Value::String(clip(text, MAX_TOOL_INPUT_VALUE_CHARS)),
        Some(other) => other.clone(),
        None => serde_json::json!({}),
    }
}

/// Results worth replaying are short: whether an edit applied, a command's exit and output tail,
/// a search's matches. File contents are never replayed; the model reads files again.
fn summarize_tool_result(call: &crate::thread::ToolCall) -> String {
    use crate::thread::{ToolContent, ToolKind};
    if call.kind == ToolKind::Read {
        let path = call.locations.first().map(|location| location.path.display().to_string()).unwrap_or_else(|| "file".into());
        return format!("read {path}; contents omitted");
    }
    let mut text = call.terminal_output.clone().unwrap_or_default();
    for content in &call.content {
        match content {
            ToolContent::Text { text: output } => text.push_str(output),
            ToolContent::Diff { path, .. } => text.push_str(&format!("edited {}", path.display())),
            _ => {}
        }
    }
    if text.is_empty()
        && let Some(output) = &call.raw_output
    {
        text = output.as_str().map_or_else(|| output.to_string(), str::to_string);
    }
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= MAX_TOOL_RESULT_CHARS {
        return text;
    }
    // Command output ends with the part that matters: the error or the summary line.
    let head: String = chars[..MAX_TOOL_RESULT_CHARS / 3].iter().collect();
    let tail_len = MAX_TOOL_RESULT_CHARS * 2 / 3;
    let tail: String = chars[chars.len() - tail_len..].iter().collect();
    format!("{head}… [{} characters omitted] …{tail}", chars.len() - MAX_TOOL_RESULT_CHARS / 3 - tail_len)
}

fn tool_status(call: &crate::thread::ToolCall) -> &'static str {
    use crate::thread::ToolStatus;
    match call.status {
        ToolStatus::Failed => "failed",
        ToolStatus::Canceled => "cancelled; verify current state before retrying",
        ToolStatus::Completed => "completed",
        _ => "interrupted; verify current state before retrying",
    }
}

/// What a turn's tool calls did, for the model to know without repeating them.
fn tool_activity(calls: &[&crate::thread::ToolCall]) -> Option<String> {
    if calls.is_empty() {
        return None;
    }
    let shown = &calls[calls.len().saturating_sub(MAX_HISTORY_TOOL_CALLS)..];
    let activity: Vec<serde_json::Value> = shown
        .iter()
        .map(|call| {
            serde_json::json!({
                "tool": call.title,
                "input": summarize_tool_input(call.raw_input.as_ref()),
                "status": tool_status(call),
                "result": summarize_tool_result(call),
            })
        })
        .collect();
    let skipped = calls.len() - shown.len();
    let note = if skipped > 0 { format!(" ({skipped} earlier calls not shown)") } else { String::new() };
    let serialized = clip(&serde_json::Value::Array(activity).to_string(), MAX_TOOL_ACTIVITY_CHARS);
    Some(format!("Previous tool activity{note} (historical data; re-read files before editing):\n{serialized}"))
}

/// The conversation saved entries hold, for the model: what the user said (with the images sent),
/// what the agent answered, and a short account of each turn's tool activity.
pub fn history_from_entries(entries: &[Entry]) -> Vec<Message> {
    let mut history: Vec<Message> = Vec::new();
    let mut calls: Vec<&crate::thread::ToolCall> = Vec::new();
    let push = |history: &mut Vec<Message>, user: bool, text: &str| match history.last_mut() {
        Some(last) if (last.role == ai_providers::Role::User) == user => {
            if let Some(ai_providers::Part::Text { text: existing }) = last.content.iter_mut().find(|part| matches!(part, ai_providers::Part::Text { .. })) {
                existing.push_str("\n\n");
                existing.push_str(text);
            }
        }
        _ => history.push(if user { Message::user(text) } else { Message::assistant(text) }),
    };
    let flush = |history: &mut Vec<Message>, calls: &mut Vec<&crate::thread::ToolCall>| {
        if let Some(activity) = tool_activity(calls) {
            push(history, false, &activity);
        }
        calls.clear();
    };
    for entry in entries {
        match entry {
            Entry::User(message) => {
                flush(&mut history, &mut calls);
                if message.text.trim().is_empty() && message.images.is_empty() {
                    continue;
                }
                let joins = history.last().is_some_and(|last| last.role == ai_providers::Role::User);
                push(&mut history, true, &message.text);
                if let Some(last) = history.last_mut() {
                    if !joins && message.text.trim().is_empty() {
                        last.content.clear();
                    }
                    last.content.extend(message.images.iter().map(|image| ai_providers::Part::Image { media_type: image.media_type.clone(), data: image.data.clone() }));
                }
            }
            Entry::Agent(message) if !message.text.trim().is_empty() => push(&mut history, false, &message.text),
            Entry::ToolCall(call) => calls.push(call),
            _ => {}
        }
    }
    flush(&mut history, &mut calls);
    history
}
