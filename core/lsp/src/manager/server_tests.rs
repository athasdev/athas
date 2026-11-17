//! `LspManager` driven against the scripted server in `test_support`, which answers requests from
//! the `fakeResponses` initialization option and reports what it received on `test/received`.

use super::*;
use crate::{document_sync::DocumentChange, test_support::fake_server_command};
use serde_json::json;
use tempfile::TempDir;

struct Fixture {
   manager: LspManager,
   workspace: TempDir,
}

impl Fixture {
   fn path(&self, name: &str) -> String {
      self
         .workspace
         .path()
         .join(name)
         .to_string_lossy()
         .into_owned()
   }
}

fn initialization(capabilities: Value, responses: Value) -> LspInitialization {
   LspInitialization {
      options: Some(json!({ "fakeCapabilities": capabilities, "fakeResponses": responses })),
      workspace_edit_owner: None,
      window_label: None,
   }
}

fn owned_by(owner: &str) -> LspInitialization {
   LspInitialization {
      workspace_edit_owner: Some(owner.to_string()),
      ..LspInitialization::default()
   }
}

async fn start_for_file(
   manager: &LspManager,
   workspace: &Path,
   file: &str,
   initialization: LspInitialization,
) -> Result<()> {
   let (exe, args, env) = fake_server_command();
   manager
      .start_lsp_for_file(
         PathBuf::from(file),
         workspace.to_path_buf(),
         Some(exe.to_string_lossy().into_owned()),
         Some(args),
         Some(env),
         initialization,
      )
      .await
}

async fn fixture(capabilities: Value, responses: Value) -> Fixture {
   let workspace = tempfile::tempdir().unwrap();
   let manager = LspManager::with_app_handle(None);
   let main = workspace.path().join("main.rs");
   start_for_file(
      &manager,
      workspace.path(),
      &main.to_string_lossy(),
      initialization(capabilities, responses),
   )
   .await
   .unwrap();
   Fixture { manager, workspace }
}

/// Every message the server received, in order, without flushing queued document changes.
async fn received(manager: &LspManager, file: &str) -> Vec<Value> {
   manager
      .raw_client_for_file(file)
      .expect("client for file")
      .request_value("test/received", Value::Null)
      .await
      .unwrap()
      .as_array()
      .unwrap()
      .clone()
}

fn methods(received: &[Value]) -> Vec<String> {
   received
      .iter()
      .map(|message| message["method"].as_str().unwrap().to_string())
      .collect()
}

fn last_params(received: &[Value], method: &str) -> Value {
   received
      .iter()
      .rev()
      .find(|message| message["method"] == method)
      .map(|message| message["params"].clone())
      .unwrap_or_else(|| panic!("{method} was not sent"))
}

fn all_params(received: &[Value], method: &str) -> Vec<Value> {
   received
      .iter()
      .filter(|message| message["method"] == method)
      .map(|message| message["params"].clone())
      .collect()
}

async fn wait_until(mut condition: impl FnMut() -> bool) {
   for _ in 0..200 {
      if condition() {
         return;
      }
      tokio::time::sleep(Duration::from_millis(25)).await;
   }
   panic!("condition was not met in time");
}

fn range(start_line: u32, end_line: u32) -> Value {
   json!({
      "start": { "line": start_line, "character": 0 },
      "end": { "line": end_line, "character": 1 }
   })
}

fn hierarchy_item(uri: &str, name: &str) -> Value {
   json!({
      "name": name,
      "kind": 12,
      "uri": uri,
      "range": range(0, 1),
      "selectionRange": range(0, 0)
   })
}

fn insert(offset: usize, text: &str, line: u32, column: u32) -> DocumentChange {
   DocumentChange {
      range_offset: offset,
      range_length: 0,
      text: text.to_string(),
      start_line: line,
      start_column: column,
      end_line: line,
      end_column: column,
   }
}

fn batch(version: i64, changes: Vec<DocumentChange>) -> DocumentChangeBatch {
   DocumentChangeBatch {
      model_session_id: "model".to_string(),
      model_version_id: version,
      changes,
      is_eol_change: false,
      is_flush: false,
      full_content: None,
   }
}

#[tokio::test]
async fn shares_one_server_per_workspace_language_until_the_last_file_closes() {
   let f = fixture(json!({}), json!({})).await;
   let main = f.path("main.rs");
   let lib = f.path("lib.rs");
   let first = f.manager.raw_client_for_file(&main).unwrap();

   start_for_file(
      &f.manager,
      f.workspace.path(),
      &lib,
      LspInitialization::default(),
   )
   .await
   .unwrap();
   // Reopening a tracked file must not add a reference that is never released.
   start_for_file(
      &f.manager,
      f.workspace.path(),
      &main,
      LspInitialization::default(),
   )
   .await
   .unwrap();
   assert_eq!(
      f.manager.raw_client_for_file(&lib).unwrap().id(),
      first.id()
   );
   assert_eq!(
      methods(&received(&f.manager, &main).await),
      vec!["initialize", "initialized"],
      "the running server must be reused instead of initialized again"
   );

   f.manager.stop_lsp_for_file(&PathBuf::from(&main)).unwrap();
   assert!(f.manager.raw_client_for_file(&lib).is_some());
   assert!(first.is_running());

   f.manager.stop_lsp_for_file(&PathBuf::from(&lib)).unwrap();
   assert!(f.manager.raw_client_for_file(&lib).is_none());
   wait_until(|| !first.is_running()).await;
}

#[tokio::test]
async fn files_outside_the_workspace_or_language_have_no_client() {
   let f = fixture(json!({}), json!({})).await;
   let other_workspace = tempfile::tempdir().unwrap();

   assert!(
      f.manager
         .raw_client_for_file(&f.path("nested/mod.rs"))
         .is_some()
   );
   assert!(f.manager.raw_client_for_file(&f.path("index.ts")).is_none());
   assert!(
      f.manager
         .raw_client_for_file(&other_workspace.path().join("main.rs").to_string_lossy())
         .is_none()
   );
}

