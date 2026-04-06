use super::types::{FlatInlayHint, FlatSymbol, LspDiagnosticContext};
use lsp_types::{
   Diagnostic as LspDiagnostic, DiagnosticSeverity, DocumentSymbol, InlayHint, InlayHintLabel,
   NumberOrString, Position, Range, SymbolKind,
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
   let mut result = Vec::new();
   for symbol in symbols {
      result.push(FlatSymbol {
         name: symbol.name.clone(),
         kind: symbol_kind_to_string(symbol.kind),
         detail: symbol.detail.clone(),
         line: symbol.selection_range.start.line,
         character: symbol.selection_range.start.character,
         end_line: symbol.selection_range.end.line,
         end_character: symbol.selection_range.end.character,
         container_name: container.map(|s| s.to_string()),
      });
      if let Some(children) = &symbol.children {
         result.extend(flatten_document_symbols(children, Some(&symbol.name)));
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
