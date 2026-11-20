//! The built-in agent end to end: the real ACP client and host on one side, the agent in the
//! middle, and a local server answering as the model provider.

use std::{cell::RefCell, collections::VecDeque, rc::Rc, sync::Arc, time::Duration};

use ai_providers::{
    MemorySecrets, ProviderSettings,
    test_support::{MockResponse, MockServer},
};
use futures::{
    FutureExt as _, StreamExt as _,
    channel::oneshot,
    executor::LocalPool,
    task::LocalSpawnExt as _,
};
use serde_json::{Value, json};

use super::{BuiltinConfig, Sleep, prompt::Mode, serve};
use crate::{
    acp::{
        client::{AgentConnection, ClientEvent},
        host::{ClientHost, LocalHost},
        open_session,
        rpc::Transport,
        schema as acp,
    },
    thread::{Entry, PlanStatus, ToolContent, ToolStatus, Transcript},
};

fn thread_sleep() -> Sleep {
    Arc::new(|duration: Duration| {
        let (tx, rx) = oneshot::channel::<()>();
        std::thread::spawn(move || {
            std::thread::sleep(duration);
            let _ = tx.send(());
        });
        async move {
            let _ = rx.await;
        }
        .boxed()
    })
}

struct Run {
    transcript: Transcript,
    stop: acp::StopReason,
    /// The permission questions the agent asked, by tool call title.
    asked: Vec<String>,
}

/// Runs one prompt against `server`, answering permission questions with `answers` in order.
fn run(project: &std::path::Path, server: &MockServer, prompt: &str, answers: &[&str]) -> Run {
    run_with(project, server, prompt, answers, None)
}

fn run_with(project: &std::path::Path, server: &MockServer, prompt: &str, answers: &[&str], unsaved: Option<super::UnsavedCheck>) -> Run {
    let mut pool = LocalPool::new();
    let spawner = pool.spawner();
    let (client_end, agent_end) = Transport::pair();
    let config = BuiltinConfig {
        cwd: project.to_path_buf(),
        root: Some(project.to_path_buf()),
        provider: ProviderSettings {
            provider_id: "custom".into(),
            model_id: "test-model".into(),
            custom_base_url: format!("{}/v1", server.url),
            ..Default::default()
        },
        mode: Mode::Agent,
        max_steps: 10,
        user_rules: String::new(),
        mcp_servers: Vec::new(),
        history: Vec::new(),
        secrets: Arc::new(MemorySecrets::default()),
        sleep: thread_sleep(),
        on_write: None,
        unsaved,
    };
    spawner.spawn_local(serve(agent_end, config)).unwrap();
    let host: Arc<dyn ClientHost> = Arc::new(LocalHost::new(project.to_path_buf(), vec![project.to_path_buf()]));
    let (connection, mut events, io) = AgentConnection::new(client_end, Some(host));
    spawner.spawn_local(io).unwrap();

    let transcript = Rc::new(RefCell::new(Transcript::default()));
    let asked = Rc::new(RefCell::new(Vec::new()));
    let mut answers: VecDeque<String> = answers.iter().map(|answer| answer.to_string()).collect();
    {
        let (transcript, asked) = (transcript.clone(), asked.clone());
        spawner
            .spawn_local(async move {
                while let Some(event) = events.next().await {
                    match event {
                        ClientEvent::Update(update) => {
                            transcript.borrow_mut().apply(update);
                        }
                        ClientEvent::Permission(request) => {
                            asked.borrow_mut().push(request.tool_call.fields.title.clone().unwrap_or_default());
                            let answer = answers.pop_front().map(|id| acp::PermissionOptionId::new(id));
                            let _ = request.respond.send(answer);
                        }
                        _ => {}
                    }
                }
            })
            .unwrap();
    }
    let prompt = prompt.to_string();
    let cwd = project.to_path_buf();
    let response = pool.run_until(async move {
        let opened = open_session(&connection, &cwd, None, false, &[]).await.unwrap();
        assert!(opened.modes.is_some());
        assert_eq!(opened.config_options.as_ref().unwrap()[0].id.0.as_ref(), "model");
        connection.prompt(&opened.session_id, vec![acp::ContentBlock::Text(acp::TextContent::new(prompt))]).await.unwrap()
    });
    pool.run_until_stalled();
    let transcript = transcript.borrow().clone();
    let asked = asked.borrow().clone();
    Run { transcript, stop: response.stop_reason, asked }
}

fn tool_calls(transcript: &Transcript) -> Vec<&crate::thread::ToolCall> {
    transcript
        .entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::ToolCall(call) => Some(call),
            _ => None,
        })
        .collect()
}

