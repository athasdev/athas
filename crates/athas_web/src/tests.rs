use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

use athas_server::{Outgoing, Workspace};
use editor::{FileBackend, Loaded};
use file_tree::Fs;
use git_panel::{FileStatus, StashAction};
use search_panel::{GrepPattern, PathFilter};
use serde_json::Value;
use terminal_view::{PtyIo, PtySize};
use web_protocol::CallError;

use super::*;

/// The server in this process, its pushes fed to the client's [`Events`] as the socket would.
struct Local {
    workspace: Arc<Workspace>,
    pushes: Mutex<mpsc::Receiver<Outgoing>>,
}

impl Transport for Local {
    fn call(&self, method: &str, params: Value) -> Result<Value, CallError> {
        let mut params = params.as_object().cloned().unwrap_or_default();
        // Terminals run a plain `sh`, never the user's login shell with their profile and history.
        if method == "terminal.create" {
            params.entry("command").or_insert_with(|| "/bin/sh".into());
            params.entry("env").or_insert_with(|| serde_json::json!({ "HISTFILE": "/dev/null", "ENV": "" }));
        }
        self.workspace.call(method, &params)
    }
}

impl Local {
    fn deliver(&self, events: &Events) {
        while let Ok(push) = self.pushes.lock().unwrap().try_recv() {
            match push {
                Outgoing::Text(text) => events.handle_text(&text),
                Outgoing::Binary(frame) => events.handle_binary(&frame),
            }
        }
    }
}

fn setup() -> (tempfile::TempDir, PathBuf, Arc<Local>, Arc<Events>) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();
    let root = workspace.root().to_path_buf();
    let local = Arc::new(Local { pushes: Mutex::new(workspace.subscribe()), workspace });
    let events = Events::new(root.clone());
    (dir, root, local, events)
}

fn until(local: &Local, events: &Events, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < deadline, "timed out");
        std::thread::sleep(Duration::from_millis(20));
        local.deliver(events);
    }
}

#[test]
fn files_and_changes() {
    let (_dir, root, local, events) = setup();
    let fs = RemoteFs::new(root.clone(), local.clone(), events.clone());
    let changed = Arc::new(Mutex::new(Vec::<PathBuf>::new()));
    let guard = {
        let changed = changed.clone();
        Fs::watch(&*fs, &root, Box::new(move |changes| changed.lock().unwrap().extend(changes.paths))).unwrap()
    };

    fs.create_dir(&root.join("src")).unwrap();
    let main = root.join("src/main.rs");
    fs.create_file(&main).unwrap();
    assert!(fs.save(&main, "fn main() {}\n").unwrap().is_some());
    assert!(fs.exists(&main) && fs.is_dir(&root.join("src")) && !fs.is_dir(&main));
    let Loaded::Text { text, modified } = fs.load(&main).unwrap() else { panic!("not text") };
    assert_eq!((text.as_str(), modified.is_some()), ("fn main() {}\n", true));
    assert_eq!(fs.read_to_string(&main).unwrap(), "fn main() {}\n");
    let entries = fs.read_dir(&root).unwrap();
    assert_eq!(entries.iter().map(|entry| (entry.name.as_str(), entry.is_dir, entry.path.clone())).collect::<Vec<_>>(), vec![("src", true, root.join("src"))]);
    until(&local, &events, || changed.lock().unwrap().iter().any(|path| path == &main));

    fs.copy(&main, &root.join("src/copy.rs")).unwrap();
    fs.move_path(&root.join("src/copy.rs"), &root.join("moved.rs")).unwrap();
    assert!(fs.exists(&root.join("moved.rs")) && !fs.exists(&root.join("src/copy.rs")));
    fs.trash(&root.join("src")).unwrap();
    assert!(!fs.exists(&main));
    assert!(fs.read_dir(Path::new("/elsewhere")).is_err());
    std::fs::write(root.join("logo.png"), [0x89, b'P', 0, 0]).unwrap();
    assert!(matches!(fs.load(&root.join("logo.png")).unwrap(), Loaded::Binary));

    drop(guard);
    changed.lock().unwrap().clear();
    fs.save(&root.join("later.txt"), "x").unwrap();
    std::thread::sleep(Duration::from_millis(400));
    local.deliver(&events);
    assert!(changed.lock().unwrap().is_empty());
}

