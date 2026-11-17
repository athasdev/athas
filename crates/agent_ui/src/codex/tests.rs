//! Codex end to end: the real ACP client on one side, the bridge in the middle, and a scripted
//! app-server in-process on the other. No `codex` program runs.

use std::{cell::RefCell, rc::Rc, sync::{Arc, Mutex}};

use futures::{StreamExt as _, channel::mpsc, executor::LocalPool, task::LocalSpawnExt as _};
use serde_json::{Value, json};

use super::*;
use crate::{
    acp::{
        client::{AgentConnection, ClientEvent},
        open_session,
        rpc::Transport,
        schema as acp,
    },
    thread::{Entry, ToolStatus, Transcript},
};

/// What the scripted app-server received, in order, with their params.
type Received = Arc<Mutex<Vec<(String, Value)>>>;

async fn next_message(incoming: &mut mpsc::UnboundedReceiver<String>, received: &Received) -> Option<Value> {
    let line = incoming.next().await?;
    assert!(!line.contains("\"jsonrpc\""), "the app-server takes JSON-RPC without the jsonrpc member: {line}");
    let message: Value = serde_json::from_str(&line).unwrap();
    if let Some(method) = message.get("method").and_then(Value::as_str) {
        received.lock().unwrap().push((method.to_string(), message.get("params").cloned().unwrap_or(Value::Null)));
    }
    Some(message)
}

/// Answers requests until `turn/start`, then plays a turn: a message, an approved command, a
/// file change and the chat title, then completes.
async fn fake_app_server(transport: Transport, received: Received, signed_in: bool) {
    let Transport { outgoing, mut incoming } = transport;
    let send = |message: Value| {
        let _ = outgoing.unbounded_send(message.to_string());
    };
    let notify = |method: &str, params: Value| send(json!({ "method": method, "params": params }));
    while let Some(message) = next_message(&mut incoming, &received).await {
        let Some(id) = message.get("id").cloned() else { continue };
        let method = message["method"].as_str().unwrap_or_default().to_string();
        let result = match method.as_str() {
            "initialize" => json!({ "userAgent": "codex" }),
            "account/read" if signed_in => json!({ "account": { "type": "chatgpt", "email": "a@b.c" }, "requiresOpenaiAuth": true }),
            "account/read" => json!({ "account": null, "requiresOpenaiAuth": true }),
            "model/list" => json!({ "data": [
                { "model": "gpt-a", "displayName": "GPT A", "isDefault": true, "defaultReasoningEffort": "medium",
                  "supportedReasoningEfforts": [{ "reasoningEffort": "low" }, { "reasoningEffort": "medium" }] },
                { "model": "gpt-b", "displayName": "GPT B", "defaultReasoningEffort": "high",
                  "supportedReasoningEfforts": [{ "reasoningEffort": "high" }] },
                { "model": "hidden", "hidden": true }
            ] }),
            "thread/start" => json!({ "thread": { "id": "th-1" } }),
            "thread/resume" => json!({ "thread": { "id": message["params"]["threadId"] } }),
            "turn/start" => {
                send(json!({ "id": id, "result": { "turn": { "id": "tu-1" } } }));
                play_turn(&send, &notify, &mut incoming, &received).await;
                continue;
            }
            _ => {
                send(json!({ "id": id, "error": { "code": -32601, "message": "unknown" } }));
                continue;
            }
        };
        send(json!({ "id": id, "result": result }));
    }
}

