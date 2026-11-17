//! How a step reads in the transcript (`lib/tool-call-summary.ts`): a verb in the tense of its
//! phase ("Reading" / "Read"), what it applies to (a path, a command, a query), its line counts
//! and how many results a search found.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::{
    diff,
    thread::{ToolCall, ToolKind, ToolStatus},
    tool_groups::StepPhase,
};

/// `ToolCallPhase`: `Background` is a call the turn left running, such as a dev server it
/// started; it reads as done and still running.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Running,
    Background,
    Done,
    Failed,
    Declined,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Summary {
    pub kind: ToolKind,
    pub phase: Phase,
    pub verb: String,
    pub target: Option<String>,
    pub additions: usize,
    pub deletions: usize,
    /// Results of a search or listing.
    pub count: Option<usize>,
    /// The file the call is about: its first diff, else its first location, else a path argument.
    pub path: Option<PathBuf>,
}

fn verbs(kind: ToolKind) -> (&'static str, &'static str) {
    match kind {
        ToolKind::Read => ("Reading", "Read"),
        ToolKind::Edit => ("Editing", "Edited"),
        ToolKind::Delete => ("Deleting", "Deleted"),
        ToolKind::Move => ("Moving", "Moved"),
        ToolKind::Search => ("Searching", "Searched"),
        ToolKind::Execute => ("Running", "Ran"),
        ToolKind::Think => ("Thinking", "Thought"),
        ToolKind::Fetch => ("Fetching", "Fetched"),
        ToolKind::SwitchMode => ("Switching mode", "Switched mode"),
        ToolKind::Other => ("Calling", "Called"),
    }
}

/// The kind a bare name suggests, for agents that only name their tools (`inferToolKind`).
pub fn infer_kind(name: &str) -> ToolKind {
    if ai_mcp::parse_model_tool_name(name).is_some() {
        return ToolKind::Other;
    }
    let lower = name.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_ascii_lowercase()).filter(|word| !word.is_empty()).collect();
    let starts = |prefixes: &[&str]| words.iter().any(|word| prefixes.iter().any(|prefix| word.starts_with(prefix)));
    let whole = |names: &[&str]| words.iter().any(|word| names.contains(word));
    if starts(&["edit", "write", "replace", "patch", "create", "apply"]) {
        ToolKind::Edit
    } else if whole(&["delete", "remove", "rm"]) {
        ToolKind::Delete
    } else if starts(&["move", "rename"]) {
        ToolKind::Move
    } else if starts(&["read", "view", "cat", "open"]) {
        ToolKind::Read
    } else if starts(&["bash", "shell", "command", "exec", "run", "terminal"]) {
        ToolKind::Execute
    } else if whole(&["grep", "glob", "search", "find", "list", "ls"]) {
        ToolKind::Search
    } else if starts(&["fetch", "http", "web", "url", "browse"]) {
        ToolKind::Fetch
    } else if starts(&["think", "plan", "reason"]) {
        ToolKind::Think
    } else {
        ToolKind::Other
    }
}

/// The call's phase from its status and the turn (`getToolCallPhase`).
pub fn phase(call: &ToolCall, streaming: bool) -> Phase {
    let declined = call.raw_output.as_ref().and_then(Value::as_object).is_some_and(|output| output.get("applied") == Some(&Value::Bool(false)) || output.get("executed") == Some(&Value::Bool(false)));
    match call.status {
        ToolStatus::Failed => Phase::Failed,
        _ if declined => Phase::Declined,
        ToolStatus::Canceled => Phase::Cancelled,
        ToolStatus::Completed => Phase::Done,
        _ => match crate::tool_groups::step_phase(call, streaming) {
            StepPhase::Running => Phase::Running,
            StepPhase::Background => Phase::Background,
            _ => Phase::Done,
        },
    }
}

fn first_string(input: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| input.get(*key).and_then(Value::as_str).filter(|value| !value.trim().is_empty()).map(str::to_string))
}

fn first_line(value: &str, max: usize) -> String {
    let line = value.trim().lines().next().unwrap_or_default();
    if line.chars().count() > max { format!("{}…", line.chars().take(max - 1).collect::<String>()) } else { line.to_string() }
}

fn display_path(path: &Path, root: Option<&Path>) -> String {
    match root.and_then(|root| path.strip_prefix(root).ok()) {
        Some(relative) if !relative.as_os_str().is_empty() => relative.to_string_lossy().into_owned(),
        _ => path.to_string_lossy().into_owned(),
    }
}

