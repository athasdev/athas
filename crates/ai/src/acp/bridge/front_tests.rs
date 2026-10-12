//! `AcpAgentBridge`'s public API against a stand-in worker: what each call sends to the worker
//! thread, how its answer comes back, and what is decided before anything is sent.

use super::*;
use crate::acp::client::PendingEntry;
use serde_json::json;
use tempfile::TempDir;

const AGENT: &str = "fake-agent";

fn bridge() -> (AcpAgentBridge, mpsc::Receiver<AcpCommand>) {
   let (command_tx, command_rx) = mpsc::channel(8);
   let mut registry = AgentRegistry::empty();
   registry.replace_agents(vec![AgentConfig::new(
      AGENT,
      "Fake Agent",
      "athas-fake-agent-binary-that-is-not-installed",
   )]);
   let bridge = AcpAgentBridge {
      registry,
      command_tx,
      status: Arc::default(),
      responders: Arc::default(),
      terminal_manager: Arc::new(TerminalManager::new()),
      traffic: TrafficInspector::default(),
   };
   (bridge, command_rx)
}

/// Runs `call` while the stand-in worker hands the one command it receives to `worker`.
async fn with_worker<T>(
   call: impl Future<Output = Result<T>>,
   commands: &mut mpsc::Receiver<AcpCommand>,
   worker: impl FnOnce(AcpCommand),
) -> Result<T> {
   let (result, ()) = tokio::join!(call, async {
      worker(commands.recv().await.expect("a command for the worker"));
   });
   result
}

fn workspace() -> (TempDir, String) {
   let dir = tempfile::tempdir().unwrap();
   let path = dir.path().to_string_lossy().into_owned();
   (dir, path)
}

fn opened(session_id: &str) -> AcpOpenedSession {
   AcpOpenedSession {
      session_id: session_id.to_string(),
      status: AcpAgentStatus::default(),
      context_lost: false,
      history: Vec::new(),
   }
}

#[tokio::test]
async fn open_session_sends_the_chats_target_to_the_worker() {
   let (bridge, mut commands) = bridge();
   let (_dir, workspace_path) = workspace();
   let cases = [
      (None, false, SessionTarget::New),
      (
         Some("s1".to_string()),
         false,
         SessionTarget::Reattach("s1".to_string()),
      ),
      (
         Some("s2".to_string()),
         true,
         SessionTarget::Import("s2".to_string()),
      ),
   ];

   for (session_id, import, expected) in cases {
      let expected_path = workspace_path.clone();
      let session = with_worker(
         bridge.open_session(
            AGENT,
            Some(workspace_path.clone()),
            session_id,
            import,
            Some("login".to_string()),
            Vec::new(),
            vec!["/extra".to_string()],
         ),
         &mut commands,
         move |command| match command {
            AcpCommand::OpenSession {
               agent_id,
               workspace_path,
               config,
               request,
               ..
            } => {
               assert_eq!(agent_id, AGENT);
               assert_eq!(workspace_path, Some(expected_path));
               assert_eq!(config.id, AGENT);
               assert_eq!(request.target, expected);
               assert_eq!(request.auth_method_id.as_deref(), Some("login"));
               assert_eq!(request.additional_directories, vec!["/extra"]);
               let _ = request.response_tx.send(Ok(opened("opened")));
            }
            _ => panic!("expected OpenSession"),
         },
      )
      .await
      .unwrap();
      assert_eq!(session.session_id, "opened");
   }
}

#[tokio::test]
async fn open_and_start_fail_early_for_unknown_agents_and_imports_without_a_session() {
   let (bridge, mut commands) = bridge();

   let error = bridge
      .open_session("unknown", None, None, false, None, Vec::new(), Vec::new())
      .await
      .unwrap_err();
   assert_eq!(error.to_string(), "Agent not found");
   let error = bridge
      .open_session(AGENT, None, None, true, None, Vec::new(), Vec::new())
      .await
      .unwrap_err();
   assert_eq!(error.to_string(), "Choose an agent session to import");
   let error = bridge.start_agent("unknown", None).await.unwrap_err();
   assert_eq!(error.to_string(), "Agent not found");

   assert!(
      commands.try_recv().is_err(),
      "nothing reaches the worker when the request cannot be served"
   );
}