async fn play_turn(send: &impl Fn(Value), notify: &impl Fn(&str, Value), incoming: &mut mpsc::UnboundedReceiver<String>, received: &Received) {
    let thread = json!("th-1");
    notify("turn/started", json!({ "threadId": thread, "turn": { "id": "tu-1" } }));
    notify("item/agentMessage/delta", json!({ "threadId": thread, "turnId": "tu-1", "itemId": "m1", "delta": "Looking" }));
    notify("item/agentMessage/delta", json!({ "threadId": thread, "turnId": "tu-1", "itemId": "m1", "delta": " now." }));
    notify("item/agentMessage/delta", json!({ "threadId": "other", "turnId": "tu-9", "itemId": "x", "delta": "not ours" }));
    let command = json!({ "type": "commandExecution", "id": "c1", "command": "cargo test" });
    notify("item/started", json!({ "threadId": thread, "turnId": "tu-1", "item": command }));
    send(json!({ "id": 100, "method": "item/commandExecution/requestApproval", "params": { "threadId": thread, "turnId": "tu-1", "itemId": "c1", "command": "cargo test" } }));
    let decision = next_message(incoming, received).await.unwrap();
    assert_eq!(decision["id"], 100);
    let approved = decision["result"]["decision"] == "accept";
    notify("item/commandExecution/outputDelta", json!({ "threadId": thread, "turnId": "tu-1", "itemId": "c1", "delta": "running 3 tests\n" }));
    notify(
        "item/completed",
        json!({ "threadId": thread, "turnId": "tu-1", "item": { "type": "commandExecution", "id": "c1", "command": "cargo test", "status": if approved { "completed" } else { "declined" }, "aggregatedOutput": "test result: ok" } }),
    );
    let change = json!({ "type": "fileChange", "id": "f1", "changes": [
        { "path": "src/lib.rs", "kind": { "type": "update" }, "diff": "--- a\n+++ b\n@@ -1,2 +1,2 @@\n fn a() {}\n-fn b() {}\n+fn b() -> u8 { 1 }" },
        { "path": "/abs/new.txt", "kind": "add", "diff": "hello" }
    ] });
    notify("item/started", json!({ "threadId": thread, "turnId": "tu-1", "item": change }));
    notify("item/completed", json!({ "threadId": thread, "turnId": "tu-1", "item": change }));
    send(json!({ "id": 101, "method": "item/tool/call", "params": { "threadId": thread, "turnId": "tu-1", "tool": "athas_set_chat_title", "arguments": { "title": "  Fix   tests " } } }));
    let titled = next_message(incoming, received).await.unwrap();
    assert_eq!(titled["result"]["success"], true);
    send(json!({ "id": 102, "method": "item/tool/call", "params": { "threadId": thread, "turnId": "tu-1", "tool": "athas_open_pull_request", "arguments": { "number": 42, "title": "Fix" } } }));
    let opened = next_message(incoming, received).await.unwrap();
    assert_eq!(opened["result"]["contentItems"][0]["text"], "Pull request #42 opened in Athas.");
    notify("thread/tokenUsage/updated", json!({ "threadId": thread, "turnId": "tu-1", "tokenUsage": { "total": { "totalTokens": 1200 }, "modelContextWindow": 200000 } }));
    notify("turn/completed", json!({ "threadId": thread, "turn": { "id": "tu-1", "status": "completed" } }));
}

struct Run {
    transcript: Transcript,
    stop: Result<acp::StopReason, String>,
    received: Vec<(String, Value)>,
    asked: Vec<String>,
    host_calls: Vec<(String, Value)>,
    saved: Vec<CodexSettings>,
}

fn run(answer: Option<&str>, signed_in: bool, change_model: Option<&str>) -> Run {
    let mut pool = LocalPool::new();
    let spawner = pool.spawner();
    let (client_end, agent_end) = Transport::pair();
    let (bridge_codex, server_codex) = Transport::pair();
    let received = Received::default();
    spawner.spawn_local(fake_app_server(server_codex, received.clone(), signed_in)).unwrap();
    let (host_tx, mut host_rx) = mpsc::unbounded::<HostCall>();
    let host_calls = Rc::new(RefCell::new(Vec::new()));
    {
        let host_calls = host_calls.clone();
        spawner
            .spawn_local(async move {
                while let Some(call) = host_rx.next().await {
                    host_calls.borrow_mut().push((call.tool.clone(), call.arguments.clone()));
                    let (number, _) = resource_number(&call.arguments, "pull request").unwrap();
                    let _ = call.respond.send(tool_result(format!("Pull request #{number} opened in Athas."), true));
                }
            })
            .unwrap();
    }
    let saved = Arc::new(Mutex::new(Vec::new()));
    let saved_sink = saved.clone();
    let config = CodexConfig {
        cwd: "/work".into(),
        settings: CodexSettings::default(),
        browser_tool: None,
        host: Some(host_tx),
        save_settings: Some(Arc::new(move |settings: &CodexSettings| saved_sink.lock().unwrap().push(settings.clone()))),
    };
    spawner.spawn_local(serve(agent_end, bridge_codex, config)).unwrap();
    let (connection, mut events, io) = AgentConnection::new(client_end, None);
    spawner.spawn_local(io).unwrap();
    let transcript = Rc::new(RefCell::new(Transcript::default()));
    let asked = Rc::new(RefCell::new(Vec::new()));
    {
        let (transcript, asked) = (transcript.clone(), asked.clone());
        let answer = answer.map(str::to_string);
        spawner
            .spawn_local(async move {
                while let Some(event) = events.next().await {
                    match event {
                        ClientEvent::Update(update) => {
                            transcript.borrow_mut().apply(update);
                        }
                        ClientEvent::Permission(request) => {
                            asked.borrow_mut().push(request.tool_call.fields.title.clone().unwrap_or_default());
                            let _ = request.respond.send(answer.clone().map(acp::PermissionOptionId::new));
                        }
                        _ => {}
                    }
                }
            })
            .unwrap();
    }
    let change_model = change_model.map(str::to_string);
    let stop = pool.run_until(async move {
        let opened = open_session(&connection, std::path::Path::new("/work"), None, false, &[]).await.map_err(|error| error.to_string())?;
        assert_eq!(opened.session_id, "th-1");
        let options = opened.config_options.unwrap();
        assert_eq!(options.iter().map(|option| option.id.0.to_string()).collect::<Vec<_>>(), ["model", "effort"]);
        if let Some(model) = change_model {
            connection.set_config_option(&opened.session_id, "model", &model).await.map_err(|error| error.to_string())?;
        }
        let prompt = vec![
            acp::ContentBlock::Text(acp::TextContent::new("Fix the tests")),
            acp::ContentBlock::Image(acp::ImageContent::new("aGk=", "image/png")),
        ];
        connection.prompt(&opened.session_id, prompt).await.map(|response| response.stop_reason).map_err(|error| error.to_string())
    });
    pool.run_until_stalled();
    let transcript = transcript.borrow().clone();
    let asked = asked.borrow().clone();
    let host_calls = host_calls.borrow().clone();
    let received = received.lock().unwrap().clone();
    let saved = saved.lock().unwrap().clone();
    Run { transcript, stop, received, asked, host_calls, saved }
}

