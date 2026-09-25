use super::{
   auth::{ACP_AUTHENTICATE_TIMEOUT, authenticate_method, automatic_auth_method},
   bridge_commands::{AcpCommand, OpenRequest, WorkerFollowUp, run_worker_loop},
   bridge_init::{ConnectionHandle, StartedConnection},
   bridge_prompt::{PromptAuth, run_prompt},
   client::{AthasAcpClient, ClientResponders, PermissionResponse},
   config::AgentRegistry,
   mcp_servers::{AcpSkippedMcpServer, McpServerConfig},
   process::{stop_child_tree, terminate_process_group},
   sessions::{ConnectionKey, SessionRegistry, is_idle},
   types::{
      AcpAgentStatus, AcpEvent, AcpOpenedSession, AcpSessionInfo, AcpSessionList, AgentConfig,
      SessionConfigOption, SessionConfigValue,
   },
   workspace_path::{path_to_string, resolve_workspace_path},
};
use crate::runtime::AthasAppHandle as AppHandle;
use agent_client_protocol::schema::v1 as acp;
use anyhow::{Context, Result, bail};
use athas_terminal::TerminalManager;
use std::{
   cell::RefCell,
   collections::{HashMap, HashSet},
   rc::Rc,
   sync::{Arc, Mutex as StdMutex},
   thread,
   time::{Duration, Instant},
};
use tauri::Emitter;
use tokio::{
   process::Child,
   runtime::Runtime,
   sync::{Mutex, mpsc, oneshot},
   task::LocalSet,
};

/// How long session requests such as `session/set_mode` or `session/list` may
/// take before the user gets an error instead of a hung control.
const ACP_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// `session/close` is a courtesy while a session or agent goes away, so it gets a short budget.
const ACP_SESSION_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

/// Awaits an agent request, turning an agent error or a missing reply within
/// `timeout` into an error that names the action.
pub(super) async fn with_request_timeout<T, E: std::fmt::Display>(
   action: &str,
   timeout: Duration,
   request: impl Future<Output = std::result::Result<T, E>>,
) -> Result<T> {
   match tokio::time::timeout(timeout, request).await {
      Ok(Ok(response)) => Ok(response),
      Ok(Err(error)) => bail!("Failed to {action}: {error}"),
      Err(_) => bail!(
         "Failed to {action}: the agent did not respond within {} seconds",
         timeout.as_secs()
      ),
   }
}

pub(super) fn map_config_options(
   options: Vec<acp::SessionConfigOption>,
) -> Vec<SessionConfigOption> {
   options
      .into_iter()
      .filter_map(AthasAcpClient::map_session_config_option)
      .collect()
}

/// Where the bridge finds the requests each running agent waits on the user for. Request ids
/// are unique across agents, so an answer goes to whichever agent is waiting for it.
pub(super) type ResponderRegistry = Arc<StdMutex<HashMap<u64, ClientResponders>>>;

fn lock_responders(
   registry: &ResponderRegistry,
) -> std::sync::MutexGuard<'_, HashMap<u64, ClientResponders>> {
   registry
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Resolves the agent and workspace a request names into the key of the process serving them.
pub(super) fn connection_key(
   agent_id: String,
   workspace_path: Option<String>,
) -> Result<ConnectionKey> {
   Ok(ConnectionKey {
      agent_id,
      workspace_path: resolve_workspace_path(workspace_path)?,
   })
}

/// Why an agent process is being shut down.
pub(super) enum Shutdown {
   /// The user stopped or restarted the agent, or the app is quitting.
   Requested,
   /// Nothing used it for a while.
   Idle,
   /// Its first session could not be opened, so nothing uses it.
   Unused,
   /// The process exited on its own.
   Exited(String),
}

/// One running agent process and the sessions chats hold on it.
pub(super) struct AgentConnection {
   key: ConnectionKey,
   handle: ConnectionHandle,
   process: Option<Child>,
   process_group_id: Option<u32>,
   io_handle: Option<tokio::task::JoinHandle<()>>,
   responders: ClientResponders,
   skipped_mcp_servers: Vec<AcpSkippedMcpServer>,
   last_activity: Instant,
   /// Session opens still waiting on the agent.
   pending_opens: usize,
}

impl AgentConnection {
   fn touch(&mut self) {
      self.last_activity = Instant::now();
   }

   fn supports_session_capability(&self, capability: &str) -> bool {
      self
         .handle
         .agent_capabilities
         .session_capabilities
         .get(capability)
         .is_some_and(|value| !value.is_null())
   }

   fn can_reattach_sessions(&self) -> bool {
      self.handle.agent_capabilities.load_session || self.handle.supports_session_resume
   }

   fn supports_logout(&self) -> bool {
      self
         .handle
         .agent_capabilities
         .auth_capabilities
         .get("logout")
         .is_some_and(|value| !value.is_null())
   }