#[test]
fn reads_edits_and_plans_then_answers() {
    let project = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(project.path().join("src")).unwrap();
    std::fs::write(project.path().join("src/lib.rs"), "fn a() {}\n").unwrap();
    let server = MockServer::start();
    server.push(MockResponse::openai_tool_call("c1", "read_file", json!({ "path": "src/lib.rs" })));
    server.push(MockResponse::openai_tool_call(
        "c2",
        "edit_file",
        json!({ "path": "src/lib.rs", "edits": [{ "oldText": "fn a() {}", "newText": "fn a() -> u8 { 1 }" }] }),
    ));
    server.push(MockResponse::openai_tool_call(
        "c3",
        "todo_write",
        json!({ "todos": [{ "content": "Change a", "status": "completed" }, { "content": "Test", "status": "in_progress" }] }),
    ));
    server.push(MockResponse::openai_text("Done."));

    let run = run(project.path(), &server, "Make a return 1", &[]);
    assert_eq!(run.stop, acp::StopReason::EndTurn);
    assert!(run.asked.is_empty(), "reads and edits need no approval");
    assert_eq!(std::fs::read_to_string(project.path().join("src/lib.rs")).unwrap(), "fn a() -> u8 { 1 }\n");

    let calls = tool_calls(&run.transcript);
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].title, "Read src/lib.rs");
    assert_eq!(calls[0].locations[0].path, project.path().join("src/lib.rs"));
    assert!(calls.iter().all(|call| call.status == ToolStatus::Completed));
    let (path, old, new) = calls[1].diffs().next().unwrap();
    assert!(path.ends_with("src/lib.rs"));
    assert_eq!((old, new), (Some("fn a() {}\n"), "fn a() -> u8 { 1 }\n"));
    assert_eq!(run.transcript.plan.len(), 2);
    assert_eq!(run.transcript.plan[1].status, PlanStatus::InProgress);
    assert!(matches!(run.transcript.entries.last(), Some(Entry::Agent(message)) if message.text == "Done."));
    assert!(run.transcript.usage.is_some());

    let requests = server.requests();
    assert_eq!(requests.len(), 4);
    assert_eq!(requests[0].path, "/v1/chat/completions");
    let system = requests[0].body["messages"][0]["content"].as_str().unwrap();
    assert!(system.contains("AGENT MODE"));
    let tools: Vec<&str> = requests[0].body["tools"].as_array().unwrap().iter().filter_map(|tool| tool["function"]["name"].as_str()).collect();
    assert!(tools.contains(&"edit_file") && tools.contains(&"run_command"));
    let read_result = requests[1].body["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(read_result.contains("\"totalLines\":2"), "{read_result}");
}

#[cfg(unix)]
#[test]
fn commands_wait_for_approval_and_run_in_a_terminal() {
    let project = tempfile::tempdir().unwrap();
    let server = MockServer::start();
    server.push(MockResponse::openai_tool_call("c1", "run_command", json!({ "command": "printf hello; touch made.txt" })));
    server.push(MockResponse::openai_text("Ran it."));

    let run = run(project.path(), &server, "Run it", &["allow"]);
    assert_eq!(run.asked, vec!["printf hello; touch made.txt".to_string()]);
    assert!(project.path().join("made.txt").exists());
    let call = tool_calls(&run.transcript)[0];
    assert_eq!(call.status, ToolStatus::Completed);
    assert_eq!(call.terminal_output.as_deref(), Some("hello"));
    assert_eq!(call.exit_code, Some(0));
    assert!(!call.content.iter().any(|content| matches!(content, ToolContent::Terminal { .. })));
    let result: Value = serde_json::from_str(
        server.requests()[1].body["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap(),
    )
    .unwrap();
    assert_eq!(result["exitCode"], 0);
    assert_eq!(result["output"], "hello");
}

#[test]
fn files_with_unsaved_editor_changes_are_not_written() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("dirty.txt"), "on disk\n").unwrap();
    let server = MockServer::start();
    server.push(MockResponse::openai_tool_call("c1", "read_file", json!({ "path": "dirty.txt" })));
    server.push(MockResponse::openai_tool_call("c2", "edit_file", json!({ "path": "dirty.txt", "edits": [{ "oldText": "on disk", "newText": "agent" }] })));
    server.push(MockResponse::openai_tool_call("c3", "write_file", json!({ "path": "clean.txt", "content": "new\n" })));
    server.push(MockResponse::openai_text("Asked."));
    let dirty = project.path().join("dirty.txt");
    let unsaved: super::UnsavedCheck = Arc::new(move |path| {
        let is_dirty = path == dirty;
        async move { is_dirty }.boxed()
    });

    let run = run_with(project.path(), &server, "Change it", &[], Some(unsaved));
    assert_eq!(std::fs::read_to_string(project.path().join("dirty.txt")).unwrap(), "on disk\n");
    assert_eq!(std::fs::read_to_string(project.path().join("clean.txt")).unwrap(), "new\n");
    let calls = tool_calls(&run.transcript);
    assert_eq!(calls[1].status, ToolStatus::Failed);
    let refused = server.requests()[2].body["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(refused.contains("unsaved changes"), "{refused}");
}