fn params<'a>(run: &'a Run, method: &str) -> &'a Value {
    &run.received.iter().find(|(name, _)| name == method).unwrap_or_else(|| panic!("{method} was not sent")).1
}

#[test]
fn a_turn_streams_into_the_transcript() {
    let run = run(Some("accept"), true, None);
    assert_eq!(run.stop, Ok(acp::StopReason::EndTurn));
    let methods: Vec<&str> = run.received.iter().map(|(method, _)| method.as_str()).collect();
    assert_eq!(&methods[..6], ["initialize", "initialized", "account/read", "model/list", "thread/start", "turn/start"]);

    let start = params(&run, "thread/start");
    assert_eq!(start["cwd"], "/work");
    assert_eq!(start["sandbox"], "workspace-write");
    assert_eq!(start["approvalPolicy"], "on-request");
    let tools: Vec<&str> = start["dynamicTools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap()).collect();
    assert_eq!(tools, [OPEN_PULL_REQUEST_TOOL, OPEN_ISSUE_TOOL, SET_CHAT_TITLE_TOOL]);
    assert!(start["developerInstructions"].as_str().unwrap().contains("athas_set_chat_title"));

    let turn = params(&run, "turn/start");
    assert_eq!(turn["threadId"], "th-1");
    assert_eq!(turn["input"][0], json!({ "type": "text", "text": "Fix the tests", "text_elements": [] }));
    assert_eq!(turn["input"][1], json!({ "type": "image", "url": "data:image/png;base64,aGk=" }));
    assert_eq!(turn["effort"], "medium");
    assert_eq!(turn["collaborationMode"]["mode"], "default");

    assert_eq!(run.asked, ["cargo test"]);
    assert!(matches!(&run.transcript.entries[0], Entry::Agent(message) if message.text == "Looking now."));
    let calls: Vec<_> = run.transcript.entries.iter().filter_map(|entry| match entry { Entry::ToolCall(call) => Some(call), _ => None }).collect();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].title, "cargo test");
    assert_eq!(calls[0].status, ToolStatus::Completed);
    assert_eq!(calls[1].title, "Edit lib.rs, new.txt");
    let diffs: Vec<_> = calls[1].diffs().map(|(path, old, new)| (path.clone(), old.map(str::to_string), new.to_string())).collect();
    assert_eq!(diffs[0], ("/work/src/lib.rs".into(), Some("fn a() {}\nfn b() {}".into()), "fn a() {}\nfn b() -> u8 { 1 }".into()));
    assert_eq!(diffs[1], ("/abs/new.txt".into(), None, "hello".into()));
    assert_eq!(run.transcript.agent_title.as_deref(), Some("Fix tests"));
    assert_eq!(run.host_calls, [(OPEN_PULL_REQUEST_TOOL.to_string(), json!({ "number": 42, "title": "Fix" }))]);
    assert_eq!(run.transcript.usage.as_ref().map(|usage| (usage.used, usage.size)), Some((1200, 200000)));
}

#[test]
fn a_denied_command_is_declined_and_shown_failed() {
    let run = run(Some("decline"), true, None);
    assert_eq!(run.stop, Ok(acp::StopReason::EndTurn));
    let call = run.transcript.entries.iter().find_map(|entry| match entry { Entry::ToolCall(call) if call.id == "c1" => Some(call), _ => None }).unwrap();
    assert_eq!(call.status, ToolStatus::Failed);
}

#[test]
fn switching_models_keeps_a_supported_effort_and_saves() {
    let run = run(Some("accept"), true, Some("gpt-b"));
    let turn = params(&run, "turn/start");
    assert_eq!(turn["model"], "gpt-b");
    assert_eq!(turn["effort"], "high");
    assert_eq!(run.saved.last().map(|settings| settings.model.clone()), Some(Some("gpt-b".to_string())));
}