#[tokio::test]
async fn reports_servers_that_cannot_be_resolved() {
   let workspace = tempfile::tempdir().unwrap();
   let manager = LspManager::with_app_handle(None);
   let file = workspace.path().join("main.rs");

   let error = manager
      .start_lsp_for_file(
         file.clone(),
         workspace.path().to_path_buf(),
         None,
         None,
         None,
         LspInitialization::default(),
      )
      .await
      .unwrap_err();
   assert!(error.to_string().contains("No LSP server found for file"));

   let error = manager
      .start_lsp_for_workspace(
         workspace.path().to_path_buf(),
         None,
         None,
         None,
         LspInitialization::default(),
      )
      .await
      .unwrap_err();
   assert!(
      error
         .to_string()
         .contains("No LSP server found for workspace")
   );

   let missing = workspace.path().join("bin/missing-server");
   let error = manager
      .start_lsp_for_file(
         file.clone(),
         workspace.path().to_path_buf(),
         Some(missing.to_string_lossy().into_owned()),
         None,
         None,
         LspInitialization::default(),
      )
      .await
      .unwrap_err();
   assert!(error.to_string().contains("binary not found"), "{error}");

   let error = manager
      .start_lsp_for_workspace(
         workspace.path().to_path_buf(),
         Some("bare-lsp-command".to_string()),
         None,
         None,
         LspInitialization::default(),
      )
      .await
      .unwrap_err();
   assert!(
      error.to_string().contains("Failed to resolve app data dir"),
      "{error}"
   );
   assert!(
      manager
         .raw_client_for_file(&file.to_string_lossy())
         .is_none()
   );
}

#[tokio::test]
async fn a_new_workspace_edit_owner_replaces_the_running_server() {
   let workspace = tempfile::tempdir().unwrap();
   let manager = LspManager::with_app_handle(None);
   let main = workspace
      .path()
      .join("main.rs")
      .to_string_lossy()
      .into_owned();
   let lib = workspace
      .path()
      .join("lib.rs")
      .to_string_lossy()
      .into_owned();

   start_for_file(&manager, workspace.path(), &main, owned_by("window-a"))
      .await
      .unwrap();
   let first = manager.raw_client_for_file(&main).unwrap();
   assert!(manager.validate_workspace_edit_owner(first.id(), "window-a"));
   assert!(!manager.validate_workspace_edit_owner(first.id(), "window-b"));

   start_for_file(&manager, workspace.path(), &lib, owned_by("window-b"))
      .await
      .unwrap();
   let second = manager.raw_client_for_file(&lib).unwrap();

   assert_ne!(first.id(), second.id());
   wait_until(|| !first.is_running()).await;
   assert!(!manager.validate_workspace_edit_owner(first.id(), "window-a"));
   assert!(manager.validate_workspace_edit_owner(second.id(), "window-b"));
   manager
      .respond_workspace_edit(second.id(), json!("srv-1"), true, None, None)
      .unwrap();
   let error = manager
      .respond_workspace_edit(first.id(), json!("srv-1"), false, None, None)
      .unwrap_err();
   assert!(error.to_string().contains("no longer available"));
}

#[cfg(unix)]
#[tokio::test]
async fn workspace_symbols_fan_out_and_skip_failing_servers() {
   let workspace = tempfile::tempdir().unwrap();
   let manager = LspManager::with_app_handle(None);
   assert!(
      manager
         .get_workspace_symbols(workspace.path(), "main")
         .await
         .unwrap()
         .is_empty()
   );

   let (exe, args, env) = fake_server_command();
   let uri = Url::from_file_path(workspace.path().join("main.rs")).unwrap();
   let symbols = json!({ "result": [{
      "name": "main",
      "kind": 12,
      "location": { "uri": uri, "range": range(0, 1) }
   }]});
   let start = |path: PathBuf, initialization: LspInitialization| {
      manager.start_lsp_for_workspace(
         workspace.path().to_path_buf(),
         Some(path.to_string_lossy().into_owned()),
         Some(args.clone()),
         Some(env.clone()),
         initialization,
      )
   };

   start(
      exe.clone(),
      initialization(json!({}), json!({ "workspace/symbol": symbols })),
   )
   .await
   .unwrap();
   start(exe.clone(), LspInitialization::default())
      .await
      .unwrap();
   assert_eq!(
      manager
         .workspace_clients
         .get_clients_for_workspace(workspace.path())
         .len(),
      1,
      "starting the same server twice must reuse it"
   );

   // A second, differently named server that does not implement workspace/symbol.
   let alias = workspace.path().join("second-language-server");
   std::os::unix::fs::symlink(&exe, &alias).unwrap();
   start(alias, LspInitialization::default()).await.unwrap();
   assert_eq!(
      manager
         .workspace_clients
         .get_clients_for_workspace(workspace.path())
         .len(),
      2
   );

   let responses = manager
      .get_workspace_symbols(workspace.path(), "main")
      .await
      .unwrap();
   assert_eq!(responses.len(), 1);
   match &responses[0] {
      WorkspaceSymbolResponse::Flat(symbols) => assert_eq!(symbols[0].name, "main"),
      WorkspaceSymbolResponse::Nested(_) => panic!("expected flat symbols"),
   }

   manager.shutdown_workspace(workspace.path()).unwrap();
   assert!(
      manager
         .workspace_clients
         .get_clients_for_workspace(workspace.path())
         .is_empty()
   );
}

