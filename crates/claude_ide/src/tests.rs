//! The integration over a real localhost WebSocket, with an in-process client standing in for
//! Claude Code; lock files go to a temporary folder. No `claude` program runs.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use athas_claude_ide::{BridgeEvent, ToolAnswer};
use futures::StreamExt as _;
use futures_util::SinkExt as _;
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    WebSocketStream, client_async,
    tungstenite::{Message, client::IntoClientRequest, http::header::SEC_WEBSOCKET_PROTOCOL},
};

use crate::tools::{self, DiffRequest, IdeDiagnostic, OpenEditor, Outcome, ToolEnv};

#[derive(Default)]
struct FakeEditor {
    opened: Vec<(PathBuf, Option<std::ops::Range<usize>>)>,
    saved: Vec<PathBuf>,
    closed: Vec<String>,
}

impl ToolEnv for FakeEditor {
    fn open_editors(&self) -> Vec<OpenEditor> {
        vec![OpenEditor { path: "/work/src/main.rs".into(), label: "main.rs".into(), language: "rust".into(), dirty: true, active: true, line_count: 3 }]
    }

    fn diagnostics(&self, path: Option<&Path>) -> Vec<(PathBuf, Vec<IdeDiagnostic>)> {
        let all = vec![
            (
                PathBuf::from("/work/src/main.rs"),
                vec![IdeDiagnostic { message: "unused variable".into(), severity: "Warning", start: (1, 4), end: (1, 5), source: Some("rustc".into()), code: None }],
            ),
            (PathBuf::from("/work/src/empty.rs"), Vec::new()),
        ];
        match path {
            Some(path) => all.into_iter().filter(|(file, _)| file == path).collect(),
            None => all,
        }
    }

    fn open_file(&mut self, path: &Path, selection: Option<std::ops::Range<usize>>) {
        self.opened.push((path.to_path_buf(), selection));
    }

    fn save(&mut self, path: &Path) -> Option<bool> {
        (path == Path::new("/work/src/main.rs")).then(|| {
            self.saved.push(path.to_path_buf());
            true
        })
    }

    fn close_diff(&mut self, _: &str) -> bool {
        false
    }

    fn close_tab(&mut self, tab_name: &str) {
        self.closed.push(tab_name.to_string());
    }

    fn close_all_diffs(&mut self) -> usize {
        0
    }

    fn workspace_root(&self) -> Option<PathBuf> {
        Some(PathBuf::from("/work"))
    }

    fn read(&self, path: &Path) -> Option<String> {
        (path == Path::new("/work/src/main.rs")).then(|| "fn main() {\n    let x = 1;\n}\n".to_string())
    }
}

async fn connect(port: u16, token: &str) -> WebSocketStream<TcpStream> {
    let mut request = format!("ws://127.0.0.1:{port}").into_client_request().unwrap();
    request.headers_mut().insert(SEC_WEBSOCKET_PROTOCOL, "mcp".parse().unwrap());
    request.headers_mut().insert(athas_claude_ide::auth::AUTH_HEADER, token.parse().unwrap());
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    client_async(request, stream).await.unwrap().0
}

async fn call(socket: &mut WebSocketStream<TcpStream>, id: u64, method: &str, params: Value) -> Value {
    socket.send(Message::Text(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string().into())).await.unwrap();
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(5), socket.next()).await.expect("no answer").unwrap().unwrap();
        if let Message::Text(text) = frame {
            let message: Value = serde_json::from_str(&text).unwrap();
            if message["id"] == id {
                return message;
            }
        }
    }
}

fn tool_text(answer: &Value) -> &str {
    answer["result"]["content"][0]["text"].as_str().unwrap_or_else(|| panic!("no text in {answer}"))
}