#[test]
fn search_pages() {
    let (_dir, root, local, _events) = setup();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/lib.rs"), "// é needle\nlet needle = Needle;\n").unwrap();
    std::fs::write(root.join("notes.md"), "needle\n").unwrap();
    let pattern = GrepPattern { pattern: "(?i:needle)".into(), is_regex: true };
    let page = grep(&*local, &root, &[root.clone()], &pattern, &PathFilter::new("src/**", "")).unwrap();
    assert_eq!(page.files.len(), 1);
    let file = &page.files[0];
    assert_eq!((file.path.clone(), file.relative.as_str()), (root.join("src/lib.rs"), "src/lib.rs"));
    assert_eq!(file.matches[0].ranges, vec![(6, 12)]);
    assert_eq!(&file.matches[0].text[6..12], "needle");
    assert_eq!(file.matches[1].ranges, vec![(4, 10), (13, 19)]);
    assert_eq!(page.next_offset, 0);
    let literal = GrepPattern { pattern: "Needle".into(), is_regex: false };
    assert_eq!(grep(&*local, &root, &[root.clone()], &literal, &PathFilter::default()).unwrap().files[0].match_count(), 1);
    assert!(grep(&*local, &root, &[PathBuf::from("/elsewhere")], &literal, &PathFilter::default()).unwrap().files.is_empty());
}

#[test]
fn git_panel_repository() {
    if !Command::new("git").arg("--version").output().is_ok_and(|output| output.status.success()) {
        return;
    }
    let (_dir, root, local, _events) = setup();
    let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&root).output().unwrap().status.success(), "git {args:?}");
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.name", "Test"]);
    git(&["config", "user.email", "test@example.com"]);
    git(&["config", "commit.gpgsign", "false"]);
    assert!(discover(root.clone(), local.clone())(Path::new("/elsewhere")).is_none());
    let repo = discover(root.clone(), local.clone())(&root).expect("a repository");
    assert_eq!(repo.root(), root);

    std::fs::write(root.join("a.txt"), "one\n").unwrap();
    let tree = repo.status().unwrap();
    assert_eq!((tree.branch.as_str(), tree.head.clone(), tree.files.len()), ("main", None, 1));
    assert_eq!(tree.files[0].status, FileStatus::Untracked);
    repo.set_staged(&["a.txt".into()], true).unwrap();
    assert!(repo.status().unwrap().files[0].staged);
    repo.commit("First").unwrap();
    let log = repo.log(0, 10).unwrap();
    assert_eq!((log[0].summary.as_str(), log[0].author.as_str(), log[0].date.len()), ("First", "Test", 10));

    std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
    let tree = repo.status().unwrap();
    assert_eq!(tree.head.as_deref(), Some(log[0].hash.as_str()));
    assert_eq!((tree.files[0].status, tree.stats[0].additions), (FileStatus::Modified, 1));
    repo.stash(Some("wip"), None).unwrap();
    assert!(repo.status().unwrap().files.is_empty());
    assert!(repo.stashes().unwrap()[0].message.contains("wip"));
    repo.stash_action(StashAction::Pop, 0).unwrap();
    assert!(repo.stashes().unwrap().is_empty());
    repo.discard(&["a.txt".into()]).unwrap();
    assert!(repo.status().unwrap().files.is_empty());

    repo.create_branch("feature", None).unwrap();
    assert_eq!(repo.status().unwrap().branch, "feature");
    assert_eq!(repo.branches().unwrap(), vec!["feature".to_string(), "main".to_string()]);
    assert_eq!(repo.checkout("main").unwrap(), git_panel::Checkout::Switched);
    assert!(matches!(repo.checkout("missing").unwrap(), git_panel::Checkout::Blocked(_)));
    repo.delete_branch("feature").unwrap();
    assert_eq!(repo.branches().unwrap(), vec!["main".to_string()]);
}

