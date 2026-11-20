//! Flat, serializable shapes of LSP responses for the editor frontend, and the conversions
//! that produce them.

use lsp_types::{
   CodeActionOrCommand, CodeLens, Diagnostic as LspDiagnostic, DiagnosticSeverity, DocumentSymbol,
   DocumentSymbolResponse, GotoDefinitionResponse, InlayHint, InlayHintLabel, Location,
   NumberOrString, OneOf, Position, Range, SemanticToken, SemanticTokensResult, SymbolKind,
   TextEdit, Url, WorkspaceSymbolResponse,
};
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

fn symbol_kind_to_string(kind: SymbolKind) -> String {
   match kind {
      SymbolKind::FILE => "file",
      SymbolKind::MODULE => "module",
      SymbolKind::NAMESPACE => "namespace",
      SymbolKind::PACKAGE => "package",
      SymbolKind::CLASS => "class",
      SymbolKind::METHOD => "method",
      SymbolKind::PROPERTY => "property",
      SymbolKind::FIELD => "field",
      SymbolKind::CONSTRUCTOR => "constructor",
      SymbolKind::ENUM => "enum",
      SymbolKind::INTERFACE => "interface",
      SymbolKind::FUNCTION => "function",
      SymbolKind::VARIABLE => "variable",
      SymbolKind::CONSTANT => "constant",
      SymbolKind::STRING => "string",
      SymbolKind::NUMBER => "number",
      SymbolKind::BOOLEAN => "boolean",
      SymbolKind::ARRAY => "array",
      SymbolKind::OBJECT => "object",
      SymbolKind::KEY => "key",
      SymbolKind::NULL => "null",
      SymbolKind::ENUM_MEMBER => "enum-member",
      SymbolKind::STRUCT => "struct",
      SymbolKind::EVENT => "event",
      SymbolKind::OPERATOR => "operator",
      SymbolKind::TYPE_PARAMETER => "type-parameter",
      _ => "unknown",
   }
   .to_string()
}

fn flatten_document_symbols(
   symbols: &[DocumentSymbol],
   container: Option<&str>,
) -> Vec<FlatSymbol> {
   flatten_document_symbols_with_path(symbols, container, Vec::new())
}

fn flatten_document_symbols_with_path(
   symbols: &[DocumentSymbol],
   container: Option<&str>,
   parent_path: Vec<u32>,
) -> Vec<FlatSymbol> {
   let mut result = Vec::new();
   for (index, symbol) in symbols.iter().enumerate() {
      let mut hierarchy_path = parent_path.clone();
      hierarchy_path.push(index as u32);
      result.push(FlatSymbol {
         name: symbol.name.clone(),
         kind: symbol_kind_to_string(symbol.kind),
         detail: symbol.detail.clone(),
         line: symbol.selection_range.start.line,
         character: symbol.selection_range.start.character,
         end_line: symbol.range.end.line,
         end_character: symbol.range.end.character,
         container_name: container.map(|s| s.to_string()),
         hierarchy_path: hierarchy_path.clone(),
      });
      if let Some(children) = &symbol.children {
         result.extend(flatten_document_symbols_with_path(
            children,
            Some(&symbol.name),
            hierarchy_path,
         ));
      }
   }
   result
}

fn flatten_inlay_hint(hint: &InlayHint) -> FlatInlayHint {
   let label = match &hint.label {
      InlayHintLabel::String(s) => s.clone(),
      InlayHintLabel::LabelParts(parts) => parts.iter().map(|p| p.value.as_str()).collect(),
   };

   let kind = hint.kind.map(|k| match k {
      lsp_types::InlayHintKind::TYPE => "type".to_string(),
      lsp_types::InlayHintKind::PARAMETER => "parameter".to_string(),
      _ => "other".to_string(),
   });

   FlatInlayHint {
      line: hint.position.line,
      character: hint.position.character,
      label,
      kind,
      padding_left: hint.padding_left.unwrap_or(false),
      padding_right: hint.padding_right.unwrap_or(false),
   }
}

fn convert_diagnostic_context_to_lsp(context: LspDiagnosticContext) -> LspDiagnostic {
   let severity = match context.severity.as_deref() {
      Some("error") => Some(DiagnosticSeverity::ERROR),
      Some("warning") => Some(DiagnosticSeverity::WARNING),
      Some("info") => Some(DiagnosticSeverity::INFORMATION),
      _ => None,
   };

   let code = context.code.as_ref().map(|value| {
      if let Ok(num) = value.parse::<i32>() {
         NumberOrString::Number(num)
      } else {
         NumberOrString::String(value.clone())
      }
   });

   LspDiagnostic {
      range: Range {
         start: Position {
            line: context.line,
            character: context.column,
         },
         end: Position {
            line: context.end_line,
            character: context.end_column,
         },
      },
      severity,
      code,
      code_description: None,
      source: context.source,
      message: context.message,
      related_information: None,
      tags: None,
      data: None,
   }
}