   /// What the frontend sees once the agent stopped: which agent, and which sessions it had.
   fn stopped_status(&self, session_ids: Vec<String>) -> AcpAgentStatus {
      AcpAgentStatus {
         agent_id: self.key.agent_id.clone(),
         workspace_path: self.key.workspace_path.as_deref().map(path_to_string),
         session_ids,
         ..AcpAgentStatus::default()
      }
   }
}

impl Drop for AgentConnection {
   fn drop(&mut self) {
      if let Some(handle) = self.io_handle.take() {
         handle.abort();
      }
      if let Some(mut process) = self.process.take() {
         terminate_process_group(self.process_group_id.take());
         let _ = process.start_kill();
      }
   }
}

/// Worker state running on the LocalSet thread: every running agent process, keyed by id, and
/// the sessions open on them.
pub(super) struct AcpWorker {
   app_handle: AppHandle,
   connections: HashMap<u64, AgentConnection>,
   next_connection_id: u64,
   sessions: SessionRegistry,
   /// Session opens in flight, by connection and requested session, so a second open of the
   /// same session waits for the first instead of loading it twice.
   pending_session_opens: HashMap<(u64, String), Vec<oneshot::Sender<Result<AcpOpenedSession>>>>,
   /// Agents the user logged out of. Athas does not sign them back in on its own; the user
   /// chooses a method again. Kept across restarts until a sign-in succeeds.
   logged_out_agents: Rc<RefCell<HashSet<String>>>,
   responders: ResponderRegistry,
   followup_tx: mpsc::UnboundedSender<WorkerFollowUp>,
}

impl AcpWorker {
   pub(super) fn new(
      app_handle: AppHandle,
      responders: ResponderRegistry,
      followup_tx: mpsc::UnboundedSender<WorkerFollowUp>,
   ) -> Self {
      Self {
         app_handle,
         connections: HashMap::new(),
         next_connection_id: 0,
         sessions: SessionRegistry::default(),
         pending_session_opens: HashMap::new(),
         logged_out_agents: Rc::default(),
         responders,
         followup_tx,
      }
   }

   pub(super) fn app_handle(&self) -> AppHandle {
      self.app_handle.clone()
   }

   fn emit(&self, event: AcpEvent) {
      if let Err(error) = self.app_handle.emit("acp-event", event) {
         log::warn!("Failed to emit ACP event: {}", error);
      }
   }

   fn emit_status(&self, connection_id: u64) {
      if let Some(status) = self.status_of(connection_id) {
         self.emit(AcpEvent::StatusChanged {
            status,
            error: None,
         });
      }
   }

   pub(super) fn connection_by_key(&self, key: &ConnectionKey) -> Option<u64> {
      self
         .connections
         .iter()
         .find(|(_, connection)| &connection.key == key)
         .map(|(id, _)| *id)
   }

   fn connection_for_key(&self, key: &ConnectionKey) -> Result<&AgentConnection> {
      self
         .connection_by_key(key)
         .and_then(|id| self.connections.get(&id))
         .context("The agent is not running")
   }

   fn connection_for_session(&self, session_id: &str) -> Result<(u64, &AgentConnection)> {
      self
         .sessions
         .connection_of(session_id)
         .and_then(|id| self.connections.get(&id).map(|connection| (id, connection)))
         .with_context(|| format!("The agent session {session_id} is not open"))
   }

   pub(super) fn status_of(&self, connection_id: u64) -> Option<AcpAgentStatus> {
      let connection = self.connections.get(&connection_id)?;
      Some(AcpAgentStatus {
         agent_id: connection.key.agent_id.clone(),
         running: true,
         initialized: true,
         workspace_path: connection.key.workspace_path.as_deref().map(path_to_string),
         agent_capabilities: Some(connection.handle.agent_capabilities.clone()),
         auth_methods: connection.handle.described_auth_methods.clone(),
         skipped_mcp_servers: connection.skipped_mcp_servers.clone(),
         session_ids: self.sessions.sessions_of(connection_id),
      })
   }

   pub(super) fn statuses(&self) -> Vec<AcpAgentStatus> {
      let mut ids: Vec<u64> = self.connections.keys().copied().collect();
      ids.sort_unstable();
      ids.into_iter()
         .filter_map(|id| self.status_of(id))
         .collect()
   }

   /// Takes over an agent that finished starting and returns its id.
   pub(super) fn adopt(&mut self, key: ConnectionKey, started: StartedConnection) -> u64 {
      self.next_connection_id += 1;
      let id = self.next_connection_id;
      lock_responders(&self.responders).insert(id, started.responders.clone());
      self.connections.insert(
         id,
         AgentConnection {
            key,
            handle: started.handle,
            process: Some(started.process),
            process_group_id: started.process_group_id,
            io_handle: Some(started.io_handle),
            responders: started.responders,
            skipped_mcp_servers: Vec::new(),
            last_activity: Instant::now(),
            pending_opens: 0,
         },
      );
      self.emit_status(id);
      id
   }

