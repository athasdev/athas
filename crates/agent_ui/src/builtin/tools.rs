//! The workspace tools the built-in agent offers the model, as Athas's `intelligence-agent.ts`
//! defines them.

use ai_providers::{ToolSpec, agent::object_schema};
use serde_json::{Value, json};

pub const READ_FILE: &str = "read_file";
pub const LIST_FILES: &str = "list_files";
pub const SEARCH_FILES: &str = "search_files";
pub const EDIT_FILE: &str = "edit_file";
pub const WRITE_FILE: &str = "write_file";
pub const DELETE_FILE: &str = "delete_file";
pub const RUN_COMMAND: &str = "run_command";
pub const TODO_WRITE: &str = "todo_write";
pub const SHOW_VIEW: &str = "show_view";

fn string(max: u64) -> Value {
    json!({ "type": "string", "maxLength": max })
}

fn integer(min: u64, max: Option<u64>) -> Value {
    match max {
        Some(max) => json!({ "type": "integer", "minimum": min, "maximum": max }),
        None => json!({ "type": "integer", "minimum": min }),
    }
}

fn spec(name: &str, description: &str, input_schema: Value) -> ToolSpec {
    ToolSpec { name: name.into(), description: description.into(), input_schema }
}

/// The tools for a session: none without a project, the read-only ones in Ask and Plan.
pub fn workspace_tools(has_root: bool, read_only: bool) -> Vec<ToolSpec> {
    let mut tools = vec![spec(
        TODO_WRITE,
        "Keep a checklist for multi-step work. Send the whole list every time, with at most one item in_progress; the user sees it update live. Skip it for one-step requests.",
        object_schema(&[(
            "todos",
            json!({
                "type": "array",
                "maxItems": 50,
                "items": object_schema(&[
                    ("content", string(500), true),
                    ("status", json!({ "type": "string", "enum": ["pending", "in_progress", "completed"] }), true),
                    ("priority", json!({ "type": "string", "enum": ["high", "medium", "low"] }), false),
                ]),
            }),
            true,
        )]),
    )];
    if !has_root {
        return tools;
    }
    tools.extend([
        spec(
            LIST_FILES,
            "List workspace files in path order, respecting .gitignore, root .athasignore/.aiignore/.cursorignore, and leaving out credentials. Returns one page: pass nextOffset back as offset for the next. Narrow with path (a folder) or glob (like *.ts or src/**/*.rs).",
            object_schema(&[
                ("path", string(1024), false),
                ("glob", string(200), false),
                ("offset", integer(0, None), false),
                ("limit", integer(1, Some(2000)), false),
            ]),
        ),
        spec(
            SEARCH_FILES,
            "Search file contents across the whole workspace, like ripgrep: .gitignore and root .athasignore/.aiignore/.cursorignore are respected; credentials and binary files are skipped. Literal text by default; set regex for a regular expression. Case-insensitive unless the query has an uppercase letter or caseSensitive is set. Narrow with path or glob, and ask for contextLines around each match.",
            object_schema(&[
                ("query", string(500), true),
                ("regex", json!({ "type": "boolean" }), false),
                ("caseSensitive", json!({ "type": "boolean" }), false),
                ("path", string(1024), false),
                ("glob", string(200), false),
                ("contextLines", integer(0, Some(5)), false),
                ("maxResults", integer(1, Some(500)), false),
            ]),
        ),
        spec(
            READ_FILE,
            &format!(
                "Read a workspace text file, {} lines at a time from startLine. Paths are relative to the workspace. Read a file before editing, overwriting or deleting it.",
                ai_tools::READ_LINES
            ),
            object_schema(&[("path", string(1024), true), ("startLine", integer(1, None), false)]),
        ),
        spec(
            SHOW_VIEW,
            "Show structured UI in the user's agent side panel instead of long prose: a comparison table, a checklist, a file tree, key metrics, a callout or a code block. Pass an Athas view node such as { type: 'table', columns: [{ key, label }], rows: [{ key: value }] }, { type: 'list', items: [{ title, description }] }, { type: 'metric', label, value }, { type: 'callout', tone: 'info' | 'warning', title, body }, { type: 'text', value } or { type: 'stack', children: [...] }. Keep it small and specific to what the user asked.",
            object_schema(&[("view", json!({ "type": "object" }), true)]),
        ),
    ]);
    if read_only {
        return tools;
    }
    tools.extend([
        spec(
            RUN_COMMAND,
            "Run a shell command in the workspace directory. Read-only commands and ones the user always allowed run at once; others wait for approval. Runs with the user's permissions, not in a sandbox. Maximum 60 seconds; output is capped. Do not start background services.",
            object_schema(&[("command", string(8000), true)]),
        ),
        spec(
            EDIT_FILE,
            "Edit a file you have read by replacing exact text. Send every change to one file in a single call as edits; they apply in order, all or none. Each oldText must match exactly one location (include surrounding lines to make it unique) unless replaceAll is set. The change lands at once and the user can keep or reject it afterwards.",
            object_schema(&[
                ("path", string(1024), true),
                (
                    "edits",
                    json!({
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 64,
                        "items": object_schema(&[
                            ("oldText", string(24_000), true),
                            ("newText", string(48_000), true),
                            ("replaceAll", json!({ "type": "boolean" }), false),
                        ]),
                    }),
                    true,
                ),
            ]),
        ),
        spec(
            WRITE_FILE,
            "Create a file, or replace all of a file you have read. Prefer edit_file for changes to existing files. Missing folders are created. The change lands at once and the user can keep or reject it afterwards.",
            object_schema(&[("path", string(1024), true), ("content", string(256 * 1024), true)]),
        ),
        spec(
            DELETE_FILE,
            "Delete a file you have read. The user approves every deletion.",
            object_schema(&[("path", string(1024), true)]),
        ),
    ]);
    tools
}

