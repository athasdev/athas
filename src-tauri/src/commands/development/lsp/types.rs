use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LspCodeActionContext {
   pub start_line: u32,
   pub start_column: u32,
   pub end_line: u32,
   pub end_column: u32,
   #[serde(default)]
   pub diagnostics: Vec<LspDiagnosticContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LspApplyCodeActionResult {
   pub applied: bool,
   pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlatWorkspaceSymbol {
   pub name: String,
   pub kind: String,
   pub detail: Option<String>,
   pub line: u32,
   pub character: u32,
   pub end_line: u32,
   pub end_character: u32,
   pub container_name: Option<String>,
   pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlatInlayHint {
   pub line: u32,
   pub character: u32,
   pub label: String,
   pub kind: Option<String>,
   pub padding_left: bool,
   pub padding_right: bool,
}

/// Semantic tokens in the LSP's compact relative encoding, sent to the webview as
/// an `ArrayBuffer` instead of one JSON object per token.
///
/// Layout, all little-endian:
/// - `u32` number of token integers (five per token)
/// - `u32` byte length of the legend JSON
/// - the token integers exactly as the server encoded them
/// - the legend as UTF-8 JSON: `{"tokenTypes":[...],"tokenModifiers":[...]}`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticTokensPayload(pub Vec<u8>);

impl tauri::ipc::IpcResponse for SemanticTokensPayload {
   fn body(self) -> tauri::Result<tauri::ipc::InvokeResponseBody> {
      Ok(tauri::ipc::InvokeResponseBody::Raw(self.0))
   }
}

impl specta::Type for SemanticTokensPayload {
   fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
      specta::datatype::DataType::Reference(specta_typescript::define("ArrayBuffer"))
   }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlatCodeLens {
   pub line: u32,
   pub title: String,
   pub command: Option<String>,
   pub arguments: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlatTextEditPosition {
   pub line: u32,
   pub character: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlatTextEditRange {
   pub start: FlatTextEditPosition,
   pub end: FlatTextEditPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlatTextEdit {
   pub range: FlatTextEditRange,
   pub new_text: String,
}

/// An `lsp_types` value crossing IPC unchanged. The generated bindings type it as
/// the matching `vscode-languageserver-protocol` type the frontend already uses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Lsp<T>(pub T);

pub trait LspTypeName {
   const TS_NAME: &'static str;
}

macro_rules! lsp_type_names {
   ($($ty:ident => $name:literal),* $(,)?) => {
      $(impl LspTypeName for lsp_types::$ty {
         const TS_NAME: &'static str = $name;
      })*
   };
}

lsp_type_names!(
   CallHierarchyIncomingCall => "CallHierarchyIncomingCall",
   CallHierarchyItem => "CallHierarchyItem",
   CallHierarchyOutgoingCall => "CallHierarchyOutgoingCall",
   CompletionItem => "CompletionItem",
   DocumentHighlight => "DocumentHighlight",
   FoldingRange => "FoldingRange",
   Hover => "Hover",
   Location => "Location",
   Position => "Position",
   PrepareRenameResponse => "PrepareRenameResult",
   SelectionRange => "SelectionRange",
   SignatureHelp => "SignatureHelp",
   TextEdit => "TextEdit",
   TypeHierarchyItem => "TypeHierarchyItem",
   WorkspaceEdit => "WorkspaceEdit",
);

impl<T: LspTypeName> specta::Type for Lsp<T> {
   fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
      specta::datatype::DataType::Reference(specta_typescript::define(format!(
         "Lsp.{}",
         T::TS_NAME
      )))
   }
}

/// Wraps `lsp_types` values, including inside `Option` and `Vec`, in [`Lsp`].
pub trait IntoLsp {
   type Output;
   fn into_lsp(self) -> Self::Output;
}

impl<T: LspTypeName> IntoLsp for T {
   type Output = Lsp<T>;
   fn into_lsp(self) -> Self::Output {
      Lsp(self)
   }
}

impl<T: IntoLsp> IntoLsp for Option<T> {
   type Output = Option<T::Output>;
   fn into_lsp(self) -> Self::Output {
      self.map(IntoLsp::into_lsp)
   }
}

impl<T: IntoLsp> IntoLsp for Vec<T> {
   type Output = Vec<T::Output>;
   fn into_lsp(self) -> Self::Output {
      self.into_iter().map(IntoLsp::into_lsp).collect()
   }
}