   /// Opens the chat's session on a running agent, or answers right away when it is open there.
   pub(super) fn open_session_on(&mut self, connection_id: u64, request: OpenRequest) {
      let Some(connection) = self.connections.get_mut(&connection_id) else {
         let _ = request.response_tx.send(Err(anyhow::anyhow!(
            "The agent stopped before the session opened"
         )));
         return;
      };
      connection.touch();

      if let Some(session_id) = request.session_id.as_deref() {
         if self.sessions.is_open_on(session_id, connection_id) {
            let status = self.status_of(connection_id).unwrap_or_default();
            let _ = request.response_tx.send(Ok(AcpOpenedSession {
               session_id: session_id.to_string(),
               status,
            }));
            return;
         }
         let pending_key = (connection_id, session_id.to_string());
         if let Some(waiters) = self.pending_session_opens.get_mut(&pending_key) {
            waiters.push(request.response_tx);
            return;
         }
         self.pending_session_opens.insert(pending_key, Vec::new());
      }

      let Some(connection) = self.connections.get_mut(&connection_id) else {
         return;
      };
      connection.pending_opens += 1;
      let handle = connection.handle.clone();
      let startup_auth = super::bridge_init::StartupAuth {
         allow_automatic: !self
            .logged_out_agents
            .borrow()
            .contains(&connection.key.agent_id),
         chosen_method_id: request.auth_method_id.clone(),
      };
      let signed_in_with_choice = request.auth_method_id.is_some();
      let followup_tx = self.followup_tx.clone();
      tokio::task::spawn_local(async move {
         let result = super::bridge_init::open_session(
            handle,
            request.session_id.clone(),
            startup_auth,
            request.mcp_servers,
            map_config_options,
         )
         .await;
         let _ = followup_tx.send(WorkerFollowUp::SessionOpened {
            connection_id,
            requested_session_id: request.session_id,
            signed_in_with_choice,
            result,
            response_tx: request.response_tx,
         });
      });
   }

   /// A session open finished on the agent: record the session and answer every chat waiting
   /// for it. An agent whose first session failed to open is shut down, since nothing uses it.
   pub(super) fn finish_session_open(
      &mut self,
      connection_id: u64,
      requested_session_id: Option<String>,
      signed_in_with_choice: bool,
      result: Result<super::bridge_init::OpenedSession>,
      response_tx: oneshot::Sender<Result<AcpOpenedSession>>,
   ) {
      let waiters = requested_session_id
         .and_then(|session_id| {
            self
               .pending_session_opens
               .remove(&(connection_id, session_id))
         })
         .unwrap_or_default();
      let Some(connection) = self.connections.get_mut(&connection_id) else {
         let error = "The agent stopped before the session opened";
         let _ = response_tx.send(Err(anyhow::anyhow!(error)));
         for waiter in waiters {
            let _ = waiter.send(Err(anyhow::anyhow!(error)));
         }
         return;
      };
      connection.pending_opens = connection.pending_opens.saturating_sub(1);
      connection.touch();

      match result {
         Ok(opened) => {
            let session_id = opened.session_id.to_string();
            connection.skipped_mcp_servers = opened.skipped_mcp_servers;
            if signed_in_with_choice {
               let agent_id = connection.key.agent_id.clone();
               self.logged_out_agents.borrow_mut().remove(&agent_id);
            }
            if let Some(previous) = self.sessions.attach(&session_id, connection_id) {
               // The session was open on another process of the same agent; that one lets go.
               self.release_session_on(previous, &session_id);
               self.emit_status(previous);
            }
            let status = self.status_of(connection_id).unwrap_or_default();
            self.emit(AcpEvent::StatusChanged {
               status: status.clone(),
               error: None,
            });
            for tx in std::iter::once(response_tx).chain(waiters) {
               let _ = tx.send(Ok(AcpOpenedSession {
                  session_id: session_id.clone(),
                  status: status.clone(),
               }));
            }
         }
         Err(error) => {
            let message = error.to_string();
            let _ = response_tx.send(Err(error));
            for waiter in waiters {
               let _ = waiter.send(Err(anyhow::anyhow!(message.clone())));
            }
            let unused =
               connection.pending_opens == 0 && self.sessions.sessions_of(connection_id).is_empty();
            if unused {
               tokio::task::spawn_local(self.shut_down(connection_id, Shutdown::Unused));
            }
         }
      }
   }

   /// Frees what `session_id` held on `connection_id`: requests waiting on the user, terminals,
   /// folder grants.
   fn release_session_on(&self, connection_id: u64, session_id: &str) {
      let Some(connection) = self.connections.get(&connection_id) else {
         return;
      };
      for request_id in connection.responders.cancel_session(session_id) {
         self.emit(AcpEvent::RequestClosed { request_id });
      }
      let client = connection.handle.client.clone();
      let session_id = session_id.to_string();
      tokio::task::spawn_local(async move {
         client.release_session(Some(&session_id)).await;
      });
   }

