//! The worker behind `AcpAgentBridge`, driven through the bridge's API against scripted
//! in-process agents. The worker loop, the agent connections and their clients are the real
//! ones; only the agent process is a stand-in (a `sleep` that holds the place of the agent's
//! process). A recording sink keeps every event the frontend would get, by name and payload.

use super::*;
use crate::acp::{
   bridge_init::{ACP_STARTUP_STOPPED, AgentLaunch, initialize_connection, serve_client},
   fake_agent::{FakeAgent, fake_agent_transport},
   host::recording::RecordingSink,
   sessions::ACP_IDLE_TIMEOUT,
};
use serde_json::{Value, json};
use std::{collections::VecDeque, path::PathBuf};
use tempfile::TempDir;

const AGENT: &str = "fake-agent";
const APP_VERSION: &str = "9.8.7-test";

/// An agent process the fake launcher started.
struct Launched {
   agent: FakeAgent,
   pid: i32,
   app_version: String,
   workspace_path: Option<PathBuf>,
   launch_env: HashMap<String, String>,
}

type LaunchLog = Rc<RefCell<Vec<Rc<Launched>>>>;

/// Starts a scripted agent the way `start_connection` starts a real one: the client is served
/// over the agent's transport, `initialize` runs, and `launch.stop` ends the startup.
async fn fake_start(
   launch: AgentLaunch,
   script: Value,
   launched: LaunchLog,
) -> Result<StartedConnection> {
   let (transport, agent) = fake_agent_transport(script);
   let client = Arc::new(AthasAcpClient::new(
      launch.events.clone(),
      launch.app_version.clone(),
      launch.workspace_path.clone(),
      launch.terminal_manager.clone(),
   ));
   let responders = client.responders();
   let (io_handle, connection_rx) = serve_client(transport, client.clone());
   let startup = async {
      let connection = Arc::new(connection_rx.await?);
      let init_response = initialize_connection(connection.clone()).await?;
      Ok::<_, anyhow::Error>((connection, init_response))
   };
   let (connection, init_response) = tokio::select! {
      result = startup => result?,
      () = launch.stop.cancelled() => {
         io_handle.abort();
         bail!(ACP_STARTUP_STOPPED);
      }
   };
   let process = tokio::process::Command::new("sleep")
      .arg("600")
      .process_group(0)
      .kill_on_drop(true)
      .spawn()?;
   let pid = process.id().expect("a running process");
   launched.borrow_mut().push(Rc::new(Launched {
      agent,
      pid: pid as i32,
      app_version: launch.app_version.clone(),
      workspace_path: launch.workspace_path.clone(),
      launch_env: launch.launch_env.clone(),
   }));
   Ok(StartedConnection {
      handle: ConnectionHandle::new(
         &launch.config,
         connection,
         client,
         launch.events,
         launch.workspace_path,
         init_response,
         Arc::default(),
      ),
      process,
      process_group_id: Some(pid),
      io_handle,
      responders,
   })
}

/// Starts each agent from the next script; the last one is used for every later start.
fn fake_launcher(scripts: Vec<Value>, launched: LaunchLog) -> AgentLauncher {
   let scripts = Rc::new(RefCell::new(VecDeque::from(scripts)));
   Rc::new(move |launch| {
      let script = {
         let mut scripts = scripts.borrow_mut();
         if scripts.len() > 1 {
            scripts.pop_front().unwrap()
         } else {
            scripts.front().cloned().unwrap_or_default()
         }
      };
      Box::pin(fake_start(launch, script, launched.clone()))
   })
}

/// The agent's answers to `initialize`, session setup and closing, with `overrides` replacing
/// or adding methods.
fn script(overrides: Value) -> Value {
   let mut script = json!({
      "initialize": { "result": {
         "protocolVersion": 1,
         "agentCapabilities": {
            "loadSession": true,
            "sessionCapabilities": { "close": {}, "list": {}, "delete": {} },
            "auth": { "logout": {} }
         },
         "authMethods": []
      } },
      "session/new": { "result": {
         "sessionId": "s1",
         "modes": {
            "currentModeId": "code",
            "availableModes": [{ "id": "code", "name": "Code" }, { "id": "ask", "name": "Ask" }]
         },
         "configOptions": [{
            "id": "model", "name": "Model", "type": "select", "currentValue": "fast",
            "options": [{ "value": "fast", "name": "Fast" }, { "value": "smart", "name": "Smart" }]
         }]
      } },
      "session/close": { "result": {} },
   });
   if let Value::Object(overrides) = overrides {
      for (method, reply) in overrides {
         script[method] = reply;
      }
   }
   script
}

fn update(session_update: Value) -> Value {
   json!({ "notify": "session/update", "params": { "sessionId": "s1", "update": session_update } })
}

fn end_turn() -> Value {
   json!({ "stopReason": "end_turn" })
}

fn permission_request(tool_call_id: &str) -> Value {
   json!({
      "request": "session/request_permission",
      "params": {
         "sessionId": "s1",
         "toolCall": { "toolCallId": tool_call_id, "title": "Edit a.txt", "kind": "edit" },
         "options": [
            { "optionId": "allow", "name": "Allow", "kind": "allow_once" },
            { "optionId": "always", "name": "Always allow", "kind": "allow_always" },
            { "optionId": "reject", "name": "Reject", "kind": "reject_once" }
         ]
      }
   })
}

struct Harness {
   bridge: AcpAgentBridge,
   sink: Arc<RecordingSink>,
   launched: LaunchLog,
   workspace: String,
   dir: TempDir,
}

impl Harness {
   /// A bridge whose worker runs on this `LocalSet` and starts agents from `scripts`.
   fn new(scripts: Vec<Value>) -> Self {
      Self::in_dir(tempfile::tempdir().unwrap(), scripts)
   }

