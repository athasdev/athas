//! The ACP client against the scripted fake agent.

use std::{path::Path, sync::Arc};

use futures::{
    StreamExt,
    channel::mpsc,
    executor::{LocalPool, LocalSpawner},
    task::LocalSpawnExt as _,
};
use serde_json::{Value, json};

use super::{
    OpenError, OpenedSession,
    client::{AgentConnection, ClientEvent},
    fake_agent::{FakeAgent, fake_agent},
    host::{ClientHost, LocalHost},
    open_session,
    rpc::RpcError,
    schema as acp,
};
use crate::thread::{Entry, Transcript};

fn initialize(load_session: bool) -> Value {
    json!({ "result": {
        "protocolVersion": 1,
        "agentCapabilities": { "loadSession": load_session },
        "authMethods": []
    } })
}

fn update(value: Value) -> Value {
    json!({ "notify": "session/update", "params": { "sessionId": "s1", "update": value } })
}

struct Harness {
    pool: LocalPool,
    connection: Arc<AgentConnection>,
    events: mpsc::UnboundedReceiver<ClientEvent>,
    agent: FakeAgent,
    project: tempfile::TempDir,
}

fn connect(script: Value) -> Harness {
    connect_in(script, tempfile::tempdir().unwrap())
}

fn connect_in(script: Value, project: tempfile::TempDir) -> Harness {
    let pool = LocalPool::new();
    let spawner: LocalSpawner = pool.spawner();
    let (transport, agent) = fake_agent(script, &spawner);
    let host: Arc<dyn ClientHost> = Arc::new(LocalHost::new(project.path().to_path_buf(), vec![project.path().to_path_buf()]));
    let (connection, events, io) = AgentConnection::new(transport, Some(host));
    spawner.spawn_local(io).unwrap();
    Harness { pool, connection, events, agent, project }
}

impl Harness {
    fn cwd(&self) -> &Path {
        self.project.path()
    }

    fn open(&mut self, resume: Option<&str>, have_history: bool) -> Result<OpenedSession, OpenError> {
        let connection = self.connection.clone();
        let cwd = self.cwd().to_path_buf();
        let resume = resume.map(str::to_string);
        self.pool.run_until(async move { open_session(&connection, &cwd, resume.as_deref(), have_history, &[]).await })
    }

    /// Every event the client has handed over so far, folded into a transcript.
    fn drain_into(&mut self, transcript: &mut Transcript) -> Vec<ClientEvent> {
        self.pool.run_until_stalled();
        let mut others = Vec::new();
        while let Ok(event) = self.events.try_recv() {
            match event {
                ClientEvent::Update(update) => {
                    transcript.apply(update);
                }
                other => others.push(other),
            }
        }
        others
    }
}

#[test]
fn opens_a_new_session_and_advertises_files_and_terminals() {
    let mut harness = connect(json!({
        "initialize": initialize(false),
        "session/new": { "result": {
            "sessionId": "s1",
            "modes": { "currentModeId": "default", "availableModes": [ { "id": "default", "name": "Default" }, { "id": "plan", "name": "Plan" } ] },
            "configOptions": [ { "id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": "opus",
                "options": [ { "value": "opus", "name": "Opus" } ] } ]
        } }
    }));
    let opened = harness.open(None, false).unwrap();
    assert_eq!(opened.session_id, "s1");
    assert_eq!(opened.modes.unwrap().available_modes.len(), 2);
    assert_eq!(opened.config_options.unwrap().len(), 1);
    assert!(!opened.context_lost);
    assert_eq!(harness.agent.methods(), ["initialize", "session/new"]);
    let init = &harness.agent.params("initialize")[0];
    assert_eq!(init["protocolVersion"], 1);
    assert_eq!(init["clientCapabilities"]["fs"]["readTextFile"], true);
    assert_eq!(init["clientCapabilities"]["fs"]["writeTextFile"], true);
    assert_eq!(init["clientCapabilities"]["terminal"], true);
    assert_eq!(init["clientCapabilities"]["_meta"]["terminal_output"], true);
    assert_eq!(init["clientCapabilities"]["_meta"]["terminal-auth"], true);
    assert_eq!(init["clientCapabilities"]["auth"]["terminal"], true);
    assert_eq!(init["clientCapabilities"]["_meta"]["athas.dev"]["extensionMethods"][1]["name"], "_athas/set_chat_title");
    assert_eq!(harness.agent.params("session/new")[0]["cwd"], json!(harness.cwd()));
}