#[tokio::test]
async fn start_agent_reports_the_workers_answer() {
   let (bridge, mut commands) = bridge();

   with_worker(bridge.start_agent(AGENT, None), &mut commands, |command| {
      let AcpCommand::StartAgent {
         agent_id,
         workspace_path,
         config,
         response_tx,
         ..
      } = command
      else {
         panic!("expected StartAgent");
      };
      assert_eq!((agent_id.as_str(), workspace_path), (AGENT, None));
      assert_eq!(config.name, "Fake Agent");
      let _ = response_tx.send(Ok(()));
   })
   .await
   .unwrap();

   let error = with_worker(bridge.start_agent(AGENT, None), &mut commands, |command| {
      let AcpCommand::StartAgent { response_tx, .. } = command else {
         panic!("expected StartAgent");
      };
      let _ = response_tx.send(Err(anyhow::anyhow!("spawn failed")));
   })
   .await
   .unwrap_err();
   assert_eq!(error.to_string(), "spawn failed");
}

#[tokio::test]
async fn session_commands_reach_the_worker_with_their_arguments() {
   let (bridge, mut commands) = bridge();

   with_worker(
      bridge.send_prompt("s1".into(), vec![json!({ "type": "text", "text": "hi" })]),
      &mut commands,
      |command| {
         let AcpCommand::SendPrompt {
            session_id,
            prompt,
            response_tx,
         } = command
         else {
            panic!("expected SendPrompt");
         };
         assert_eq!(session_id, "s1");
         assert_eq!(prompt[0]["text"], "hi");
         let _ = response_tx.send(Ok(()));
      },
   )
   .await
   .unwrap();

   with_worker(
      bridge.set_session_mode("s1".into(), "plan".into()),
      &mut commands,
      |command| {
         let AcpCommand::SetMode {
            session_id,
            mode_id,
            response_tx,
         } = command
         else {
            panic!("expected SetMode");
         };
         assert_eq!((session_id.as_str(), mode_id.as_str()), ("s1", "plan"));
         let _ = response_tx.send(Err(anyhow::anyhow!("mode not found")));
      },
   )
   .await
   .unwrap_err();

   with_worker(
      bridge.set_session_config_option(
         "s1".into(),
         "streaming".into(),
         SessionConfigValue::Boolean(false),
      ),
      &mut commands,
      |command| {
         let AcpCommand::SetConfigOption {
            session_id,
            config_id,
            value,
            response_tx,
         } = command
         else {
            panic!("expected SetConfigOption");
         };
         assert_eq!(session_id, "s1");
         assert_eq!(config_id, "streaming");
         assert_eq!(value, SessionConfigValue::Boolean(false));
         let _ = response_tx.send(Ok(()));
      },
   )
   .await
   .unwrap();

   with_worker(
      bridge.close_session("s1".into()),
      &mut commands,
      |command| {
         let AcpCommand::CloseSession {
            session_id,
            response_tx,
         } = command
         else {
            panic!("expected CloseSession");
         };
         assert_eq!(session_id, "s1");
         let _ = response_tx.send(Ok(()));
      },
   )
   .await
   .unwrap();
}