   /// Like [`Self::new`], with chats opening sessions in `dir`.
   fn in_dir(dir: TempDir, scripts: Vec<Value>) -> Self {
      let workspace = dir.path().to_string_lossy().into_owned();
      let sink = Arc::new(RecordingSink::default());
      let launched = LaunchLog::default();
      let (command_tx, command_rx) = mpsc::channel(32);
      let (followup_tx, followup_rx) = mpsc::unbounded_channel();
      let responders = ResponderRegistry::default();
      let traffic = TrafficInspector::default();
      let status = Arc::default();
      let launch_env: AgentLaunchEnv =
         Arc::new(|agent_id| HashMap::from([("ATHAS_AGENT".to_string(), agent_id.to_string())]));
      let mut worker = AcpWorker::new(
         sink.clone(),
         APP_VERSION.to_string(),
         responders.clone(),
         traffic.clone(),
         launch_env,
         followup_tx,
      );
      worker.launcher = fake_launcher(scripts, launched.clone());
      tokio::task::spawn_local(run_worker_loop(
         command_rx,
         followup_rx,
         Arc::clone(&status),
         worker,
      ));

      let mut registry = AgentRegistry::empty();
      registry.replace_agents(vec![AgentConfig::new(
         AGENT,
         "Fake Agent",
         "athas-fake-agent",
      )]);
      let bridge = AcpAgentBridge {
         registry,
         command_tx,
         status,
         responders,
         terminal_manager: Arc::new(TerminalManager::new()),
         traffic,
      };
      Self {
         bridge,
         sink,
         launched,
         workspace,
         dir,
      }
   }

   fn agent(&self, index: usize) -> Rc<Launched> {
      self.launched.borrow()[index].clone()
   }

   fn launches(&self) -> usize {
      self.launched.borrow().len()
   }

   async fn open(&self, session_id: Option<&str>) -> Result<AcpOpenedSession> {
      self
         .bridge
         .open_session(
            AGENT,
            Some(self.workspace.clone()),
            session_id.map(str::to_string),
            false,
            None,
            Vec::new(),
            Vec::new(),
         )
         .await
   }

   async fn prepare(&self, session_id: Option<&str>) -> Result<AcpOpenedSession> {
      self
         .bridge
         .prepare_session(
            AGENT,
            Some(self.workspace.clone()),
            session_id.map(str::to_string),
            Vec::new(),
            Vec::new(),
         )
         .await
   }

   async fn prompt(&self, text: &str) -> Result<()> {
      self
         .bridge
         .send_prompt("s1".into(), vec![json!({ "type": "text", "text": text })])
         .await
   }

   async fn stop(&self) -> Result<()> {
      self
         .bridge
         .stop_agent(Some(AGENT.to_string()), Some(self.workspace.clone()))
         .await
   }

   /// The `acp-event` types sent so far, in order.
   fn event_types(&self) -> Vec<String> {
      self
         .sink
         .acp_events()
         .iter()
         .map(|event| event["type"].as_str().unwrap_or_default().to_string())
         .collect()
   }

   /// Waits for the turn in `s1` to end and returns its `prompt_complete`.
   async fn turn_end(&self) -> Value {
      self.sink.wait_for("prompt_complete", |_| true).await
   }

   /// Sends a prompt once the worker heard the previous turn ended.
   async fn prompt_when_free(&self, text: &str) {
      for _ in 0..1000 {
         if self.prompt(text).await.is_ok() {
            return;
         }
         tokio::time::sleep(Duration::from_millis(2)).await;
      }
      panic!("the session never took another prompt");
   }
}

fn local<F: Future>(future: F) -> F::Output {
   tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap()
      .block_on(LocalSet::new().run_until(future))
}

fn process_is_running(pid: i32) -> bool {
   // Signal 0 checks the process exists without touching it. A stopped `sleep` may linger as a
   // zombie until reaped, so also ask whether it can still be waited on.
   let mut status = 0;
   let reaped = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
   reaped == 0 && unsafe { libc::kill(pid, 0) } == 0
}

async fn wait_for_exit(pid: i32) {
   for _ in 0..1000 {
      if !process_is_running(pid) {
         return;
      }
      tokio::time::sleep(Duration::from_millis(5)).await;
   }
   panic!("agent process {pid} kept running");
}

#[test]
fn opening_a_session_starts_the_agent_and_reports_its_state() {
   local(async {
      let h = Harness::new(vec![script(json!({}))]);

      let opened = h.open(None).await.unwrap();

      assert_eq!(opened.session_id, "s1");
      assert!(!opened.context_lost);
      assert!(opened.history.is_empty());
      assert_eq!(opened.status.agent_id, AGENT);
      assert!(opened.status.running && opened.status.initialized);
      assert_eq!(opened.status.session_ids, vec!["s1".to_string()]);

      // The process got the app's version, the workspace and the launch environment.
      let launched = h.agent(0);
      assert_eq!(launched.app_version, APP_VERSION);
      assert_eq!(
         launched.workspace_path.as_deref(),
         Some(h.dir.path()),
         "the agent runs in the chat's workspace"
      );
      assert_eq!(launched.launch_env["ATHAS_AGENT"], AGENT);
      assert_eq!(launched.agent.methods(), vec!["initialize", "session/new"]);
      assert_eq!(
         launched.agent.params("session/new")[0]["cwd"],
         json!(h.workspace)
      );

      assert_eq!(
         h.event_types(),
         vec![
            "status_changed",
            "session_mode_update",
            "config_options_update",
            "status_changed",
         ]
      );
      let events = h.sink.acp_events();
      // Adopting the agent reports it running before any session is open.
      assert_eq!(events[0]["status"]["running"], true);
      assert_eq!(events[0]["status"]["sessionIds"], json!([]));
      assert_eq!(events[0]["error"], Value::Null);
      assert_eq!(
         events[0]["status"]["agentCapabilities"]["sessionCapabilities"]["close"],
         json!({})
      );
      assert_eq!(
         events[1],
         json!({
            "type": "session_mode_update",
            "sessionId": "s1",
            "modeState": {
               "currentModeId": "code",
               "availableModes": [
                  { "id": "code", "name": "Code", "description": null },
                  { "id": "ask", "name": "Ask", "description": null }
               ]
            }
         })
      );
      assert_eq!(events[2]["sessionId"], "s1");
      assert_eq!(events[2]["configOptions"][0]["id"], "model");
      assert_eq!(events[3]["status"]["sessionIds"], json!(["s1"]));
      assert_eq!(
         events[3]["status"]["workspacePath"],
         json!(h.workspace),
         "the status names the workspace the agent runs in"
      );

      let statuses = h.bridge.get_status().await;
      assert_eq!(statuses.len(), 1);
      assert_eq!(statuses[0].session_ids, vec!["s1".to_string()]);

      // Every event went out under a name the frontend listens on.
      assert!(h.sink.emitted().iter().all(|(name, _)| name == "acp-event"));
   });
}