/// Packs semantic tokens and their legend into the compact binary layout the webview reads as
/// an `ArrayBuffer`, instead of one JSON object per token.
///
/// Layout, all little-endian:
/// - `u32` number of token integers (five per token)
/// - `u32` byte length of the legend JSON
/// - the token integers exactly as the server encoded them
/// - the legend as UTF-8 JSON: `{"tokenTypes":[...],"tokenModifiers":[...]}`
pub fn encode_semantic_tokens_payload(
   tokens: &[SemanticToken],
   token_types: &[String],
   token_modifiers: &[String],
) -> Vec<u8> {
   let legend = serde_json::to_vec(&serde_json::json!({
      "tokenTypes": token_types,
      "tokenModifiers": token_modifiers,
   }))
   .unwrap_or_else(|_| b"{\"tokenTypes\":[],\"tokenModifiers\":[]}".to_vec());
   let integer_count = tokens.len() * 5;
   let mut bytes = Vec::with_capacity(8 + integer_count * 4 + legend.len());
   bytes.extend_from_slice(&(integer_count as u32).to_le_bytes());
   bytes.extend_from_slice(&(legend.len() as u32).to_le_bytes());
   for token in tokens {
      for value in [
         token.delta_line,
         token.delta_start,
         token.length,
         token.token_type,
         token.token_modifiers_bitset,
      ] {
         bytes.extend_from_slice(&value.to_le_bytes());
      }
   }
   bytes.extend_from_slice(&legend);
   bytes
}

fn symbol_kind_label(kind: SymbolKind) -> String {
   symbol_kind_to_string(kind)
}

fn uri_to_file_path(uri: &Url) -> String {
   uri.to_file_path()
      .map(|path| path.to_string_lossy().into_owned())
      .unwrap_or_else(|_| uri.to_string())
}

pub fn flatten_workspace_symbol_response(
   responses: Vec<WorkspaceSymbolResponse>,
) -> Vec<FlatWorkspaceSymbol> {
   let mut seen = std::collections::HashSet::new();
   let mut out = Vec::new();

   for response in responses {
      match response {
         WorkspaceSymbolResponse::Flat(infos) => {
            for info in infos {
               let file_path = uri_to_file_path(&info.location.uri);
               let key = (
                  file_path.clone(),
                  info.location.range.start.line,
                  info.location.range.start.character,
                  info.name.clone(),
               );
               if !seen.insert(key) {
                  continue;
               }
               out.push(FlatWorkspaceSymbol {
                  name: info.name,
                  kind: symbol_kind_label(info.kind),
                  detail: None,
                  line: info.location.range.start.line,
                  character: info.location.range.start.character,
                  end_line: info.location.range.end.line,
                  end_character: info.location.range.end.character,
                  container_name: info.container_name,
                  file_path,
               });
            }
         }
         WorkspaceSymbolResponse::Nested(symbols) => {
            for symbol in symbols {
               // `WorkspaceSymbol.location` is `OneOf<Location, WorkspaceLocation>` in this
               // pinned lsp-types version: servers may return a full `Location` (uri + range)
               // or, per the 3.17 spec, a bare `WorkspaceLocation` (uri only, no range) when
               // the client advertises `workspace.symbol.resolveSupport` (which we don't).
               // We don't set that capability, so servers should send the full form, but
               // handle the range-less form defensively by falling back to (0, 0).
               let (file_path, start_line, start_character, end_line, end_character) =
                  match symbol.location {
                     OneOf::Left(location) => (
                        uri_to_file_path(&location.uri),
                        location.range.start.line,
                        location.range.start.character,
                        location.range.end.line,
                        location.range.end.character,
                     ),
                     OneOf::Right(workspace_location) => {
                        (uri_to_file_path(&workspace_location.uri), 0, 0, 0, 0)
                     }
                  };

               let key = (
                  file_path.clone(),
                  start_line,
                  start_character,
                  symbol.name.clone(),
               );
               if !seen.insert(key) {
                  continue;
               }
               out.push(FlatWorkspaceSymbol {
                  name: symbol.name,
                  kind: symbol_kind_label(symbol.kind),
                  detail: None,
                  line: start_line,
                  character: start_character,
                  end_line,
                  end_character,
                  container_name: symbol.container_name,
                  file_path,
               });
            }
         }
      }
   }
   out
}

/// Goto-style responses (definition, implementation, type definition) as plain locations;
/// links resolve to their target selection range.
pub fn locations_from_goto_response(
   response: Option<GotoDefinitionResponse>,
) -> Option<Vec<Location>> {
   match response? {
      GotoDefinitionResponse::Scalar(location) => Some(vec![location]),
      GotoDefinitionResponse::Array(locations) => Some(locations),
      GotoDefinitionResponse::Link(links) => Some(
         links
            .into_iter()
            .map(|link| Location {
               uri: link.target_uri,
               range: link.target_selection_range,
            })
            .collect(),
      ),
   }
}

