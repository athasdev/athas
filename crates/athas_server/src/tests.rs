use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::Command,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use serde_json::{Map, Value, json};
use tungstenite::Message;
use web_protocol::{ClientMessage, ServerMessage, decode_terminal_frame, from_base64, to_base64};

use super::*;

fn params(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn workspace() -> (tempfile::TempDir, Arc<Workspace>) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();
    (dir, workspace)
}

fn call(workspace: &Workspace, method: &str, value: Value) -> Value {
    workspace.call(method, &params(value)).unwrap_or_else(|error| panic!("{method}: {error}"))
}

#[test]
fn files() {
    let (_dir, workspace) = workspace();
    call(&workspace, "fs.write", json!({ "path": "src/main.rs", "content": to_base64(b"fn main() {}\n") }));
    let read = call(&workspace, "fs.read", json!({ "path": "src/main.rs" }));
    assert_eq!(from_base64(&read["content"]).unwrap(), b"fn main() {}\n");
    assert_eq!(call(&workspace, "fs.stat", json!({ "path": "src" }))["type"], "directory");
    assert_eq!(call(&workspace, "fs.readdir", json!({ "path": "" }))["entries"], json!([{ "name": "src", "type": "directory" }]));
    let conflict = workspace.call("fs.write", &params(json!({ "path": "src/main.rs", "content": to_base64(b"x"), "expectedSize": 1 }))).unwrap_err();
    assert_eq!(conflict.code, "conflict");

    call(&workspace, "fs.createFile", json!({ "path": "src/lib.rs" }));
    assert!(workspace.call("fs.createFile", &params(json!({ "path": "src/lib.rs" }))).is_err());
    call(&workspace, "fs.copy", json!({ "from": "src/main.rs", "to": "src/copy.rs" }));
    call(&workspace, "fs.rename", json!({ "from": "src/copy.rs", "to": "moved/copy.rs" }));
    assert_eq!(call(&workspace, "fs.exists", json!({ "path": "moved/copy.rs" }))["exists"], true);
    assert_eq!(call(&workspace, "fs.exists", json!({ "path": "src/copy.rs" }))["exists"], false);
    let mut files: Vec<String> = serde_json::from_value(call(&workspace, "fs.list", json!({}))["files"].clone()).unwrap();
    files.sort();
    assert_eq!(files, ["moved/copy.rs", "src/lib.rs", "src/main.rs"]);

    assert_eq!(workspace.call("fs.remove", &params(json!({ "path": "src" }))).unwrap_err().code, "fs_error");
    call(&workspace, "fs.remove", json!({ "path": "src", "recursive": true }));
    assert_eq!(workspace.call("fs.read", &params(json!({ "path": "src/main.rs" }))).unwrap_err().code, "not_found");
    assert_eq!(workspace.call("fs.read", &params(json!({ "path": "../outside" }))).unwrap_err().code, "invalid_request");
    assert_eq!(workspace.call("fs.remove", &params(json!({ "path": "" }))).unwrap_err().code, "invalid_request");
    assert_eq!(workspace.call("nope", &Map::new()).unwrap_err().code, "unknown_method");
}