#[test]
fn chats_share_one_running_agent_and_reopening_an_open_session_answers_right_away() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/new": [
            { "result": { "sessionId": "s1" } },
            { "result": { "sessionId": "s2" } }
         ]
      }))]);

      // Both chats ask while the agent is still starting; one process serves them.
      let (first, second) = tokio::join!(h.open(None), h.open(None));
      let mut sessions = vec![first.unwrap().session_id, second.unwrap().session_id];
      sessions.sort();
      assert_eq!(sessions, vec!["s1", "s2"]);
      assert_eq!(h.launches(), 1);

      let reopened = h.open(Some("s1")).await.unwrap();
      assert_eq!(reopened.session_id, "s1");
      assert_eq!(
         reopened.status.session_ids,
         vec!["s1".to_string(), "s2".to_string()]
      );
      let agent = h.agent(0);
      assert_eq!(
         agent.agent.methods(),
         vec!["initialize", "session/new", "session/new"],
         "an open session is not loaded again"
      );
   });
}

#[test]
fn a_prompt_turn_streams_the_agents_updates_as_chat_events() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/prompt": {
            "steps": [
               update(json!({
                  "sessionUpdate": "agent_thought_chunk",
                  "content": { "type": "text", "text": "Thinking" }
               })),
               update(json!({
                  "sessionUpdate": "agent_message_chunk",
                  "content": { "type": "text", "text": "Hello" },
                  "messageId": "m1"
               })),
               update(json!({
                  "sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Read a.txt",
                  "kind": "read", "status": "pending",
                  "locations": [{ "path": "/work/a.txt", "line": 3 }]
               })),
               update(json!({
                  "sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
                  "content": [{ "type": "content", "content": { "type": "text", "text": "done" } }]
               })),
               update(json!({
                  "sessionUpdate": "plan",
                  "entries": [{ "content": "Read", "priority": "high", "status": "completed" }]
               })),
               update(json!({ "sessionUpdate": "current_mode_update", "currentModeId": "ask" })),
               update(json!({ "sessionUpdate": "usage_update", "used": 10, "size": 100 })),
               update(json!({ "sessionUpdate": "session_info_update", "title": "Greeting" })),
               update(json!({
                  "sessionUpdate": "available_commands_update",
                  "availableCommands": [
                     { "name": "plan", "description": "Plan", "input": { "hint": "goal" } }
                  ]
               })),
            ],
            "result": {
               "stopReason": "end_turn",
               "usage": { "totalTokens": 30, "inputTokens": 20, "outputTokens": 10 }
            }
         }
      }))]);
      h.open(None).await.unwrap();
      let before = h.sink.acp_events().len();

      h.prompt("Hi").await.unwrap();
      let complete = h.turn_end().await;

      assert_eq!(
         h.agent(0).agent.params("session/prompt")[0],
         json!({ "sessionId": "s1", "prompt": [{ "type": "text", "text": "Hi" }] })
      );
      let types: Vec<String> = h.event_types().split_off(before);
      assert_eq!(
         types,
         vec![
            "thought_chunk",
            "content_chunk",
            "tool_start",
            "tool_update",
            "tool_complete",
            "plan_update",
            "current_mode_update",
            "usage_update",
            "session_info_update",
            "slash_commands_update",
            "prompt_complete",
         ]
      );
      let events = h.sink.acp_events().split_off(before);
      assert!(events.iter().all(|event| event["sessionId"] == "s1"));
      assert_eq!(
         events[1],
         json!({
            "type": "content_chunk",
            "sessionId": "s1",
            "content": { "type": "text", "text": "Hello" },
            "isComplete": false,
            "messageId": "m1"
         })
      );
      assert_eq!(events[2]["toolId"], "t1");
      assert_eq!(events[2]["toolName"], "Read a.txt");
      assert_eq!(events[2]["kind"], "read");
      assert_eq!(events[2]["status"], "pending");
      assert_eq!(
         events[2]["locations"],
         json!([{ "path": "/work/a.txt", "line": 3 }])
      );
      assert_eq!(events[3]["status"], "completed");
      assert_eq!(events[4]["success"], true);
      assert_eq!(
         events[5]["entries"],
         json!([{ "content": "Read", "priority": "high", "status": "completed" }])
      );
      assert_eq!(events[6]["currentModeId"], "ask");
      assert_eq!(events[7]["usage"]["used"], 10);
      assert_eq!(events[7]["usage"]["size"], 100);
      assert_eq!(events[8]["title"], "Greeting");
      assert_eq!(events[9]["commands"][0]["name"], "plan");
      assert_eq!(events[9]["commands"][0]["input"]["hint"], "goal");
      assert_eq!(
         complete,
         json!({
            "type": "prompt_complete",
            "sessionId": "s1",
            "stopReason": "end_turn",
            "usage": {
               "totalTokens": 30,
               "inputTokens": 20,
               "outputTokens": 10,
               "thoughtTokens": null,
               "cachedReadTokens": null,
               "cachedWriteTokens": null
            }
         })
      );

      // Once the worker hears the turn ended, the chat can prompt again.
      h.prompt_when_free("Again").await;
   });
}

