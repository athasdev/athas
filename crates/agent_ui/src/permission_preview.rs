//! What the permission prompt shows of the call it asks about: the files it would change, the
//! command it would run, its text, or a few `key: value` lines of its input.
//!
//! Ported from Athas's `lib/acp-permission-preview.ts`.

use serde_json::Value;

use crate::thread::{ToolCall, ToolContent, ToolKind};

const MAX_SUMMARY_FIELDS: usize = 4;
const MAX_SUMMARY_VALUE_LENGTH: usize = 80;
const MAX_SUMMARY_TEXT_LENGTH: usize = 240;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PermissionPreview {
    /// Changed files with the lines added and removed.
    pub diffs: Vec<(String, usize, usize)>,
    pub command: Option<String>,
    pub text: Option<String>,
    pub input_summary: Option<String>,
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() > max { format!("{}…", text.chars().take(max - 1).collect::<String>()) } else { text.to_string() }
}

/// The shell command an execute call's input carries, in the shapes agents send it; a command
/// array like `["bash", "-lc", "ls"]` reads as the script it runs.
pub fn raw_input_command(raw_input: &Value) -> Option<String> {
    let input = raw_input.as_object()?;
    ["command", "cmd"].iter().find_map(|key| match input.get(*key)? {
        Value::String(command) if !command.trim().is_empty() => Some(command.clone()),
        Value::Array(parts) if !parts.is_empty() && parts.iter().all(Value::is_string) => {
            let words: Vec<String> = parts.iter().filter_map(Value::as_str).map(str::to_string).collect();
            Some(crate::shell_command::unwrap_shell_words(&words))
        }
        _ => None,
    })
}

fn summary_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => {
            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
            (!text.is_empty()).then(|| truncate(&text, MAX_SUMMARY_VALUE_LENGTH))
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        other => Some(truncate(&other.to_string(), MAX_SUMMARY_VALUE_LENGTH)),
    }
}

/// A few `key: value` lines from the input, enough to see what the call targets.
pub fn summarize_raw_input(raw_input: &Value) -> Option<String> {
    let input = match raw_input {
        Value::String(text) => return (!text.trim().is_empty()).then(|| truncate(text.trim(), MAX_SUMMARY_TEXT_LENGTH)),
        Value::Object(input) => input,
        other => return summary_value(other),
    };
    let entries: Vec<String> = input.iter().filter_map(|(key, value)| summary_value(value).map(|value| format!("{key}: {value}"))).collect();
    if entries.is_empty() {
        return None;
    }
    let hidden = entries.len().saturating_sub(MAX_SUMMARY_FIELDS);
    let mut shown: Vec<String> = entries.into_iter().take(MAX_SUMMARY_FIELDS).collect();
    if hidden > 0 {
        shown.push(format!("+{hidden} more"));
    }
    Some(shown.join("\n"))
}

fn line_counts(old: Option<&str>, new: &str) -> (usize, usize) {
    crate::diff::stats(&crate::diff::diff_rows(old.unwrap_or_default(), new))
}

/// The preview of the call a permission request asks about; `None` when there is nothing to show
/// beyond its title.
pub fn preview(call: &ToolCall, root: Option<&std::path::Path>) -> Option<PermissionPreview> {
    let diffs: Vec<(String, usize, usize)> = call
        .content
        .iter()
        .filter_map(|content| match content {
            ToolContent::Diff { path, old_text, new_text } => {
                let shown = root.and_then(|root| path.strip_prefix(root).ok()).unwrap_or(path).display().to_string();
                let (added, removed) = line_counts(old_text.as_deref(), new_text);
                Some((shown, added, removed))
            }
            _ => None,
        })
        .collect();
    let command = (diffs.is_empty() && matches!(call.kind, ToolKind::Execute | ToolKind::Other)).then(|| call.raw_input.as_ref().and_then(raw_input_command)).flatten();
    let texts: Vec<&str> = call
        .content
        .iter()
        .filter_map(|content| match content {
            ToolContent::Text { text } if !text.trim().is_empty() => Some(text.trim()),
            _ => None,
        })
        .collect();
    let text = (!texts.is_empty()).then(|| texts.join("\n\n"));
    let input_summary = (diffs.is_empty() && command.is_none() && text.is_none()).then(|| call.raw_input.as_ref().and_then(summarize_raw_input)).flatten();
    let preview = PermissionPreview { diffs, command, text, input_summary };
    (preview != PermissionPreview::default()).then_some(preview)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn commands_come_from_strings_or_arrays() {
        assert_eq!(raw_input_command(&json!({ "command": "ls -la" })).as_deref(), Some("ls -la"));
        assert_eq!(raw_input_command(&json!({ "cmd": ["bash", "-lc", "gh issue view 12"] })).as_deref(), Some("gh issue view 12"));
        assert_eq!(raw_input_command(&json!({ "command": "  " })), None);
        assert_eq!(raw_input_command(&json!("ls")), None);
    }

    #[test]
    fn inputs_are_summed_up_in_a_few_lines() {
        let summary = summarize_raw_input(&json!({ "a": "x  y", "b": 2, "c": true, "d": null, "e": [1], "f": "z", "g": "w" })).unwrap();
        assert_eq!(summary, "a: x y\nb: 2\nc: true\ne: [1]\n+2 more");
        assert_eq!(summarize_raw_input(&json!({ "q": "x".repeat(100) })).unwrap().chars().count(), "q: ".len() + 80);
        assert_eq!(summarize_raw_input(&json!(" query ")).as_deref(), Some("query"));
        assert_eq!(summarize_raw_input(&json!({})), None);
    }

    #[test]
    fn previews_show_what_the_call_does() {
        let call = ToolCall {
            kind: ToolKind::Edit,
            content: vec![ToolContent::Diff { path: "/p/src/a.rs".into(), old_text: Some("a\nb\nc".into()), new_text: "a\nB\nc\nd".into() }],
            raw_input: Some(json!({ "command": "rm -rf /" })),
            ..Default::default()
        };
        let shown = preview(&call, Some(std::path::Path::new("/p"))).unwrap();
        assert_eq!(shown.diffs, [("src/a.rs".to_string(), 2, 1)]);
        assert_eq!(shown.command, None);
        let call = ToolCall { kind: ToolKind::Execute, raw_input: Some(json!({ "command": ["sh", "-c", "bun test"] })), ..Default::default() };
        assert_eq!(preview(&call, None).unwrap().command.as_deref(), Some("bun test"));
        let call = ToolCall { kind: ToolKind::Fetch, raw_input: Some(json!({ "url": "https://athas.dev" })), ..Default::default() };
        assert_eq!(preview(&call, None).unwrap().input_summary.as_deref(), Some("url: https://athas.dev"));
        assert_eq!(preview(&ToolCall::default(), None), None);
    }
}