#[test]
fn terminals_stream_both_ways() {
    let (_dir, root, local, events) = setup();
    let output = Arc::new(Mutex::new(Vec::<u8>::new()));
    let (exited_tx, exited) = mpsc::channel();
    let (input, input_rx) = mpsc::channel();
    let io = PtyIo {
        input: input_rx,
        output: Box::new({
            let output = output.clone();
            move |bytes| output.lock().unwrap().extend_from_slice(bytes)
        }),
        exited: Box::new(move |_| exited_tx.send(()).unwrap()),
    };
    let size = PtySize { rows: 24, cols: 80, cell_width: 8, cell_height: 16 };
    let pty = spawn_terminal(&root, local.clone(), events.clone(), root.clone(), size, io).unwrap();
    pty.resize(PtySize { cols: 100, ..size });
    input.send(b"printf 'web%s\\n' -ok\n".to_vec()).unwrap();
    send_input(&*local, &events);
    until(&local, &events, || String::from_utf8_lossy(&output.lock().unwrap()).contains("web-ok"));
    input.send(b"exit\n".to_vec()).unwrap();
    send_input(&*local, &events);
    until(&local, &events, || exited.try_recv().is_ok());
    drop(pty);
    assert_eq!(local.workspace.call("terminal.list", &Default::default()).unwrap()["terminals"], serde_json::json!([]));
}

/// A language server in Python: answers `initialize` and hover, publishes a diagnostic for each
/// opened file, and exits on `exit`.
const FAKE_LANGUAGE_SERVER: &str = r#"
import json, sys
def read():
    length = None
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        line = line.strip()
        if not line and length is not None:
            return json.loads(sys.stdin.buffer.read(length))
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":")[1])
def send(message):
    body = json.dumps(message).encode()
    sys.stdout.buffer.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
    sys.stdout.buffer.flush()