   pub(super) fn send_prompt(
      &mut self,
      session_id: String,
      prompt: Vec<serde_json::Value>,
   ) -> Result<()> {
      let connection_id = self.sessions.begin_prompt(&session_id)?;
      let Some(connection) = self.connections.get_mut(&connection_id) else {
         self.sessions.end_prompt(&session_id);
         bail!("The agent is not running");
      };
      connection.touch();

      let handle = connection.handle.clone();
      let agent_id = connection.key.agent_id.clone();
      let auth = PromptAuth {
         automatic_method_id: if self.allows_automatic_auth(&agent_id) {
            automatic_auth_method(&handle.auth_methods)
         } else {
            None
         },
         agent_id,
         methods: handle.described_auth_methods.clone(),
      };
      let followup_tx = self.followup_tx.clone();

      tokio::task::spawn_local(async move {
         handle.client.set_session_id(session_id.clone()).await;
         let acp_session_id = acp::SessionId::new(session_id.clone());
         if let Err(err) = run_prompt(
            handle.connection.clone(),
            acp_session_id,
            handle.app_handle.clone(),
            prompt,
            auth,
         )
         .await
         {
            log::error!("Failed to run ACP prompt: {}", err);
            let _ = handle.app_handle.emit(
               "acp-event",
               AcpEvent::Error {
                  session_id: Some(session_id.clone()),
                  error: format!("Failed to run prompt: {}", err),
               },
            );
         }
         let _ = followup_tx.send(WorkerFollowUp::PromptFinished { session_id });
      });

      Ok(())
   }

   pub(super) fn is_session_open(&self, session_id: &str) -> bool {
      self.sessions.connection_of(session_id).is_some()
   }

   pub(super) fn finish_prompt(&mut self, session_id: &str) {
      self.sessions.end_prompt(session_id);
      if let Some(connection) = self
         .sessions
         .connection_of(session_id)
         .and_then(|id| self.connections.get_mut(&id))
      {
         connection.touch();
      }
   }

   /// Sends `session/cancel` for the session's turn and answers what the turn left waiting on the
   /// user as cancelled, as ACP requires. Other sessions on the agent keep running. A session
   /// that is not open has nothing to cancel.
   pub(super) fn cancel_prompt(&mut self, session_id: &str) -> Result<()> {
      let Some(connection_id) = self.sessions.connection_of(session_id) else {
         return Ok(());
      };
      let Some(connection) = self.connections.get_mut(&connection_id) else {
         return Ok(());
      };
      connection.touch();
      connection
         .handle
         .connection
         .send_notification(acp::CancelNotification::new(session_id.to_string()))
         .context("Failed to cancel prompt")?;
      for request_id in connection.responders.cancel_session(session_id) {
         self.emit(AcpEvent::RequestClosed { request_id });
      }
      Ok(())
   }

   /// Returns the `session/set_mode` request. The worker loop runs it in the background so a
   /// slow agent cannot hold up Cancel or Stop.
   pub(super) fn set_mode(
      &mut self,
      session_id: String,
      mode_id: String,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      let (_, connection) = self.connection_for_session(&session_id)?;
      let connection = connection.handle.connection.clone();
      let request = acp::SetSessionModeRequest::new(session_id, mode_id);

      Ok(async move {
         with_request_timeout(
            "set session mode",
            ACP_REQUEST_TIMEOUT,
            connection.send_request(request).block_task(),
         )
         .await?;
         Ok(())
      })
   }

   pub(super) fn set_config_option(
      &mut self,
      session_id: String,
      config_id: String,
      value: SessionConfigValue,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      let (_, connection) = self.connection_for_session(&session_id)?;
      let connection = connection.handle.connection.clone();
      let app_handle = self.app_handle.clone();

      let value = match value {
         SessionConfigValue::String(value) => acp::SessionConfigOptionValue::value_id(value),
         SessionConfigValue::Boolean(value) => acp::SessionConfigOptionValue::boolean(value),
      };
      let request = acp::SetSessionConfigOptionRequest::new(session_id.clone(), config_id, value);

      Ok(async move {
         let response = with_request_timeout(
            "set session config option",
            ACP_REQUEST_TIMEOUT,
            connection.send_request(request).block_task(),
         )
         .await?;
         let config_options = map_config_options(response.config_options);

         let _ = app_handle.emit(
            "acp-event",
            AcpEvent::ConfigOptionsUpdate {
               session_id,
               config_options,
            },
         );

         Ok(())
      })
   }

   /// A chat let go of its session (it was deleted). The session is forgotten and, when the agent
   /// supports it, closed with `session/close`; the agent keeps running for other chats.
   pub(super) fn close_session(&mut self, session_id: &str) {
      let Some(connection_id) = self.sessions.connection_of(session_id) else {
         return;
      };
      self.release_session_on(connection_id, session_id);
      self.sessions.detach(session_id);
      let Some(connection) = self.connections.get_mut(&connection_id) else {
         return;
      };
      connection.touch();
      if connection.supports_session_capability("close") {
         let request = connection
            .handle
            .connection
            .send_request(acp::CloseSessionRequest::new(session_id.to_string()));
         tokio::task::spawn_local(async move {
            if let Err(error) = with_request_timeout(
               "close ACP session",
               ACP_SESSION_CLOSE_TIMEOUT,
               request.block_task(),
            )
            .await
            {
               log::warn!("{}", error);
            }
         });
      }
      self.emit_status(connection_id);
   }