#[test]
fn transfers_cross_only_through_their_own_folders() {
    let (_dir, workspace) = workspace();
    let uploaded = call(&workspace, "transfer.upload", json!({ "name": "../../notes.db", "content": to_base64(b"SQLite format 3\0") }));
    let path = std::path::PathBuf::from(uploaded["path"].as_str().unwrap());
    assert_eq!(path.file_name().unwrap(), "notes.db", "only the file name of what the browser sends is kept");
    assert!(path.starts_with(std::env::temp_dir().join("athas-transfers")));
    assert_eq!(std::fs::read(&path).unwrap(), b"SQLite format 3\0");

    let read = call(&workspace, "transfer.read", json!({ "path": path.to_string_lossy() }));
    assert_eq!((read["name"].as_str(), from_base64(&read["content"]).unwrap()), (Some("notes.db"), b"SQLite format 3\0".to_vec()));
    let outside = workspace.call("transfer.read", &params(json!({ "path": "/etc/hosts" })));
    assert!(outside.is_err(), "files outside a transfer folder are refused");
    let escape = workspace.call("transfer.read", &params(json!({ "path": path.parent().unwrap().join("../../etc").to_string_lossy() })));
    assert!(escape.is_err());

    let dir = std::path::PathBuf::from(call(&workspace, "transfer.dir", json!({}))["path"].as_str().unwrap().to_string());
    assert!(dir.is_dir() && dir.read_dir().unwrap().next().is_none());
    assert!(workspace.call("transfer.read", &params(json!({ "path": dir.to_string_lossy() }))).is_err(), "folders are not files");
    std::fs::remove_dir_all(path.parent().unwrap()).ok();
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn content_search() {
    let (_dir, workspace) = workspace();
    call(&workspace, "fs.write", json!({ "path": "a.txt", "content": to_base64("one\nTwo two\nthree\n".as_bytes()) }));
    call(&workspace, "fs.write", json!({ "path": "b.txt", "content": to_base64(b"nothing here\n") }));
    let found = call(&workspace, "search.content", json!({ "query": "two", "contextLines": 1 }));
    assert_eq!(
        found,
        json!({ "results": [{ "path": "a.txt", "matches": [{ "line": 2, "text": "Two two", "ranges": [{ "start": 0, "end": 3 }, { "start": 4, "end": 7 }], "before": ["one"], "after": ["three"] }] }], "truncated": false })
    );
    let sensitive = call(&workspace, "search.content", json!({ "query": "Two", "wholeWord": true }));
    assert_eq!(sensitive["results"][0]["matches"][0]["ranges"], json!([{ "start": 0, "end": 3 }]));
    let limited = call(&workspace, "search.content", json!({ "query": "o", "maxResults": 1 }));
    assert_eq!(limited["truncated"], true);
}

fn has_git() -> bool {
    Command::new("git").arg("--version").output().is_ok_and(|output| output.status.success())
}

#[test]
fn git() {
    if !has_git() {
        return;
    }
    let (dir, workspace) = workspace();
    let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(dir.path()).output().unwrap().status.success(), "git {args:?}");
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.name", "Test"]);
    git(&["config", "user.email", "test@example.com"]);
    git(&["config", "commit.gpgsign", "false"]);
    call(&workspace, "fs.write", json!({ "path": "a.txt", "content": to_base64(b"one\n") }));
    call(&workspace, "git.add", json!({ "paths": ["a.txt"] }));
    let commit = call(&workspace, "git.commit", json!({ "message": "First" }));
    assert_eq!(commit["hash"].as_str().unwrap().len(), 40);

    call(&workspace, "fs.write", json!({ "path": "a.txt", "content": to_base64(b"two\n") }));
    call(&workspace, "fs.write", json!({ "path": "new.txt", "content": to_base64(b"new\n") }));
    let status = call(&workspace, "git.status", json!({}));
    assert_eq!(status["branch"], "main");
    assert_eq!(status["files"], json!([{ "path": "a.txt", "status": "modified", "staged": false }, { "path": "new.txt", "status": "untracked", "staged": false }]));
    let diff = call(&workspace, "git.diff", json!({ "path": "a.txt" }));
    assert!(diff["patch"].as_str().unwrap().contains("-one\n+two"));
    let untracked = call(&workspace, "git.diff", json!({ "path": "new.txt" }));
    assert!(untracked["patch"].as_str().unwrap().contains("+new"));
    assert_eq!(from_base64(&call(&workspace, "git.show", json!({ "path": "a.txt" }))["content"]).unwrap(), b"one\n");

    call(&workspace, "git.discard", json!({ "paths": ["a.txt", "new.txt"] }));
    assert_eq!(call(&workspace, "git.status", json!({}))["files"], json!([]));
    call(&workspace, "git.checkout", json!({ "branch": "feature", "create": true }));
    let branches = call(&workspace, "git.branches", json!({}));
    assert_eq!(branches["current"], "feature");
    assert_eq!(branches["local"], json!(["feature", "main"]));
    let log = call(&workspace, "git.log", json!({ "limit": 5 }));
    assert_eq!(log["commits"][0]["message"], "First");
    assert_eq!(workspace.call("git.checkout", &params(json!({ "branch": "-x" }))).unwrap_err().code, "invalid_request");
    call(&workspace, "fs.write", json!({ "path": "a.txt", "content": to_base64(b"one\ntwo\nthree\n") }));
    let stats = call(&workspace, "git.diffStats", json!({}));
    assert_eq!(stats["stats"], json!([{ "path": "a.txt", "staged": false, "additions": 2, "deletions": 0 }]));
    call(&workspace, "git.stash", json!({ "message": "wip" }));
    let stashes = call(&workspace, "git.stashes", json!({}));
    assert_eq!(stashes["stashes"][0]["index"], 0);
    assert!(stashes["stashes"][0]["message"].as_str().unwrap().contains("wip"));
    assert_eq!(call(&workspace, "git.status", json!({}))["files"], json!([]));
    call(&workspace, "git.stashAction", json!({ "action": "pop", "index": 0 }));
    assert_eq!(call(&workspace, "git.stashes", json!({}))["stashes"], json!([]));
    assert_eq!(call(&workspace, "git.status", json!({}))["files"][0]["path"], "a.txt");
    call(&workspace, "git.checkout", json!({ "branch": "main" }));
    call(&workspace, "git.deleteBranch", json!({ "branch": "feature" }));
    assert_eq!(call(&workspace, "git.branches", json!({}))["local"], json!(["main"]));
}