while True:
    message = read()
    if message is None or message.get("method") == "exit":
        break
    method, id = message.get("method"), message.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": id, "result": {"capabilities": {"textDocumentSync": 1, "hoverProvider": True}}})
    elif method == "textDocument/hover":
        line = message["params"]["position"]["line"]
        send({"jsonrpc": "2.0", "id": id, "result": {"contents": {"kind": "markdown", "value": "hover %d" % line}}})
    elif method == "shutdown":
        send({"jsonrpc": "2.0", "id": id, "result": None})
    elif method == "textDocument/didOpen":
        document = message["params"]["textDocument"]
        diagnostic = {"range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 2}}, "message": document["text"]}
        send({"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": {"uri": document["uri"], "diagnostics": [diagnostic]}})
"#;

#[test]
fn language_servers_run_on_the_server() {
    use lsp_client::{Launcher as _, ServerMessage, lsp};

    let (_dir, root, local, events) = setup();
    std::fs::write(root.join("server.py"), FAKE_LANGUAGE_SERVER).unwrap();
    let entry: lsp_client::ServerEntry = serde_json::from_value(serde_json::json!({ "runtime": "binary", "command": "python3", "args": ["server.py"] })).unwrap();
    let (sink, mut messages) = futures::channel::mpsc::unbounded();
    let launcher = RemoteLauncher::new(root.clone(), local.clone(), events.clone());
    let server = launcher.launch(1, "fake", &entry, &root, sink).unwrap();

    let mut next = |what: &str| {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            local.deliver(&events);
            if let Ok(event) = messages.try_recv() {
                return event.message;
            }
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    assert!(matches!(next("initialize"), ServerMessage::Ready));
    assert!(server.capabilities().is_some_and(|capabilities| capabilities.hover_provider.is_some()));

    let uri = lsp_client::uri::from_path(&root.join("main.rs")).unwrap();
    server.notify::<lsp::notification::DidOpenTextDocument>(lsp::DidOpenTextDocumentParams {
        text_document: lsp::TextDocumentItem { uri: uri.clone(), language_id: "rust".into(), version: 1, text: "fn main() {}".into() },
    });
    let ServerMessage::Notification { method, params } = next("diagnostics") else { panic!("expected diagnostics") };
    assert_eq!((method.as_str(), params["diagnostics"][0]["message"].as_str()), ("textDocument/publishDiagnostics", Some("fn main() {}")));

    let hover = server.request::<lsp::request::HoverRequest>(lsp::HoverParams {
        text_document_position_params: lsp::TextDocumentPositionParams { text_document: lsp::TextDocumentIdentifier { uri }, position: lsp::Position::new(3, 1) },
        work_done_progress_params: Default::default(),
    });
    let delivering = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let pump = {
        let (local, events, delivering) = (local.clone(), events.clone(), delivering.clone());
        std::thread::spawn(move || {
            while delivering.load(std::sync::atomic::Ordering::SeqCst) {
                local.deliver(&events);
                std::thread::sleep(Duration::from_millis(10));
            }
        })
    };
    let hover = futures::executor::block_on(hover).unwrap().unwrap();
    delivering.store(false, std::sync::atomic::Ordering::SeqCst);
    pump.join().unwrap();
    assert_eq!(hover.contents, lsp::HoverContents::Markup(lsp::MarkupContent { kind: lsp::MarkupKind::Markdown, value: "hover 3".into() }));

    server.shutdown();
    assert!(matches!(next("exit"), ServerMessage::Exited { error: None }));
    drop(server);
    assert!(local.workspace.call("lsp.send", serde_json::json!({ "id": "l1", "message": "{}" }).as_object().unwrap()).is_err());
}

#[test]
fn diffs_commits_and_blame() {
    use git_diff::{DiffTarget, git::HunkAction, model::FileStatus as DiffStatus, remote::RemoteRepository as _};

    if !Command::new("git").arg("--version").output().is_ok_and(|output| output.status.success()) {
        return;
    }
    let (_dir, root, local, _events) = setup();
    let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&root).output().unwrap().status.success(), "git {args:?}");
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.name", "Test"]);
    git(&["config", "user.email", "test@example.com"]);
    git(&["config", "commit.gpgsign", "false"]);
    let numbered = |changed: &[usize]| (1..=30).map(|n| if changed.contains(&n) { format!("changed {n}\n") } else { format!("line {n}\n") }).collect::<String>();
    std::fs::write(root.join("a.txt"), numbered(&[])).unwrap();
    git(&["add", "."]);
    git(&["commit", "-q", "-m", "First\n\nThe body."]);
    let diffs = RemoteDiffs::new(root.clone(), local.clone());

    std::fs::write(root.join("a.txt"), numbered(&[2, 25])).unwrap();
    std::fs::write(root.join("new.txt"), "hello\n").unwrap();
    let working = diffs.load(&DiffTarget::Working { path: "a.txt".into() }).unwrap();
    assert_eq!((working.len(), working[0].hunks().len(), working[0].additions, working[0].deletions), (1, 2, 2, 2));
    let untracked = diffs.load(&DiffTarget::Working { path: "new.txt".into() }).unwrap();
    assert_eq!((untracked[0].path.as_str(), untracked[0].status), ("new.txt", DiffStatus::Added));

    diffs.apply_hunk(&working[0], &working[0].hunks()[0], HunkAction::Stage).unwrap();
    let staged = diffs.load(&DiffTarget::Staged { path: "a.txt".into() }).unwrap();
    assert_eq!((staged[0].hunks().len(), staged[0].hunks()[0].new_start), (1, 1));
    diffs.apply_hunk(&staged[0], &staged[0].hunks()[0], HunkAction::Unstage).unwrap();
    assert!(diffs.load(&DiffTarget::Staged { path: "a.txt".into() }).unwrap().is_empty());
    let working = diffs.load(&DiffTarget::Working { path: "a.txt".into() }).unwrap();
    diffs.apply_hunk(&working[0], &working[0].hunks()[1], HunkAction::Discard).unwrap();
    assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), numbered(&[2]));

    git(&["add", "."]);
    git(&["commit", "-q", "-m", "Second"]);
    let commit = diffs.commit_details("HEAD").unwrap();
    assert_eq!((commit.summary.as_str(), commit.parents.len(), commit.author.name.as_str()), ("Second", 1, "Test"));
    let files: Vec<_> = commit.files.iter().map(|file| (file.path.as_str(), file.status, file.additions, file.deletions)).collect();
    assert_eq!(files, vec![("a.txt", DiffStatus::Modified, 1, 1), ("new.txt", DiffStatus::Added, 1, 0)]);
    assert_eq!(diffs.commit_details("HEAD~1").unwrap().body, "The body.");
    let shown = diffs.load(&DiffTarget::Commit { commit: commit.hash.clone() }).unwrap();
    assert_eq!(shown.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(), vec!["a.txt", "new.txt"]);
    assert_eq!(diffs.file_at_commit("HEAD~1", "a.txt").unwrap(), numbered(&[]));
    assert!(diffs.file_at_commit("HEAD~1", "new.txt").is_err());

    let blame = diffs.blame("a.txt", None).unwrap();
    assert_eq!(blame.len(), 30);
    assert_eq!(blame[1].commit.as_ref().map(|commit| commit.summary.as_str()), Some("Second"));
    assert_eq!(blame[0].commit.as_ref().map(|commit| commit.summary.as_str()), Some("First"));
    let edited = format!("new first\n{}", numbered(&[2]));
    let blame = diffs.blame("a.txt", Some(&edited)).unwrap();
    assert_eq!((blame.len(), blame[0].commit.is_none(), blame[2].commit.is_some()), (31, true, true));
}