#[test]
fn a_permission_request_waits_for_the_users_choice_and_hands_it_to_the_agent() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/prompt": [
            { "steps": [permission_request("t1")], "result": end_turn() },
            { "steps": [permission_request("t2")], "result": end_turn() },
            { "steps": [permission_request("t3")], "result": end_turn() }
         ]
      }))]);
      h.open(None).await.unwrap();

      // The user clicks one of the agent's options.
      h.prompt("Edit it").await.unwrap();
      let request = h.sink.wait_for("permission_request", |_| true).await;
      assert_eq!(request["sessionId"], "s1");
      assert_eq!(request["permissionType"], "tool_call");
      assert_eq!(request["resource"], "t1");
      assert_eq!(request["description"], "Edit a.txt (t1)");
      assert_eq!(
         request["options"],
         json!([
            { "id": "allow", "name": "Allow", "kind": "allow_once" },
            { "id": "always", "name": "Always allow", "kind": "allow_always" },
            { "id": "reject", "name": "Reject", "kind": "reject_once" }
         ])
      );
      // The request's tool call reaches the transcript before the prompt asks about it.
      let types = h.event_types();
      let permission_at = types.iter().position(|kind| kind == "permission_request");
      assert_eq!(
         types[permission_at.unwrap() - 1],
         "tool_update",
         "the tool call is applied first"
      );
      let request_id = request["requestId"].as_str().unwrap().to_string();
      h.bridge
         .respond_to_permission(request_id.clone(), true, false, Some("always".into()))
         .await
         .unwrap();
      let answers = h
         .agent(0)
         .agent
         .wait_for_answers("session/request_permission", 1)
         .await;
      assert_eq!(
         answers[0]["result"]["outcome"],
         json!({ "outcome": "selected", "optionId": "always" })
      );
      h.turn_end().await;
      // An answered request is not withdrawn from the UI: the chat already moved on.
      assert!(h.sink.of_type("request_closed").is_empty());

      // A plain yes picks the one-time allow option, never the standing rule.
      h.prompt_when_free("Again").await;
      let request = h
         .sink
         .wait_for("permission_request", |event| event["resource"] == "t2")
         .await;
      h.bridge
         .respond_to_permission(
            request["requestId"].as_str().unwrap().to_string(),
            true,
            false,
            None,
         )
         .await
         .unwrap();
      let answers = h
         .agent(0)
         .agent
         .wait_for_answers("session/request_permission", 2)
         .await;
      assert_eq!(
         answers[1]["result"]["outcome"],
         json!({ "outcome": "selected", "optionId": "allow" })
      );

      // A plain no picks the one-time reject option.
      h.prompt_when_free("Once more").await;
      let request = h
         .sink
         .wait_for("permission_request", |event| event["resource"] == "t3")
         .await;
      h.bridge
         .respond_to_permission(
            request["requestId"].as_str().unwrap().to_string(),
            false,
            false,
            None,
         )
         .await
         .unwrap();
      let answers = h
         .agent(0)
         .agent
         .wait_for_answers("session/request_permission", 3)
         .await;
      assert_eq!(
         answers[2]["result"]["outcome"],
         json!({ "outcome": "selected", "optionId": "reject" })
      );

      // An answer for a request nobody waits on anymore is ignored.
      h.bridge
         .respond_to_permission(request_id, true, false, None)
         .await
         .unwrap();
   });
}

#[test]
fn cancelling_a_turn_tells_the_agent_and_withdraws_what_waits_on_the_user() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/prompt": {
            "steps": [permission_request("t1"), { "await": "session/cancel" }],
            "result": { "stopReason": "cancelled" }
         }
      }))]);
      h.open(None).await.unwrap();
      h.prompt("Edit it").await.unwrap();
      let request = h.sink.wait_for("permission_request", |_| true).await;

      // One turn at a time per session.
      let busy = h.prompt("And this").await.unwrap_err();
      assert_eq!(
         busy.to_string(),
         "The agent is still answering the previous prompt in this chat"
      );

      h.bridge
         .cancel_prompt(Some("s1".into()), None, None)
         .await
         .unwrap();

      let answers = h
         .agent(0)
         .agent
         .wait_for_answers("session/request_permission", 1)
         .await;
      assert_eq!(
         answers[0]["result"]["outcome"],
         json!({ "outcome": "cancelled" })
      );
      assert_eq!(
         h.agent(0).agent.params("session/cancel"),
         vec![json!({ "sessionId": "s1" })]
      );
      let closed = h.sink.wait_for("request_closed", |_| true).await;
      assert_eq!(
         closed,
         json!({ "type": "request_closed", "requestId": request["requestId"] })
      );
      let complete = h.turn_end().await;
      assert_eq!(complete["stopReason"], "cancelled");

      // Cancelling a session that is not open does nothing.
      h.bridge
         .cancel_prompt(Some("unknown".into()), None, None)
         .await
         .unwrap();
   });
}

#[test]
fn agent_questions_are_answered_with_the_users_reply() {
   local(async {
      let question = json!({
         "request": "elicitation/create",
         "params": {
            "sessionId": "s1",
            "mode": "form",
            "message": "Which scope?",
            "requestedSchema": {
               "type": "object",
               "properties": { "scope": { "type": "string" } },
               "required": ["scope"]
            }
         }
      });
      let h = Harness::new(vec![script(json!({
         "session/prompt": { "steps": [question], "result": end_turn() }
      }))]);
      h.open(None).await.unwrap();
      h.prompt("Ask me").await.unwrap();

      let asked = h.sink.wait_for("elicitation_request", |_| true).await;
      assert_eq!(asked["sessionId"], "s1");
      assert_eq!(asked["request"]["mode"], "form");
      assert_eq!(asked["request"]["message"], "Which scope?");
      let request_id = asked["requestId"].as_str().unwrap().to_string();

      let reply = json!({ "action": "accept", "content": { "scope": "package" } });
      h.bridge
         .respond_to_elicitation(request_id.clone(), reply.clone())
         .await
         .unwrap();
      let answers = h
         .agent(0)
         .agent
         .wait_for_answers("elicitation/create", 1)
         .await;
      assert_eq!(answers[0]["result"], reply);
      h.turn_end().await;

      let late = h
         .bridge
         .respond_to_elicitation(request_id, json!({ "action": "decline" }))
         .await
         .unwrap_err();
      assert_eq!(
         late.to_string(),
         "The agent is no longer waiting for this answer"
      );
   });
}