#[tokio::test]
async fn completions_are_capped_and_carry_the_trigger_context() {
   let many: Vec<Value> = (0..105)
      .map(|index| json!({ "label": format!("item{index}") }))
      .collect();
   let f = fixture(
      json!({}),
      json!({
         "textDocument/completion": [
            { "result": many },
            { "result": { "isIncomplete": true, "items": [{ "label": "listed" }] } },
            { "result": null }
         ],
         "completionItem/resolve": { "result": { "label": "listed", "detail": "resolved" } }
      }),
   )
   .await;
   let main = f.path("main.rs");

   let capped = f
      .manager
      .get_completions(&main, 1, 2, Some(2), Some(".".to_string()))
      .await
      .unwrap();
   assert_eq!(capped.len(), f.manager.settings.max_completion_items);
   assert_eq!(capped[0].label, "item0");

   let listed = f
      .manager
      .get_completions(&main, 3, 4, Some(3), None)
      .await
      .unwrap();
   assert_eq!(listed.len(), 1);
   assert_eq!(listed[0].label, "listed");

   assert!(
      f.manager
         .get_completions(&main, 0, 0, None, None)
         .await
         .unwrap()
         .is_empty()
   );

   let resolved = f
      .manager
      .resolve_completion_item(&main, listed[0].clone())
      .await
      .unwrap();
   assert_eq!(resolved.detail.as_deref(), Some("resolved"));

   let sent = all_params(
      &received(&f.manager, &main).await,
      "textDocument/completion",
   );
   assert_eq!(sent[0]["position"], json!({ "line": 1, "character": 2 }));
   assert_eq!(
      sent[0]["context"],
      json!({ "triggerKind": 2, "triggerCharacter": "." })
   );
   assert_eq!(sent[1]["context"]["triggerKind"], 3);
   assert_eq!(sent[2]["context"]["triggerKind"], 1);
   assert_eq!(
      sent[0]["textDocument"]["uri"],
      json!(Url::from_file_path(&main).unwrap())
   );

   let error = f
      .manager
      .get_completions(&f.path("index.ts"), 0, 0, None, None)
      .await
      .unwrap_err();
   assert!(error.to_string().contains("No LSP client"));
}