#[test]
fn claude_code_calls_the_editor_tools_over_the_socket() {
    let dir = tempfile::tempdir().unwrap();
    let (runtime, server, bridge, mut events) = crate::service::start_server(dir.path().to_path_buf(), vec!["/work".into()], "0.0.0").unwrap();
    let lock: Value = serde_json::from_slice(&std::fs::read(server.lock_path()).unwrap()).unwrap();
    assert!(server.lock_path().starts_with(dir.path()));
    assert_eq!(lock["ideName"], "Athas");
    assert_eq!(lock["workspaceFolders"], json!(["/work"]));
    let token = lock["authToken"].as_str().unwrap().to_string();

    let editor = Arc::new(Mutex::new(FakeEditor::default()));
    let diffs: Arc<Mutex<Vec<DiffRequest>>> = Arc::default();
    let answering = {
        let (editor, diffs, bridge) = (editor.clone(), diffs.clone(), bridge.clone());
        std::thread::spawn(move || {
            while let Some(event) = futures::executor::block_on(events.next()) {
                let BridgeEvent::Request(request) = event else { continue };
                let outcome = tools::run_tool(&mut *editor.lock().unwrap(), &request.request_id, &request.tool, &request.arguments);
                let answer = match outcome {
                    Ok(Outcome::Answer(content)) => ToolAnswer { content, error: None },
                    Ok(Outcome::Diff(diff)) => {
                        let content = tools::diff_answer(&diff, true);
                        diffs.lock().unwrap().push(diff);
                        ToolAnswer { content, error: None }
                    }
                    Err(error) => ToolAnswer { content: Vec::new(), error: Some(error) },
                };
                bridge.respond(&request.request_id, answer);
            }
        })
    };

    server.update_selection(Some(athas_claude_ide::EditorSelection {
        file_path: "/work/src/main.rs".into(),
        text: "let x".into(),
        start: athas_claude_ide::SelectionPosition { line: 1, character: 4 },
        end: athas_claude_ide::SelectionPosition { line: 1, character: 9 },
    }));

    let port = server.port();
    runtime.block_on(async {
        let mut socket = connect(port, &token).await;
        let init = call(&mut socket, 1, "initialize", json!({ "protocolVersion": "2025-03-26" })).await;
        assert_eq!(init["result"]["serverInfo"]["name"], "athas");

        let selection: Value = serde_json::from_str(tool_text(&call(&mut socket, 2, "tools/call", json!({ "name": "getCurrentSelection" })).await)).unwrap();
        assert_eq!(selection["text"], "let x");
        assert_eq!(selection["selection"]["start"], json!({ "line": 1, "character": 4 }));

        let editors: Value = serde_json::from_str(tool_text(&call(&mut socket, 3, "tools/call", json!({ "name": "getOpenEditors" })).await)).unwrap();
        assert_eq!(editors["tabs"][0]["uri"], "file:///work/src/main.rs");
        assert_eq!(editors["tabs"][0]["isDirty"], true);

        let all: Value = serde_json::from_str(tool_text(&call(&mut socket, 4, "tools/call", json!({ "name": "getDiagnostics", "arguments": {} })).await)).unwrap();
        assert_eq!(all.as_array().unwrap().len(), 1, "files without diagnostics are left out");
        assert_eq!(all[0]["diagnostics"][0]["severity"], "Warning");
        assert_eq!(all[0]["diagnostics"][0]["range"]["start"], json!({ "line": 1, "character": 4 }));

        let opened = call(&mut socket, 5, "tools/call", json!({ "name": "openFile", "arguments": { "filePath": "/work/src/main.rs", "startText": "let x" } })).await;
        assert_eq!(tool_text(&opened), "Opened file: /work/src/main.rs");

        let saved: Value = serde_json::from_str(tool_text(&call(&mut socket, 6, "tools/call", json!({ "name": "saveDocument", "arguments": { "filePath": "/work/src/main.rs" } })).await)).unwrap();
        assert_eq!(saved["saved"], true);
        let missing: Value = serde_json::from_str(tool_text(&call(&mut socket, 7, "tools/call", json!({ "name": "checkDocumentDirty", "arguments": { "filePath": "/nope" } })).await)).unwrap();
        assert_eq!(missing["success"], false);

        let diff = call(
            &mut socket,
            8,
            "tools/call",
            json!({ "name": "openDiff", "arguments": { "old_file_path": "/work/a.rs", "new_file_path": "/work/a.rs", "new_file_contents": "new", "tab_name": "a.rs (Claude)" } }),
        )
        .await;
        assert_eq!(diff["result"]["content"][0]["text"], "FILE_SAVED");
        assert_eq!(diff["result"]["content"][1]["text"], "new");

        let unsupported = call(&mut socket, 9, "tools/call", json!({ "name": "close_tab", "arguments": { "tab_name": "main.rs" } })).await;
        assert_eq!(tool_text(&unsupported), "TAB_CLOSED");
    });

    let editor = editor.lock().unwrap();
    assert_eq!(editor.opened, [(PathBuf::from("/work/src/main.rs"), Some(16..21))]);
    assert_eq!(editor.saved, [PathBuf::from("/work/src/main.rs")]);
    assert_eq!(editor.closed, ["main.rs"]);
    assert_eq!(diffs.lock().unwrap()[0].tab_name, "a.rs (Claude)");

    let lock_path = server.lock_path();
    drop(server);
    drop(bridge);
    runtime.shutdown_background();
    assert!(!lock_path.exists(), "the lock file goes away with the server");
    let _ = answering;
}