   pub(super) fn list_sessions(
      &mut self,
      key: &ConnectionKey,
      cwd: Option<String>,
      cursor: Option<String>,
   ) -> Result<impl Future<Output = Result<AcpSessionList>> + use<>> {
      let connection = self.connection_for_key(key)?;
      if !connection.supports_session_capability("list") {
         bail!("ACP agent does not support session/list");
      }

      let connection = connection.handle.connection.clone();
      let mut request = acp::ListSessionsRequest::new();
      if let Some(cwd) = cwd {
         let cwd = resolve_workspace_path(Some(cwd))?
            .context("Workspace path is required to list ACP sessions by cwd")?;
         request = request.cwd(cwd);
      }
      if let Some(cursor) = cursor {
         request = request.cursor(cursor);
      }

      Ok(async move {
         let response = with_request_timeout(
            "list ACP sessions",
            ACP_REQUEST_TIMEOUT,
            connection.send_request(request).block_task(),
         )
         .await?;

         Ok(AcpSessionList {
            sessions: response
               .sessions
               .into_iter()
               .map(|session| AcpSessionInfo {
                  session_id: session.session_id.to_string(),
                  cwd: session.cwd.to_string_lossy().to_string(),
                  title: session.title,
                  updated_at: session.updated_at,
                  meta: session.meta.map(serde_json::Value::Object),
               })
               .collect(),
            next_cursor: response.next_cursor,
         })
      })
   }

   /// Returns the `session/delete` request. Once it succeeds the worker loop
   /// calls [`Self::forget_session`] to drop the session if it was open.
   pub(super) fn delete_session(
      &mut self,
      key: &ConnectionKey,
      session_id: String,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      let connection = self.connection_for_key(key)?;
      if !connection.supports_session_capability("delete") {
         bail!("ACP agent does not support session/delete");
      }

      let connection = connection.handle.connection.clone();
      let request = acp::DeleteSessionRequest::new(session_id);

      Ok(async move {
         with_request_timeout(
            "delete ACP session",
            ACP_REQUEST_TIMEOUT,
            connection.send_request(request).block_task(),
         )
         .await?;
         Ok(())
      })
   }

   /// Drops a session the agent deleted.
   pub(super) fn forget_session(&mut self, session_id: &str) {
      let Some(connection_id) = self.sessions.connection_of(session_id) else {
         return;
      };
      self.release_session_on(connection_id, session_id);
      self.sessions.detach(session_id);
      self.emit(AcpEvent::SessionComplete {
         session_id: session_id.to_string(),
      });
      self.emit_status(connection_id);
   }

   pub(super) fn logout(
      &mut self,
      key: &ConnectionKey,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      let connection = self.connection_for_key(key)?;
      if !connection.supports_logout() {
         bail!("ACP agent does not support logout");
      }

      let agent_id = connection.key.agent_id.clone();
      let connection = connection.handle.connection.clone();
      let logged_out_agents = self.logged_out_agents.clone();

      Ok(async move {
         with_request_timeout(
            "log out ACP agent",
            ACP_REQUEST_TIMEOUT,
            connection
               .send_request(acp::LogoutRequest::new())
               .block_task(),
         )
         .await?;
         logged_out_agents.borrow_mut().insert(agent_id);
         Ok(())
      })
   }

   /// Signs in to the running agent with a method the user picked. Only methods completed by
   /// `authenticate` are accepted; terminal methods are run by the user and followed by a
   /// restart instead.
   pub(super) fn authenticate(
      &mut self,
      key: &ConnectionKey,
      method_id: String,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      let connection = self.connection_for_key(key)?;
      let method_id = authenticate_method(&connection.handle.auth_methods, &method_id)?;
      let agent_id = connection.key.agent_id.clone();
      let connection = connection.handle.connection.clone();
      let logged_out_agents = self.logged_out_agents.clone();

      Ok(async move {
         with_request_timeout(
            "sign in to the agent",
            ACP_AUTHENTICATE_TIMEOUT,
            connection
               .send_request(acp::AuthenticateRequest::new(method_id))
               .block_task(),
         )
         .await?;
         logged_out_agents.borrow_mut().remove(&agent_id);
         Ok(())
      })
   }

   /// Whether a lone `authenticate` method may be used for `agent_id` without asking.
   pub(super) fn allows_automatic_auth(&self, agent_id: &str) -> bool {
      !self.logged_out_agents.borrow().contains(agent_id)
   }

   /// The ids of the agents matching `key`, or every agent without one.
   pub(super) fn connections_matching(&self, key: Option<&ConnectionKey>) -> Vec<u64> {
      let mut ids: Vec<u64> = self
         .connections
         .iter()
         .filter(|(_, connection)| key.is_none_or(|key| &connection.key == key))
         .map(|(id, _)| *id)
         .collect();
      ids.sort_unstable();
      ids
   }