#[test]
fn signed_out_codex_asks_for_a_sign_in() {
    let run = run(None, false, None);
    assert!(run.stop.unwrap_err().contains("sign in"));
    assert!(!run.received.iter().any(|(method, _)| method == "thread/start"));
}

#[test]
fn file_changes_become_old_and_new_text() {
    let item = json!({ "type": "fileChange", "changes": [
        { "path": "a.rs", "kind": "delete", "diff": "gone" },
        { "path": "b.rs", "kind": { "type": "update" }, "diff": "@@ -1 +1 @@\n-x\n+y\n\\ No newline at end of file" }
    ] });
    assert_eq!(file_change_diffs(&item), [("a.rs".into(), "gone".into(), String::new()), ("b.rs".into(), "x".into(), "y".into())]);
}

#[test]
fn thread_and_turn_settings_carry_only_what_is_set() {
    let settings = CodexSettings { model: Some("gpt-test".into()), sandbox: Some("read-only".into()), effort: Some("high".into()), collaboration_mode: Some("plan".into()), ..CodexSettings::default() };
    let mut thread = serde_json::Map::new();
    apply_thread_settings(&mut thread, &settings);
    assert_eq!(thread.get("model"), Some(&json!("gpt-test")));
    assert!(!thread.contains_key("personality"));
    let mut turn = serde_json::Map::new();
    apply_turn_settings(&mut turn, &settings);
    assert_eq!(turn["collaborationMode"]["settings"]["reasoning_effort"], json!("high"));
    assert_eq!(chat_title(&json!({ "title": "   " })), Err("A chat title is required."));
    assert!(resource_number(&json!({ "number": 0 }), "issue").is_err());
    let models = normalize_models(&json!({ "models": [{ "id": "m", "supportedReasoningEfforts": [{ "reasoningEffort": "low" }], "defaultReasoningEffort": "low" }] }));
    assert_eq!(effort_for_model(&models[0], Some("high")), Some("low".into()));
    let models = normalize_models(&json!({ "data": [{ "model": "m", "description": "Fast", "supportedReasoningEfforts": [{ "reasoningEffort": "low", "description": "Quick answers" }, { "reasoningEffort": "high" }] }] }));
    assert_eq!(models[0].description, "Fast");
    assert_eq!(models[0].effort_descriptions, [("low".to_string(), "Quick answers".to_string()), ("high".to_string(), "high".to_string())]);
}

#[test]
fn threads_list_and_replay_as_sessions() {
    let threads = json!({ "data": [
        { "id": "t1", "name": "", "preview": "Fix the build\nmore", "updatedAt": 1_767_225_600 },
        { "id": "t2", "name": "Named", "preview": "", "cwd": "/other" },
        { "id": "" },
    ] });
    let sessions = threads_as_sessions(&threads, "/p");
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0], json!({ "sessionId": "t1", "cwd": "/p", "title": "Fix the build", "updatedAt": "2026-01-01T00:00:00Z" }));
    assert_eq!(sessions[1]["title"], "Named");
    assert_eq!(sessions[1]["cwd"], "/other");

    let thread = json!({ "thread": { "turns": [{ "items": [
        { "type": "userMessage", "content": [{ "type": "text", "text": "Hi" }, { "type": "image", "url": "x" }] },
        { "type": "reasoning", "text": "hmm" },
        { "type": "agentMessage", "text": "One" },
        { "type": "agentMessage", "text": "Two" },
    ] }] } });
    let updates = thread_history_updates(&thread);
    assert_eq!(updates.len(), 2);
    assert_eq!(updates[0]["sessionUpdate"], "user_message_chunk");
    assert_eq!(updates[1]["content"]["text"], "One\n\nTwo");
}

#[test]
fn codex_skills_read_once_each_with_their_errors() {
    let (skills, errors) = super::normalize_skills(&json!({
        "data": [{
            "cwd": "/p",
            "skills": [
                { "name": "review", "shortDescription": "Review a diff", "path": "/h/.codex/skills/review/SKILL.md", "scope": "user" },
                { "name": "review", "path": "/h/.codex/skills/review/SKILL.md" },
                { "name": "off", "description": "Disabled", "enabled": false },
                { "path": "/nameless" }
            ],
            "errors": [{ "path": "/p/.codex/skills/bad/SKILL.md", "message": "missing front matter" }]
        }]
    }));
    assert_eq!(skills.len(), 2);
    assert_eq!((skills[0].description.as_str(), skills[0].scope.as_str()), ("Review a diff", "user"));
    assert!(!skills[1].enabled);
    assert_eq!(errors, ["missing front matter"]);
}
