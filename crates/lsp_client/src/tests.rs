//! The manager against a fake language server that runs in-process over pipes.

use std::{
    io::{BufReader, Write},
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};

use futures::channel::mpsc;
use lsp_types::{
    HoverContents, HoverParams, MarkupContent, Position, PublishDiagnosticsParams, TextDocumentPositionParams, WorkDoneProgressParams,
    request::HoverRequest,
};
use parking_lot::Mutex;
use ropey::Rope;
use serde_json::{Value, json};

use crate::{
    DiagnosticsStore, Launcher, OpenError, ServerEntry, ServerManager, TextChange,
    rpc::{self, Incoming},
    server::{EventSink, LanguageServer, ServerEvent, ServerId, ServerMessage},
    text::{offsets_to_range, range_to_offsets},
};

/// What the fake server saw.
#[derive(Default)]
struct Seen {
    text: String,
    configuration: Option<Value>,
    closed: bool,
}

fn fake_server(stdin: std::io::PipeReader, mut stdout: std::io::PipeWriter, seen: Arc<Mutex<Seen>>) {
    let mut reader = BufReader::new(stdin);
    let mut send = |body: String| rpc::write_message(&mut stdout, &body).unwrap();
    let publish = |text: &str, uri: &Value| {
        rpc::notification(
            "textDocument/publishDiagnostics",
            &json!({ "uri": uri, "diagnostics": [{ "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 2 } }, "severity": 1, "message": text }] }),
        )
    };
    while let Ok(Some(body)) = rpc::read_message(&mut reader) {
        match rpc::parse(&body).unwrap() {
            Incoming::Request { id, method, params } => match method.as_str() {
                "initialize" => send(rpc::response(&id, Ok(json!({ "capabilities": { "textDocumentSync": 2, "hoverProvider": true } })))),
                "textDocument/hover" => {
                    let line = params["position"]["line"].as_u64().unwrap();
                    send(rpc::response(&id, Ok(json!({ "contents": { "kind": "markdown", "value": format!("hover {line}") } }))));
                }
                "workspace/symbol" => {
                    let query = params["query"].as_str().unwrap().to_string();
                    let symbol = |name: &str, kind: u32, line: u32| {
                        json!({ "name": name, "kind": kind, "containerName": "crate", "location": { "uri": "file:///project/src/main.rs", "range": { "start": { "line": line, "character": 3 }, "end": { "line": line, "character": 7 } } } })
                    };
                    let symbols: Vec<Value> = [symbol("main", 12, 0), symbol("main", 12, 0), symbol("Matrix", 23, 4)]
                        .into_iter()
                        .filter(|symbol| symbol["name"].as_str().unwrap().to_lowercase().contains(&query))
                        .collect();
                    send(rpc::response(&id, Ok(Value::Array(symbols))));
                }
                "workspace/executeCommand" => {
                    let arguments = params["arguments"].clone();
                    let result = match params["command"].as_str().unwrap() {
                        "java.edit.organizeImports" => json!({ "changes": { arguments[0].as_str().unwrap(): [
                            { "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 2, "character": 0 } }, "newText": "import a;\nimport b;\n" }
                        ] } }),
                        command => json!({ "command": command, "arguments": arguments }),
                    };
                    send(rpc::response(&id, Ok(result)));
                }
                "shutdown" => send(rpc::response(&id, Ok(Value::Null))),
                _ => send(rpc::response(&id, Err(rpc::RpcError { code: rpc::METHOD_NOT_FOUND, message: method, data: None }))),
            },
            Incoming::Notification { method, params } => match method.as_str() {
                "textDocument/didOpen" => {
                    let text = params["textDocument"]["text"].as_str().unwrap().to_string();
                    seen.lock().text = text.clone();
                    send(publish(&text, &params["textDocument"]["uri"]));
                    send(rpc::request(900, "workspace/configuration", &json!({ "items": [{ "section": "cargo" }] })));
                }
                "textDocument/didChange" => {
                    let mut seen = seen.lock();
                    for change in params["contentChanges"].as_array().unwrap() {
                        let rope = Rope::from_str(&seen.text);
                        let range = range_to_offsets(&rope, serde_json::from_value(change["range"].clone()).unwrap());
                        seen.text.replace_range(range, change["text"].as_str().unwrap());
                    }
                    send(publish(&seen.text, &params["textDocument"]["uri"]));
                }
                "textDocument/didClose" => seen.lock().closed = true,
                "exit" => break,
                _ => {}
            },
            Incoming::Response { id: 900, result } => seen.lock().configuration = result.ok(),
            Incoming::Response { .. } => {}
        }
    }
    stdout.flush().ok();
}

struct FakeLauncher {
    seen: Arc<Mutex<Seen>>,
}

impl Launcher for FakeLauncher {
    fn launch(&self, id: ServerId, name: &str, _: &ServerEntry, root: &Path, events: EventSink) -> Result<Arc<LanguageServer>, OpenError> {
        let (server_in, client_out) = std::io::pipe().unwrap();
        let (client_in, server_out) = std::io::pipe().unwrap();
        let seen = self.seen.clone();
        std::thread::spawn(move || fake_server(server_in, server_out, seen));
        LanguageServer::connect(id, name, root, Some(json!({ "cargo": { "features": "all" } })), events, client_out, client_in, None::<std::io::Empty>)
            .map_err(|error| OpenError::Failed { server: name.into(), message: error.to_string() })
    }
}

fn next_event(receiver: &mut mpsc::UnboundedReceiver<ServerEvent>, wanted: impl Fn(&ServerMessage) -> bool) -> ServerEvent {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match receiver.try_recv() {
            Ok(event) if wanted(&event.message) => return event,
            Ok(_) => {}
            Err(_) => std::thread::sleep(Duration::from_millis(5)),
        }
    }
    panic!("no event in time");
}

fn diagnostic_message(event: ServerEvent) -> (ServerId, PublishDiagnosticsParams) {
    let ServerMessage::Notification { params, .. } = event.message else { unreachable!() };
    (event.server, serde_json::from_value(params).unwrap())
}

fn is_diagnostics(message: &ServerMessage) -> bool {
    matches!(message, ServerMessage::Notification { method, .. } if method == "textDocument/publishDiagnostics")
}

#[test]
fn manager_syncs_documents_with_a_server() {
    let seen = Arc::new(Mutex::new(Seen::default()));
    let (events, mut receiver) = mpsc::unbounded();
    let mut manager = ServerManager::new(Box::new(FakeLauncher { seen: seen.clone() }), events);
    let path = Path::new("/project/src/main.rs");
    let mut rope = Rope::from_str("fn main() {}\n");
    let document = manager.open(path, &rope, Some(Path::new("/project"))).unwrap();
    assert_eq!(document.language_id, "rust");

    // Opened before the server answered `initialize`: queued, then sent.
    next_event(&mut receiver, |message| matches!(message, ServerMessage::Ready));
    let (server, params) = diagnostic_message(next_event(&mut receiver, is_diagnostics));
    let mut store = DiagnosticsStore::default();
    store.publish(server, params);
    assert_eq!(store.for_path(path)[0].message, "fn main() {}");

    // Incremental changes, one after another.
    let mut changes = Vec::new();
    for (range, text) in [(3..7, "start"), (0..0, "// é😀\n")] {
        changes.push(TextChange { range: offsets_to_range(&rope, range.clone()), text: text.to_string() });
        let start = rope.byte_to_char(range.start);
        rope.remove(start..rope.byte_to_char(range.end));
        rope.insert(start, text);
    }
    document.change(changes, &rope);
    assert_eq!(document.version(), 1);
    let (server, params) = diagnostic_message(next_event(&mut receiver, is_diagnostics));
    assert_eq!(params.diagnostics[0].message, "// é😀\nfn start() {}\n");
    store.publish(server, params);
    assert_eq!(seen.lock().text, rope.to_string());
    assert_eq!(seen.lock().configuration, Some(json!([{ "features": "all" }])));

    // Requests resolve on any executor.
    let hover = futures::executor::block_on(document.server().request::<HoverRequest>(HoverParams {
        text_document_position_params: TextDocumentPositionParams { text_document: document.identifier(), position: Position::new(1, 4) },
        work_done_progress_params: WorkDoneProgressParams::default(),
    }))
    .unwrap()
    .unwrap();
    assert_eq!(hover.contents, HoverContents::Markup(MarkupContent { kind: lsp_types::MarkupKind::Markdown, value: "hover 1".into() }));

    // A second file of the same project shares the server.
    let other = manager.open(Path::new("/project/src/lib.rs"), &Rope::from_str(""), Some(Path::new("/project"))).unwrap();
    assert_eq!(other.server().id(), document.server().id());
    assert!(manager.is_open(path));

    drop(document);
    let deadline = Instant::now() + Duration::from_secs(5);
    while !seen.lock().closed && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(seen.lock().closed, "dropping the document closes it");
    assert!(!manager.is_open(path));

    // Shutting down ends the server; its exit is reported without an error.
    manager.shutdown_all();
    let exited = next_event(&mut receiver, |message| matches!(message, ServerMessage::Exited { .. }));
    assert!(matches!(exited.message, ServerMessage::Exited { error: None }));
}

#[test]
fn unsupported_and_missing_servers() {
    let (events, _receiver) = mpsc::unbounded();
    let mut manager = ServerManager::new(
        Box::new(crate::ProcessLauncher::with_paths(crate::SearchPaths { path_dirs: Vec::new(), athas_data_dirs: Vec::new() })),
        events,
    );
    let rope = Rope::from_str("");
    assert_eq!(manager.open(Path::new("/p/readme.unknownext"), &rope, None).err(), Some(OpenError::Unsupported));
    assert_eq!(manager.open(Path::new("/p/main.rs"), &rope, None).err(), Some(OpenError::NotInstalled { server: "rust-analyzer".into() }));
}

#[gpui::test]
fn missing_servers_reach_the_hook_and_a_retry_tells_editors(cx: &mut gpui::TestAppContext) {
    use std::{cell::RefCell, rc::Rc};

    let missing = Rc::new(RefCell::new(Vec::new()));
    let retried = Rc::new(RefCell::new(0));
    let store = cx.update(|cx| {
        crate::init_with(cx, || Box::new(crate::ProcessLauncher::with_paths(crate::SearchPaths { path_dirs: Vec::new(), athas_data_dirs: Vec::new() })));
        let seen = missing.clone();
        crate::on_missing_server(cx, move |server, _| seen.borrow_mut().push(server.to_string()));
        crate::LspStore::global(cx)
    });
    let counter = retried.clone();
    let _subscription = cx.update(|cx| {
        cx.subscribe(&store, move |_, event: &crate::LspStoreEvent, _| {
            if matches!(event, crate::LspStoreEvent::Retry) {
                *counter.borrow_mut() += 1;
            }
        })
    });
    let opened = store.update(cx, |store, cx| store.open_document(Path::new("/p/main.rs"), &Rope::from_str(""), None, cx));
    assert_eq!(opened.err(), Some(OpenError::NotInstalled { server: "rust-analyzer".into() }));
    cx.run_until_parked();
    assert_eq!(*missing.borrow(), vec!["rust-analyzer".to_string()]);

    store.update(cx, |store, cx| store.retry_unavailable(cx));
    cx.run_until_parked();
    assert_eq!(*retried.borrow(), 1);
}

#[test]
fn workspace_symbols_are_flattened_and_deduplicated() {
    let seen = Arc::new(Mutex::new(Seen::default()));
    let (events, mut receiver) = mpsc::unbounded();
    let mut manager = ServerManager::new(Box::new(FakeLauncher { seen }), events);
    let document = manager.open(Path::new("/project/src/main.rs"), &Rope::from_str("fn main() {}\n"), Some(Path::new("/project"))).unwrap();
    next_event(&mut receiver, |message| matches!(message, ServerMessage::Ready));

    let symbols = futures::executor::block_on(crate::workspace_symbols(vec![document.server().clone()], "ma".into()));
    assert_eq!(symbols.len(), 2, "the repeated `main` is dropped");
    assert_eq!(symbols[0].name, "main");
    assert_eq!(symbols[0].kind_label(), "function");
    assert_eq!((symbols[0].line, symbols[0].character), (0, 3));
    assert_eq!(symbols[0].path, Path::new("/project/src/main.rs"));
    assert_eq!(symbols[1].kind_label(), "struct");
    assert_eq!(symbols[1].container_name.as_deref(), Some("crate"));

    let none = futures::executor::block_on(crate::workspace_symbols(vec![document.server().clone()], "zzz".into()));
    assert!(none.is_empty());
    manager.shutdown_all();
}

#[gpui::test]
fn execute_command_reaches_the_server_and_applies_returned_edits(cx: &mut gpui::TestAppContext) {
    use std::{cell::RefCell, rc::Rc};

    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let other = root.join("src/Other.rs");
    std::fs::create_dir_all(other.parent().unwrap()).unwrap();
    std::fs::write(&other, "import b;\nimport a;\nclass Other {}\n").unwrap();
    let main = root.join("src/main.rs");
    let store = cx.update(|cx| {
        crate::init_with(cx, || Box::new(FakeLauncher { seen: Arc::new(Mutex::new(Seen::default())) }));
        crate::LspStore::global(cx)
    });
    let _document = store.update(cx, |store, cx| store.open_document(&main, &Rope::from_str("fn main() {}\n"), Some(&root), cx)).unwrap();
    assert!(store.read_with(cx, |store, _| store.server_for_path(&root.join("src/lib.rs")).is_some()), "a closed file of the same language under the root");
    assert!(store.read_with(cx, |store, _| store.server_for_path(Path::new("/elsewhere/lib.rs")).is_none()));

    let run = |command: &'static str, arguments: Vec<Value>, cx: &mut gpui::TestAppContext| {
        let answer = Rc::new(RefCell::new(None));
        let task = store.update(cx, |store, cx| store.execute_command(&main, command, arguments, cx));
        let slot = answer.clone();
        cx.spawn(async move |_| *slot.borrow_mut() = Some(task.await.unwrap())).detach();
        for _ in 0..400 {
            cx.run_until_parked();
            if let Some(answer) = answer.borrow_mut().take() {
                return answer;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("no answer to {command}");
    };
    let echoed = run("java.project.import", vec![json!("x")], cx).unwrap();
    assert_eq!(echoed, json!({ "command": "java.project.import", "arguments": ["x"] }));

    let uri = crate::uri::from_path(&other).unwrap().to_string();
    run("java.edit.organizeImports", vec![json!(uri)], cx);
    assert_eq!(std::fs::read_to_string(&other).unwrap(), "import a;\nimport b;\nclass Other {}\n");
    store.update(cx, |store, cx| store.stop_all(cx));
}