   /// Removes an agent process and returns the work that ends it: closing its sessions when
   /// that is a requested stop, then stopping the process. Chats hear about it right away.
   pub(super) fn shut_down(&mut self, connection_id: u64, reason: Shutdown) -> LocalFuture {
      let connection = self.connections.remove(&connection_id);
      let session_ids = self.sessions.remove_connection(connection_id);
      lock_responders(&self.responders).remove(&connection_id);
      self
         .pending_session_opens
         .retain(|(pending_connection, _), _| *pending_connection != connection_id);

      let Some(mut connection) = connection else {
         return Box::pin(std::future::ready(()));
      };
      let error = match &reason {
         Shutdown::Exited(message) => Some(message.clone()),
         Shutdown::Requested | Shutdown::Idle | Shutdown::Unused => None,
      };
      if matches!(reason, Shutdown::Requested) {
         for session_id in &session_ids {
            self.emit(AcpEvent::SessionComplete {
               session_id: session_id.clone(),
            });
         }
      }
      self.emit(AcpEvent::StatusChanged {
         status: connection.stopped_status(session_ids.clone()),
         error,
      });

      // Closing is a courtesy before the process is stopped; an agent that does not answer
      // quickly must not keep Stop waiting. The requests go out now and share one budget.
      let close_requests: Vec<_> = if matches!(reason, Shutdown::Requested | Shutdown::Idle)
         && connection.supports_session_capability("close")
      {
         session_ids
            .iter()
            .map(|session_id| {
               connection
                  .handle
                  .connection
                  .send_request(acp::CloseSessionRequest::new(session_id.clone()))
            })
            .collect()
      } else {
         Vec::new()
      };
      let io_handle = connection.io_handle.take();
      let process = connection.process.take();
      let process_group_id = connection.process_group_id.take();
      let client = connection.handle.client.clone();
      drop(connection);

      Box::pin(async move {
         let close_all = async {
            for request in close_requests {
               if let Err(error) = request.block_task().await {
                  log::warn!(
                     "Failed to close ACP session before stopping agent: {}",
                     error
                  );
               }
            }
         };
         let _ = tokio::time::timeout(ACP_SESSION_CLOSE_TIMEOUT, close_all).await;
         if let Some(handle) = io_handle {
            handle.abort();
         }
         if let Some(process) = process {
            stop_child_tree(process, process_group_id).await;
         }
         client.release_session(None).await;
      })
   }

   /// Finds agents that exited on their own and agents idle long enough to shut down. Every
   /// session on an agent that exited gets a `status_changed` with the exit, so its chats can
   /// reconnect.
   pub(super) fn sweep(&mut self, now: Instant) {
      let mut exited = Vec::new();
      let mut idle = Vec::new();
      for (id, connection) in &mut self.connections {
         let exit = connection
            .process
            .as_mut()
            .map(|process| process.try_wait());
         match exit {
            Some(Ok(Some(status))) => {
               exited.push((*id, format!("ACP agent process exited: {}", status)));
               continue;
            }
            Some(Err(error)) => {
               log::warn!("Failed to check ACP process status: {}", error);
            }
            _ => {}
         }
         let busy = self.sessions.has_running_prompt(*id)
            || connection.pending_opens > 0
            || connection.responders.has_pending();
         let has_sessions = !self.sessions.sessions_of(*id).is_empty();
         if is_idle(
            connection.last_activity,
            now,
            busy,
            has_sessions,
            connection.can_reattach_sessions(),
         ) {
            idle.push(*id);
         }
      }
      for (id, message) in exited {
         log::warn!("{}", message);
         tokio::task::spawn_local(self.shut_down(id, Shutdown::Exited(message)));
      }
      for id in idle {
         log::info!("Stopping an idle ACP agent");
         tokio::task::spawn_local(self.shut_down(id, Shutdown::Idle));
      }
   }
}

/// Work that runs on the worker's LocalSet.
pub(super) type LocalFuture = std::pin::Pin<Box<dyn Future<Output = ()>>>;

/// Manages ACP agent connections via a dedicated worker thread. Each (agent, workspace) pair
/// runs one agent process, shared by every chat that uses it; each chat has its own session.
#[derive(Clone)]
pub struct AcpAgentBridge {
   registry: AgentRegistry,
   command_tx: mpsc::Sender<AcpCommand>,
   status: Arc<Mutex<Vec<AcpAgentStatus>>>,
   responders: ResponderRegistry,
   terminal_manager: Arc<TerminalManager>,
}

