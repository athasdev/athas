//! The parts of the protocol's bodies Athas reads. Fields adapters leave out take defaults, so an
//! adapter that skips an optional field never fails a whole response.

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: i64,
    #[serde(default)]
    pub name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub source_reference: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackFrame {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub source: Option<Source>,
    /// One-based.
    #[serde(default)]
    pub line: u32,
    #[serde(default)]
    pub column: u32,
    /// "normal", "label" or "subtle": subtle frames are library code.
    #[serde(default)]
    pub presentation_hint: Option<String>,
}

impl StackFrame {
    pub fn path(&self) -> Option<PathBuf> {
        self.source.as_ref()?.path.as_ref().map(PathBuf::from)
    }

    /// The file name, or the source's own name for code without a file.
    pub fn source_label(&self) -> Option<String> {
        let source = self.source.as_ref()?;
        let name = source.path.as_deref().and_then(|path| path.rsplit(['/', '\\']).next()).or(source.name.as_deref())?;
        Some(if self.line > 0 { format!("{name}:{}", self.line) } else { name.to_string() })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    #[serde(default)]
    pub name: String,
    pub variables_reference: i64,
    #[serde(default)]
    pub expensive: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    pub name: String,
    #[serde(default)]
    pub value: String,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub variables_reference: i64,
    #[serde(default)]
    pub evaluate_name: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateResult {
    #[serde(default)]
    pub result: String,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub variables_reference: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointResult {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub line: Option<u32>,
    #[serde(default)]
    pub source: Option<Source>,
}

/// A filter the adapter offers for stopping on exceptions ("Uncaught Exceptions", …).
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExceptionFilter {
    pub filter: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub default: bool,
}

/// What the adapter said it supports in its `initialize` response.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    #[serde(default)]
    pub supports_configuration_done_request: bool,
    #[serde(default)]
    pub supports_conditional_breakpoints: bool,
    #[serde(default)]
    pub supports_hit_conditional_breakpoints: bool,
    #[serde(default)]
    pub supports_log_points: bool,
    #[serde(default)]
    pub supports_evaluate_for_hovers: bool,
    #[serde(default)]
    pub supports_set_variable: bool,
    #[serde(default)]
    pub supports_restart_request: bool,
    #[serde(default)]
    pub supports_terminate_request: bool,
    #[serde(default)]
    pub support_terminate_debuggee: bool,
    #[serde(default)]
    pub exception_breakpoint_filters: Vec<ExceptionFilter>,
}

impl Capabilities {
    /// Reads an `initialize` response body; a `capabilities` event is merged into that body first.
    pub fn from_body(body: &Value) -> Self {
        serde_json::from_value(body.clone()).unwrap_or_default()
    }
}

/// Reads a typed list out of a response body field such as `threads` or `variables`, skipping
/// entries that do not parse.
pub fn list<T: for<'de> Deserialize<'de>>(body: &Value, field: &str) -> Vec<T> {
    body.get(field)
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|item| serde_json::from_value(item.clone()).ok()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn lists_skip_malformed_entries() {
        let body = json!({ "threads": [{ "id": 1, "name": "main" }, { "name": "no id" }, { "id": 2 }] });
        let threads: Vec<Thread> = list(&body, "threads");
        assert_eq!(threads.len(), 2);
        assert_eq!(threads[1].name, "");
    }

    #[test]
    fn capabilities_tolerate_unknown_and_missing_fields() {
        let capabilities = Capabilities::from_body(&json!({
            "supportsLogPoints": true,
            "supportsSomethingNew": 3,
            "exceptionBreakpointFilters": [{ "filter": "raised", "label": "Raised" }]
        }));
        assert!(capabilities.supports_log_points);
        assert!(!capabilities.supports_restart_request);
        assert_eq!(capabilities.exception_breakpoint_filters[0].filter, "raised");
        assert_eq!(Capabilities::from_body(&json!(null)), Capabilities::default());
    }

    #[test]
    fn frame_labels() {
        let frame: StackFrame =
            serde_json::from_value(json!({ "id": 1, "name": "main", "line": 12, "source": { "path": "/p/src/main.rs" } })).unwrap();
        assert_eq!(frame.source_label().as_deref(), Some("main.rs:12"));
        assert_eq!(frame.path(), Some(PathBuf::from("/p/src/main.rs")));
    }
}