#[tokio::test]
async fn forwards_language_features_and_returns_server_results() {
   let workspace = tempfile::tempdir().unwrap();
   let main_path = workspace.path().join("main.rs");
   let uri = Url::from_file_path(&main_path).unwrap().to_string();
   let location = json!({ "uri": uri, "range": range(2, 3) });
   let edit = json!({ "range": range(0, 0), "newText": "x" });
   let item = hierarchy_item(&uri, "main");
   let responses = json!({
      "textDocument/hover": { "result": { "contents": "docs" } },
      "textDocument/definition": { "result": location },
      "textDocument/implementation": { "result": [location, location] },
      "textDocument/typeDefinition": { "result": null },
      "textDocument/inlayHint": {
         "result": [{ "position": { "line": 5, "character": 2 }, "label": ": i32" }]
      },
      "textDocument/documentSymbol": {
         "result": [{ "name": "main", "kind": 12, "range": range(0, 3), "selectionRange": range(0, 0) }]
      },
      "textDocument/formatting": { "result": [edit] },
      "textDocument/rangeFormatting": { "result": [edit, edit] },
      "textDocument/foldingRange": { "result": [{ "startLine": 0, "endLine": 3 }] },
      "textDocument/selectionRange": { "result": [{ "range": range(1, 1) }] },
      "textDocument/documentHighlight": { "result": [{ "range": range(1, 1), "kind": 2 }] },
      "textDocument/onTypeFormatting": { "result": [edit] },
      "textDocument/signatureHelp": { "result": { "signatures": [{ "label": "f(a: i32)" }] } },
      "textDocument/references": { "result": [location] },
      "textDocument/rename": { "result": { "changes": { (uri.clone()): [edit] } } },
      "textDocument/prepareRename": { "result": range(4, 4) },
      "textDocument/codeLens": { "result": [{ "range": range(0, 0) }] },
      "textDocument/codeAction": { "result": [{ "title": "Fix it", "kind": "quickfix" }] },
      "textDocument/prepareCallHierarchy": { "result": [item] },
      "callHierarchy/incomingCalls": { "result": [{ "from": item, "fromRanges": [range(1, 1)] }] },
      "callHierarchy/outgoingCalls": { "result": null },
      "textDocument/prepareTypeHierarchy": { "result": [item] },
      "typeHierarchy/supertypes": { "result": [hierarchy_item(&uri, "Base")] },
      "typeHierarchy/subtypes": { "result": null },
      "workspace/executeCommand": { "result": { "applied": true } },
      "java/classFileContents": { "result": "class Foo {}" },
      "textDocument/semanticTokens/full": { "result": { "data": [0, 0, 4, 1, 0] } }
   });
   let capabilities = json!({
      "codeLensProvider": {},
      "codeActionProvider": true,
      "signatureHelpProvider": { "triggerCharacters": ["(", ","] },
      "documentOnTypeFormattingProvider": {
         "firstTriggerCharacter": "}",
         "moreTriggerCharacter": [";"]
      },
      "semanticTokensProvider": {
         "legend": { "tokenTypes": ["function", "variable"], "tokenModifiers": ["declaration"] },
         "full": true
      }
   });
   let manager = LspManager::with_app_handle(None);
   start_for_file(
      &manager,
      workspace.path(),
      &main_path.to_string_lossy(),
      initialization(capabilities, responses),
   )
   .await
   .unwrap();
   let f = Fixture { manager, workspace };
   let main = f.path("main.rs");
   let m = &f.manager;

   let hover = m.get_hover(&main, 1, 2).await.unwrap().unwrap();
   assert_eq!(
      hover.contents,
      HoverContents::Scalar(MarkedString::String("docs".to_string()))
   );
   assert!(matches!(
      m.get_definition(&main, 1, 2).await.unwrap(),
      Some(GotoDefinitionResponse::Scalar(_))
   ));
   assert!(matches!(
      m.get_implementation(&main, 1, 2).await.unwrap(),
      Some(GotoDefinitionResponse::Array(locations)) if locations.len() == 2
   ));
   assert!(m.get_type_definition(&main, 1, 2).await.unwrap().is_none());
   assert_eq!(
      m.get_inlay_hints(&main, 4, 9).await.unwrap().unwrap().len(),
      1
   );
   assert!(matches!(
      m.get_document_symbols(&main).await.unwrap(),
      Some(DocumentSymbolResponse::Nested(symbols)) if symbols[0].name == "main"
   ));
   assert_eq!(m.format_document(&main).await.unwrap().unwrap().len(), 1);
   assert_eq!(
      m.format_range(&main, 1, 2, 3, 4)
         .await
         .unwrap()
         .unwrap()
         .len(),
      2
   );
   assert_eq!(m.get_folding_ranges(&main).await.unwrap()[0].end_line, 3);
   assert_eq!(
      m.get_selection_ranges(&main, vec![Position::new(1, 0)])
         .await
         .unwrap()
         .len(),
      1
   );
   assert_eq!(
      m.get_document_highlights(&main, 1, 0).await.unwrap()[0].kind,
      Some(DocumentHighlightKind::READ)
   );
   assert_eq!(
      m.format_on_type(&main, 2, 1, "}".to_string(), 2, false)
         .await
         .unwrap()
         .len(),
      1
   );
   assert_eq!(
      m.get_signature_help(&main, 1, 2)
         .await
         .unwrap()
         .unwrap()
         .signatures[0]
         .label,
      "f(a: i32)"
   );
   assert_eq!(
      m.get_references(&main, 1, 2).await.unwrap().unwrap().len(),
      1
   );
   assert_eq!(
      m.rename(&main, 1, 2, "renamed".to_string())
         .await
         .unwrap()
         .unwrap()
         .changes
         .unwrap()
         .len(),
      1
   );
   assert!(matches!(
      m.prepare_rename(&main, 4, 0).await.unwrap(),
      Some(PrepareRenameResponse::Range(range)) if range.start.line == 4
   ));
   assert_eq!(m.get_code_lens(&main).await.unwrap().unwrap().len(), 1);
   let diagnostic = Diagnostic {
      range: Range::default(),
      message: "unused".to_string(),
      ..Default::default()
   };
   let actions = m
      .get_code_actions(&main, Range::default(), vec![diagnostic])
      .await
      .unwrap();
   assert!(matches!(
      &actions[..],
      [CodeActionOrCommand::CodeAction(action)] if action.title == "Fix it"
   ));

   let items = m.prepare_call_hierarchy(&main, 0, 0).await.unwrap();
   assert_eq!(items[0].name, "main");
   assert_eq!(
      m.get_incoming_calls(&main, items[0].clone())
         .await
         .unwrap()
         .len(),
      1
   );
   assert!(
      m.get_outgoing_calls(&main, items[0].clone())
         .await
         .unwrap()
         .is_empty()
   );
   let types = m.prepare_type_hierarchy(&main, 0, 0).await.unwrap();
   assert_eq!(
      m.get_supertypes(&main, types[0].clone()).await.unwrap()[0].name,
      "Base"
   );
   assert!(
      m.get_subtypes(&main, types[0].clone())
         .await
         .unwrap()
         .is_empty()
   );

   assert_eq!(
      m.execute_command(&main, "rust.run".to_string(), vec![json!(1)])
         .await
         .unwrap(),
      Some(json!({ "applied": true }))
   );
   let class_uri = Url::parse("jdt://contents/Foo.class").unwrap();
   assert_eq!(
      m.get_java_class_file_contents(&main, class_uri)
         .await
         .unwrap(),
      "class Foo {}"
   );
   assert!(matches!(
      m.get_semantic_tokens(&main).await.unwrap(),
      Some(SemanticTokensResult::Tokens(tokens)) if tokens.data.len() == 1
   ));

   assert_eq!(
      m.semantic_token_legend(&main),
      (
         vec!["function".to_string(), "variable".to_string()],
         vec!["declaration".to_string()]
      )
   );
   assert_eq!(
      m.get_signature_help_trigger_characters(&main),
      vec!["(", ","]
   );
   assert_eq!(
      m.get_on_type_formatting_trigger_characters(&main),
      vec!["}", ";"]
   );

   let sent = received(m, &main).await;
   let formatting = last_params(&sent, "textDocument/formatting");
   assert_eq!(formatting["options"]["tabSize"], 3);
   assert_eq!(formatting["options"]["insertSpaces"], true);
   assert_eq!(
      last_params(&sent, "textDocument/rangeFormatting")["range"],
      json!({ "start": { "line": 1, "character": 2 }, "end": { "line": 3, "character": 4 } })
   );
   assert_eq!(
      last_params(&sent, "textDocument/inlayHint")["range"],
      json!({ "start": { "line": 4, "character": 0 }, "end": { "line": 9, "character": 0 } })
   );
   let on_type = last_params(&sent, "textDocument/onTypeFormatting");
   assert_eq!(on_type["ch"], "}");
   assert_eq!(on_type["options"]["tabSize"], 2);
   assert_eq!(on_type["options"]["insertSpaces"], false);
   assert_eq!(
      last_params(&sent, "textDocument/references")["context"]["includeDeclaration"],
      true
   );
   assert_eq!(
      last_params(&sent, "textDocument/rename")["newName"],
      "renamed"
   );
   let code_action = last_params(&sent, "textDocument/codeAction");
   assert_eq!(code_action["context"]["triggerKind"], 1);
   assert_eq!(
      code_action["context"]["diagnostics"][0]["message"],
      "unused"
   );
   let command = last_params(&sent, "workspace/executeCommand");
   assert_eq!(command["command"], "rust.run");
   assert_eq!(command["arguments"], json!([1]));
   assert_eq!(
      last_params(&sent, "java/classFileContents")["uri"],
      "jdt://contents/Foo.class"
   );
}