/// `summarizeToolCall`, with the call's title standing for its name.
pub fn summarize(call: &ToolCall, streaming: bool, root: Option<&Path>) -> Summary {
    let kind = if call.kind != ToolKind::Other { call.kind } else { infer_kind(&call.title) };
    let phase = phase(call, streaming);
    let empty = serde_json::Map::new();
    let input = call.raw_input.as_ref().and_then(Value::as_object).unwrap_or(&empty);
    let diffs: Vec<_> = call.diffs().collect();
    let path = diffs
        .first()
        .map(|(path, _, _)| path.to_path_buf())
        .or_else(|| call.locations.first().map(|location| location.path.clone()))
        .or_else(|| first_string(input, &["file_path", "path", "filename", "filePath"]).map(Into::into));
    let shown_path = path.as_deref().map(|path| display_path(path, root));
    let (additions, deletions) = diffs.iter().fold((0, 0), |(additions, deletions), (_, old, new)| {
        let (added, removed) = diff::stats(&diff::diff_rows(old.unwrap_or(""), new));
        (additions + added, deletions + removed)
    });
    let mut count = None;
    let mut target = match kind {
        ToolKind::Read | ToolKind::Edit | ToolKind::Delete | ToolKind::Move => {
            if diffs.len() > 1 { Some(format!("{} files", diffs.len())) } else { shown_path.or_else(|| first_string(input, &["description", "title"])) }
        }
        ToolKind::Search => {
            if let Some(Value::Array(results)) = &call.raw_output {
                count = Some(results.len());
            }
            match first_string(input, &["query", "pattern", "regex", "glob", "q"]) {
                Some(query) => Some(format!("\"{}\"", first_line(&query, 64))),
                None => shown_path,
            }
        }
        ToolKind::Execute => call
            .command()
            .map(|command| crate::shell_command::clean_command(&first_line(&command, 96)))
            .or_else(|| first_string(input, &["description"]))
            .map(|target| first_line(&target, 96)),
        ToolKind::Fetch => first_string(input, &["url", "uri", "query"]).map(|target| first_line(&target, 96)),
        ToolKind::Think => None,
        _ => shown_path.or_else(|| first_string(input, &["description", "title", "query", "command"])).map(|target| first_line(&target, 96)),
    };
    let mcp = (kind == ToolKind::Other).then(|| ai_mcp::parse_model_tool_name(&call.title)).flatten();
    if let Some((server, _)) = mcp {
        target = Some(format!("{server} (MCP)"));
    }
    let verb = match mcp {
        Some((_, tool)) => tool.to_string(),
        None if kind == ToolKind::Other => call.title.clone(),
        None => {
            let (running, done) = verbs(kind);
            if matches!(phase, Phase::Running | Phase::Background) { running } else { done }.to_string()
        }
    };
    Summary { kind, phase, verb, target, additions, deletions, count, path }
}