/// The transcript's title and kind for a call, before it runs.
pub fn describe(name: &str, input: &Value) -> (String, &'static str) {
    let text = |key: &str| input.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    match name {
        READ_FILE => (format!("Read {}", text("path")), "read"),
        LIST_FILES => {
            let target = [text("glob"), text("path")].into_iter().find(|value| !value.is_empty()).unwrap_or_else(|| "files".into());
            (format!("List {target}"), "search")
        }
        SEARCH_FILES => (format!("Search for “{}”", text("query")), "search"),
        EDIT_FILE => (format!("Edit {}", text("path")), "edit"),
        WRITE_FILE => (format!("Write {}", text("path")), "edit"),
        DELETE_FILE => (format!("Delete {}", text("path")), "delete"),
        RUN_COMMAND => (text("command"), "execute"),
        TODO_WRITE => ("Update the plan".into(), "think"),
        other => match ai_mcp::parse_model_tool_name(other) {
            Some((server, tool)) => (format!("{server}: {tool}"), "other"),
            None => (other.to_string(), "other"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(tools: &[ToolSpec]) -> Vec<&str> {
        tools.iter().map(|tool| tool.name.as_str()).collect()
    }

    #[test]
    fn read_only_modes_and_chats_get_fewer_tools() {
        assert_eq!(names(&workspace_tools(false, false)), [TODO_WRITE]);
        let ask = workspace_tools(true, true);
        assert!(names(&ask).contains(&READ_FILE) && !names(&ask).contains(&EDIT_FILE) && !names(&ask).contains(&RUN_COMMAND));
        assert_eq!(workspace_tools(true, false).len(), 9);
        assert!(names(&ask).contains(&SHOW_VIEW));
        assert_eq!(describe(EDIT_FILE, &json!({ "path": "src/a.rs" })), ("Edit src/a.rs".into(), "edit"));
        assert_eq!(describe(LIST_FILES, &json!({})).0, "List files");
    }
}
