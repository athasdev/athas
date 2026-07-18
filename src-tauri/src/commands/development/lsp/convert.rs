use super::types::{FlatInlayHint, FlatSymbol, FlatWorkspaceSymbol, LspDiagnosticContext};
use lsp_types::{
   Diagnostic as LspDiagnostic, DiagnosticSeverity, DocumentSymbol, InlayHint, InlayHintLabel,
   NumberOrString, OneOf, Position, Range, SymbolKind, Url, WorkspaceSymbolResponse,
};

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

pub(super) fn flatten_document_symbols(
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

pub(super) fn flatten_inlay_hint(hint: &InlayHint) -> FlatInlayHint {
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

pub(super) fn convert_diagnostic_context_to_lsp(context: LspDiagnosticContext) -> LspDiagnostic {
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

pub(super) fn symbol_kind_label(kind: SymbolKind) -> String {
   symbol_kind_to_string(kind)
}

fn uri_to_file_path(uri: &Url) -> String {
   uri.to_file_path()
      .map(|path| path.to_string_lossy().into_owned())
      .unwrap_or_else(|_| uri.to_string())
}

pub(super) fn flatten_workspace_symbol_response(
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

#[cfg(test)]
mod tests {
   use super::*;
   use lsp_types::{Location, Range, SymbolInformation};

   fn symbol_info(name: &str, uri: &str, line: u32, character: u32) -> SymbolInformation {
      #[allow(deprecated)]
      SymbolInformation {
         name: name.to_string(),
         kind: SymbolKind::FUNCTION,
         tags: None,
         deprecated: None,
         location: Location {
            uri: Url::parse(uri).unwrap(),
            range: Range {
               start: Position { line, character },
               end: Position {
                  line,
                  character: character + 5,
               },
            },
         },
         container_name: None,
      }
   }

   #[test]
   fn dedupes_identical_symbol_from_two_servers() {
      let response =
         WorkspaceSymbolResponse::Flat(vec![symbol_info("foo", "file:///workspace/a.rs", 10, 4)]);
      let responses = vec![response.clone(), response];

      let flattened = flatten_workspace_symbol_response(responses);
      assert_eq!(flattened.len(), 1);
      assert_eq!(flattened[0].name, "foo");
   }

   #[test]
   fn keeps_different_symbols_in_same_file() {
      let responses = vec![
         WorkspaceSymbolResponse::Flat(vec![symbol_info("foo", "file:///workspace/a.rs", 10, 4)]),
         WorkspaceSymbolResponse::Flat(vec![symbol_info("bar", "file:///workspace/a.rs", 20, 4)]),
      ];

      let flattened = flatten_workspace_symbol_response(responses);
      assert_eq!(flattened.len(), 2);
      let names: std::collections::HashSet<_> = flattened
         .iter()
         .map(|symbol| symbol.name.as_str())
         .collect();
      assert!(names.contains("foo"));
      assert!(names.contains("bar"));
   }

   #[test]
   fn empty_input_yields_empty_output() {
      let flattened = flatten_workspace_symbol_response(Vec::new());
      assert!(flattened.is_empty());
   }
}