#[test]
fn agent_file_writes_land_on_disk_and_tell_the_chat_and_the_editor() {
   local(async {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("notes.txt");
      std::fs::write(&path, "before").unwrap();
      let path = std::fs::canonicalize(path).unwrap();
      let path_str = path.to_string_lossy().into_owned();
      let write = json!({
         "request": "fs/write_text_file",
         "params": { "sessionId": "s1", "path": path_str, "content": "after" }
      });
      let read = json!({
         "request": "fs/read_text_file",
         "params": { "sessionId": "s1", "path": path_str, "line": 1 }
      });
      let h = Harness::in_dir(
         dir,
         vec![script(json!({
            "session/prompt": { "steps": [write, read], "result": end_turn() }
         }))],
      );
      h.open(None).await.unwrap();
      h.prompt("Write it").await.unwrap();
      h.turn_end().await;

      assert_eq!(std::fs::read_to_string(&path).unwrap(), "after");
      let agent = h.agent(0);
      assert_eq!(
         agent.agent.answers("fs/write_text_file")[0]["result"],
         json!({})
      );
      assert_eq!(
         agent.agent.answers("fs/read_text_file")[0]["result"],
         json!({ "content": "after" }),
         "with no editor window open the read goes to the disk"
      );

      let written = h.sink.wait_for("agent_file_write", |_| true).await;
      assert_eq!(written["sessionId"], "s1");
      assert_eq!(written["path"], json!(path_str));
      assert_eq!(written["previousContent"], "before");
      assert_eq!(written["content"], "after");
      let changed = h.sink.wait_for_named("file-changed", |_| true).await;
      assert_eq!(
         changed,
         json!({
            "path": path_str,
            "event_type": "reloaded",
            "agent_write_id": written["writeId"]
         })
      );
      let locations = h.sink.of_type("agent_location");
      assert_eq!(
         locations,
         vec![
            json!({ "type": "agent_location", "sessionId": "s1", "path": path_str, "line": null }),
            json!({ "type": "agent_location", "sessionId": "s1", "path": path_str, "line": 1 }),
         ]
      );
      let names: Vec<String> = h.sink.emitted().into_iter().map(|(name, _)| name).collect();
      let write_at = names
         .iter()
         .position(|name| name == "file-changed")
         .unwrap();
      assert!(
         h.sink.emitted()[..write_at]
            .iter()
            .any(|(_, event)| event["type"] == "agent_file_write"),
         "the chat hears the write is the agent's before the file watcher does"
      );
   });
}

#[test]
fn reads_use_the_editors_unsaved_buffer_when_a_window_has_the_file_open() {
   local(async {
      let dir = tempfile::tempdir().unwrap();
      let path = std::fs::canonicalize(dir.path()).unwrap().join("open.txt");
      std::fs::write(&path, "on disk").unwrap();
      let path_str = path.to_string_lossy().into_owned();
      let read = json!({
         "request": "fs/read_text_file",
         "params": { "sessionId": "s1", "path": path_str }
      });
      let h = Harness::in_dir(
         dir,
         vec![script(json!({
            "session/prompt": { "steps": [read.clone(), read], "result": end_turn() }
         }))],
      );
      h.sink.set_editor_windows(2);
      h.open(None).await.unwrap();
      h.prompt("Read it").await.unwrap();

      // Every editor window is asked; the first with the file open answers.
      let asked = h.sink.wait_for_named("acp-buffer-read", |_| true).await;
      assert_eq!(asked["path"], json!(path_str));
      let request_id = asked["requestId"].as_str().unwrap().to_string();
      h.bridge
         .respond_to_buffer_read(request_id.clone(), None)
         .await;
      h.bridge
         .respond_to_buffer_read(request_id, Some("unsaved".into()))
         .await;
      let answers = h
         .agent(0)
         .agent
         .wait_for_answers("fs/read_text_file", 1)
         .await;
      assert_eq!(answers[0]["result"], json!({ "content": "unsaved" }));

      // When no window has it open, the read goes to the disk.
      let second = h
         .sink
         .wait_for_named("acp-buffer-read", |request| {
            request["requestId"] != asked["requestId"]
         })
         .await;
      let second_id = second["requestId"].as_str().unwrap().to_string();
      h.bridge
         .respond_to_buffer_read(second_id.clone(), None)
         .await;
      h.bridge.respond_to_buffer_read(second_id, None).await;
      let answers = h
         .agent(0)
         .agent
         .wait_for_answers("fs/read_text_file", 2)
         .await;
      assert_eq!(answers[1]["result"], json!({ "content": "on disk" }));
      h.turn_end().await;
   });
}

#[test]
fn agent_terminals_run_with_the_apps_version_and_report_their_output() {
   local(async {
      let create = json!({
         "request": "terminal/create",
         "params": {
            "sessionId": "s1",
            "command": "sh",
            "args": ["-c", "printf \"version=%s\" \"$TERM_PROGRAM_VERSION\""]
         }
      });
      let h = Harness::new(vec![script(json!({
         "session/prompt": { "steps": [create], "result": end_turn() }
      }))]);
      h.open(None).await.unwrap();
      h.prompt("Run it").await.unwrap();
      h.turn_end().await;

      let agent = h.agent(0);
      let created = &agent.agent.answers("terminal/create")[0];
      let terminal_id = created["result"]["terminalId"]
         .as_str()
         .unwrap_or_else(|| panic!("terminal/create failed: {created}"))
         .to_string();
      let exit = h
         .sink
         .wait_for("terminal_exit", |event| {
            event["terminalId"] == json!(terminal_id)
         })
         .await;
      assert_eq!(exit["sessionId"], "s1");
      assert_eq!(exit["exitCode"], 0);
      let output: String = h
         .sink
         .of_type("terminal_output")
         .iter()
         .filter(|event| event["terminalId"] == json!(terminal_id))
         .map(|event| event["data"].as_str().unwrap().to_string())
         .collect();
      assert!(
         output.contains(&format!("version={APP_VERSION}")),
         "terminal output: {output:?}"
      );
   });
}

#[test]
fn a_failed_turn_reports_an_error_event_and_frees_the_session() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/prompt": [
            { "error": { "code": -32603, "message": "Rate limit exceeded" } },
            { "result": end_turn() }
         ]
      }))]);
      h.open(None).await.unwrap();

      h.prompt("Hi").await.unwrap();
      let error = h.sink.wait_for("error", |_| true).await;
      // The agent's reason reaches the chat, not just the step that failed.
      assert_eq!(
         error,
         json!({
            "type": "error",
            "sessionId": "s1",
            "error": "Failed to run prompt: Failed to send prompt: Rate limit exceeded"
         })
      );
      assert!(h.sink.of_type("prompt_complete").is_empty());

      // The failed turn does not leave the session busy.
      h.prompt_when_free("Again").await;
      h.turn_end().await;
   });
}

