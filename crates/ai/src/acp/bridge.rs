use super::{
   AcpConnection,
   auth::{ACP_AUTHENTICATE_TIMEOUT, authenticate_method, automatic_auth_method},
   bridge_commands::{AcpCommand, run_worker_loop},
   bridge_init::InitializedAcpWorker,
   bridge_prompt::{PromptAuth, run_prompt},
   client::{AthasAcpClient, ClientResponders, PermissionResponse},
   config::AgentRegistry,
   mcp_servers::{AcpSkippedMcpServer, McpServerConfig},
   process::{stop_child_tree, terminate_process_group},
   types::{
      AcpAgentCapabilities, AcpAgentStatus, AcpAuthMethod, AcpEvent, AcpSessionInfo,
      AcpSessionList, AgentConfig, SessionConfigOption, SessionConfigValue,
   },
   workspace_path::{path_to_string, resolve_workspace_path},
};
use crate::runtime::AthasAppHandle as AppHandle;
use agent_client_protocol::schema::v1 as acp;
use anyhow::{Context, Result, bail};
use athas_terminal::TerminalManager;
use std::{
   cell::RefCell, collections::HashSet, path::PathBuf, rc::Rc, sync::Arc, thread, time::Duration,
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
/// `session/close` is only sent while stopping, so it gets a short budget.
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

/// Worker state running on the LocalSet thread
pub(super) struct AcpWorker {
   connection: Option<Arc<AcpConnection>>,
   session_id: Option<acp::SessionId>,
   auth_methods: Vec<acp::AuthMethod>,
   described_auth_methods: Vec<AcpAuthMethod>,
   /// Agents the user logged out of. Athas does not sign them back in on its own; the user
   /// chooses a method again. Kept across restarts until a sign-in succeeds.
   logged_out_agents: Rc<RefCell<HashSet<String>>>,
   process: Option<Child>,
   process_group_id: Option<u32>,
   io_handle: Option<tokio::task::JoinHandle<()>>,
   client: Option<Arc<AthasAcpClient>>,
   workspace_path: Option<PathBuf>,
   agent_id: Option<String>,
   agent_capabilities: Option<AcpAgentCapabilities>,
   skipped_mcp_servers: Vec<AcpSkippedMcpServer>,
   app_handle: Option<AppHandle>,
}

impl AcpWorker {
   pub(super) fn new() -> Self {
      Self {
         connection: None,
         session_id: None,
         auth_methods: Vec::new(),
         described_auth_methods: Vec::new(),
         logged_out_agents: Rc::default(),
         process: None,
         process_group_id: None,
         io_handle: None,
         client: None,
         workspace_path: None,
         agent_id: None,
         agent_capabilities: None,
         skipped_mcp_servers: Vec::new(),
         app_handle: None,
      }
   }

   pub(super) async fn ensure_process_alive(&mut self) -> Result<()> {
      let Some(process) = self.process.as_mut() else {
         return Ok(());
      };

      match process.try_wait() {
         Ok(Some(status)) => {
            let session_id = self.session_id.as_ref().map(ToString::to_string);
            if let Some(app_handle) = self.app_handle.as_ref() {
               let _ = app_handle.emit(
                  "acp-event",
                  AcpEvent::Error {
                     session_id: session_id.clone(),
                     error: format!("ACP agent process exited: {}", status),
                  },
               );
               let _ = app_handle.emit(
                  "acp-event",
                  AcpEvent::StatusChanged {
                     status: AcpAgentStatus::default(),
                  },
               );
            }

            if let Some(io_handle) = self.io_handle.take() {
               io_handle.abort();
            }
            if let Some(client) = self.client.as_ref() {
               client.release_session(None).await;
            }

            self.connection = None;
            self.session_id = None;
            self.auth_methods.clear();
            self.described_auth_methods.clear();
            self.process = None;
            self.process_group_id = None;
            self.client = None;
            self.workspace_path = None;
            self.agent_id = None;
            self.agent_capabilities = None;
            self.skipped_mcp_servers.clear();
            self.app_handle = None;

            bail!("ACP agent process exited: {}", status);
         }
         Ok(None) => Ok(()),
         Err(e) => Err(anyhow::anyhow!("Failed to check ACP process status: {}", e)),
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

   /// Takes over an agent that finished starting. The caller stopped any previous agent before
   /// startup began.
   pub(super) fn adopt(
      &mut self,
      agent_id: String,
      app_handle: AppHandle,
      initialized: InitializedAcpWorker,
   ) -> (AcpAgentStatus, ClientResponders) {
      self.connection = Some(initialized.connection);
      self.session_id = initialized.session_id.clone();
      self.auth_methods = initialized.auth_methods;
      self.described_auth_methods = initialized.described_auth_methods;
      self.process_group_id = initialized.process_group_id;
      self.process = Some(initialized.process);
      self.io_handle = Some(initialized.io_handle);
      self.client = Some(initialized.client);
      self.workspace_path = initialized.workspace_path;
      self.agent_id = Some(agent_id);
      self.agent_capabilities = Some(initialized.agent_capabilities);
      self.skipped_mcp_servers = initialized.skipped_mcp_servers;
      self.app_handle = Some(app_handle);

      (self.get_status(), initialized.responders)
   }

   pub(super) async fn send_prompt(&mut self, prompt: Vec<serde_json::Value>) -> Result<()> {
      self.ensure_process_alive().await?;

      let connection = self
         .connection
         .as_ref()
         .context("No active connection")?
         .clone();
      let session_id = self
         .session_id
         .as_ref()
         .context("No active session")?
         .clone();
      let app_handle = self
         .app_handle
         .as_ref()
         .context("No app handle available")?
         .clone();
      let agent_id = self.agent_id.clone().unwrap_or_default();
      let auth = PromptAuth {
         automatic_method_id: if self.allows_automatic_auth(&agent_id) {
            automatic_auth_method(&self.auth_methods)
         } else {
            None
         },
         agent_id,
         methods: self.described_auth_methods.clone(),
      };

      tokio::task::spawn_local(async move {
         if let Err(err) = run_prompt(
            connection,
            session_id.clone(),
            app_handle.clone(),
            prompt,
            auth,
         )
         .await
         {
            log::error!("Failed to run ACP prompt: {}", err);
            let _ = app_handle.emit(
               "acp-event",
               AcpEvent::Error {
                  session_id: Some(session_id.to_string()),
                  error: format!("Failed to run prompt: {}", err),
               },
            );
         }
      });

      Ok(())
   }

   pub(super) async fn cancel_prompt(&mut self) -> Result<()> {
      self.ensure_process_alive().await?;

      let connection = self.connection.as_ref().context("No active connection")?;
      let session_id = self.session_id.as_ref().context("No active session")?;

      let cancel_notification = acp::CancelNotification::new(session_id.clone());

      connection
         .send_notification(cancel_notification)
         .context("Failed to cancel prompt")?;

      Ok(())
   }

   /// Checks the agent is ready and returns the `session/set_mode` request. The
   /// worker loop runs it in the background so a slow agent cannot hold up
   /// Cancel or Stop.
   pub(super) async fn set_mode(
      &mut self,
      mode_id: String,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      self.ensure_process_alive().await?;

      let connection = self.active_connection()?;
      let session_id = self.active_session_id()?;
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

   pub(super) async fn set_config_option(
      &mut self,
      config_id: String,
      value: SessionConfigValue,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      self.ensure_process_alive().await?;

      let connection = self.active_connection()?;
      let session_id = self.active_session_id()?;
      let app_handle = self
         .app_handle
         .as_ref()
         .context("No app handle available")?
         .clone();

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
         let config_options = Self::map_config_options(response.config_options);

         let _ = app_handle.emit(
            "acp-event",
            AcpEvent::ConfigOptionsUpdate {
               session_id: session_id.to_string(),
               config_options,
            },
         );

         Ok(())
      })
   }

   pub(super) async fn list_sessions(
      &mut self,
      cwd: Option<String>,
      cursor: Option<String>,
   ) -> Result<impl Future<Output = Result<AcpSessionList>> + use<>> {
      self.ensure_process_alive().await?;

      if !self.supports_session_list() {
         bail!("ACP agent does not support session/list");
      }

      let connection = self.active_connection()?;
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
   /// calls [`Self::forget_session`] to drop the session if it was active.
   pub(super) async fn delete_session(
      &mut self,
      session_id: String,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      self.ensure_process_alive().await?;

      if !self.supports_session_delete() {
         bail!("ACP agent does not support session/delete");
      }

      let connection = self.active_connection()?;
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

   /// Clears the active session after the agent deleted it.
   pub(super) fn forget_session(&mut self, session_id: &str) {
      let is_active = self
         .session_id
         .as_ref()
         .is_some_and(|active_session_id| active_session_id.to_string() == session_id);
      if !is_active {
         return;
      }

      self.session_id = None;
      if let Some(app_handle) = self.app_handle.as_ref() {
         let _ = app_handle.emit(
            "acp-event",
            AcpEvent::SessionComplete {
               session_id: session_id.to_string(),
            },
         );
      }
   }

   pub(super) async fn logout(&mut self) -> Result<impl Future<Output = Result<()>> + use<>> {
      self.ensure_process_alive().await?;

      if !self.supports_logout() {
         bail!("ACP agent does not support logout");
      }

      let connection = self.active_connection()?;
      let agent_id = self.agent_id.clone().context("No active agent")?;
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
   pub(super) async fn authenticate(
      &mut self,
      method_id: String,
   ) -> Result<impl Future<Output = Result<()>> + use<>> {
      self.ensure_process_alive().await?;

      let method_id = authenticate_method(&self.auth_methods, &method_id)?;
      let connection = self.active_connection()?;
      let agent_id = self.agent_id.clone().context("No active agent")?;
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

   /// A startup signed in with a method the user picked.
   pub(super) fn signed_in(&self, agent_id: &str) {
      self.logged_out_agents.borrow_mut().remove(agent_id);
   }

   fn active_connection(&self) -> Result<Arc<AcpConnection>> {
      self.connection.clone().context("No active connection")
   }

   fn active_session_id(&self) -> Result<acp::SessionId> {
      self.session_id.clone().context("No active session")
   }

   fn supports_session_list(&self) -> bool {
      self
         .agent_capabilities
         .as_ref()
         .and_then(|capabilities| capabilities.session_capabilities.get("list"))
         .is_some()
   }

   fn supports_session_delete(&self) -> bool {
      self
         .agent_capabilities
         .as_ref()
         .and_then(|capabilities| capabilities.session_capabilities.get("delete"))
         .is_some()
   }

   fn supports_session_close(&self) -> bool {
      self
         .agent_capabilities
         .as_ref()
         .and_then(|capabilities| capabilities.session_capabilities.get("close"))
         .is_some()
   }

   fn supports_logout(&self) -> bool {
      self
         .agent_capabilities
         .as_ref()
         .and_then(|capabilities| capabilities.auth_capabilities.get("logout"))
         .is_some()
   }

   pub(super) async fn stop(&mut self) -> Result<()> {
      // Closing is a courtesy before the process is stopped; an agent that
      // does not answer quickly must not keep Stop waiting.
      if self.supports_session_close()
         && let (Some(connection), Some(session_id)) =
            (self.connection.as_ref(), self.session_id.as_ref())
         && let Err(error) = with_request_timeout(
            "close ACP session",
            ACP_SESSION_CLOSE_TIMEOUT,
            connection
               .send_request(acp::CloseSessionRequest::new(session_id.clone()))
               .block_task(),
         )
         .await
      {
         log::warn!(
            "Failed to close ACP session before stopping agent: {}",
            error
         );
      }

      if let Some(handle) = self.io_handle.take() {
         handle.abort();
      }

      if let Some(process) = self.process.take() {
         stop_child_tree(process, self.process_group_id.take()).await;
      }
      if let Some(client) = self.client.as_ref() {
         client.release_session(None).await;
      }

      self.connection = None;
      self.session_id = None;
      self.auth_methods.clear();
      self.described_auth_methods.clear();
      self.client = None;
      self.workspace_path = None;
      self.agent_id = None;
      self.agent_capabilities = None;
      self.skipped_mcp_servers.clear();
      self.app_handle = None;
      self.process_group_id = None;

      Ok(())
   }

   pub(super) fn get_status(&self) -> AcpAgentStatus {
      match &self.agent_id {
         Some(agent_id) => AcpAgentStatus {
            agent_id: agent_id.clone(),
            running: true,
            session_active: self.session_id.is_some(),
            initialized: self.connection.is_some(),
            session_id: self.session_id.as_ref().map(ToString::to_string),
            workspace_path: self.workspace_path.as_deref().map(path_to_string),
            agent_capabilities: self.agent_capabilities.clone(),
            auth_methods: self.described_auth_methods.clone(),
            skipped_mcp_servers: self.skipped_mcp_servers.clone(),
         },
         None => AcpAgentStatus::default(),
      }
   }
}

impl Drop for AcpWorker {
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

/// Manages ACP agent connections via a dedicated worker thread
#[derive(Clone)]
pub struct AcpAgentBridge {
   app_handle: AppHandle,
   registry: AgentRegistry,
   command_tx: mpsc::Sender<AcpCommand>,
   status: Arc<Mutex<AcpAgentStatus>>,
   responders: Arc<Mutex<Option<ClientResponders>>>,
   terminal_manager: Arc<TerminalManager>,
}

impl AcpAgentBridge {
   pub fn new(app_handle: AppHandle, terminal_manager: Arc<TerminalManager>) -> Self {
      let mut registry = AgentRegistry::new(&app_handle);
      registry.detect_installed();

      let (command_tx, command_rx) = mpsc::channel::<AcpCommand>(32);
      let status = Arc::new(Mutex::new(AcpAgentStatus::default()));
      let status_clone = status.clone();

      // Spawn the worker thread with its own runtime and LocalSet
      thread::spawn(move || {
         let rt = Runtime::new().expect("Failed to create Tokio runtime for ACP worker");
         let local = LocalSet::new();

         local.block_on(&rt, async move {
            run_worker_loop(command_rx, status_clone).await;
         });
      });

      Self {
         app_handle,
         registry,
         command_tx,
         status,
         responders: Arc::new(Mutex::new(None)),
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

   /// Start an ACP agent by ID. `auth_method_id` is the sign-in method the user picked after an
   /// earlier start needed one; startup uses it if the agent asks to authenticate.
   /// `mcp_servers` are offered to the agent in session setup, filtered by what it supports.
   pub async fn start_agent(
      &self,
      agent_id: &str,
      workspace_path: Option<String>,
      session_id: Option<String>,
      auth_method_id: Option<String>,
      mcp_servers: Vec<McpServerConfig>,
   ) -> Result<AcpAgentStatus> {
      let config = self
         .registry
         .get(agent_id)
         .context("Agent not found")?
         .clone();

      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::Initialize {
            agent_id: agent_id.to_string(),
            workspace_path,
            session_id,
            auth_method_id,
            mcp_servers,
            config: Box::new(config),
            app_handle: self.app_handle.clone(),
            terminal_manager: self.terminal_manager.clone(),
            response_tx,
         })
         .await
         .context("Failed to send command to ACP worker")?;

      let (status, responders) = response_rx.await.context("Worker disconnected")??;

      // Keep the channels that deliver the user's answers to waiting agent requests
      *self.responders.lock().await = Some(responders);

      // Emit status change
      self.emit_status_change(&status);

      Ok(status)
   }

   /// Send a prompt to the active agent
   pub async fn send_prompt(&self, prompt: Vec<serde_json::Value>) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::SendPrompt {
            prompt,
            response_tx,
         })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
   }

   /// Respond to a permission request
   pub async fn respond_to_permission(
      &self,
      request_id: String,
      approved: bool,
      cancelled: bool,
      option_id: Option<String>,
   ) -> Result<()> {
      if let Some(responders) = self.responders.lock().await.as_ref() {
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
      let delivered = self
         .responders
         .lock()
         .await
         .as_ref()
         .is_some_and(|responders| responders.answer_elicitation(&request_id, response));
      if !delivered {
         anyhow::bail!("The agent is no longer waiting for this answer");
      }
      Ok(())
   }

   /// Hands the editor's contents for a file an agent is reading (`None` when it is not open) to
   /// the read waiting for them. A read that already gave up and used the disk ignores it.
   pub async fn respond_to_buffer_read(&self, request_id: String, content: Option<String>) {
      if let Some(responders) = self.responders.lock().await.as_ref() {
         responders.answer_buffer_read(&request_id, content);
      }
   }

   /// Stop the active agent
   pub async fn stop_agent(&self) -> Result<()> {
      // Get current session ID before stopping
      let current_status = self.status.lock().await.clone();
      let session_id = if current_status.running {
         current_status.session_id.clone()
      } else {
         None
      };

      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::Stop { response_tx })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")??;

      // Drop the answer channels; pending agent requests resolve as cancelled
      *self.responders.lock().await = None;

      // Emit SessionComplete before StatusChanged
      if let Some(sid) = session_id {
         let _ = self
            .app_handle
            .emit("acp-event", AcpEvent::SessionComplete { session_id: sid });
      }

      // Emit status change
      self.emit_status_change(&AcpAgentStatus::default());

      Ok(())
   }

   /// Get current agent status
   pub async fn get_status(&self) -> AcpAgentStatus {
      self.status.lock().await.clone()
   }

   /// Set session mode for the active agent
   pub async fn set_session_mode(&self, mode_id: &str) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::SetMode {
            mode_id: mode_id.to_string(),
            response_tx,
         })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
   }

   /// Set a session configuration option for the active agent
   pub async fn set_session_config_option(
      &self,
      config_id: &str,
      value: SessionConfigValue,
   ) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::SetConfigOption {
            config_id: config_id.to_string(),
            value,
            response_tx,
         })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
   }

   /// List sessions known to the active agent
   pub async fn list_sessions(
      &self,
      cwd: Option<String>,
      cursor: Option<String>,
   ) -> Result<AcpSessionList> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::ListSessions {
            cwd,
            cursor,
            response_tx,
         })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
   }

   /// Delete a session known to the active agent
   pub async fn delete_session(&self, session_id: &str) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::DeleteSession {
            session_id: session_id.to_string(),
            response_tx,
         })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
   }

   /// Log out of the active agent when supported by ACP auth capabilities
   pub async fn logout(&self) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::Logout { response_tx })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
   }

   /// Sign in to the running agent with an `authenticate` method the user picked
   pub async fn authenticate(&self, method_id: String) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::Authenticate {
            method_id,
            response_tx,
         })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
   }

   /// Cancel the current prompt turn. While the agent is still starting, this stops the startup
   /// instead, since there is no turn yet and the user asked for everything to stop.
   pub async fn cancel_prompt(&self) -> Result<()> {
      let session_id = self.status.lock().await.session_id.clone();
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::CancelPrompt { response_tx })
         .await
         .context("Failed to send command to ACP worker")?;

      let result = response_rx.await.context("Worker disconnected")?;

      // After `session/cancel`, whatever the turn left waiting on the user is answered as
      // cancelled here, not by whichever chat surface happens to show it.
      if let Some(session_id) = session_id {
         self.cancel_pending_requests(&session_id).await;
      }

      result
   }

   async fn cancel_pending_requests(&self, session_id: &str) {
      let closed = self
         .responders
         .lock()
         .await
         .as_ref()
         .map(|responders| responders.cancel_session(session_id))
         .unwrap_or_default();
      for request_id in closed {
         let _ = self
            .app_handle
            .emit("acp-event", AcpEvent::RequestClosed { request_id });
      }
   }

   fn emit_status_change(&self, status: &AcpAgentStatus) {
      let _ = self.app_handle.emit(
         "acp-event",
         AcpEvent::StatusChanged {
            status: status.clone(),
         },
      );
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
