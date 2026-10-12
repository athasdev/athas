use super::*;
use lsp_types::SymbolInformation;

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

fn read_u32(bytes: &[u8], index: usize) -> u32 {
   u32::from_le_bytes(bytes[index * 4..index * 4 + 4].try_into().unwrap())
}

#[test]
fn packs_relative_semantic_tokens_and_legend_into_binary_payload() {
   let tokens = [
      SemanticToken {
         delta_line: 0,
         delta_start: 4,
         length: 3,
         token_type: 1,
         token_modifiers_bitset: 2,
      },
      SemanticToken {
         delta_line: 2,
         delta_start: 1,
         length: 5,
         token_type: 0,
         token_modifiers_bitset: 0,
      },
   ];
   let bytes = encode_semantic_tokens_payload(
      &tokens,
      &["variable".to_string(), "function".to_string()],
      &["declaration".to_string()],
   );

   let integer_count = read_u32(&bytes, 0) as usize;
   let legend_len = read_u32(&bytes, 1) as usize;
   assert_eq!(integer_count, 10);
   assert_eq!(
      (0..integer_count)
         .map(|index| read_u32(&bytes, index + 2))
         .collect::<Vec<_>>(),
      vec![0, 4, 3, 1, 2, 2, 1, 5, 0, 0]
   );
   let legend_start = 8 + integer_count * 4;
   assert_eq!(bytes.len(), legend_start + legend_len);
   let legend: serde_json::Value = serde_json::from_slice(&bytes[legend_start..]).unwrap();
   assert_eq!(
      legend,
      serde_json::json!({
         "tokenTypes": ["variable", "function"],
         "tokenModifiers": ["declaration"],
      })
   );
}

#[test]
fn packs_an_empty_semantic_token_payload_with_an_empty_legend() {
   let bytes = encode_semantic_tokens_payload(&[], &[], &[]);
   assert_eq!(read_u32(&bytes, 0), 0);
   let legend: serde_json::Value = serde_json::from_slice(&bytes[8..]).unwrap();
   assert_eq!(legend["tokenTypes"], serde_json::json!([]));
}

fn range(start_line: u32, start_character: u32, end_line: u32, end_character: u32) -> Range {
   Range {
      start: Position {
         line: start_line,
         character: start_character,
      },
      end: Position {
         line: end_line,
         character: end_character,
      },
   }
}

fn location(uri: &str, line: u32) -> Location {
   Location {
      uri: Url::parse(uri).unwrap(),
      range: range(line, 0, line, 3),
   }
}

#[test]
fn normalizes_every_goto_response_shape_to_locations() {
   assert_eq!(locations_from_goto_response(None), None);
   assert_eq!(
      locations_from_goto_response(Some(GotoDefinitionResponse::Scalar(location(
         "file:///a.rs",
         1
      )))),
      Some(vec![location("file:///a.rs", 1)])
   );
   assert_eq!(
      locations_from_goto_response(Some(GotoDefinitionResponse::Array(vec![
         location("file:///a.rs", 1),
         location("file:///b.rs", 2),
      ])))
      .map(|locations| locations.len()),
      Some(2)
   );
   let link = lsp_types::LocationLink {
      origin_selection_range: None,
      target_uri: Url::parse("file:///target.rs").unwrap(),
      target_range: range(10, 0, 20, 1),
      target_selection_range: range(12, 4, 12, 9),
   };
   assert_eq!(
      locations_from_goto_response(Some(GotoDefinitionResponse::Link(vec![link]))),
      Some(vec![Location {
         uri: Url::parse("file:///target.rs").unwrap(),
         range: range(12, 4, 12, 9),
      }])
   );
}