impl AcpAgentBridge {
   pub fn new(app_handle: AppHandle, terminal_manager: Arc<TerminalManager>) -> Self {
      let mut registry = AgentRegistry::new(&app_handle);
      registry.detect_installed();

      let (command_tx, command_rx) = mpsc::channel::<AcpCommand>(32);
      let status = Arc::new(Mutex::new(Vec::new()));
      let responders: ResponderRegistry = Arc::default();
      let worker_status = status.clone();
      let worker_responders = responders.clone();
      let worker_app_handle = app_handle.clone();

      // Spawn the worker thread with its own runtime and LocalSet
      thread::spawn(move || {
         let rt = Runtime::new().expect("Failed to create Tokio runtime for ACP worker");
         let local = LocalSet::new();

         local.block_on(&rt, async move {
            run_worker_loop(
               command_rx,
               worker_status,
               worker_app_handle,
               worker_responders,
            )
            .await;
         });
      });

      Self {
         registry,
         command_tx,
         status,
         responders,
         terminal_manager,
      }
   }
   /// Detect which agents are installed on the system
   pub fn detect_agents(&mut self) -> Vec<AgentConfig> {
      self.registry.detect_installed();
      self.registry.list_all()
   }

   pub fn replace_registered_agents(&mut self, agents: Vec<AgentConfig>) {
      self.registry.replace_agents(agents);
   }

   pub fn invalidate_agent_detection_cache(&mut self) {
      self.registry.invalidate_detection_cache();
   }

   async fn request<T>(
      &self,
      command: impl FnOnce(oneshot::Sender<Result<T>>) -> AcpCommand,
   ) -> Result<T> {
      let (response_tx, response_rx) = oneshot::channel();
      self
         .command_tx
         .send(command(response_tx))
         .await
         .context("Failed to send command to ACP worker")?;
      response_rx.await.context("Worker disconnected")?
   }

   /// Opens a chat's session on `agent_id` in `workspace_path`, starting the agent when it is not
   /// running there yet. `session_id` is the chat's earlier session: it is reattached when the
   /// agent still has it (answered right away when it is already open), and a new session is
   /// created otherwise. `auth_method_id` is the sign-in method the user picked after an earlier
   /// attempt needed one. `mcp_servers` are offered to the agent in session setup, filtered by
   /// what it supports.
   pub async fn open_session(
      &self,
      agent_id: &str,
      workspace_path: Option<String>,
      session_id: Option<String>,
      auth_method_id: Option<String>,
      mcp_servers: Vec<McpServerConfig>,
   ) -> Result<AcpOpenedSession> {
      let config = self
         .registry
         .get(agent_id)
         .context("Agent not found")?
         .clone();
      let terminal_manager = self.terminal_manager.clone();
      let agent_id = agent_id.to_string();

      self
         .request(|response_tx| AcpCommand::OpenSession {
            agent_id,
            workspace_path,
            config: Box::new(config),
            terminal_manager,
            request: OpenRequest {
               session_id,
               auth_method_id,
               mcp_servers,
               response_tx,
            },
         })
         .await
   }

   /// Sends a prompt in a chat's session. Other sessions, on this agent or others, keep running.
   pub async fn send_prompt(
      &self,
      session_id: String,
      prompt: Vec<serde_json::Value>,
   ) -> Result<()> {
      self
         .request(|response_tx| AcpCommand::SendPrompt {
            session_id,
            prompt,
            response_tx,
         })
         .await
   }

   /// Respond to a permission request
   pub async fn respond_to_permission(
      &self,
      request_id: String,
      approved: bool,
      cancelled: bool,
      option_id: Option<String>,
   ) -> Result<()> {
      let responders: Vec<ClientResponders> = lock_responders(&self.responders)
         .values()
         .cloned()
         .collect();
      if let Some(responders) = responders
         .iter()
         .find(|responders| responders.has_permission(&request_id))
      {
         responders.answer_permission(
            &request_id,
            PermissionResponse {
               approved,
               cancelled,
               option_id,
            },
         );
      }
      Ok(())
   }

   /// Deliver the user's answer to a pending `elicitation/create` request. `response` is ACP
   /// `CreateElicitationResponse` JSON: `{ "action": "accept", "content": {...} }`, `decline` or
   /// `cancel`. Fails when the agent is no longer waiting for it.
   pub async fn respond_to_elicitation(
      &self,
      request_id: String,
      response: serde_json::Value,
   ) -> Result<()> {
      let responders: Vec<ClientResponders> = lock_responders(&self.responders)
         .values()
         .cloned()
         .collect();
      let delivered = responders
         .iter()
         .find(|responders| responders.has_elicitation(&request_id))
         .is_some_and(|responders| responders.answer_elicitation(&request_id, response));
      if !delivered {
         anyhow::bail!("The agent is no longer waiting for this answer");
      }
      Ok(())
   }

   /// Hands the editor's contents for a file an agent is reading (`None` when it is not open) to
   /// the read waiting for them. A read that already gave up and used the disk ignores it.
   pub async fn respond_to_buffer_read(&self, request_id: String, content: Option<String>) {
      let responders: Vec<ClientResponders> = lock_responders(&self.responders)
         .values()
         .cloned()
         .collect();
      if let Some(responders) = responders
         .iter()
         .find(|responders| responders.has_buffer_read(&request_id))
      {
         responders.answer_buffer_read(&request_id, content);
      }
   }