const FAKE_AGENT: &str = r#"
import json, sys
def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()
for line in sys.stdin:
    message = json.loads(line)
    method, id = message.get("method"), message.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": id, "result": {"protocolVersion": 1, "agentCapabilities": {}, "authMethods": []}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": id, "result": {"sessionId": "s1"}})
    elif method == "session/prompt":
        text = message["params"]["prompt"][0]["text"]
        update = {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "echo: " + text}}
        send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "s1", "update": update}})
        send({"jsonrpc": "2.0", "id": id, "result": {"stopReason": "end_turn"}})
"#;

#[test]
fn agents_run_on_the_server() {
    use agent_ui::acp::{
        self,
        client::{AgentConnection, ClientEvent},
        remote::{RemoteAgents as _, RemoteError},
        schema,
    };
    use futures::{executor::LocalPool, task::LocalSpawnExt as _};

    let (_dir, root, local, events) = setup();
    let host = RemoteAgentHost::new(root.clone(), local.clone(), events.clone());
    assert!(matches!(host.start("nobody", "no-such-agent-binary", &[], &root), Err(RemoteError::NotInstalled(_))));

    std::fs::write(root.join("agent.py"), FAKE_AGENT).unwrap();
    // SAFETY: no other test reads or writes the environment.
    unsafe { std::env::set_var("ATHAS_AGENT_COMMAND", format!("python3 {}", root.join("agent.py").display())) };
    let (transport, handle) = host.start("fake", "fake-acp", &[], &root).unwrap();
    unsafe { std::env::remove_var("ATHAS_AGENT_COMMAND") };

    let mut pool = LocalPool::new();
    let (connection, mut updates, io) = AgentConnection::new(transport, None);
    pool.spawner().spawn_local(io).unwrap();
    let run = |pool: &mut LocalPool, done: &mut dyn FnMut() -> bool| {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !done() {
            assert!(Instant::now() < deadline, "timed out");
            pool.run_until_stalled();
            send_input(&*local, &events);
            local.deliver(&events);
            std::thread::sleep(Duration::from_millis(10));
        }
    };

    let opened = Arc::new(Mutex::new(None));
    pool.spawner()
        .spawn_local({
            let (connection, opened, root) = (connection.clone(), opened.clone(), root.clone());
            async move {
                let session = acp::open_session(&connection, &root, None, false, &[]).await.map_err(|error| error.to_string());
                *opened.lock().unwrap() = Some(session.map(|session| session.session_id));
            }
        })
        .unwrap();
    run(&mut pool, &mut || opened.lock().unwrap().is_some());
    assert_eq!(opened.lock().unwrap().take().unwrap().unwrap(), "s1");

    let stopped = Arc::new(Mutex::new(None));
    pool.spawner()
        .spawn_local({
            let (connection, stopped) = (connection.clone(), stopped.clone());
            async move {
                let response = connection.prompt("s1", vec![schema::ContentBlock::Text(schema::TextContent::new("hi"))]).await;
                *stopped.lock().unwrap() = Some(response.map(|response| response.stop_reason));
            }
        })
        .unwrap();
    run(&mut pool, &mut || stopped.lock().unwrap().is_some());
    assert_eq!(stopped.lock().unwrap().take().unwrap().unwrap(), schema::StopReason::EndTurn);
    let Ok(ClientEvent::Update(schema::SessionUpdate::AgentMessageChunk(chunk))) = updates.try_recv() else { panic!("expected the agent's answer") };
    assert_eq!(chunk.content, schema::ContentBlock::Text(schema::TextContent::new("echo: hi")));

    drop(handle);
    assert!(local.workspace.call("agent.send", serde_json::json!({ "id": "a1", "message": "{}" }).as_object().unwrap()).is_err());
}