#[test]
fn converts_code_action_context_into_an_lsp_request() {
   let diagnostic = |severity: Option<&str>, code: Option<&str>| LspDiagnosticContext {
      line: 1,
      column: 2,
      end_line: 1,
      end_column: 8,
      message: "unused".to_string(),
      source: Some("rustc".to_string()),
      code: code.map(ToString::to_string),
      severity: severity.map(ToString::to_string),
   };
   let context = LspCodeActionContext {
      start_line: 1,
      start_column: 2,
      end_line: 3,
      end_column: 4,
      diagnostics: vec![
         diagnostic(Some("error"), Some("E0308")),
         diagnostic(Some("warning"), Some("42")),
         diagnostic(Some("info"), None),
         diagnostic(Some("hint"), None),
      ],
   };

   let (requested, diagnostics) = context.into_request();

   assert_eq!(requested, range(1, 2, 3, 4));
   assert_eq!(diagnostics[0].range, range(1, 2, 1, 8));
   assert_eq!(diagnostics[0].severity, Some(DiagnosticSeverity::ERROR));
   assert_eq!(
      diagnostics[0].code,
      Some(NumberOrString::String("E0308".to_string()))
   );
   assert_eq!(diagnostics[1].severity, Some(DiagnosticSeverity::WARNING));
   assert_eq!(diagnostics[1].code, Some(NumberOrString::Number(42)));
   assert_eq!(
      diagnostics[2].severity,
      Some(DiagnosticSeverity::INFORMATION)
   );
   assert_eq!(diagnostics[3].severity, None);
   assert_eq!(diagnostics[3].source.as_deref(), Some("rustc"));
}

#[test]
fn summarizes_code_actions_and_keeps_a_replayable_payload() {
   let command = lsp_types::Command {
      title: "Run test".to_string(),
      command: "rust-analyzer.runSingle".to_string(),
      arguments: None,
   };
   let action = lsp_types::CodeAction {
      title: "Import HashMap".to_string(),
      kind: Some(lsp_types::CodeActionKind::QUICKFIX),
      diagnostics: None,
      edit: Some(lsp_types::WorkspaceEdit::default()),
      command: None,
      is_preferred: Some(true),
      disabled: Some(lsp_types::CodeActionDisabled {
         reason: "not now".to_string(),
      }),
      data: None,
   };

   let items = code_action_items(vec![
      CodeActionOrCommand::Command(command.clone()),
      CodeActionOrCommand::CodeAction(action),
   ]);

   assert_eq!(items[0].id, "command-0");
   assert_eq!(items[0].title, "Run test");
   assert!(items[0].has_command && !items[0].has_edit);
   assert_eq!(
      serde_json::from_value::<CodeActionOrCommand>(items[0].payload.clone()).unwrap(),
      CodeActionOrCommand::Command(command)
   );
   assert_eq!(items[1].id, "code-action-1");
   assert_eq!(items[1].kind.as_deref(), Some("quickfix"));
   assert!(items[1].is_preferred);
   assert!(items[1].has_edit && !items[1].has_command);
   assert_eq!(items[1].disabled_reason.as_deref(), Some("not now"));
   assert_eq!(items[1].payload["title"], "Import HashMap");
}

#[test]
fn encodes_semantic_token_responses_and_reads_the_legend_only_when_needed() {
   let empty = semantic_tokens_payload(None, || panic!("legend must not be read"));
   assert_eq!(empty, encode_semantic_tokens_payload(&[], &[], &[]));

   let token = SemanticToken {
      delta_line: 1,
      delta_start: 2,
      length: 3,
      token_type: 0,
      token_modifiers_bitset: 1,
   };
   let partial = semantic_tokens_payload(
      Some(SemanticTokensResult::Partial(
         lsp_types::SemanticTokensPartialResult { data: vec![token] },
      )),
      || (vec!["function".to_string()], vec!["static".to_string()]),
   );
   assert_eq!(
      partial,
      encode_semantic_tokens_payload(&[token], &["function".to_string()], &["static".to_string()])
   );
   assert_eq!(read_u32(&partial, 0), 5);
}

#[test]
fn keeps_only_resolved_code_lenses() {
   let lenses = flatten_code_lenses(Some(vec![
      CodeLens {
         range: range(4, 0, 4, 10),
         command: Some(lsp_types::Command {
            title: "2 references".to_string(),
            command: "editor.showReferences".to_string(),
            arguments: Some(vec![serde_json::json!("file:///a.rs")]),
         }),
         data: None,
      },
      CodeLens {
         range: range(9, 0, 9, 10),
         command: None,
         data: None,
      },
   ]));

   assert_eq!(lenses.len(), 1);
   assert_eq!(lenses[0].line, 4);
   assert_eq!(lenses[0].title, "2 references");
   assert_eq!(lenses[0].command.as_deref(), Some("editor.showReferences"));
   assert_eq!(
      lenses[0].arguments,
      Some(vec![serde_json::json!("file:///a.rs")])
   );
   assert!(flatten_code_lenses(None).is_empty());
}