#[test]
fn a_declined_deletion_keeps_the_file() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("keep.txt"), "important").unwrap();
    let server = MockServer::start();
    server.push(MockResponse::openai_tool_call("c1", "read_file", json!({ "path": "keep.txt" })));
    server.push(MockResponse::openai_tool_call("c2", "delete_file", json!({ "path": "keep.txt" })));
    server.push(MockResponse::openai_text("Kept it."));

    let run = run(project.path(), &server, "Delete keep.txt", &["deny"]);
    assert_eq!(run.asked, vec!["Delete keep.txt".to_string()]);
    assert!(project.path().join("keep.txt").exists());
    let declined = server.requests()[2].body["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(declined.contains("declined"), "{declined}");
}

#[test]
fn provider_failures_end_the_turn_with_their_message() {
    let project = tempfile::tempdir().unwrap();
    let server = MockServer::start();
    server.push(MockResponse::json(400, json!({ "error": { "message": "Unknown model test-model" } })));
    let mut pool = LocalPool::new();
    let spawner = pool.spawner();
    let (client_end, agent_end) = Transport::pair();
    let config = BuiltinConfig {
        cwd: project.path().to_path_buf(),
        root: None,
        provider: ProviderSettings {
            provider_id: "custom".into(),
            model_id: "test-model".into(),
            custom_base_url: server.url.clone(),
            ..Default::default()
        },
        mode: Mode::Ask,
        max_steps: 3,
        user_rules: String::new(),
        mcp_servers: Vec::new(),
        history: vec![ai_providers::Message::user("Earlier question"), ai_providers::Message::assistant("Earlier answer")],
        secrets: Arc::new(MemorySecrets::default()),
        sleep: thread_sleep(),
        on_write: None,
        unsaved: None,
    };
    spawner.spawn_local(serve(agent_end, config)).unwrap();
    let (connection, _events, io) = AgentConnection::new(client_end, None);
    spawner.spawn_local(io).unwrap();
    let cwd = project.path().to_path_buf();
    let error = pool.run_until(async move {
        let opened = open_session(&connection, &cwd, None, false, &[]).await.unwrap();
        connection.prompt(&opened.session_id, vec![acp::ContentBlock::Text(acp::TextContent::new("Hi"))]).await.unwrap_err()
    });
    assert_eq!(error.message, "Unknown model test-model");
    let sent = &server.requests()[0].body;
    assert_eq!(sent["messages"][1]["content"], "Earlier question", "the saved conversation goes along");
    let tools: Vec<&str> = sent["tools"].as_array().unwrap().iter().filter_map(|tool| tool["function"]["name"].as_str()).collect();
    assert_eq!(tools, ["todo_write"], "a chat of no project has no workspace tools");
}

#[test]
fn history_replays_images_and_a_short_account_of_tool_activity() {
    use crate::thread::{AgentMessage, Entry, MessageImage, ToolCall, ToolContent, ToolKind, ToolStatus, UserMessage};
    let entries = vec![
        Entry::User(UserMessage { text: "Fix the build".into(), images: vec![MessageImage { media_type: "image/png".into(), data: "AAAA".into() }], ..Default::default() }),
        Entry::Agent(AgentMessage { message_id: None, text: "Running the tests.".into(), ..Default::default() }),
        Entry::ToolCall(ToolCall {
            id: "t1".into(),
            title: "cargo test".into(),
            kind: ToolKind::Execute,
            status: ToolStatus::Failed,
            raw_input: Some(json!({ "command": "cargo test", "timeout": 600 })),
            content: vec![ToolContent::Text { text: "x".repeat(2_000) }],
            ..Default::default()
        }),
        Entry::User(UserMessage { text: "Thanks".into(), ..Default::default() }),
    ];
    let history = super::history_from_entries(&entries);
    assert_eq!(history.len(), 3);
    assert!(matches!(&history[0].content[1], ai_providers::Part::Image { media_type, .. } if media_type == "image/png"));
    let answer = history[1].text();
    assert!(answer.starts_with("Running the tests.\n\nPrevious tool activity (historical data; re-read files before editing):"));
    assert!(answer.contains("\"status\":\"failed\"") && answer.contains("\"timeout\":\"600\"") && answer.contains("characters omitted"));
}