#[test]
fn reattaches_with_session_load_and_drops_the_replayed_history() {
    let mut harness = connect(json!({
        "initialize": initialize(true),
        "session/load": { "steps": [
            update(json!({ "sessionUpdate": "user_message_chunk", "content": { "type": "text", "text": "old prompt" } })),
            update(json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "old answer" } })),
            update(json!({ "sessionUpdate": "available_commands_update", "availableCommands": [ { "name": "review", "description": "Review" } ] })),
        ], "result": {} }
    }));
    let opened = harness.open(Some("s1"), true).unwrap();
    assert_eq!(opened.session_id, "s1");
    assert_eq!(harness.agent.methods(), ["initialize", "session/load"]);
    let mut transcript = Transcript::default();
    harness.drain_into(&mut transcript);
    assert!(transcript.entries.is_empty(), "{:?}", transcript.entries);
    assert_eq!(transcript.commands.len(), 1);
}

#[test]
fn a_session_without_history_keeps_the_replay() {
    let mut harness = connect(json!({
        "initialize": initialize(true),
        "session/load": { "steps": [
            update(json!({ "sessionUpdate": "user_message_chunk", "content": { "type": "text", "text": "old prompt" } })),
        ], "result": {} }
    }));
    harness.open(Some("s1"), false).unwrap();
    let mut transcript = Transcript::default();
    harness.drain_into(&mut transcript);
    assert_eq!(transcript.first_prompt(), Some("old prompt"));
}

#[test]
fn starts_over_when_the_agent_cannot_load() {
    let mut harness = connect(json!({
        "initialize": initialize(false),
        "session/new": { "result": { "sessionId": "s2" } }
    }));
    let opened = harness.open(Some("s1"), true).unwrap();
    assert_eq!(opened.session_id, "s2");
    assert!(opened.context_lost);

    let mut missing = connect(json!({
        "initialize": initialize(true),
        "session/load": { "error": { "code": -32002, "message": "Session not found" } },
        "session/new": { "result": { "sessionId": "s3" } }
    }));
    let opened = missing.open(Some("gone"), true).unwrap();
    assert_eq!((opened.session_id.as_str(), opened.context_lost), ("s3", true));
}

#[test]
fn reports_sign_in_when_the_agent_needs_it() {
    let mut harness = connect(json!({
        "initialize": { "result": { "protocolVersion": 1, "agentCapabilities": {}, "authMethods": [
            { "id": "claude-login", "name": "Log in with Claude", "type": "terminal" }
        ] } },
        "session/new": { "error": { "code": -32000, "message": "Authentication required" } }
    }));
    match harness.open(None, false) {
        Err(OpenError::AuthRequired(methods, _)) => assert_eq!(&*methods[0].id().0, "claude-login"),
        other => panic!("{other:?}"),
    }

    let mut automatic = connect(json!({
        "initialize": { "result": { "protocolVersion": 1, "agentCapabilities": {}, "authMethods": [
            { "id": "api-key", "name": "API key" }
        ] } },
        "session/new": [ { "error": { "code": -32000, "message": "Authentication required" } }, { "result": { "sessionId": "s1" } } ],
        "authenticate": { "result": {} }
    }));
    assert_eq!(automatic.open(None, false).unwrap().session_id, "s1");
    assert_eq!(automatic.agent.methods(), ["initialize", "session/new", "authenticate", "session/new"]);

    // A method with the older `terminal-auth` launch, or one of several ways, is the user's pick.
    for methods in [
        json!([{ "id": "login", "name": "Log in", "_meta": { "terminal-auth": { "command": "agent", "args": ["login"] } } }]),
        json!([{ "id": "api-key", "name": "API key" }, { "id": "login", "name": "Log in", "type": "terminal" }]),
    ] {
        let mut harness = connect(json!({
            "initialize": { "result": { "protocolVersion": 1, "agentCapabilities": {}, "authMethods": methods } },
            "session/new": { "error": { "code": -32000, "message": "Authentication required" } }
        }));
        assert!(matches!(harness.open(None, false), Err(OpenError::AuthRequired(..))));
        assert_eq!(harness.agent.methods(), ["initialize", "session/new"]);
    }
}