#[test]
fn flattens_text_edits_and_inlay_hints() {
   let edits = flatten_text_edits(Some(vec![TextEdit {
      range: range(1, 2, 3, 4),
      new_text: "x".to_string(),
   }]));
   assert_eq!(edits.len(), 1);
   assert_eq!(edits[0].range.start.line, 1);
   assert_eq!(edits[0].range.start.character, 2);
   assert_eq!(edits[0].range.end.line, 3);
   assert_eq!(edits[0].range.end.character, 4);
   assert_eq!(edits[0].new_text, "x");
   assert!(flatten_text_edits(None).is_empty());

   let hint = |label: InlayHintLabel, kind: Option<lsp_types::InlayHintKind>| InlayHint {
      position: Position {
         line: 7,
         character: 3,
      },
      label,
      kind,
      text_edits: None,
      tooltip: None,
      padding_left: Some(true),
      padding_right: None,
      data: None,
   };
   let part = |value: &str| lsp_types::InlayHintLabelPart {
      value: value.to_string(),
      ..Default::default()
   };
   let hints = flatten_inlay_hints(Some(vec![
      hint(
         InlayHintLabel::String(": u32".to_string()),
         Some(lsp_types::InlayHintKind::TYPE),
      ),
      hint(
         InlayHintLabel::LabelParts(vec![part("name"), part(":")]),
         Some(lsp_types::InlayHintKind::PARAMETER),
      ),
      hint(InlayHintLabel::String("?".to_string()), None),
   ]));
   assert_eq!(hints[0].label, ": u32");
   assert_eq!(hints[0].kind.as_deref(), Some("type"));
   assert_eq!((hints[0].line, hints[0].character), (7, 3));
   assert!(hints[0].padding_left && !hints[0].padding_right);
   assert_eq!(hints[1].label, "name:");
   assert_eq!(hints[1].kind.as_deref(), Some("parameter"));
   assert_eq!(hints[2].kind, None);
}

#[test]
fn flattens_flat_and_nested_document_symbols() {
   let mut flat = symbol_info("helper", "file:///a.rs", 3, 1);
   flat.kind = SymbolKind::ENUM_MEMBER;
   flat.container_name = Some("Mode".to_string());
   let flattened = flatten_document_symbol_response(Some(DocumentSymbolResponse::Flat(vec![flat])));
   assert_eq!(flattened[0].kind, "enum-member");
   assert_eq!(flattened[0].container_name.as_deref(), Some("Mode"));
   assert!(flattened[0].hierarchy_path.is_empty());

   #[allow(deprecated)]
   let symbol =
      |name: &str, kind: SymbolKind, children: Option<Vec<DocumentSymbol>>| DocumentSymbol {
         name: name.to_string(),
         detail: Some(format!("{name} detail")),
         kind,
         tags: None,
         deprecated: None,
         range: range(0, 0, 10, 1),
         selection_range: range(1, 4, 1, 8),
         children,
      };
   let nested = flatten_document_symbol_response(Some(DocumentSymbolResponse::Nested(vec![
      symbol("Other", SymbolKind::CONSTANT, None),
      symbol(
         "Editor",
         SymbolKind::STRUCT,
         Some(vec![
            symbol("open", SymbolKind::METHOD, None),
            symbol("close", SymbolKind::METHOD, None),
         ]),
      ),
   ])));
   let summary = nested
      .iter()
      .map(|symbol| {
         (
            symbol.name.as_str(),
            symbol.kind.as_str(),
            symbol.container_name.as_deref(),
            symbol.hierarchy_path.clone(),
         )
      })
      .collect::<Vec<_>>();
   assert_eq!(
      summary,
      vec![
         ("Other", "constant", None, vec![0]),
         ("Editor", "struct", None, vec![1]),
         ("open", "method", Some("Editor"), vec![1, 0]),
         ("close", "method", Some("Editor"), vec![1, 1]),
      ]
   );
   assert_eq!((nested[0].line, nested[0].character), (1, 4));
   assert_eq!((nested[0].end_line, nested[0].end_character), (10, 1));
   assert!(flatten_document_symbol_response(None).is_empty());
}