#[test]
fn a_prompt_that_needs_sign_in_asks_the_user_unless_one_method_signs_in_on_its_own() {
   local(async {
      let auth_required =
         json!({ "error": { "code": -32000, "message": "Authentication required" } });

      // Two methods: the user picks one in the chat.
      let mut choose = script(json!({ "session/prompt": auth_required.clone() }));
      choose["initialize"]["result"]["authMethods"] = json!([
         { "id": "login", "name": "Log in" },
         { "id": "key", "name": "API key" }
      ]);
      let h = Harness::new(vec![choose]);
      h.open(None).await.unwrap();
      h.prompt("Hi").await.unwrap();
      let asked = h.sink.wait_for("auth_required", |_| true).await;
      assert_eq!(asked["agentId"], AGENT);
      assert_eq!(asked["sessionId"], "s1");
      assert_eq!(asked["methods"][0]["id"], "login");
      assert_eq!(asked["methods"][1]["id"], "key");
      let error = h.sink.wait_for("error", |_| true).await;
      assert_eq!(
         error["error"],
         "Failed to run prompt: Authentication required before sending prompt"
      );

      // One method: Athas signs in and sends the prompt again.
      let mut automatic = script(json!({
         "session/prompt": [auth_required, { "result": end_turn() }],
         "authenticate": { "result": {} }
      }));
      automatic["initialize"]["result"]["authMethods"] =
         json!([{ "id": "login", "name": "Log in" }]);
      let h = Harness::new(vec![automatic]);
      h.open(None).await.unwrap();
      h.prompt("Hi").await.unwrap();
      h.turn_end().await;
      assert_eq!(
         h.agent(0).agent.methods(),
         vec![
            "initialize",
            "session/new",
            "session/prompt",
            "authenticate",
            "session/prompt"
         ]
      );
      assert_eq!(
         h.agent(0).agent.params("authenticate")[0]["methodId"],
         "login"
      );
      assert!(h.sink.of_type("auth_required").is_empty());
   });
}

#[test]
fn a_prepared_session_reports_its_options_and_the_first_prompt_reuses_it() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/prompt": { "result": end_turn() }
      }))]);

      let prepared = h.prepare(None).await.unwrap();
      assert_eq!(prepared.session_id, "s1");
      let options = h.sink.wait_for("config_options_update", |_| true).await;
      assert_eq!(options["configOptions"][0]["id"], "model");
      h.sink.wait_for("session_mode_update", |_| true).await;

      let opened = h.open(Some("s1")).await.unwrap();
      assert_eq!(opened.session_id, "s1");
      assert!(!opened.context_lost);
      h.prompt("Hi").await.unwrap();
      h.turn_end().await;

      assert_eq!(h.launches(), 1);
      assert_eq!(
         h.agent(0).agent.methods(),
         vec!["initialize", "session/new", "session/prompt"]
      );
   });
}

#[test]
fn preparing_a_session_never_signs_in_or_asks_the_user_to() {
   local(async {
      let auth_required =
         json!({ "error": { "code": -32000, "message": "Authentication required" } });
      let mut agent = script(json!({
         "session/new": auth_required,
         "authenticate": { "result": {} }
      }));
      agent["initialize"]["result"]["authMethods"] = json!([{ "id": "login", "name": "Log in" }]);
      let h = Harness::new(vec![agent]);

      let error = h.prepare(None).await.unwrap_err();

      assert!(error.to_string().contains("Authentication required"));
      assert!(
         !h.agent(0)
            .agent
            .methods()
            .contains(&"authenticate".to_string())
      );
      assert!(h.sink.of_type("auth_required").is_empty());
      wait_for_exit(h.agent(0).pid).await;
   });
}

#[test]
fn an_agent_that_crashes_mid_turn_fails_the_turn_and_its_chats_hear_it_exited() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/load": { "result": {} },
         "session/prompt": {
            "steps": [
               update(json!({
                  "sessionUpdate": "agent_message_chunk",
                  "content": { "type": "text", "text": "Work" }
               })),
               { "hangup": true }
            ],
            "result": end_turn()
         }
      }))]);
      h.open(None).await.unwrap();
      h.prompt("Hi").await.unwrap();

      let error = h.sink.wait_for("error", |_| true).await;
      assert_eq!(error["sessionId"], "s1");
      assert!(
         error["error"]
            .as_str()
            .unwrap()
            .starts_with("Failed to run prompt"),
         "{error}"
      );
      assert_eq!(h.sink.of_type("content_chunk").len(), 1);

      // The process dies; the next health check notices and every chat on it hears.
      let pid = h.agent(0).pid;
      unsafe { libc::kill(pid, libc::SIGKILL) };
      let exited = h
         .sink
         .wait_for("status_changed", |event| !event["error"].is_null())
         .await;
      assert_eq!(exited["status"]["running"], false);
      assert_eq!(exited["status"]["agentId"], AGENT);
      assert_eq!(exited["status"]["sessionIds"], json!(["s1"]));
      assert!(
         exited["error"]
            .as_str()
            .unwrap()
            .starts_with("ACP agent process exited:"),
         "{exited}"
      );
      // An exit is not a requested stop: the chat keeps its session to reconnect with.
      assert!(h.sink.of_type("session_complete").is_empty());
      assert!(h.bridge.get_status().await.is_empty());
      let gone = h.prompt("Hello?").await.unwrap_err();
      assert_eq!(gone.to_string(), "The agent session s1 is not open");

      // The chat reconnects: a new process loads the session it had.
      let reopened = h.open(Some("s1")).await.unwrap();
      assert_eq!(reopened.session_id, "s1");
      assert!(!reopened.context_lost);
      assert_eq!(h.launches(), 2);
      assert_eq!(
         h.agent(1).agent.methods(),
         vec!["initialize", "session/load"]
      );
      assert_eq!(
         h.agent(1).agent.params("session/load")[0]["sessionId"],
         "s1"
      );
   });
}

#[test]
fn stopping_the_agent_closes_its_sessions_and_ends_the_process() {
   local(async {
      let h = Harness::new(vec![script(json!({}))]);
      h.open(None).await.unwrap();
      let pid = h.agent(0).pid;

      h.stop().await.unwrap();

      assert_eq!(
         h.agent(0).agent.params("session/close"),
         vec![json!({ "sessionId": "s1" })]
      );
      let events = h.sink.acp_events();
      let tail = &events[events.len() - 2..];
      assert_eq!(
         tail[0],
         json!({ "type": "session_complete", "sessionId": "s1" })
      );
      assert_eq!(tail[1]["type"], "status_changed");
      assert_eq!(tail[1]["status"]["running"], false);
      assert_eq!(tail[1]["status"]["sessionIds"], json!(["s1"]));
      assert_eq!(tail[1]["error"], Value::Null);
      wait_for_exit(pid).await;
      assert!(h.bridge.get_status().await.is_empty());

      // Stopping what is not running is fine, and so is stopping everything.
      h.stop().await.unwrap();
      h.bridge.stop_agent(None, None).await.unwrap();
   });
}