#[tokio::test]
async fn unsupported_methods_degrade_to_empty_results() {
   let f = fixture(
      json!({ "codeLensProvider": {}, "codeActionProvider": true }),
      json!({}),
   )
   .await;
   let main = f.path("main.rs");
   let m = &f.manager;

   assert!(m.get_hover(&main, 0, 0).await.unwrap().is_none());
   assert!(m.get_definition(&main, 0, 0).await.unwrap().is_none());
   assert!(m.get_implementation(&main, 0, 0).await.unwrap().is_none());
   assert!(m.get_type_definition(&main, 0, 0).await.unwrap().is_none());
   assert!(m.get_semantic_tokens(&main).await.unwrap().is_none());
   assert!(m.get_inlay_hints(&main, 0, 1).await.unwrap().is_none());
   assert!(m.get_document_symbols(&main).await.unwrap().is_none());
   assert!(m.format_document(&main).await.unwrap().is_none());
   assert!(m.format_range(&main, 0, 0, 1, 0).await.unwrap().is_none());
   assert!(m.get_folding_ranges(&main).await.unwrap().is_empty());
   assert!(
      m.get_selection_ranges(&main, vec![Position::default()])
         .await
         .unwrap()
         .is_empty()
   );
   assert!(
      m.get_document_highlights(&main, 0, 0)
         .await
         .unwrap()
         .is_empty()
   );
   assert!(
      m.format_on_type(&main, 0, 0, ";".to_string(), 4, true)
         .await
         .unwrap()
         .is_empty()
   );
   assert!(m.get_signature_help(&main, 0, 0).await.unwrap().is_none());
   assert!(m.get_references(&main, 0, 0).await.unwrap().is_none());
   assert!(
      m.rename(&main, 0, 0, "x".to_string())
         .await
         .unwrap()
         .is_none()
   );
   assert!(m.prepare_rename(&main, 0, 0).await.unwrap().is_none());
   assert!(m.get_code_lens(&main).await.unwrap().is_none());
   assert!(
      m.get_code_actions(&main, Range::default(), Vec::new())
         .await
         .unwrap()
         .is_empty()
   );
   assert_eq!(
      m.apply_code_action(
         &main,
         CodeActionOrCommand::Command(Command::new("Run".into(), "run".into(), None)),
      )
      .await
      .unwrap(),
      (
         false,
         Some("Server does not support workspace/executeCommand".to_string())
      )
   );

   // Hierarchy and raw command requests have no fallback and report the failure.
   assert!(m.prepare_call_hierarchy(&main, 0, 0).await.is_err());
   assert!(m.prepare_type_hierarchy(&main, 0, 0).await.is_err());
   assert!(
      m.execute_command(&main, "run".to_string(), Vec::new())
         .await
         .is_err()
   );
}

#[tokio::test]
async fn other_server_errors_are_reported() {
   let methods = [
      "textDocument/hover",
      "textDocument/definition",
      "textDocument/implementation",
      "textDocument/typeDefinition",
      "textDocument/semanticTokens/full",
      "textDocument/inlayHint",
      "textDocument/documentSymbol",
      "textDocument/formatting",
      "textDocument/rangeFormatting",
      "textDocument/foldingRange",
      "textDocument/selectionRange",
      "textDocument/documentHighlight",
      "textDocument/onTypeFormatting",
      "textDocument/signatureHelp",
      "textDocument/references",
      "textDocument/rename",
      "textDocument/prepareRename",
      "textDocument/codeLens",
      "textDocument/codeAction",
      "workspace/executeCommand",
   ];
   let failure = json!({ "error": { "code": -32603, "message": "internal failure" } });
   let responses: serde_json::Map<String, Value> = methods
      .iter()
      .map(|method| (method.to_string(), failure.clone()))
      .collect();
   let f = fixture(
      json!({ "codeLensProvider": {}, "codeActionProvider": true }),
      Value::Object(responses),
   )
   .await;
   let main = f.path("main.rs");
   let m = &f.manager;

   let errors = [
      m.get_hover(&main, 0, 0).await.err(),
      m.get_definition(&main, 0, 0).await.err(),
      m.get_implementation(&main, 0, 0).await.err(),
      m.get_type_definition(&main, 0, 0).await.err(),
      m.get_semantic_tokens(&main).await.err(),
      m.get_inlay_hints(&main, 0, 1).await.err(),
      m.get_document_symbols(&main).await.err(),
      m.format_document(&main).await.err(),
      m.format_range(&main, 0, 0, 1, 0).await.err(),
      m.get_folding_ranges(&main).await.err(),
      m.get_selection_ranges(&main, vec![Position::default()])
         .await
         .err(),
      m.get_document_highlights(&main, 0, 0).await.err(),
      m.format_on_type(&main, 0, 0, ";".to_string(), 4, true)
         .await
         .err(),
      m.get_signature_help(&main, 0, 0).await.err(),
      m.get_references(&main, 0, 0).await.err(),
      m.rename(&main, 0, 0, "x".to_string()).await.err(),
      m.prepare_rename(&main, 0, 0).await.err(),
      m.get_code_lens(&main).await.err(),
      m.get_code_actions(&main, Range::default(), Vec::new())
         .await
         .err(),
      m.apply_code_action(
         &main,
         CodeActionOrCommand::Command(Command::new("Run".into(), "run".into(), None)),
      )
      .await
      .err(),
   ];

   for (method, error) in methods.iter().zip(errors) {
      let error = error.unwrap_or_else(|| panic!("{method} should report the server error"));
      assert!(
         error.to_string().contains("internal failure"),
         "{method}: {error}"
      );
   }
}

#[tokio::test]
async fn code_lens_and_actions_are_skipped_without_server_support() {
   let f = fixture(
      json!({ "codeActionProvider": false }),
      json!({
         "textDocument/codeLens": { "result": [] },
         "textDocument/codeAction": { "result": [] }
      }),
   )
   .await;
   let main = f.path("main.rs");

   assert!(f.manager.get_code_lens(&main).await.unwrap().is_none());
   assert!(
      f.manager
         .get_code_actions(&main, Range::default(), Vec::new())
         .await
         .unwrap()
         .is_empty()
   );
   let sent = methods(&received(&f.manager, &main).await);
   assert!(
      !sent
         .iter()
         .any(|method| method.starts_with("textDocument/code"))
   );
}

