use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnosticContext {
   pub line: u32,
   pub column: u32,
   pub end_line: u32,
   pub end_column: u32,
   pub message: String,
   pub source: Option<String>,
   pub code: Option<String>,
   pub severity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCodeActionItem {
   pub id: String,
   pub title: String,
   pub kind: Option<String>,
   pub is_preferred: bool,
   pub disabled_reason: Option<String>,
   pub has_command: bool,
   pub has_edit: bool,
   pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspApplyCodeActionResult {
   pub applied: bool,
   pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatSymbol {
   pub name: String,
   pub kind: String,
   pub detail: Option<String>,
   pub line: u32,
   pub character: u32,
   pub end_line: u32,
   pub end_character: u32,
   pub container_name: Option<String>,
   pub hierarchy_path: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatInlayHint {
   pub line: u32,
   pub character: u32,
   pub label: String,
   pub kind: Option<String>,
   pub padding_left: bool,
   pub padding_right: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatSemanticToken {
   pub line: u32,
   pub start_char: u32,
   pub length: u32,
   pub token_type: u32,
   pub token_type_name: Option<String>,
   pub token_modifiers: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatCodeLens {
   pub line: u32,
   pub title: String,
   pub command: Option<String>,
   pub arguments: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatTextEditPosition {
   pub line: u32,
   pub character: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatTextEditRange {
   pub start: FlatTextEditPosition,
   pub end: FlatTextEditPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatTextEdit {
   pub range: FlatTextEditRange,
   pub new_text: String,
}