/// Text worth showing for a call's `rawOutput` when it has no ACP content (`getOutputText`): the
/// built-in shell tool's stdout and stderr with a timeout or exit note, the read tool's text, a
/// refusal's reason, search hits as `path:line  text`, else the value as JSON. Extension views,
/// diffs and terminals are left out; they show on their own.
pub fn raw_output_text(output: &Value) -> String {
    let is_view = |value: &Value| value.get("type").and_then(Value::as_str) == Some("athas_ui");
    let format = |value: &Value| match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    };
    match output {
        Value::Null => String::new(),
        value if is_view(value) => String::new(),
        Value::Object(record) => {
            let stdout = record.get("stdout").and_then(Value::as_str);
            let stderr = record.get("stderr").and_then(Value::as_str);
            if stdout.is_some() || stderr.is_some() {
                let mut parts: Vec<String> = [stdout, stderr].into_iter().flatten().filter(|part| !part.trim().is_empty()).map(str::to_string).collect();
                if record.get("timed_out").and_then(Value::as_bool) == Some(true) {
                    parts.push("(timed out)".into());
                } else if let Some(code) = record.get("exit_code").and_then(Value::as_f64).filter(|code| *code != 0.) {
                    parts.push(format!("(exit code {code})"));
                }
                return parts.join("\n").trim().to_string();
            }
            if let Some(text) = record.get("text").and_then(Value::as_str) {
                return text.to_string();
            }
            if let Some(reason) = record.get("reason").and_then(Value::as_str) {
                return reason.to_string();
            }
            format(output)
        }
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                if is_view(item) {
                    return None;
                }
                let Some(record) = item.as_object() else { return Some(format(item)) };
                match record.get("type").and_then(Value::as_str) {
                    Some("content") if record.get("content").is_some_and(Value::is_object) => {
                        let content = &record["content"];
                        return Some(match (content.get("type").and_then(Value::as_str), content.get("text").and_then(Value::as_str)) {
                            (Some("text"), Some(text)) => text.to_string(),
                            _ => format(content),
                        });
                    }
                    Some("terminal" | "diff") => return None,
                    _ => {}
                }
                if let (Some(path), Some(line)) = (record.get("path").and_then(Value::as_str), record.get("line").and_then(Value::as_f64)) {
                    let text = record.get("text").and_then(Value::as_str).map(str::trim).unwrap_or_default();
                    return Some(format!("{path}:{line}  {text}"));
                }
                Some(format(item))
            })
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        other => format(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::{Location, ToolContent};
    use serde_json::json;

    fn call(kind: ToolKind, status: ToolStatus, input: Value) -> ToolCall {
        ToolCall { id: "1".into(), title: "Tool".into(), kind, status, raw_input: Some(input), ..Default::default() }
    }

    #[test]
    fn steps_read_as_verb_and_target() {
        let root = Path::new("/repo");
        let mut read = call(ToolKind::Read, ToolStatus::Completed, json!({}));
        read.locations = vec![Location { path: "/repo/src/a.rs".into(), line: None }];
        let summary = summarize(&read, false, Some(root));
        assert_eq!((summary.verb.as_str(), summary.target.as_deref()), ("Read", Some("src/a.rs")));

        let run = call(ToolKind::Execute, ToolStatus::InProgress, json!({ "command": "/bin/zsh -lc 'bun dev'" }));
        let summary = summarize(&run, true, Some(root));
        assert_eq!((summary.verb.as_str(), summary.target.as_deref(), summary.phase), ("Running", Some("bun dev"), Phase::Running));

        let mut search = call(ToolKind::Search, ToolStatus::Completed, json!({ "pattern": "fn main" }));
        search.raw_output = Some(json!(["a", "b"]));
        let summary = summarize(&search, false, None);
        assert_eq!((summary.target.as_deref(), summary.count), (Some("\"fn main\""), Some(2)));

        let mut edit = call(ToolKind::Edit, ToolStatus::Completed, json!({}));
        edit.content = vec![ToolContent::Diff { path: "/repo/a.rs".into(), old_text: Some("a\n".into()), new_text: "a\nb\n".into() }];
        let summary = summarize(&edit, false, Some(root));
        assert_eq!((summary.verb.as_str(), summary.target.as_deref(), summary.additions), ("Edited", Some("a.rs"), 1));

        let mut declined = call(ToolKind::Execute, ToolStatus::Completed, json!({ "command": "rm -rf x" }));
        declined.raw_output = Some(json!({ "executed": false }));
        assert_eq!(phase(&declined, false), Phase::Declined);
    }

    #[test]
    fn kinds_come_from_bare_names() {
        assert_eq!(infer_kind("Bash"), ToolKind::Execute);
        assert_eq!(infer_kind("write_file"), ToolKind::Edit);
        assert_eq!(infer_kind("Glob"), ToolKind::Search);
        assert_eq!(infer_kind("rm"), ToolKind::Delete);
        assert_eq!(infer_kind("WebFetch"), ToolKind::Fetch);
        assert_eq!(infer_kind("mcp__github__list_issues"), ToolKind::Other);
        assert_eq!(infer_kind("Mystery"), ToolKind::Other);
    }

    #[test]
    fn raw_output_reads_like_the_built_in_tools() {
        use serde_json::json;
        assert_eq!(raw_output_text(&json!({ "stdout": "ok\n", "stderr": " ", "exit_code": 2 })), "ok\n\n(exit code 2)");
        assert_eq!(raw_output_text(&json!({ "stdout": "", "stderr": "slow", "timed_out": true })), "slow\n(timed out)");
        assert_eq!(raw_output_text(&json!({ "text": "file body" })), "file body");
        assert_eq!(raw_output_text(&json!({ "executed": false, "reason": "Declined" })), "Declined");
        assert_eq!(raw_output_text(&json!([{ "path": "a.rs", "line": 3, "text": "  fn a()  " }, { "type": "terminal", "terminalId": "t" }])), "a.rs:3  fn a()");
        assert_eq!(raw_output_text(&json!([{ "type": "content", "content": { "type": "text", "text": "hi" } }, { "type": "athas_ui", "view": {} }])), "hi");
        assert_eq!(raw_output_text(&json!({ "a": 1 })), "{\n  \"a\": 1\n}");
    }
}
