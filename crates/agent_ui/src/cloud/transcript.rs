//! What a cloud run's log reads as: the agent's words, its tool calls and its plan. Claude Code
//! and Codex write one JSON event per line on stdout; Athas's own lines (cloning, pushing,
//! opening the pull request) come on the system stream.
//!
//! Ported from Athas's `cloud-agents/services/cloud-run-transcript.ts`.

use std::collections::HashMap;

use serde_json::{Map, Value, json};

use super::api::LogLine;
use crate::thread::PlanStatus;

const MAX_OUTPUT_CHARS: usize = 4000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CallStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CloudToolCall {
    pub id: String,
    pub name: String,
    /// `execute`, `edit` or `fetch` when the event says what kind of call it is.
    pub kind: Option<&'static str>,
    pub input: Map<String, Value>,
    pub status: CallStatus,
    pub output: String,
    pub started_at: u64,
    pub duration_ms: Option<u64>,
}

impl CloudToolCall {
    /// The command, file or pattern the call worked on.
    pub fn detail(&self) -> Option<&str> {
        ["command", "file_path", "path", "pattern", "query", "description"]
            .iter()
            .find_map(|key| self.input.get(*key).and_then(Value::as_str).filter(|value| !value.trim().is_empty()))
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CloudTranscript {
    pub content: String,
    pub tool_calls: Vec<CloudToolCall>,
    pub plan: Option<Vec<(String, PlanStatus)>>,
    /// The sandbox's latest progress line, such as cloning or opening the pull request.
    pub status: Option<String>,
}

fn text(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|text| !text.trim().is_empty())
}

fn clip(output: &str) -> String {
    let count = output.chars().count();
    if count > MAX_OUTPUT_CHARS { format!("…{}", output.chars().skip(count - MAX_OUTPUT_CHARS).collect::<String>()) } else { output.to_string() }
}

fn tool_result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts.iter().filter_map(|part| part.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

fn read_todos(todos: Option<&Value>) -> Option<Vec<(String, PlanStatus)>> {
    let entries: Vec<(String, PlanStatus)> = todos?
        .as_array()?
        .iter()
        .filter_map(|todo| {
            let content = text(todo.get("content")).or_else(|| text(todo.get("text")))?;
            let status = match todo.get("completed").and_then(Value::as_bool) {
                Some(true) => PlanStatus::Completed,
                Some(false) => PlanStatus::Pending,
                None => match todo.get("status").and_then(Value::as_str) {
                    Some("completed") => PlanStatus::Completed,
                    Some("in_progress") => PlanStatus::InProgress,
                    _ => PlanStatus::Pending,
                },
            };
            Some((content.to_string(), status))
        })
        .collect();
    (!entries.is_empty()).then_some(entries)
}

#[derive(Default)]
struct Builder {
    transcript: CloudTranscript,
    by_id: HashMap<String, usize>,
}

impl Builder {
    fn append_text(&mut self, value: &str) {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return;
        }
        let content = &mut self.transcript.content;
        if !content.is_empty() {
            content.push_str("\n\n");
        }
        content.push_str(trimmed);
    }

    fn upsert_tool(&mut self, id: &str, at: u64, name: String, kind: Option<&'static str>, input: Map<String, Value>) {
        if let Some(&index) = self.by_id.get(id) {
            let call = &mut self.transcript.tool_calls[index];
            call.name = name;
            call.input = input;
            if kind.is_some() {
                call.kind = kind;
            }
            return;
        }
        self.by_id.insert(id.to_string(), self.transcript.tool_calls.len());
        self.transcript.tool_calls.push(CloudToolCall { id: id.to_string(), name, kind, input, status: CallStatus::InProgress, output: String::new(), started_at: at, duration_ms: None });
    }

    fn finish_tool(&mut self, id: &str, output: &str, failed: bool, at: u64) {
        let Some(&index) = self.by_id.get(id) else { return };
        let call = &mut self.transcript.tool_calls[index];
        call.output = clip(output);
        call.status = if failed { CallStatus::Failed } else { CallStatus::Completed };
        call.duration_ms = Some(at.saturating_sub(call.started_at));
    }

    fn line(&mut self, index: usize, line: &LogLine) {
        if line.stream == "system" {
            if !line.text.trim().is_empty() {
                self.transcript.status = Some(line.text.trim().to_string());
            }
            return;
        }
        if line.stream != "stdout" {
            return;
        }
        let Ok(event) = serde_json::from_str::<Value>(&line.text) else { return };
        let Some(kind) = event.get("type").and_then(Value::as_str) else { return };
        let parts = || event.pointer("/message/content").and_then(Value::as_array).cloned().unwrap_or_default();
        match kind {
            "assistant" => {
                for part in parts() {
                    match part.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            if let Some(text) = part.get("text").and_then(Value::as_str) {
                                self.append_text(text);
                            }
                        }
                        Some("tool_use") => {
                            let Some(name) = part.get("name").and_then(Value::as_str) else { continue };
                            let id = part.get("id").and_then(Value::as_str).map_or_else(|| format!("tool-{index}"), str::to_string);
                            let input = part.get("input").and_then(Value::as_object).cloned().unwrap_or_default();
                            if name == "TodoWrite" {
                                if let Some(plan) = read_todos(input.get("todos")) {
                                    self.transcript.plan = Some(plan);
                                }
                                continue;
                            }
                            self.upsert_tool(&id, line.at, name.to_string(), None, input);
                        }
                        _ => {}
                    }
                }
            }
            "user" => {
                for part in parts() {
                    if part.get("type").and_then(Value::as_str) != Some("tool_result") {
                        continue;
                    }
                    let Some(id) = part.get("tool_use_id").and_then(Value::as_str) else { continue };
                    self.finish_tool(id, &tool_result_text(part.get("content")), part.get("is_error") == Some(&Value::Bool(true)), line.at);
                }
            }
            "result" => {
                if let Some(result) = text(event.get("result"))
                    && !self.transcript.content.ends_with(result.trim())
                {
                    self.append_text(result);
                }
            }
            "item.started" | "item.updated" | "item.completed" => {
                let Some(item) = event.get("item") else { return };
                let id = item.get("id").and_then(Value::as_str).map_or_else(|| format!("item-{index}"), str::to_string);
                let done = kind == "item.completed";
                let failed_status = item.get("status").and_then(Value::as_str) == Some("failed");
                match item.get("type").and_then(Value::as_str) {
                    Some("agent_message") => {
                        if done && let Some(text) = item.get("text").and_then(Value::as_str) {
                            self.append_text(text);
                        }
                    }
                    Some("command_execution") => {
                        let Some(command) = item.get("command").and_then(Value::as_str) else { return };
                        let input = json!({ "command": command }).as_object().cloned().unwrap_or_default();
                        self.upsert_tool(&id, line.at, "Bash".into(), Some("execute"), input);
                        if done {
                            let failed = failed_status || item.get("exit_code").and_then(Value::as_i64).is_some_and(|code| code != 0);
                            self.finish_tool(&id, item.get("aggregated_output").and_then(Value::as_str).unwrap_or_default(), failed, line.at);
                        }
                    }
                    Some("file_change") => {
                        let paths: Vec<&str> = item
                            .get("changes")
                            .and_then(Value::as_array)
                            .map(|changes| changes.iter().filter_map(|change| change.get("path").and_then(Value::as_str)).collect())
                            .unwrap_or_default();
                        if paths.is_empty() {
                            return;
                        }
                        let input = if paths.len() == 1 { json!({ "path": paths[0] }) } else { json!({ "description": format!("{} files", paths.len()) }) };
                        self.upsert_tool(&id, line.at, "Edit".into(), Some("edit"), input.as_object().cloned().unwrap_or_default());
                        if done {
                            self.finish_tool(&id, &paths.join("\n"), failed_status, line.at);
                        }
                    }
                    Some("mcp_tool_call") => {
                        let name = [text(item.get("server")), text(item.get("tool"))].into_iter().flatten().collect::<Vec<_>>().join(".");
                        if name.is_empty() {
                            return;
                        }
                        self.upsert_tool(&id, line.at, name, None, item.get("arguments").and_then(Value::as_object).cloned().unwrap_or_default());
                        if done {
                            self.finish_tool(&id, "", failed_status, line.at);
                        }
                    }
                    Some("web_search") => {
                        let Some(query) = text(item.get("query")) else { return };
                        let input = json!({ "query": query }).as_object().cloned().unwrap_or_default();
                        self.upsert_tool(&id, line.at, "WebSearch".into(), Some("fetch"), input);
                        if done {
                            self.finish_tool(&id, "", false, line.at);
                        }
                    }
                    Some("todo_list") => {
                        if let Some(plan) = read_todos(item.get("items")) {
                            self.transcript.plan = Some(plan);
                        }
                    }
                    Some("error") => {
                        if done && let Some(message) = item.get("message").and_then(Value::as_str) {
                            self.transcript.status = Some(message.to_string());
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

/// Reads a run's log into a transcript.
pub fn build(lines: &[LogLine]) -> CloudTranscript {
    let mut builder = Builder::default();
    for (index, line) in lines.iter().enumerate() {
        builder.line(index, line);
    }
    builder.transcript
}

/// The log as readable lines, for the run's raw log view.
pub fn format_log(lines: &[LogLine]) -> Vec<String> {
    lines
        .iter()
        .flat_map(|line| {
            if line.stream != "stdout" {
                return vec![line.text.clone()];
            }
            let Ok(event) = serde_json::from_str::<Value>(&line.text) else { return vec![line.text.clone()] };
            if !event.is_object() {
                return vec![line.text.clone()];
            }
            if event.get("type").and_then(Value::as_str) == Some("result") {
                return Vec::new();
            }
            let single = build(std::slice::from_ref(line));
            let tools = single.tool_calls.iter().map(|call| match call.detail() {
                Some(detail) => format!("→ {} {detail}", call.name),
                None => format!("→ {}", call.name),
            });
            std::iter::once(single.content).chain(tools).filter(|text| !text.is_empty()).collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(at: u64, stream: &str, text: Value) -> LogLine {
        LogLine { at, stream: stream.into(), text: if let Value::String(text) = text { text } else { text.to_string() } }
    }

    #[test]
    fn claude_code_events_become_a_transcript() {
        let lines = vec![
            line(0, "system", json!("Cloning acme/app")),
            line(1, "stdout", json!({ "type": "assistant", "message": { "content": [
                { "type": "text", "text": "Looking at the tests." },
                { "type": "tool_use", "id": "t1", "name": "Bash", "input": { "command": "cargo test" } },
                { "type": "tool_use", "id": "t2", "name": "TodoWrite", "input": { "todos": [{ "content": "Fix it", "status": "in_progress" }] } }
            ] } })),
            line(1500, "stdout", json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": [{ "type": "text", "text": "ok" }] }] } })),
            line(2000, "stdout", json!({ "type": "result", "result": "Done." })),
        ];
        let transcript = build(&lines);
        assert_eq!(transcript.content, "Looking at the tests.\n\nDone.");
        assert_eq!(transcript.status.as_deref(), Some("Cloning acme/app"));
        assert_eq!(transcript.plan, Some(vec![("Fix it".to_string(), PlanStatus::InProgress)]));
        let call = &transcript.tool_calls[0];
        assert_eq!((call.name.as_str(), call.status, call.output.as_str(), call.duration_ms), ("Bash", CallStatus::Completed, "ok", Some(1499)));
        assert_eq!(format_log(&lines), ["Cloning acme/app", "Looking at the tests.", "→ Bash cargo test"]);
    }

    #[test]
    fn codex_items_become_tool_calls() {
        let lines = vec![
            line(0, "stdout", json!({ "type": "item.started", "item": { "id": "c", "type": "command_execution", "command": "npm test" } })),
            line(10, "stdout", json!({ "type": "item.completed", "item": { "id": "c", "type": "command_execution", "command": "npm test", "exit_code": 1, "aggregated_output": "1 failed" } })),
            line(11, "stdout", json!({ "type": "item.completed", "item": { "id": "f", "type": "file_change", "changes": [{ "path": "a.ts" }, { "path": "b.ts" }] } })),
            line(12, "stdout", json!({ "type": "item.completed", "item": { "id": "m", "type": "agent_message", "text": "Fixed." } })),
        ];
        let transcript = build(&lines);
        assert_eq!(transcript.tool_calls[0].status, CallStatus::Failed);
        assert_eq!(transcript.tool_calls[1].detail(), Some("2 files"));
        assert_eq!(transcript.content, "Fixed.");
    }
}