#[test]
fn closing_a_session_releases_it_while_the_agent_keeps_running() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/new": [
            { "result": { "sessionId": "s1" } },
            { "result": { "sessionId": "s2" } }
         ]
      }))]);
      h.open(None).await.unwrap();
      h.open(None).await.unwrap();

      h.bridge.close_session("s1".into()).await.unwrap();

      let agent = h.agent(0);
      for _ in 0..200 {
         if !agent.agent.params("session/close").is_empty() {
            break;
         }
         tokio::time::sleep(Duration::from_millis(5)).await;
      }
      assert_eq!(
         agent.agent.params("session/close"),
         vec![json!({ "sessionId": "s1" })]
      );
      let status = h.sink.acp_events().pop().unwrap();
      assert_eq!(status["type"], "status_changed");
      assert_eq!(status["status"]["running"], true);
      assert_eq!(status["status"]["sessionIds"], json!(["s2"]));
      assert!(process_is_running(agent.pid));
      assert!(h.sink.of_type("session_complete").is_empty());

      // Closing a session that is not open does nothing.
      h.bridge.close_session("s1".into()).await.unwrap();
   });
}

#[test]
fn session_requests_reach_the_agent_and_report_back() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/set_mode": { "result": {} },
         "session/set_config_option": { "result": { "configOptions": [{
            "id": "model", "name": "Model", "type": "select", "currentValue": "smart",
            "options": [{ "value": "fast", "name": "Fast" }, { "value": "smart", "name": "Smart" }]
         }] } },
         "session/list": { "result": {
            "sessions": [{ "sessionId": "old", "cwd": "/work/app", "title": "Earlier" }],
            "nextCursor": "page-2"
         } },
         "session/delete": { "result": {} },
         "logout": { "result": {} }
      }))]);
      h.open(None).await.unwrap();

      h.bridge
         .set_session_mode("s1".into(), "ask".into())
         .await
         .unwrap();
      h.bridge
         .set_session_config_option(
            "s1".into(),
            "model".into(),
            SessionConfigValue::String("smart".into()),
         )
         .await
         .unwrap();
      let list = h
         .bridge
         .list_sessions(AGENT.into(), Some(h.workspace.clone()), None, None)
         .await
         .unwrap();
      h.bridge
         .logout(AGENT.into(), Some(h.workspace.clone()))
         .await
         .unwrap();

      let agent = h.agent(0);
      assert_eq!(
         agent.agent.params("session/set_mode"),
         vec![json!({ "sessionId": "s1", "modeId": "ask" })]
      );
      assert_eq!(
         agent.agent.params("session/set_config_option")[0]["value"],
         "smart"
      );
      let updated = h
         .sink
         .wait_for("config_options_update", |event| {
            event["configOptions"][0]["kind"]["currentValue"] == "smart"
         })
         .await;
      assert_eq!(updated["sessionId"], "s1");
      assert_eq!(list.sessions.len(), 1);
      assert_eq!(list.sessions[0].session_id, "old");
      assert_eq!(list.sessions[0].title.as_deref(), Some("Earlier"));
      assert_eq!(list.next_cursor.as_deref(), Some("page-2"));
      assert_eq!(agent.agent.params("logout").len(), 1);

      // Deleting the open session drops it from the chat and the status.
      h.bridge
         .delete_session(AGENT.into(), Some(h.workspace.clone()), "s1".into())
         .await
         .unwrap();
      assert_eq!(
         agent.agent.params("session/delete"),
         vec![json!({ "sessionId": "s1" })]
      );
      let events = h.sink.acp_events();
      let tail = &events[events.len() - 2..];
      assert_eq!(
         tail[0],
         json!({ "type": "session_complete", "sessionId": "s1" })
      );
      assert_eq!(tail[1]["status"]["sessionIds"], json!([]));

      // Requests for a session that is not open fail without reaching the agent.
      let error = h
         .bridge
         .set_session_mode("s1".into(), "code".into())
         .await
         .unwrap_err();
      assert_eq!(error.to_string(), "The agent session s1 is not open");
   });
}

#[test]
fn a_failed_startup_answers_every_waiting_chat() {
   local(async {
      let h = Harness::new(vec![json!({
         "initialize": { "error": { "code": -32603, "message": "bad install" } }
      })]);

      let (first, second) = tokio::join!(h.open(None), h.open(None));

      let first = first.unwrap_err().to_string();
      let second = second.unwrap_err().to_string();
      assert!(first.contains("bad install"), "{first}");
      assert_eq!(first, second);
      assert_eq!(h.launches(), 0);
      assert!(h.bridge.get_status().await.is_empty());
      assert!(h.sink.acp_events().is_empty());
   });
}

#[test]
fn stopping_a_startup_answers_the_waiting_chat() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "initialize": { "steps": [{ "await": "never" }], "result": {} }
      }))]);

      let (opened, ()) = tokio::join!(h.open(None), async {
         tokio::time::sleep(Duration::from_millis(50)).await;
         h.bridge
            .cancel_prompt(None, Some(AGENT.into()), Some(h.workspace.clone()))
            .await
            .unwrap();
      });

      assert_eq!(opened.unwrap_err().to_string(), ACP_STARTUP_STOPPED);
      assert_eq!(h.launches(), 0);
      assert!(h.bridge.get_status().await.is_empty());

      // Stopping every agent, as quitting the app does, stops startups too.
      let (opened, ()) = tokio::join!(h.open(None), async {
         tokio::time::sleep(Duration::from_millis(50)).await;
         h.bridge.stop_agent(None, None).await.unwrap();
      });
      assert_eq!(opened.unwrap_err().to_string(), ACP_STARTUP_STOPPED);
      assert_eq!(h.launches(), 0);
   });
}