#[test]
fn terminal_sign_in_runs_the_agent_with_the_methods_arguments() {
    let methods: Vec<acp::AuthMethod> = serde_json::from_value(json!([
        { "id": "login", "name": "Log in", "type": "terminal", "args": ["--login"], "env": { "MODE": "1" } },
        { "id": "legacy", "name": "Legacy", "_meta": { "terminal-auth": { "command": "gemini-login", "args": ["auth"], "env": { "A": "b" } } } },
        { "id": "key", "name": "Key" },
    ]))
    .unwrap();
    let base = vec!["--acp".to_string()];
    let launch = super::terminal_launch(&methods[0], &base).unwrap();
    assert_eq!((launch.program, launch.args, launch.env), (None, vec!["--acp".into(), "--login".into()], vec![("MODE".into(), "1".into())]));
    let launch = super::terminal_launch(&methods[1], &base).unwrap();
    assert_eq!((launch.program.as_deref(), launch.args, launch.env), (Some("gemini-login"), vec!["auth".into()], vec![("A".into(), "b".into())]));
    assert!(super::terminal_launch(&methods[2], &base).is_none());
    assert!(super::uses_authenticate(&methods[2]) && !super::uses_authenticate(&methods[1]));
}

#[test]
fn streams_a_turn_and_answers_permission_requests() {
    let mut harness = connect(json!({
        "initialize": initialize(false),
        "session/new": { "result": { "sessionId": "s1" } },
        "session/prompt": { "steps": [
            update(json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "Thinking" } })),
            update(json!({ "sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Edit main.rs", "kind": "edit", "status": "pending" })),
            { "request": "session/request_permission", "params": {
                "sessionId": "s1",
                "toolCall": { "toolCallId": "t1" },
                "options": [
                    { "optionId": "allow", "name": "Allow", "kind": "allow_once" },
                    { "optionId": "reject", "name": "Reject", "kind": "reject_once" }
                ]
            } },
            update(json!({ "sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed" })),
            update(json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "Done." } })),
        ], "result": { "stopReason": "end_turn" } }
    }));
    let session = harness.open(None, false).unwrap().session_id;
    let connection = harness.connection.clone();
    let prompt = vec![acp::ContentBlock::Text(acp::TextContent::new("Edit it"))];
    let (answer_tx, answer_rx) = futures::channel::oneshot::channel();
    harness
        .pool
        .spawner()
        .spawn_local(async move {
            let _ = answer_tx.send(connection.prompt(&session, prompt).await);
        })
        .unwrap();

    let mut transcript = Transcript::default();
    let events = harness.drain_into(&mut transcript);
    let Some(ClientEvent::Permission(request)) = events.into_iter().next() else { panic!("no permission request") };
    assert_eq!(&*request.tool_call.tool_call_id.0, "t1");
    assert_eq!(request.options.len(), 2);
    request.respond.send(Some(request.options[0].option_id.clone())).unwrap();

    harness.drain_into(&mut transcript);
    let response = harness.pool.run_until(answer_rx).unwrap().unwrap();
    assert_eq!(response.stop_reason, acp::StopReason::EndTurn);
    let answers = harness.agent.answers("session/request_permission");
    assert_eq!(answers[0]["result"]["outcome"], json!({ "outcome": "selected", "optionId": "allow" }));
    assert_eq!(harness.agent.params("session/prompt")[0]["prompt"][0]["text"], "Edit it");
    assert!(matches!(&transcript.entries[0], Entry::Thought(_)));
    assert!(matches!(&transcript.entries[1], Entry::ToolCall(call) if call.status == crate::thread::ToolStatus::Completed));
    assert!(matches!(&transcript.entries[2], Entry::Agent(message) if message.text == "Done."));
}