#[tokio::test]
async fn applies_code_actions_through_execute_command() {
   let ok = json!({ "result": null });
   let f = fixture(
      json!({}),
      json!({
         "workspace/executeCommand": [
            ok,
            ok,
            { "error": { "code": -32603, "message": "command crashed" } }
         ]
      }),
   )
   .await;
   let main = f.path("main.rs");
   let m = &f.manager;
   let command = Command::new("Fix all".into(), "fix.all".into(), Some(vec![json!(1)]));

   assert_eq!(
      m.apply_code_action(&main, CodeActionOrCommand::Command(command.clone()))
         .await
         .unwrap(),
      (true, None)
   );

   let disabled = CodeAction {
      title: "Disabled".into(),
      disabled: Some(CodeActionDisabled {
         reason: "Nothing to fix".into(),
      }),
      command: Some(command.clone()),
      ..Default::default()
   };
   assert_eq!(
      m.apply_code_action(&main, CodeActionOrCommand::CodeAction(disabled))
         .await
         .unwrap(),
      (false, Some("Nothing to fix".to_string()))
   );

   let edit_only = CodeAction {
      title: "Edit".into(),
      edit: Some(WorkspaceEdit::default()),
      ..Default::default()
   };
   assert_eq!(
      m.apply_code_action(&main, CodeActionOrCommand::CodeAction(edit_only))
         .await
         .unwrap(),
      (
         false,
         Some("Edit-only actions are not supported yet in this menu".to_string())
      )
   );

   let empty = CodeAction {
      title: "Empty".into(),
      ..Default::default()
   };
   assert_eq!(
      m.apply_code_action(&main, CodeActionOrCommand::CodeAction(empty))
         .await
         .unwrap(),
      (false, Some("Action has no executable command".to_string()))
   );

   let with_command = CodeAction {
      title: "Run".into(),
      edit: Some(WorkspaceEdit::default()),
      command: Some(Command::new("Run".into(), "run.it".into(), None)),
      ..Default::default()
   };
   assert_eq!(
      m.apply_code_action(&main, CodeActionOrCommand::CodeAction(with_command.clone()))
         .await
         .unwrap(),
      (true, None)
   );

   let error = m
      .apply_code_action(&main, CodeActionOrCommand::CodeAction(with_command))
      .await
      .unwrap_err();
   assert!(error.to_string().contains("command crashed"));

   let sent = all_params(&received(m, &main).await, "workspace/executeCommand");
   assert_eq!(
      sent.len(),
      3,
      "disabled and command-less actions must not run"
   );
   assert_eq!(sent[0], json!({ "command": "fix.all", "arguments": [1] }));
   assert_eq!(sent[1], json!({ "command": "run.it", "arguments": [] }));
}

#[tokio::test]
async fn syncs_incremental_documents_through_open_change_save_and_close() {
   let f = fixture(
      json!({ "textDocumentSync": { "openClose": true, "change": 2, "save": { "includeText": true } } }),
      json!({ "textDocument/hover": { "result": null } }),
   )
   .await;
   let main = f.path("main.rs");
   let m = &f.manager;

   m.notify_document_open(&main, "fn main() {}\n".to_string(), None)
      .unwrap();
   assert_eq!(
      m.queue_document_changes(&main, batch(2, vec![insert(0, "pub ", 0, 0)]))
         .unwrap(),
      2
   );
   // A language request flushes queued edits first so the server never answers stale text.
   m.get_hover(&main, 0, 0).await.unwrap();

   assert_eq!(
      m.queue_document_change_batches(
         &main,
         vec![
            batch(3, vec![insert(4, "async ", 0, 4)]),
            batch(4, vec![insert(0, "// x\n", 0, 0)]),
         ],
      )
      .unwrap(),
      3
   );
   m.flush_document_changes(&main).unwrap();
   m.notify_document_save(&main).unwrap();
   m.notify_document_close(&main).unwrap();

   let sent = received(m, &main).await;
   assert_eq!(
      methods(&sent)[2..],
      [
         "textDocument/didOpen",
         "textDocument/didChange",
         "textDocument/hover",
         "textDocument/didChange",
         "textDocument/didSave",
         "textDocument/didClose",
      ]
   );
   let open = last_params(&sent, "textDocument/didOpen");
   assert_eq!(open["textDocument"]["languageId"], "rust");
   assert_eq!(open["textDocument"]["version"], 1);
   assert_eq!(open["textDocument"]["text"], "fn main() {}\n");

   let changes = all_params(&sent, "textDocument/didChange");
   assert_eq!(changes[0]["textDocument"]["version"], 2);
   assert_eq!(changes[0]["contentChanges"][0]["text"], "pub ");
   assert_eq!(
      changes[0]["contentChanges"][0]["range"]["start"],
      json!({ "line": 0, "character": 0 })
   );
   assert_eq!(changes[1]["textDocument"]["version"], 3);
   assert_eq!(changes[1]["contentChanges"].as_array().unwrap().len(), 2);
   assert_eq!(
      last_params(&sent, "textDocument/didSave")["text"],
      "// x\npub async fn main() {}\n"
   );

   let error = m
      .queue_document_changes(&main, batch(5, vec![insert(0, "x", 0, 0)]))
      .unwrap_err();
   assert!(error.to_string().contains("No open LSP document session"));
}

#[tokio::test]
async fn queued_changes_are_sent_after_the_debounce_without_a_flush() {
   let f = fixture(json!({ "textDocumentSync": 2 }), json!({})).await;
   let main = f.path("main.rs");

   f.manager
      .notify_document_open(&main, "a".to_string(), Some("custom".to_string()))
      .unwrap();
   f.manager
      .queue_document_changes(&main, batch(2, vec![insert(1, "b", 0, 1)]))
      .unwrap();

   let mut sent = Vec::new();
   for _ in 0..100 {
      sent = received(&f.manager, &main).await;
      if methods(&sent).contains(&"textDocument/didChange".to_string()) {
         break;
      }
      tokio::time::sleep(Duration::from_millis(20)).await;
   }
   let change = last_params(&sent, "textDocument/didChange");
   assert_eq!(change["contentChanges"][0]["text"], "b");
   assert_eq!(
      last_params(&sent, "textDocument/didOpen")["textDocument"]["languageId"],
      "custom"
   );

   let error = f
      .manager
      .queue_document_change_batches(&main, Vec::new())
      .unwrap_err();
   assert!(error.to_string().contains("empty"));
}