fn wait_for<T>(events: &std::sync::mpsc::Receiver<Outgoing>, mut found: impl FnMut(&Outgoing) -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let event = events.recv_timeout(deadline.saturating_duration_since(Instant::now())).expect("timed out waiting for an event");
        if let Some(value) = found(&event) {
            return value;
        }
    }
}

#[test]
fn terminals() {
    let (_dir, workspace) = workspace();
    let events = workspace.subscribe();
    let id = call(&workspace, "terminal.create", json!({ "cols": 80, "rows": 24, "command": "/bin/sh", "args": ["-c", "read line; echo got-$line"] }))["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(call(&workspace, "terminal.list", json!({}))["terminals"], json!([id]));
    call(&workspace, "terminal.resize", json!({ "id": id, "cols": 100, "rows": 30 }));
    call(&workspace, "terminal.write", json!({ "id": id, "data": "ping\n" }));
    let mut output = Vec::new();
    wait_for(&events, |event| match event {
        Outgoing::Binary(frame) => {
            let (frame_id, data) = decode_terminal_frame(frame)?;
            output.extend_from_slice(data);
            (frame_id == id && String::from_utf8_lossy(&output).contains("got-ping")).then_some(())
        }
        Outgoing::Text(_) => None,
    });
    let exit = wait_for(&events, |event| match event {
        Outgoing::Text(text) => match serde_json::from_str::<ServerMessage>(text).ok()? {
            ServerMessage::TerminalExit { id: exited, exit_code } if exited == id => Some(exit_code),
            _ => None,
        },
        Outgoing::Binary(_) => None,
    });
    assert_eq!(exit, Some(0));
    assert_eq!(call(&workspace, "terminal.list", json!({}))["terminals"], json!([]));
    assert_eq!(workspace.call("terminal.write", &params(json!({ "id": id, "data": "x" }))).unwrap_err().code, "not_found");
}

#[test]
fn file_changes_reach_subscribers() {
    let (_dir, workspace) = workspace();
    let events = workspace.subscribe();
    call(&workspace, "fs.write", json!({ "path": "watched.txt", "content": to_base64(b"x") }));
    wait_for(&events, |event| match event {
        Outgoing::Text(text) => match serde_json::from_str::<ServerMessage>(text).ok()? {
            ServerMessage::FsChanges { changes, rescan, .. } => (rescan || changes.iter().any(|change| change.path == "watched.txt")).then_some(()),
            _ => None,
        },
        Outgoing::Binary(_) => None,
    });
}

fn start_server() -> (tempfile::TempDir, std::net::SocketAddr) {
    let (dir, workspace) = workspace();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let config = Arc::new(ServerConfig { token: "secret".into(), web_dir: Some(dir.path().to_path_buf()) });
    thread::spawn(move || serve(listener, workspace, config));
    (dir, address)
}

fn http(address: std::net::SocketAddr, request: &str) -> String {
    let mut stream = TcpStream::connect(address).unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

fn post_call(address: std::net::SocketAddr, token: &str, body: &str) -> String {
    http(address, &format!("POST /call HTTP/1.1\r\nHost: test\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()))
}

#[test]
fn http_calls_and_static_files() {
    let (dir, address) = start_server();
    std::fs::write(dir.path().join("index.html"), "<p>web</p>").unwrap();
    let written = post_call(address, "secret", &json!({ "method": "fs.write", "params": { "path": "x.txt", "content": to_base64(b"hi") } }).to_string());
    assert!(written.starts_with("HTTP/1.1 200"), "{written}");
    assert!(written.ends_with(r#"{"ok":true,"value":{"size":2}}"#), "{written}");
    let failed = post_call(address, "secret", r#"{"method":"fs.read","params":{"path":"missing"}}"#);
    assert!(failed.contains(r#""ok":false"#) && failed.contains("not_found"), "{failed}");
    assert!(post_call(address, "wrong", r#"{"method":"fs.list"}"#).starts_with("HTTP/1.1 401"));
    let info = http(address, "GET /workspace HTTP/1.1\r\nAuthorization: Bearer secret\r\n\r\n");
    assert!(info.contains(r#""id":"local""#), "{info}");
    let page = http(address, "GET /?token=secret HTTP/1.1\r\n\r\n");
    assert!(page.starts_with("HTTP/1.1 200") && page.contains("text/html") && page.ends_with("<p>web</p>"), "{page}");
    assert!(http(address, "GET /../etc/passwd HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
    assert!(http(address, "OPTIONS /call HTTP/1.1\r\n\r\n").contains("Access-Control-Allow-Headers: Authorization"));
}

fn text(socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>) -> ServerMessage {
    loop {
        match socket.read().unwrap() {
            Message::Text(text) => return serde_json::from_str(text.as_str()).unwrap(),
            _ => continue,
        }
    }
}

fn send(socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>, message: &ClientMessage) {
    socket.send(Message::text(serde_json::to_string(message).unwrap())).unwrap();
}

#[test]
fn socket_sessions() {
    let (_dir, address) = start_server();
    let url = format!("ws://{address}/workspaces/local/socket");

    let (mut refused, _) = tungstenite::connect(&url).unwrap();
    send(&mut refused, &ClientMessage::Auth { token: "wrong".into() });
    match refused.read() {
        Ok(Message::Close(Some(frame))) => assert_eq!(u16::from(frame.code), web_protocol::SOCKET_UNAUTHORIZED),
        other => panic!("expected a close, got {other:?}"),
    }

    let (mut socket, _) = tungstenite::connect(&url).unwrap();
    send(&mut socket, &ClientMessage::Auth { token: "secret".into() });
    let ServerMessage::Ready { workspace } = text(&mut socket) else { panic!("expected ready") };
    assert_eq!(workspace.id, "local");
    send(&mut socket, &ClientMessage::Ping);
    assert_eq!(text(&mut socket), ServerMessage::Pong);
    send(&mut socket, &ClientMessage::Call { id: 7, method: "fs.write".into(), params: params(json!({ "path": "a.txt", "content": to_base64(b"a") })) });
    loop {
        match text(&mut socket) {
            ServerMessage::Result { id, outcome } => {
                assert_eq!(id, 7);
                assert_eq!(outcome.into_result().unwrap(), json!({ "size": 1 }));
                break;
            }
            ServerMessage::FsChanges { .. } => continue,
            other => panic!("unexpected {other:?}"),
        }
    }

    send(&mut socket, &ClientMessage::Call { id: 8, method: "terminal.create".into(), params: params(json!({ "cols": 80, "rows": 24, "command": "/bin/sh", "args": ["-c", "echo attached; sleep 5"] })) });
    let terminal = loop {
        if let ServerMessage::Result { id: 8, outcome } = text(&mut socket) {
            break outcome.into_result().unwrap()["id"].as_str().unwrap().to_string();
        }
    };
    // Output streams in as binary frames, and a second client gets it back by attaching.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut streamed = Vec::new();
    while !String::from_utf8_lossy(&streamed).contains("attached") {
        assert!(Instant::now() < deadline, "no terminal output");
        if let Message::Binary(frame) = socket.read().unwrap()
            && let Some((id, data)) = decode_terminal_frame(&frame)
            && id == terminal
        {
            streamed.extend_from_slice(data);
        }
    }
    let (mut second, _) = tungstenite::connect(&url).unwrap();
    send(&mut second, &ClientMessage::Auth { token: "secret".into() });
    let ServerMessage::Ready { workspace } = text(&mut second) else { panic!("expected ready") };
    assert_eq!(workspace.terminals, vec![terminal.clone()]);
    send(&mut second, &ClientMessage::Call { id: 1, method: "terminal.attach".into(), params: params(json!({ "id": terminal })) });
    let replay = loop {
        if let Message::Binary(frame) = second.read().unwrap() {
            break frame;
        }
    };
    assert!(String::from_utf8_lossy(decode_terminal_frame(&replay).unwrap().1).contains("attached"));
    send(&mut second, &ClientMessage::Call { id: 2, method: "terminal.close".into(), params: params(json!({ "id": terminal })) });
}

#[test]
fn databases() {
    let (dir, workspace) = workspace();
    let state = tempfile::tempdir().unwrap();
    let connections = state.path().join("connections.json");
    workspace.set_database_paths(Some(connections.clone()), Some(state.path().join("history.json")));
    let file = dir.path().join("app.db");
    std::fs::write(&file, b"").unwrap();
    let connection = json!({ "id": "local", "name": "App", "db_type": "sqlite", "file_path": file.to_string_lossy() });

    call(&workspace, "database.test", json!({ "connection": connection }));
    let handle = call(&workspace, "database.open", json!({ "connection": connection }));
    let handle = handle.as_str().unwrap();
    call(&workspace, "database.run", json!({ "handle": handle, "sql": "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)" }));
    assert_eq!(call(&workspace, "database.insert", json!({ "handle": handle, "table": "users", "columns": ["name"], "values": ["Ada"] })), json!(1));
    call(&workspace, "database.insert", json!({ "handle": handle, "table": "users", "columns": ["name"], "values": ["Linus"] }));
    let objects = call(&workspace, "database.objects", json!({ "handle": handle }));
    assert_eq!(objects[0]["name"], "users");
    let columns = call(&workspace, "database.columns", json!({ "handle": handle, "table": "users" }));
    assert_eq!(columns[0]["primary_key"], true);
    let request = json!({ "table": "users", "filters": [], "search": "", "search_columns": [], "sort": ["name", "Desc"], "page_size": 10, "offset": 0 });
    let page = call(&workspace, "database.page", json!({ "handle": handle, "request": request }));
    assert_eq!(page["total"], 2);
    assert_eq!(page["result"]["rows"][0], json!([2, "Linus"]));
    let identity = json!({ "columns": ["id"], "values": [1] });
    call(&workspace, "database.update", json!({ "handle": handle, "table": "users", "columns": ["name"], "values": ["Grace"], "identity": identity }));
    call(&workspace, "database.delete", json!({ "handle": handle, "table": "users", "identity": { "columns": ["id"], "values": [2] } }));
    let outcome = call(&workspace, "database.run", json!({ "handle": handle, "sql": "SELECT name FROM users" }));
    assert_eq!(outcome["result"]["rows"], json!([["Grace"]]));
    assert_eq!(workspace.call("database.run", &params(json!({ "handle": handle, "sql": "SELECT * FROM nope" }))).unwrap_err().code, "database_failed");
    call(&workspace, "database.close", json!({ "handle": handle }));
    assert!(workspace.call("database.objects", &params(json!({ "handle": handle }))).is_err());

    // Saved connections keep their connection strings' passwords on the server.
    let secret = json!({ "id": "pg", "name": "Prod", "db_type": "postgres", "connection_string": "postgres://app:hunter2@db:5432/app" });
    call(&workspace, "database.saveConnections", json!({ "connections": [secret] }));
    let listed = call(&workspace, "database.connections", json!({}));
    assert_eq!(listed[0]["connection_string"], "postgres://app:••••@db:5432/app");
    assert!(!listed.to_string().contains("hunter2"));
    call(&workspace, "database.saveConnections", json!({ "connections": listed }));
    assert!(std::fs::read_to_string(&connections).unwrap().contains("hunter2"));

    call(&workspace, "database.saveHistory", json!({ "key": "sqlite:file:app", "history": ["SELECT 1", "SELECT 2"] }));
    assert_eq!(call(&workspace, "database.loadHistory", json!({ "key": "sqlite:file:app" })), json!(["SELECT 1", "SELECT 2"]));
    assert_eq!(workspace.call("database.dropEverything", &Map::new()).unwrap_err().code, "invalid_request");
}

#[cfg(unix)]
#[test]
fn docker() {
    let (dir, workspace) = workspace();
    workspace.set_docker_program(concat!(env!("CARGO_MANIFEST_DIR"), "/../docker_view/fixtures/fake-docker").into());
    let inventory = call(&workspace, "docker.inventory", json!({}));
    assert_eq!(inventory["containers"].as_array().unwrap().len(), 4);
    assert_eq!(inventory["images"].as_array().unwrap().len(), 5);
    let inspected = call(&workspace, "docker.cli", json!({ "args": ["container", "inspect", "web"] }));
    assert!(inspected.as_str().unwrap().contains("Running"));
    assert_eq!(workspace.call("docker.cli", &params(json!({ "args": ["rm", "x"] }))).unwrap_err().code, "docker_failed");
    let root = dir.path().canonicalize().unwrap().to_string_lossy().into_owned();
    let config = call(&workspace, "docker.projectConfig", json!({ "workspacePath": root }));
    assert!(config.is_object());
    let outside = workspace.call("docker.copyFromContainer", &params(json!({ "containerId": "c1", "containerPath": "/etc", "hostPath": "/tmp/elsewhere" })));
    assert_eq!(outside.unwrap_err().code, "invalid_request");

    let stream = call(&workspace, "docker.logsStart", json!({ "containerId": "web", "tail": 100 }));
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut lines = Vec::new();
    while lines.len() < 5 {
        assert!(Instant::now() < deadline, "no log lines");
        let read = call(&workspace, "docker.logsRead", json!({ "stream": stream }));
        lines.extend(read.as_array().unwrap().iter().cloned());
        thread::sleep(Duration::from_millis(50));
    }
    // stdout and stderr are read on separate threads, so only each pipe's own order holds.
    let first_stdout = lines.iter().find(|line| line["Line"]["stderr"] == json!(false)).expect("a stdout line");
    assert!(first_stdout["Line"]["text"].as_str().unwrap().ends_with("request 1"));
    call(&workspace, "docker.logsStop", json!({ "stream": stream }));
    assert!(workspace.call("docker.logsRead", &params(json!({ "stream": stream }))).is_err());
}

#[test]
fn html_previews() {
    let (dir, address) = start_server();
    std::fs::create_dir_all(dir.path().join("site/css")).unwrap();
    std::fs::write(dir.path().join("site/index.html"), "<h1>hi</h1>").unwrap();
    std::fs::write(dir.path().join("site/css/a b.css"), "h1{}").unwrap();
    let answer = post_call(address, "secret", r#"{"method":"preview.base"}"#);
    let base = answer.split(r#""path":""#).nth(1).and_then(|rest| rest.split('"').next()).unwrap().to_string();
    assert!(base.starts_with("/preview/") && base.ends_with('/'), "{answer}");
    let page = http(address, &format!("GET {base}site/ HTTP/1.1\r\n\r\n"));
    assert!(page.starts_with("HTTP/1.1 200") && page.contains("Content-Security-Policy: sandbox") && page.ends_with("<h1>hi</h1>"), "{page}");
    assert!(http(address, &format!("GET {base}site/css/a%20b.css HTTP/1.1\r\n\r\n")).contains("text/css"));
    assert!(http(address, &format!("GET {base}../outside HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 404"));
    assert!(http(address, "GET /preview/wrong/site/index.html HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
    assert!(post_call(address, "wrong", r#"{"method":"preview.base"}"#).starts_with("HTTP/1.1 401"));
}