#[tokio::test]
async fn agent_commands_carry_the_resolved_connection_key() {
   let (bridge, mut commands) = bridge();
   let (dir, workspace_path) = workspace();
   let expected_key = ConnectionKey::new(AGENT.to_string(), Some(dir.path().to_path_buf()));
   let workspace = || Some(workspace_path.clone());

   let key = expected_key.clone();
   let list = with_worker(
      bridge.list_sessions(
         AGENT.into(),
         workspace(),
         Some("/work".into()),
         Some("page-2".into()),
      ),
      &mut commands,
      move |command| {
         let AcpCommand::ListSessions {
            key: sent,
            cwd,
            cursor,
            response_tx,
         } = command
         else {
            panic!("expected ListSessions");
         };
         assert_eq!(sent, key);
         assert_eq!(cwd.as_deref(), Some("/work"));
         assert_eq!(cursor.as_deref(), Some("page-2"));
         let _ = response_tx.send(Ok(AcpSessionList {
            sessions: Vec::new(),
            next_cursor: Some("page-3".into()),
         }));
      },
   )
   .await
   .unwrap();
   assert_eq!(list.next_cursor.as_deref(), Some("page-3"));

   let key = expected_key.clone();
   with_worker(
      bridge.delete_session(AGENT.into(), workspace(), "s9".into()),
      &mut commands,
      move |command| {
         let AcpCommand::DeleteSession {
            key: sent,
            session_id,
            response_tx,
         } = command
         else {
            panic!("expected DeleteSession");
         };
         assert_eq!(sent, key);
         assert_eq!(session_id, "s9");
         let _ = response_tx.send(Ok(()));
      },
   )
   .await
   .unwrap();

   let key = expected_key.clone();
   with_worker(
      bridge.logout(AGENT.into(), workspace()),
      &mut commands,
      move |command| {
         let AcpCommand::Logout {
            key: sent,
            response_tx,
         } = command
         else {
            panic!("expected Logout");
         };
         assert_eq!(sent, key);
         let _ = response_tx.send(Ok(()));
      },
   )
   .await
   .unwrap();

   let key = expected_key.clone();
   with_worker(
      bridge.authenticate(AGENT.into(), workspace(), "api-key".into()),
      &mut commands,
      move |command| {
         let AcpCommand::Authenticate {
            key: sent,
            method_id,
            response_tx,
         } = command
         else {
            panic!("expected Authenticate");
         };
         assert_eq!(sent, key);
         assert_eq!(method_id, "api-key");
         let _ = response_tx.send(Ok(()));
      },
   )
   .await
   .unwrap();

   let key = expected_key.clone();
   with_worker(
      bridge.cancel_prompt(Some("s1".into()), Some(AGENT.into()), workspace()),
      &mut commands,
      move |command| {
         let AcpCommand::CancelPrompt {
            session_id,
            key: sent,
            response_tx,
         } = command
         else {
            panic!("expected CancelPrompt");
         };
         assert_eq!(session_id.as_deref(), Some("s1"));
         assert_eq!(sent, Some(key));
         let _ = response_tx.send(Ok(()));
      },
   )
   .await
   .unwrap();

   for (agent_id, expected) in [(Some(AGENT.to_string()), Some(expected_key)), (None, None)] {
      with_worker(
         bridge.stop_agent(agent_id, workspace()),
         &mut commands,
         move |command| {
            let AcpCommand::Stop {
               key: sent,
               response_tx,
            } = command
            else {
               panic!("expected Stop");
            };
            assert_eq!(sent, expected);
            let _ = response_tx.send(Ok(()));
         },
      )
      .await
      .unwrap();
   }
}

#[tokio::test]
async fn invalid_workspaces_are_rejected_before_reaching_the_worker() {
   let (bridge, mut commands) = bridge();
   let missing = || Some("/definitely/not/a/workspace/athas".to_string());

   let errors = [
      bridge
         .list_sessions(AGENT.into(), missing(), None, None)
         .await
         .map(drop)
         .unwrap_err(),
      bridge
         .delete_session(AGENT.into(), missing(), "s".into())
         .await
         .unwrap_err(),
      bridge.logout(AGENT.into(), missing()).await.unwrap_err(),
      bridge
         .authenticate(AGENT.into(), missing(), "m".into())
         .await
         .unwrap_err(),
      bridge
         .cancel_prompt(None, Some(AGENT.into()), missing())
         .await
         .unwrap_err(),
      bridge
         .stop_agent(Some(AGENT.into()), missing())
         .await
         .unwrap_err(),
   ];
   for error in errors {
      assert!(
         error
            .to_string()
            .starts_with("Workspace path does not exist"),
         "{error}"
      );
   }
   assert!(commands.try_recv().is_err());
}