   /// Stops the agent process running `agent_id` in `workspace_path`, ending every session on it,
   /// or every agent when `agent_id` is `None` (the app is quitting). Startups in progress for
   /// those agents are stopped too.
   pub async fn stop_agent(
      &self,
      agent_id: Option<String>,
      workspace_path: Option<String>,
   ) -> Result<()> {
      let key = agent_id
         .map(|agent_id| connection_key(agent_id, workspace_path))
         .transpose()?;
      self
         .request(|response_tx| AcpCommand::Stop { key, response_tx })
         .await
   }

   /// Every running agent process and the sessions open on it.
   pub async fn get_status(&self) -> Vec<AcpAgentStatus> {
      self.status.lock().await.clone()
   }

   /// Set a session's mode
   pub async fn set_session_mode(&self, session_id: String, mode_id: String) -> Result<()> {
      self
         .request(|response_tx| AcpCommand::SetMode {
            session_id,
            mode_id,
            response_tx,
         })
         .await
   }

   /// Set a session configuration option
   pub async fn set_session_config_option(
      &self,
      session_id: String,
      config_id: String,
      value: SessionConfigValue,
   ) -> Result<()> {
      self
         .request(|response_tx| AcpCommand::SetConfigOption {
            session_id,
            config_id,
            value,
            response_tx,
         })
         .await
   }

   /// Lets go of a chat's session: it is closed on the agent when supported, and whatever it
   /// held is freed. The agent keeps running for other chats.
   pub async fn close_session(&self, session_id: String) -> Result<()> {
      self
         .request(|response_tx| AcpCommand::CloseSession {
            session_id,
            response_tx,
         })
         .await
   }

   /// List sessions known to the agent running `agent_id` in `workspace_path`
   pub async fn list_sessions(
      &self,
      agent_id: String,
      workspace_path: Option<String>,
      cwd: Option<String>,
      cursor: Option<String>,
   ) -> Result<AcpSessionList> {
      let key = connection_key(agent_id, workspace_path)?;
      self
         .request(|response_tx| AcpCommand::ListSessions {
            key,
            cwd,
            cursor,
            response_tx,
         })
         .await
   }

   /// Delete a session known to the agent running `agent_id` in `workspace_path`
   pub async fn delete_session(
      &self,
      agent_id: String,
      workspace_path: Option<String>,
      session_id: String,
   ) -> Result<()> {
      let key = connection_key(agent_id, workspace_path)?;
      self
         .request(|response_tx| AcpCommand::DeleteSession {
            key,
            session_id,
            response_tx,
         })
         .await
   }

   /// Log out of an agent when supported by ACP auth capabilities
   pub async fn logout(&self, agent_id: String, workspace_path: Option<String>) -> Result<()> {
      let key = connection_key(agent_id, workspace_path)?;
      self
         .request(|response_tx| AcpCommand::Logout { key, response_tx })
         .await
   }

   /// Sign in to a running agent with an `authenticate` method the user picked
   pub async fn authenticate(
      &self,
      agent_id: String,
      workspace_path: Option<String>,
      method_id: String,
   ) -> Result<()> {
      let key = connection_key(agent_id, workspace_path)?;
      self
         .request(|response_tx| AcpCommand::Authenticate {
            key,
            method_id,
            response_tx,
         })
         .await
   }

   /// Cancels the prompt turn in `session_id`. Other chats on the same agent keep running. Before
   /// the chat has a session there is no turn yet: the startup of `agent_id` in
   /// `workspace_path` is stopped instead, since the user asked for everything to stop.
   pub async fn cancel_prompt(
      &self,
      session_id: Option<String>,
      agent_id: Option<String>,
      workspace_path: Option<String>,
   ) -> Result<()> {
      let key = agent_id
         .map(|agent_id| connection_key(agent_id, workspace_path))
         .transpose()?;
      self
         .request(|response_tx| AcpCommand::CancelPrompt {
            session_id,
            key,
            response_tx,
         })
         .await
   }
}

#[cfg(test)]
mod tests {
   use super::with_request_timeout;
   use std::time::Duration;

   #[tokio::test]
   async fn request_timeout_returns_the_response() {
      let result = with_request_timeout("do it", Duration::from_secs(1), async {
         Ok::<_, String>(7)
      })
      .await;
      assert_eq!(result.unwrap(), 7);
   }

   #[tokio::test]
   async fn request_timeout_names_the_action_on_agent_errors() {
      let result = with_request_timeout("set session mode", Duration::from_secs(1), async {
         Err::<(), _>("mode not found")
      })
      .await;
      assert_eq!(
         result.unwrap_err().to_string(),
         "Failed to set session mode: mode not found"
      );
   }

   #[tokio::test]
   async fn request_timeout_gives_up_on_a_silent_agent() {
      let result = with_request_timeout(
         "list ACP sessions",
         Duration::from_millis(20),
         std::future::pending::<Result<(), String>>(),
      )
      .await;
      let message = result.unwrap_err().to_string();
      assert!(
         message.starts_with("Failed to list ACP sessions: the agent did not respond"),
         "{message}"
      );
   }
}