#[test]
fn cancelling_stops_the_turn() {
    let mut harness = connect(json!({
        "initialize": initialize(false),
        "session/new": { "result": { "sessionId": "s1" } },
        "session/prompt": { "steps": [ { "await": "session/cancel" } ], "result": { "stopReason": "cancelled" } }
    }));
    let session = harness.open(None, false).unwrap().session_id;
    let connection = harness.connection.clone();
    let (answer_tx, answer_rx) = futures::channel::oneshot::channel();
    let turn_connection = connection.clone();
    let turn_session = session.clone();
    harness
        .pool
        .spawner()
        .spawn_local(async move {
            let prompt = vec![acp::ContentBlock::Text(acp::TextContent::new("Go"))];
            let _ = answer_tx.send(turn_connection.prompt(&turn_session, prompt).await);
        })
        .unwrap();
    harness.pool.run_until_stalled();
    connection.cancel(&session);
    let response = harness.pool.run_until(answer_rx).unwrap();
    assert_eq!(response.unwrap().stop_reason, acp::StopReason::Cancelled);
    assert_eq!(harness.agent.methods(), ["initialize", "session/new", "session/prompt", "session/cancel"]);
}

#[test]
fn file_reads_see_what_an_open_editor_holds() {
    let project = tempfile::tempdir().unwrap();
    let open_file = project.path().join("open.txt");
    let closed_file = project.path().join("closed.txt");
    std::fs::write(&open_file, "saved\n").unwrap();
    std::fs::write(&closed_file, "one\ntwo\n").unwrap();
    let mut harness = connect_in(
        json!({
            "initialize": initialize(false),
            "session/new": { "result": { "sessionId": "s1" } },
            "session/prompt": { "steps": [
                { "request": "fs/read_text_file", "params": { "sessionId": "s1", "path": open_file } },
                { "request": "fs/read_text_file", "params": { "sessionId": "s1", "path": closed_file, "line": 2 } },
            ], "result": { "stopReason": "end_turn" } }
        }),
        project,
    );
    harness.connection.read_open_buffers();
    let connection = harness.connection.clone();
    let spawner = harness.pool.spawner();
    let session = harness.open(None, false).unwrap().session_id;
    let (done_tx, done_rx) = futures::channel::oneshot::channel();
    spawner
        .spawn_local(async move {
            let _ = done_tx.send(connection.prompt(&session, Vec::new()).await);
        })
        .unwrap();
    let mut transcript = Transcript::default();
    let mut asked = Vec::new();
    loop {
        let mut answered = false;
        for event in harness.drain_into(&mut transcript) {
            if let ClientEvent::BufferRead { path, respond } = event {
                let open = (path == open_file).then(|| "unsaved\n".to_string());
                respond.send(open).unwrap();
                asked.push(path);
                answered = true;
            }
        }
        if !answered {
            break;
        }
    }
    harness.pool.run_until(done_rx).unwrap().unwrap();
    assert_eq!(asked, vec![open_file.clone(), closed_file.clone()]);
    let reads = harness.agent.answers("fs/read_text_file");
    assert_eq!(reads[0]["result"]["content"], "unsaved\n");
    assert_eq!(reads[1]["result"]["content"], "two\n");
}

#[test]
fn a_file_read_goes_to_the_disk_when_the_editor_does_not_answer() {
    let project = tempfile::tempdir().unwrap();
    let file = project.path().join("open.txt");
    std::fs::write(&file, "saved\n").unwrap();
    let mut harness = connect_in(
        json!({
            "initialize": initialize(false),
            "session/new": { "result": { "sessionId": "s1" } },
            "session/prompt": { "steps": [
                { "request": "fs/read_text_file", "params": { "sessionId": "s1", "path": file } },
            ], "result": { "stopReason": "end_turn" } }
        }),
        project,
    );
    harness.connection.read_open_buffers();
    let connection = harness.connection.clone();
    let spawner = harness.pool.spawner();
    let session = harness.open(None, false).unwrap().session_id;
    let (done_tx, done_rx) = futures::channel::oneshot::channel();
    spawner
        .spawn_local(async move {
            let _ = done_tx.send(connection.prompt(&session, Vec::new()).await);
        })
        .unwrap();
    let mut transcript = Transcript::default();
    // The editor holds the request without answering it.
    let held: Vec<_> = harness.drain_into(&mut transcript).into_iter().filter(|event| matches!(event, ClientEvent::BufferRead { .. })).collect();
    assert_eq!(held.len(), 1);
    let started = std::time::Instant::now();
    harness.pool.run_until(done_rx).unwrap().unwrap();
    assert!(started.elapsed() >= std::time::Duration::from_millis(1500));
    assert_eq!(harness.agent.answers("fs/read_text_file")[0]["result"]["content"], "saved\n");
    drop(held);
}