#[test]
fn github_views_relay_through_the_server() {
    use web_protocol::github::{AuthState, GitHubCall};

    let (_dir, root, local, _events) = setup();
    let git = |args: &[&str]| Command::new("git").args(args).current_dir(&root).output().is_ok_and(|output| output.status.success());
    let has_git = git(&["init", "-q", "-b", "main"]) && git(&["remote", "add", "origin", "git@github.com:acme/web.git"]) && git(&["remote", "add", "fork", "https://github.com/me/web"])
        && git(&["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "First"]);

    let calls = Arc::new(Mutex::new(Vec::new()));
    local.workspace.set_github_backend(Arc::new({
        let calls = calls.clone();
        move |call: GitHubCall| {
            calls.lock().unwrap().push(call.clone());
            let pr = serde_json::json!({ "number": 41, "title": "Port", "state": "OPEN", "author": {"login": "mehmet"}, "headRefName": "feature", "baseRefName": "main",
                "statusCheckRollup": {"contexts": {"nodes": [{"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS", "workflowName": "CI"}]}},
                "closingIssuesReferences": [{"number": 3, "url": "u"}] });
            match call {
                GitHubCall::Auth => Ok(serde_json::to_value(AuthState::Authenticated { source: "ghCli".into() }).unwrap()),
                GitHubCall::ListPrs { .. } => Ok(serde_json::to_value(serde_json::from_value::<Vec<athas_github::PullRequest>>(Value::Array(vec![pr])).unwrap()).unwrap()),
                GitHubCall::PrDetails { .. } => Ok(serde_json::to_value(serde_json::from_value::<athas_github::PullRequestDetails>(pr).unwrap()).unwrap()),
                GitHubCall::ListReleases { page, .. } => Ok(serde_json::json!([{ "id": page, "tag_name": "v1", "target_commitish": "main", "name": null, "body": null, "draft": false, "prerelease": false,
                    "html_url": "h", "created_at": "c", "published_at": null, "author": null, "assets": [], "zipball_url": null, "tarball_url": null, "discussion_url": null }])),
                GitHubCall::RerunWorkflowRun { .. } => Ok(Value::Null),
                GitHubCall::ResolveNotificationRun { check_suite_id, .. } => Ok(serde_json::json!({ "databaseId": check_suite_id.unwrap() * 10, "displayTitle": "CI", "name": "CI", "headBranch": "main", "event": "push", "status": "completed", "conclusion": "success", "workflowName": "CI", "createdAt": "c", "updatedAt": "u", "url": "https://github.com/acme/web/actions/runs/70" })),
                _ => Err("GitHub said no".into()),
            }
        }
    }));
    github_panel::relay::set_transport(Arc::new(GitHubRelay::new(local.clone())));
    let path = root.to_string_lossy().into_owned();

    assert_eq!(github_panel::relay::auth_state().unwrap(), AuthState::Authenticated { source: "ghCli".into() });
    let prs = github_panel::relay::github_list_prs(path.clone(), "open".into(), None).unwrap();
    assert_eq!((prs[0].number, prs[0].head_ref.as_str(), prs[0].base_ref.as_str()), (41, "feature", "main"));
    let details = github_panel::relay::github_get_pr_details(path.clone(), 41, None).unwrap();
    assert_eq!((details.status_checks[0].workflow_name.as_deref(), details.linked_issues[0].number), (Some("CI"), 3));
    assert_eq!(github_panel::relay::github_list_releases(path.clone(), 2, None).unwrap()[0].id, 2);
    github_panel::relay::github_rerun_workflow_run(path.clone(), 9, true, None).unwrap();
    let run = github_panel::relay::github_resolve_notification_workflow_run("acme/web".into(), Some(7), "CI".into(), "u".into(), None).unwrap().unwrap();
    assert_eq!(run.url, "https://github.com/acme/web/actions/runs/70");
    assert_eq!(github_panel::relay::github_get_issue_details(path.clone(), 1, None).unwrap_err(), "GitHub said no");
    assert!(github_panel::relay::github_list_prs("/elsewhere".into(), "open".into(), None).unwrap_err().contains("outside the workspace"));
    assert!(github_panel::relay::github_upload_release_asset(path.clone(), 1, "/etc/passwd".into(), None).is_err());
    assert_eq!(
        calls.lock().unwrap().iter().filter(|call| matches!(call, GitHubCall::RerunWorkflowRun { run_id: 9, failed_only: true, .. })).count(),
        1
    );
    assert_eq!(calls.lock().unwrap().len(), 7);

    if has_git {
        let info = github_panel::relay::repository(path.clone()).unwrap().expect("a repository");
        assert_eq!((info.root.as_str(), info.branch.as_deref()), (path.as_str(), Some("main")));
        assert_eq!(info.remotes.iter().map(|remote| remote.name.as_str()).collect::<Vec<_>>(), ["fork", "origin"]);
        assert_eq!(info.remotes[1].url, "git@github.com:acme/web.git");
    }
}

#[test]
fn database_views_relay_through_the_server() {
    use database_view::relay::{self, RemoteBackend};

    let (_dir, root, local, _events) = setup();
    let state = tempfile::tempdir().unwrap();
    local.workspace.set_database_paths(Some(state.path().join("connections.json")), Some(state.path().join("history.json")));
    relay::set_transport(Arc::new(ServiceRelay::new(local.clone())));

    let file = root.join("notes.sqlite");
    std::fs::write(&file, b"").unwrap();
    let connection: database_view::SavedConnection =
        serde_json::from_value(serde_json::json!({ "id": "notes", "name": "Notes", "db_type": "sqlite", "file_path": file.to_string_lossy() })).unwrap();
    RemoteBackend::test(&connection, None).unwrap();
    let backend = RemoteBackend::open(&connection, None).unwrap();
    assert_eq!(backend.file_path(), Some(file.as_path()));
    backend.run("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)").unwrap();
    assert_eq!(backend.insert("notes", &["body".into()], &[Value::from("hello")]).unwrap(), 1);
    assert_eq!(backend.objects().unwrap()[0].name, "notes");
    assert!(backend.columns("notes").unwrap()[0].primary_key);
    let outcome = backend.run("SELECT body FROM notes").unwrap();
    assert_eq!(outcome.result.rows, vec![vec![Value::from("hello")]]);
    assert_eq!(backend.info(1).unwrap().tables, 1);
    backend.close();
    assert!(backend.objects().is_err());

    relay::save_connections(std::slice::from_ref(&connection)).unwrap();
    assert_eq!(relay::connections().unwrap(), vec![connection]);
    relay::save_history("sqlite:file:notes", &["SELECT 1".into()]).unwrap();
    assert_eq!(relay::load_history("sqlite:file:notes").unwrap(), vec!["SELECT 1".to_string()]);
}

#[test]
fn html_previews_load_from_the_server() {
    let root = Path::new("/work/site");
    assert_eq!(
        preview_address("http://127.0.0.1:7878/", "/preview/abc/", root, &root.join("pages/a b.html")).as_deref(),
        Some("http://127.0.0.1:7878/preview/abc/pages/a%20b.html")
    );
    assert_eq!(preview_address("http://h", "/preview/abc/", root, Path::new("/elsewhere/x.html")), None);
}

#[test]
fn browser_transfers_round_trip_through_the_server() {
    let (_dir, _root, local, _events) = setup();
    let path = crate::transfers::upload(&*local, "data.db", b"SQLite format 3\0rows").unwrap();
    assert_eq!(path.file_name().unwrap(), "data.db");
    assert_eq!(crate::transfers::read(&*local, &path).unwrap(), ("data.db".to_string(), b"SQLite format 3\0rows".to_vec()));
    let folder = crate::transfers::new_dir(&*local).unwrap();
    std::fs::write(folder.join("app.log"), "started\n").unwrap();
    assert_eq!(crate::transfers::read(&*local, &folder.join("app.log")).unwrap().1, b"started\n");
    assert!(crate::transfers::read(&*local, Path::new("/etc/hosts")).is_err());
    std::fs::remove_dir_all(path.parent().unwrap()).ok();
    std::fs::remove_dir_all(folder).ok();
}