#[test]
fn open_file_selections_follow_text_or_lines() {
    let text = "one\ntwo three\nfour\n";
    assert_eq!(tools::find_open_file_selection(text, &json!({ "startText": "two", "endText": "three" })), Some(4..13));
    assert_eq!(tools::find_open_file_selection(text, &json!({ "startText": "two", "selectToEndOfLine": true })), Some(4..13));
    assert_eq!(tools::find_open_file_selection(text, &json!({ "startLine": 2, "endLine": 3 })), Some(4..18));
    assert_eq!(tools::find_open_file_selection(text, &json!({ "startText": "zzz" })), None);
    assert_eq!(tools::file_uri_to_path("file:///a%20b/c.rs"), PathBuf::from("/a b/c.rs"));
    assert_eq!(tools::path_to_file_uri(Path::new("/a b/c#d.rs")), "file:///a%20b/c%23d.rs");
}

#[test]
fn tool_paths_resolve_against_the_workspace_and_home() {
    let root = Some(Path::new("/work"));
    let home = Some(Path::new("/home/me"));
    assert_eq!(tools::resolve_tool_path("src/main.rs", root, home), PathBuf::from("/work/src/main.rs"));
    assert_eq!(tools::resolve_tool_path("/etc/hosts", root, home), PathBuf::from("/etc/hosts"));
    assert_eq!(tools::resolve_tool_path("C:\\code\\a.rs", root, home), PathBuf::from("C:\\code\\a.rs"));
    assert_eq!(tools::resolve_tool_path("remote://box/srv/a.rs", root, home), PathBuf::from("remote://box/srv/a.rs"));
    assert_eq!(tools::resolve_tool_path("~/notes.md", root, home), PathBuf::from("/home/me/notes.md"));
    assert_eq!(tools::resolve_tool_path("~", root, home), PathBuf::from("/home/me"));
    assert_eq!(tools::resolve_tool_path("~/x", root, None), PathBuf::from("~/x"));
    assert_eq!(tools::resolve_tool_path("src/a.rs", None, home), PathBuf::from("src/a.rs"));

    let mut editor = FakeEditor::default();
    let Ok(Outcome::Answer(answer)) = tools::run_tool(&mut editor, "1", "openFile", &json!({ "filePath": "src/main.rs", "startLine": 2 })) else {
        panic!("openFile answers at once");
    };
    assert_eq!(answer, vec!["Opened file: /work/src/main.rs".to_string()]);
    assert_eq!(editor.opened, vec![(PathBuf::from("/work/src/main.rs"), Some(12..26))]);
}

#[test]
fn proposed_changes_show_their_path_inside_the_workspace() {
    use crate::diff_view::relative_display_path;
    assert_eq!(relative_display_path(Path::new("/work/src/main.rs"), Some(Path::new("/work"))), "src/main.rs");
    assert_eq!(relative_display_path(Path::new("/work/src/main.rs"), Some(Path::new("/work/"))), "src/main.rs");
    assert_eq!(relative_display_path(Path::new("/workshop/a.rs"), Some(Path::new("/work"))), "/workshop/a.rs");
    assert_eq!(relative_display_path(Path::new("/etc/hosts"), None), "/etc/hosts");
}