#[test]
fn the_agent_asks_before_touching_files_outside_the_project() {
    let project = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let inside_file = project.path().join("notes.txt");
    let outside_file = outside.path().join("secret.txt");
    std::fs::write(&outside_file, "secret").unwrap();
    std::fs::write(outside.path().join("other.txt"), "other").unwrap();
    let mut harness = connect_in(
        json!({
            "initialize": initialize(false),
            "session/new": { "result": { "sessionId": "s1" } },
            "session/prompt": { "steps": [
                { "request": "fs/write_text_file", "params": { "sessionId": "s1", "path": inside_file, "content": "hello\nworld\n" } },
                { "request": "fs/read_text_file", "params": { "sessionId": "s1", "path": "notes.txt", "line": 2 } },
                { "request": "fs/write_text_file", "params": { "sessionId": "s1", "path": outside.path().join("new.txt"), "content": "no" } },
                { "request": "fs/write_text_file", "params": { "sessionId": "s1", "path": outside.path().join("yes.txt"), "content": "yes" } },
                { "request": "fs/read_text_file", "params": { "sessionId": "s1", "path": outside_file } },
                { "request": "fs/read_text_file", "params": { "sessionId": "s1", "path": outside.path().join("other.txt") } },
            ], "result": { "stopReason": "end_turn" } }
        }),
        project,
    );
    let connection = harness.connection.clone();
    let spawner = harness.pool.spawner();
    let session = harness.open(None, false).unwrap().session_id;
    let (done_tx, done_rx) = futures::channel::oneshot::channel();
    spawner
        .spawn_local(async move {
            let _ = done_tx.send(connection.prompt(&session, Vec::new()).await);
        })
        .unwrap();

    let mut transcript = Transcript::default();
    let mut written = Vec::new();
    let mut prompts = Vec::new();
    loop {
        let events = harness.drain_into(&mut transcript);
        let mut asked = false;
        for event in events {
            match event {
                ClientEvent::FileWritten { path, .. } => written.push(path),
                ClientEvent::Permission(request) => {
                    let title = request.tool_call.fields.title.clone().unwrap();
                    let has_diff = request.tool_call.fields.content.as_ref().is_some_and(|content| content.iter().any(|item| matches!(item, acp::ToolCallContent::Diff(_))));
                    let kinds: Vec<_> = request.options.iter().map(|option| option.kind).collect();
                    // The first write is denied, the second allowed once; the read allows its folder.
                    let pick = if title.ends_with("new.txt") {
                        acp::PermissionOptionKind::RejectOnce
                    } else if title.starts_with("Write") {
                        acp::PermissionOptionKind::AllowOnce
                    } else {
                        acp::PermissionOptionKind::AllowAlways
                    };
                    prompts.push((title, has_diff, kinds));
                    let option = request.options.iter().find(|option| option.kind == pick).unwrap();
                    request.respond.send(Some(option.option_id.clone())).unwrap();
                    asked = true;
                }
                _ => {}
            }
        }
        if !asked {
            break;
        }
    }
    harness.pool.run_until(done_rx).unwrap().unwrap();
    assert_eq!(std::fs::read_to_string(&inside_file).unwrap(), "hello\nworld\n");
    assert_eq!(written, vec![inside_file.clone(), outside.path().join("yes.txt")]);
    let writes = harness.agent.answers("fs/write_text_file");
    assert!(writes[0].get("result").is_some());
    assert!(writes[1].get("error").is_some());
    assert!(writes[2].get("result").is_some());
    assert!(!outside.path().join("new.txt").exists());
    assert_eq!(std::fs::read_to_string(outside.path().join("yes.txt")).unwrap(), "yes");
    let reads = harness.agent.answers("fs/read_text_file");
    assert_eq!(reads[0]["result"]["content"], "world\n");
    assert_eq!(reads[1]["result"]["content"], "secret");
    assert_eq!(reads[2]["result"]["content"], "other");
    // Writes offer no folder-wide choice and show their diff; the second read in the folder did
    // not ask again.
    assert_eq!(prompts.len(), 3);
    assert!(prompts[0].1 && prompts[1].1 && !prompts[2].1);
    assert_eq!(prompts[0].2, vec![acp::PermissionOptionKind::AllowOnce, acp::PermissionOptionKind::RejectOnce]);
    assert_eq!(prompts[2].2.len(), 3);
    assert!(prompts[2].0.starts_with("Read "));
}