#[tokio::test]
async fn full_sync_servers_receive_whole_documents() {
   let f = fixture(json!({ "textDocumentSync": 1 }), json!({})).await;
   let main = f.path("main.rs");
   let m = &f.manager;

   m.notify_document_open(&main, "old".to_string(), None)
      .unwrap();
   m.queue_document_changes(&main, batch(2, vec![insert(3, "er", 0, 3)]))
      .unwrap();
   m.flush_document_changes(&main).unwrap();
   m.notify_document_change(&main, "replaced".to_string(), 3)
      .unwrap();
   m.notify_document_save(&main).unwrap();

   let sent = received(m, &main).await;
   let changes = all_params(&sent, "textDocument/didChange");
   assert_eq!(changes.len(), 2);
   assert_eq!(changes[0]["contentChanges"], json!([{ "text": "older" }]));
   assert_eq!(
      changes[1]["contentChanges"],
      json!([{ "text": "replaced" }])
   );
   assert!(
      last_params(&sent, "textDocument/didSave")
         .get("text")
         .is_none_or(Value::is_null),
      "text is only included when the server asks for it"
   );
}

#[tokio::test]
async fn semantic_tokens_use_deltas_and_fall_back_to_full_requests() {
   let f = fixture(
      json!({
         "semanticTokensProvider": {
            "legend": { "tokenTypes": ["function", "variable"], "tokenModifiers": [] },
            "full": { "delta": true }
         }
      }),
      json!({
         "textDocument/semanticTokens/full": [
            { "result": { "resultId": "1", "data": [0, 0, 3, 0, 0, 1, 0, 4, 1, 0] } },
            { "result": { "resultId": "3", "data": [0, 0, 5, 0, 0] } }
         ],
         "textDocument/semanticTokens/full/delta": [
            { "result": { "resultId": "2", "edits": [{ "start": 5, "deleteCount": 5, "data": [2, 0, 4, 1, 0] }] } },
            { "error": { "code": -32603, "message": "delta failed" } },
            { "result": { "resultId": "4", "edits": [{ "start": 50, "deleteCount": 5 }] } },
            { "error": { "code": -32800, "message": "Request cancelled" } }
         ]
      }),
   )
   .await;
   let main = f.path("main.rs");
   let m = &f.manager;
   let tokens = |result: Option<SemanticTokensResult>| match result {
      Some(SemanticTokensResult::Tokens(tokens)) => (
         tokens.result_id,
         crate::semantic_tokens::flatten_semantic_tokens(&tokens.data),
      ),
      other => panic!("expected tokens, got {other:?}"),
   };
   assert!(
      m.raw_client_for_file(&main)
         .unwrap()
         .supports_semantic_tokens_delta()
   );

   m.notify_document_open(&main, "fn a() {}".to_string(), None)
      .unwrap();
   assert_eq!(
      tokens(m.get_semantic_tokens(&main).await.unwrap()),
      (Some("1".to_string()), vec![0, 0, 3, 0, 0, 1, 0, 4, 1, 0])
   );
   assert_eq!(
      tokens(m.get_semantic_tokens(&main).await.unwrap()),
      (Some("2".to_string()), vec![0, 0, 3, 0, 0, 2, 0, 4, 1, 0])
   );
   // A failed delta falls back to a full request.
   assert_eq!(
      tokens(m.get_semantic_tokens(&main).await.unwrap()),
      (Some("3".to_string()), vec![0, 0, 5, 0, 0])
   );
   // So does a delta whose edits do not fit the cached tokens.
   assert_eq!(
      tokens(m.get_semantic_tokens(&main).await.unwrap()),
      (Some("3".to_string()), vec![0, 0, 5, 0, 0])
   );
   // A canceled delta is reported instead of being retried as a full request.
   let error = m.get_semantic_tokens(&main).await.unwrap_err();
   assert!(error.to_string().contains("Request cancelled"));

   let sent = received(m, &main).await;
   let token_methods: Vec<String> = methods(&sent)
      .into_iter()
      .filter(|method| method.contains("semanticTokens"))
      .collect();
   assert_eq!(
      token_methods,
      [
         "textDocument/semanticTokens/full",
         "textDocument/semanticTokens/full/delta",
         "textDocument/semanticTokens/full/delta",
         "textDocument/semanticTokens/full",
         "textDocument/semanticTokens/full/delta",
         "textDocument/semanticTokens/full",
         "textDocument/semanticTokens/full/delta",
      ]
   );
   let previous_ids: Vec<Value> = all_params(&sent, "textDocument/semanticTokens/full/delta")
      .into_iter()
      .map(|params| params["previousResultId"].clone())
      .collect();
   assert_eq!(
      previous_ids,
      [json!("1"), json!("2"), json!("3"), json!("3")]
   );

   // Closing the document forgets the cache, so the next request is a full one again.
   m.notify_document_close(&main).unwrap();
   m.notify_document_open(&main, "fn a() {}".to_string(), None)
      .unwrap();
   m.get_semantic_tokens(&main).await.unwrap();
   let sent = received(m, &main).await;
   assert_eq!(
      methods(&sent)
         .iter()
         .rev()
         .find(|method| method.contains("semanticTokens"))
         .map(String::as_str),
      Some("textDocument/semanticTokens/full")
   );
}

#[tokio::test]
async fn crashed_servers_are_dropped() {
   let f = fixture(json!({}), json!({})).await;
   let main = f.path("main.rs");
   let client = f.manager.raw_client_for_file(&main).unwrap();

   assert!(
      client
         .request_value("test/crash", Value::Null)
         .await
         .is_err()
   );
   wait_until(|| f.manager.raw_client_for_file(&main).is_none()).await;
   assert!(f.manager.get_hover(&main, 0, 0).await.unwrap().is_none());
}