#[test]
fn a_request_the_agent_withdraws_is_withdrawn_from_the_chat() {
   local(async {
      let mut ask = permission_request("t1");
      ask["id"] = json!(77);
      ask["wait"] = json!(false);
      let h = Harness::new(vec![script(json!({
         "session/prompt": {
            "steps": [
               ask,
               { "sleep_ms": 100 },
               { "notify": "$/cancel_request", "params": { "requestId": 77 } }
            ],
            "result": end_turn()
         }
      }))]);
      h.open(None).await.unwrap();
      h.prompt("Edit it").await.unwrap();

      let request = h.sink.wait_for("permission_request", |_| true).await;
      let closed = h
         .sink
         .wait_for("request_closed", |event| {
            event["requestId"] == request["requestId"]
         })
         .await;
      assert_eq!(closed["type"], "request_closed");
      let answers = h
         .agent(0)
         .agent
         .wait_for_answers("session/request_permission", 1)
         .await;
      assert_eq!(answers[0]["error"]["code"], -32800, "{answers:?}");

      // The user's late answer goes nowhere.
      h.bridge
         .respond_to_permission(
            request["requestId"].as_str().unwrap().to_string(),
            true,
            false,
            Some("allow".into()),
         )
         .await
         .unwrap();
      assert_eq!(
         h.agent(0).agent.answers("session/request_permission").len(),
         1
      );
   });
}

#[test]
fn an_agent_whose_first_session_cannot_open_is_shut_down() {
   local(async {
      let h = Harness::new(vec![script(json!({
         "session/new": { "error": { "code": -32603, "message": "no sessions today" } }
      }))]);

      let error = h.open(None).await.unwrap_err().to_string();

      assert!(error.contains("no sessions today"), "{error}");
      let stopped = h
         .sink
         .wait_for("status_changed", |event| {
            event["status"]["running"] == false
         })
         .await;
      assert_eq!(stopped["error"], Value::Null);
      wait_for_exit(h.agent(0).pid).await;
      assert!(h.bridge.get_status().await.is_empty());
   });
}

#[test]
fn idle_agents_are_shut_down_once_nothing_uses_them() {
   local(async {
      let sink = Arc::new(RecordingSink::default());
      let launched = LaunchLog::default();
      let (followup_tx, _followup_rx) = mpsc::unbounded_channel();
      let mut worker = AcpWorker::new(
         sink.clone(),
         APP_VERSION.to_string(),
         ResponderRegistry::default(),
         TrafficInspector::default(),
         Arc::new(|_| HashMap::new()),
         followup_tx,
      );
      let started = fake_start(
         AgentLaunch {
            config: Box::new(AgentConfig::new(AGENT, "Fake Agent", "athas-fake-agent")),
            launch_env: HashMap::new(),
            workspace_path: None,
            events: sink.clone(),
            app_version: APP_VERSION.to_string(),
            terminal_manager: Arc::new(TerminalManager::new()),
            traffic: TrafficInspector::default(),
            stop: tokio_util::sync::CancellationToken::new(),
         },
         script(json!({})),
         launched.clone(),
      )
      .await
      .unwrap();
      let id = worker.adopt(ConnectionKey::new(AGENT.into(), None), started);
      let pid = launched.borrow()[0].pid;

      // Recently used: it keeps running.
      worker.sweep(Instant::now());
      assert_eq!(worker.statuses().len(), 1);

      worker.sweep(Instant::now() + ACP_IDLE_TIMEOUT + Duration::from_secs(1));
      assert!(worker.statuses().is_empty());
      assert!(worker.status_of(id).is_none());
      let stopped = sink.acp_events().pop().unwrap();
      assert_eq!(stopped["type"], "status_changed");
      assert_eq!(stopped["status"]["running"], false);
      assert_eq!(stopped["error"], Value::Null);
      wait_for_exit(pid).await;
   });
}

#[test]
fn the_bridge_runs_managed_agents_from_the_data_dir_and_streams_their_traffic() {
   let sink = Arc::new(RecordingSink::default());
   let data_dir = tempfile::tempdir().unwrap();
   let managed = data_dir.path().join("tools").join("acp");
   std::fs::create_dir_all(&managed).unwrap();
   let wrapper = managed.join(AGENT);
   athas_test_support::write_script(
      &wrapper,
      "echo 'Error: the agent needs an API key' >&2\nexit 3",
   );

   let mut bridge = AcpAgentBridge::new(
      sink.clone(),
      AcpHostInfo {
         app_version: APP_VERSION.to_string(),
         data_dir: Some(data_dir.path().to_path_buf()),
      },
      Arc::new(TerminalManager::new()),
      Arc::new(|_| HashMap::new()),
   );
   bridge.replace_registered_agents(vec![AgentConfig::new(
      AGENT,
      "Fake Agent",
      "athas-fake-agent-binary-that-is-not-installed",
   )]);
   let agents = bridge.detect_agents();
   let agent = agents.iter().find(|agent| agent.id == AGENT).unwrap();
   assert!(agent.installed && agent.managed);
   assert_eq!(
      agent.binary_path.as_deref(),
      Some(wrapper.to_string_lossy().as_ref()),
      "agents installed by Athas run from its data directory"
   );

   tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap()
      .block_on(async {
         let error = bridge
            .open_session("missing", None, None, false, None, Vec::new(), Vec::new())
            .await
            .unwrap_err();
         assert_eq!(error.to_string(), "Agent not found");

         // The worker thread runs the real process: one that exits during startup fails the
         // open with what it printed, instead of hanging it.
         bridge.traffic().subscribe();
         let error = bridge
            .open_session(AGENT, None, None, false, None, Vec::new(), Vec::new())
            .await
            .unwrap_err()
            .to_string();
         assert!(error.contains("the agent needs an API key"), "{error}");
         assert!(bridge.get_status().await.is_empty());

         let process = sink
            .wait_for_named("acp-traffic", |event| event["type"] == "process")
            .await;
         assert_eq!(process["process"]["agentId"], AGENT);
         let entries = sink
            .wait_for_named("acp-traffic", |event| {
               event["type"] == "entries" && event.to_string().contains("needs an API key")
            })
            .await;
         assert_eq!(entries["processKey"], process["process"]["processKey"]);
         bridge.stop_agent(None, None).await.unwrap();
      });

   assert!(
      sink
         .emitted()
         .iter()
         .all(|(name, _)| name == "acp-event" || name == "acp-traffic")
   );
}