#[test]
fn a_crashed_agent_fails_the_turn() {
    let mut harness = connect(json!({
        "initialize": initialize(false),
        "session/new": { "result": { "sessionId": "s1" } },
        "session/prompt": { "steps": [ { "hangup": true } ], "result": { "stopReason": "end_turn" } }
    }));
    let session = harness.open(None, false).unwrap().session_id;
    let connection = harness.connection.clone();
    let result = harness.pool.run_until(async move { connection.prompt(&session, Vec::new()).await });
    assert_eq!(result.unwrap_err().code, RpcError::DISCONNECTED);
    harness.pool.run_until_stalled();
    assert!(harness.connection.is_closed());
    // The event stream ends, so the view knows the agent is gone.
    assert!(matches!(futures::FutureExt::now_or_never(harness.events.next()), Some(None)));
}

#[test]
fn other_workspace_roots_go_along_as_additional_directories() {
    let roots = vec!["/p/".into(), "/q/".into(), "/q".into(), "relative".into(), "ssh://host/r".into(), "/r".into()];
    assert_eq!(super::client::additional_directories(Path::new("/p"), &roots), vec![std::path::PathBuf::from("/q"), "/r".into()]);
}

#[test]
fn athas_requests_open_a_terminal_and_name_the_chat() {
    let mut harness = connect(json!({
        "initialize": initialize(false),
        "session/new": { "result": { "sessionId": "s1" } },
        "session/prompt": { "steps": [
            { "request": "_athas/open_terminal", "params": { "sessionId": "s1", "command": "bun dev" } },
            { "request": "_athas/set_chat_title", "params": { "sessionId": "s1", "title": "  Fix login  " } },
            { "request": "_athas/set_chat_title", "params": { "sessionId": "s1", "title": " " } },
        ], "result": { "stopReason": "end_turn" } }
    }));
    let session = harness.open(None, false).unwrap().session_id;
    let connection = harness.connection.clone();
    harness.pool.spawner().spawn_local(async move { let _ = connection.prompt(&session, Vec::new()).await; }).unwrap();
    let events = harness.drain_into(&mut Transcript::default());
    assert!(matches!(&events[0], ClientEvent::OpenTerminal(Some(command)) if command == "bun dev"));
    assert!(matches!(&events[1], ClientEvent::SetTitle(title) if title == "Fix login"));
    assert_eq!(events.len(), 2);
    let answers = harness.agent.answers("_athas/set_chat_title");
    assert_eq!(answers[0]["result"]["success"], true);
    assert_eq!(answers[1]["error"]["code"], -32602);
}

#[test]
fn a_shared_connection_initializes_once_and_routes_each_sessions_updates() {
    let text = |session: &str, text: &str| {
        json!({ "notify": "session/update", "params": { "sessionId": session, "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": text } } } })
    };
    let mut harness = connect(json!({
        "initialize": initialize(false),
        "session/new": [
            { "steps": [text("s1", "early for one")], "result": { "sessionId": "s1" } },
            { "steps": [text("s2", "early for two"), text("s1", "later for one")], "result": { "sessionId": "s2" } },
        ]
    }));
    harness.connection.share();
    harness.open(None, false).unwrap();
    let (mut first, _first_route) = harness.connection.route_session("s1");
    harness.open(None, false).unwrap();
    let (mut second, second_route) = harness.connection.route_session("s2");
    harness.pool.run_until_stalled();
    assert_eq!(harness.agent.methods(), ["initialize", "session/new", "session/new"]);
    let texts = |events: &mut mpsc::UnboundedReceiver<ClientEvent>| {
        let mut transcript = Transcript::default();
        while let Ok(ClientEvent::Update(update)) = events.try_recv() {
            transcript.apply(update);
        }
        transcript.entries.iter().filter_map(|entry| if let Entry::Agent(message) = entry { Some(message.text.clone()) } else { None }).collect::<Vec<_>>()
    };
    assert_eq!(texts(&mut first), ["early for onelater for one"]);
    assert_eq!(texts(&mut second), ["early for two"]);
    assert!(harness.events.try_recv().is_err(), "nothing goes to the connection's own channel once shared");
    drop(second_route);
}