#[tokio::test]
async fn shutdown_stops_every_server() {
   let f = fixture(json!({}), json!({})).await;
   let main = f.path("main.rs");
   let client = f.manager.raw_client_for_file(&main).unwrap();

   f.manager.shutdown();

   assert!(f.manager.raw_client_for_file(&main).is_none());
   wait_until(|| !client.is_running()).await;
}

#[tokio::test]
async fn requests_without_a_client_return_empty_results_or_errors() {
   let workspace = tempfile::tempdir().unwrap();
   let m = LspManager::with_app_handle(None);
   let file = workspace
      .path()
      .join("main.rs")
      .to_string_lossy()
      .into_owned();
   let file = file.as_str();
   let item =
      serde_json::from_value::<CallHierarchyItem>(hierarchy_item("file:///main.rs", "main"))
         .unwrap();
   let type_item =
      serde_json::from_value::<TypeHierarchyItem>(hierarchy_item("file:///main.rs", "T")).unwrap();

   assert!(m.get_hover(file, 0, 0).await.unwrap().is_none());
   assert!(m.get_definition(file, 0, 0).await.unwrap().is_none());
   assert!(m.get_implementation(file, 0, 0).await.unwrap().is_none());
   assert!(m.get_type_definition(file, 0, 0).await.unwrap().is_none());
   assert!(m.get_semantic_tokens(file).await.unwrap().is_none());
   assert!(m.get_inlay_hints(file, 0, 1).await.unwrap().is_none());
   assert!(m.get_document_symbols(file).await.unwrap().is_none());
   assert!(m.format_document(file).await.unwrap().is_none());
   assert!(m.format_range(file, 0, 0, 1, 0).await.unwrap().is_none());
   assert!(m.get_folding_ranges(file).await.unwrap().is_empty());
   assert!(
      m.get_selection_ranges(file, Vec::new())
         .await
         .unwrap()
         .is_empty()
   );
   assert!(
      m.get_document_highlights(file, 0, 0)
         .await
         .unwrap()
         .is_empty()
   );
   assert!(
      m.prepare_call_hierarchy(file, 0, 0)
         .await
         .unwrap()
         .is_empty()
   );
   assert!(
      m.get_incoming_calls(file, item.clone())
         .await
         .unwrap()
         .is_empty()
   );
   assert!(m.get_outgoing_calls(file, item).await.unwrap().is_empty());
   assert!(
      m.prepare_type_hierarchy(file, 0, 0)
         .await
         .unwrap()
         .is_empty()
   );
   assert!(
      m.get_supertypes(file, type_item.clone())
         .await
         .unwrap()
         .is_empty()
   );
   assert!(m.get_subtypes(file, type_item).await.unwrap().is_empty());
   assert!(
      m.format_on_type(file, 0, 0, ";".to_string(), 4, true)
         .await
         .unwrap()
         .is_empty()
   );
   assert!(m.get_signature_help(file, 0, 0).await.unwrap().is_none());
   assert!(m.get_references(file, 0, 0).await.unwrap().is_none());
   assert!(
      m.rename(file, 0, 0, "x".to_string())
         .await
         .unwrap()
         .is_none()
   );
   assert!(m.prepare_rename(file, 0, 0).await.unwrap().is_none());
   assert!(m.get_code_lens(file).await.unwrap().is_none());
   assert!(
      m.get_code_actions(file, Range::default(), Vec::new())
         .await
         .unwrap()
         .is_empty()
   );
   assert_eq!(
      m.apply_code_action(
         file,
         CodeActionOrCommand::Command(Command::new("Run".into(), "run".into(), None)),
      )
      .await
      .unwrap(),
      (
         false,
         Some("No active LSP client for this file".to_string())
      )
   );
   assert!(
      m.resolve_completion_item(file, CompletionItem::default())
         .await
         .is_err()
   );
   assert!(
      m.execute_command(file, "run".to_string(), Vec::new())
         .await
         .is_err()
   );
   assert!(
      m.get_java_class_file_contents(file, Url::parse("jdt://x").unwrap())
         .await
         .is_err()
   );

   assert_eq!(m.semantic_token_legend(file), (Vec::new(), Vec::new()));
   assert!(m.get_signature_help_trigger_characters(file).is_empty());
   assert!(m.get_on_type_formatting_trigger_characters(file).is_empty());
   assert!(!m.validate_workspace_edit_owner("missing", "owner"));
   assert!(
      m.respond_workspace_edit("missing", json!(1), true, None, None)
         .is_err()
   );

   for result in [
      m.notify_document_open(file, String::new(), None),
      m.queue_document_changes(file, batch(2, Vec::new()))
         .map(drop),
      m.flush_document_changes(file),
      m.notify_document_save(file),
      m.notify_document_close(file),
   ] {
      assert!(
         result
            .unwrap_err()
            .to_string()
            .contains("No LSP client for this file")
      );
   }
   m.stop_lsp_for_file(&PathBuf::from(file)).unwrap();
   m.shutdown_workspace(workspace.path()).unwrap();
}

#[test]
fn maps_file_names_to_language_ids() {
   let manager = LspManager::with_app_handle(None);
   for (file, language) in [
      ("/w/main.rs", "rust"),
      ("/w/app.tsx", "typescriptreact"),
      ("/w/app.mjs", "javascript"),
      ("/w/types.pyi", "python"),
      ("/w/header.hpp", "cpp"),
      ("/w/config.yml", "yaml"),
      ("/w/settings.jsonc", "jsonc"),
      ("/w/Rakefile.rake", "ruby"),
      ("/w/script.zsh", "bash"),
      ("/home/u/.bashrc", "bash"),
      ("/home/u/.zshrc", "bash"),
      ("/w/README", "plaintext"),
      ("/w/notes.unknown", "plaintext"),
   ] {
      assert_eq!(manager.get_language_id_for_file(file), language, "{file}");
   }
}