#[tokio::test]
async fn reports_a_worker_that_is_gone_or_never_answers() {
   let (bridge, mut commands) = bridge();

   let error = with_worker(bridge.close_session("s1".into()), &mut commands, drop)
      .await
      .unwrap_err();
   assert_eq!(error.to_string(), "Worker disconnected");

   drop(commands);
   let error = bridge.close_session("s1".into()).await.unwrap_err();
   assert_eq!(error.to_string(), "Failed to send command to ACP worker");
}

#[tokio::test]
async fn status_is_the_workers_last_snapshot() {
   let (bridge, _commands) = bridge();
   assert!(bridge.get_status().await.is_empty());

   *bridge.status.lock().await = vec![AcpAgentStatus {
      agent_id: AGENT.to_string(),
      running: true,
      session_ids: vec!["s1".to_string()],
      ..AcpAgentStatus::default()
   }];

   let status = bridge.get_status().await;
   assert_eq!(status.len(), 1);
   assert_eq!(status[0].session_ids, vec!["s1"]);
}

#[tokio::test]
async fn delivers_user_answers_to_the_agent_waiting_for_them() {
   let (bridge, _commands) = bridge();
   let responders = ClientResponders {
      permissions: Arc::default(),
      elicitations: Arc::default(),
      buffer_reads: Arc::default(),
   };
   let (permission_tx, permission_rx) = oneshot::channel();
   responders.permissions.lock().unwrap().insert(
      "perm-1".to_string(),
      PendingEntry::new(Some("s1".to_string()), permission_tx),
   );
   let (elicitation_tx, elicitation_rx) = oneshot::channel();
   responders
      .elicitations
      .lock()
      .unwrap()
      .insert("ask-1".to_string(), PendingEntry::new(None, elicitation_tx));
   lock_responders(&bridge.responders).insert(
      1,
      ClientResponders {
         permissions: Arc::default(),
         elicitations: Arc::default(),
         buffer_reads: Arc::default(),
      },
   );
   lock_responders(&bridge.responders).insert(2, responders.clone());

   bridge
      .respond_to_permission("unknown".into(), true, false, None)
      .await
      .unwrap();
   bridge
      .respond_to_permission("perm-1".into(), true, false, Some("allow-always".into()))
      .await
      .unwrap();
   let permission = permission_rx.await.unwrap();
   assert!(permission.approved && !permission.cancelled);
   assert_eq!(permission.option_id.as_deref(), Some("allow-always"));
   assert!(!responders.has_permission("perm-1"));

   bridge
      .respond_to_elicitation("ask-1".into(), json!({ "action": "decline" }))
      .await
      .unwrap();
   assert_eq!(
      elicitation_rx.await.unwrap(),
      json!({ "action": "decline" })
   );
   let error = bridge
      .respond_to_elicitation("ask-1".into(), json!({ "action": "accept" }))
      .await
      .unwrap_err();
   assert_eq!(
      error.to_string(),
      "The agent is no longer waiting for this answer"
   );

   bridge
      .respond_to_buffer_read("nobody-waits".into(), Some("text".into()))
      .await;
}

#[test]
fn lists_registered_agents_and_their_install_state() {
   let (mut bridge, _commands) = bridge();

   let agents = bridge.detect_agents();
   assert_eq!(agents.len(), 1);
   assert_eq!(agents[0].id, AGENT);
   assert!(!agents[0].installed);
   assert!(agents[0].binary_path.is_none());

   bridge.invalidate_agent_detection_cache();
   assert_eq!(bridge.redetect_agents().len(), 1);

   bridge.replace_registered_agents(vec![
      AgentConfig::new("b-agent", "B Agent", "athas-missing-b"),
      AgentConfig::new("a-agent", "A Agent", "athas-missing-a"),
   ]);
   assert_eq!(
      bridge
         .detect_agents()
         .iter()
         .map(|agent| agent.id.as_str())
         .collect::<Vec<_>>(),
      vec!["a-agent", "b-agent"],
      "agents are listed by name"
   );
   let _ = bridge.traffic();
}