impl LspCodeActionContext {
   /// The requested range and the diagnostics it carries, in LSP form.
   pub fn into_request(self) -> (Range, Vec<LspDiagnostic>) {
      let range = Range {
         start: Position {
            line: self.start_line,
            character: self.start_column,
         },
         end: Position {
            line: self.end_line,
            character: self.end_column,
         },
      };
      let diagnostics = self
         .diagnostics
         .into_iter()
         .map(convert_diagnostic_context_to_lsp)
         .collect();
      (range, diagnostics)
   }
}

/// Summarizes each code action for the menu and keeps the full action as `payload` so it can be
/// applied later.
pub fn code_action_items(actions: Vec<CodeActionOrCommand>) -> Vec<LspCodeActionItem> {
   actions
      .into_iter()
      .enumerate()
      .map(|(index, action)| {
         let payload = serde_json::to_value(&action).unwrap_or(Value::Null);
         match action {
            CodeActionOrCommand::Command(command) => LspCodeActionItem {
               id: format!("command-{}", index),
               title: command.title,
               kind: None,
               is_preferred: false,
               disabled_reason: None,
               has_command: true,
               has_edit: false,
               payload,
            },
            CodeActionOrCommand::CodeAction(code_action) => LspCodeActionItem {
               id: format!("code-action-{}", index),
               title: code_action.title,
               kind: code_action.kind.map(|kind| kind.as_str().to_string()),
               is_preferred: code_action.is_preferred.unwrap_or(false),
               disabled_reason: code_action.disabled.map(|disabled| disabled.reason),
               has_command: code_action.command.is_some(),
               has_edit: code_action.edit.is_some(),
               payload,
            },
         }
      })
      .collect()
}

/// Encodes a semantic tokens response; `legend` is only consulted when there are tokens.
pub fn semantic_tokens_payload(
   response: Option<SemanticTokensResult>,
   legend: impl FnOnce() -> (Vec<String>, Vec<String>),
) -> Vec<u8> {
   let data = match response {
      Some(SemanticTokensResult::Tokens(tokens)) => tokens.data,
      Some(SemanticTokensResult::Partial(partial)) => partial.data,
      None => return encode_semantic_tokens_payload(&[], &[], &[]),
   };
   let (token_types, token_modifiers) = legend();
   encode_semantic_tokens_payload(&data, &token_types, &token_modifiers)
}

/// Code lenses that carry a command; unresolved lenses are dropped.
pub fn flatten_code_lenses(lenses: Option<Vec<CodeLens>>) -> Vec<FlatCodeLens> {
   lenses
      .unwrap_or_default()
      .into_iter()
      .filter_map(|lens| {
         let command = lens.command?;
         Some(FlatCodeLens {
            line: lens.range.start.line,
            title: command.title,
            command: Some(command.command),
            arguments: command.arguments,
         })
      })
      .collect()
}

pub fn flatten_text_edits(edits: Option<Vec<TextEdit>>) -> Vec<FlatTextEdit> {
   let position = |position: Position| FlatTextEditPosition {
      line: position.line,
      character: position.character,
   };
   edits
      .unwrap_or_default()
      .into_iter()
      .map(|edit| FlatTextEdit {
         range: FlatTextEditRange {
            start: position(edit.range.start),
            end: position(edit.range.end),
         },
         new_text: edit.new_text,
      })
      .collect()
}

pub fn flatten_inlay_hints(hints: Option<Vec<InlayHint>>) -> Vec<FlatInlayHint> {
   hints
      .unwrap_or_default()
      .iter()
      .map(flatten_inlay_hint)
      .collect()
}

/// Flattens either response shape into one list; nested symbols keep their parent's name and
/// their index path.
pub fn flatten_document_symbol_response(
   response: Option<DocumentSymbolResponse>,
) -> Vec<FlatSymbol> {
   match response {
      Some(DocumentSymbolResponse::Flat(infos)) => infos
         .into_iter()
         .map(|info| FlatSymbol {
            name: info.name,
            kind: symbol_kind_label(info.kind),
            detail: None,
            line: info.location.range.start.line,
            character: info.location.range.start.character,
            end_line: info.location.range.end.line,
            end_character: info.location.range.end.character,
            container_name: info.container_name,
            hierarchy_path: Vec::new(),
         })
         .collect(),
      Some(DocumentSymbolResponse::Nested(symbols)) => flatten_document_symbols(&symbols, None),
      None => Vec::new(),
   }
}

#[cfg(test)]
mod tests;
