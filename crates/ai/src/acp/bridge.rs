use super::{
   AcpConnection,
   bridge_commands::{AcpCommand, run_worker_loop},
   bridge_init::initialize_worker,
   bridge_prompt::run_prompt,
   client::{AthasAcpClient, PermissionResponse},
   config::AgentRegistry,
   process::{stop_child_tree, terminate_process_group},
   types::{
      AcpAgentCapabilities, AcpAgentStatus, AcpEvent, AcpSessionInfo, AcpSessionList, AgentConfig,
      SessionConfigOption,
   },
   workspace_path::{path_to_string, resolve_workspace_path},
};
use crate::runtime::AthasAppHandle as AppHandle;
use agent_client_protocol::schema as acp;
use anyhow::{Context, Result, bail};
use athas_terminal::TerminalManager;
use std::{path::PathBuf, sync::Arc, thread};
use tauri::Emitter;
use tokio::{
   process::Child,
   runtime::Runtime,
   sync::{Mutex, mpsc, oneshot},
   task::LocalSet,
};

/// Worker state running on the LocalSet thread
pub(super) struct AcpWorker {
   connection: Option<Arc<AcpConnection>>,
   session_id: Option<acp::SessionId>,
   auth_method_id: Option<String>,
   process: Option<Child>,
   process_group_id: Option<u32>,
   io_handle: Option<tokio::task::JoinHandle<()>>,
   client: Option<Arc<AthasAcpClient>>,
   workspace_path: Option<PathBuf>,
   agent_id: Option<String>,
   agent_capabilities: Option<AcpAgentCapabilities>,
   app_handle: Option<AppHandle>,
}

impl AcpWorker {
   pub(super) fn new() -> Self {
      Self {
         connection: None,
         session_id: None,
         auth_method_id: None,
         process: None,
         process_group_id: None,
         io_handle: None,
         client: None,
         workspace_path: None,
         agent_id: None,
         agent_capabilities: None,
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

            self.connection = None;
            self.session_id = None;
            self.process = None;
            self.process_group_id = None;
            self.client = None;
            self.workspace_path = None;
            self.agent_id = None;
            self.agent_capabilities = None;
            self.app_handle = None;

            bail!("ACP agent process exited: {}", status);
         }
         Ok(None) => Ok(()),
         Err(e) => Err(anyhow::anyhow!("Failed to check ACP process status: {}", e)),
      }
   }

   fn map_config_options(options: Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption> {
      options
         .into_iter()
         .filter_map(AthasAcpClient::map_session_config_option)
         .collect()
   }

   pub(super) async fn initialize(
      &mut self,
      agent_id: String,
      workspace_path: Option<String>,
      session_id: Option<String>,
      config: AgentConfig,
      app_handle: AppHandle,
      terminal_manager: Arc<TerminalManager>,
   ) -> Result<(AcpAgentStatus, mpsc::Sender<PermissionResponse>)> {
      // Stop any existing agent first
      self.stop().await?;

      if !config.installed {
         log::warn!(
            "Agent '{}' not marked as installed; attempting to start anyway",
            config.name
         );
      }

      let initialized = initialize_worker(
         &config,
         workspace_path,
         app_handle.clone(),
         terminal_manager,
         session_id,
         Self::map_config_options,
      )
      .await?;

      self.connection = Some(initialized.connection);
      self.session_id = initialized.session_id.clone();
      self.auth_method_id = initialized.auth_method_id;
      self.process_group_id = initialized.process_group_id;
      self.process = Some(initialized.process);
      self.io_handle = Some(initialized.io_handle);
      self.client = Some(initialized.client);
      self.workspace_path = initialized.workspace_path;
      self.agent_id = Some(agent_id.clone());
      self.agent_capabilities = Some(initialized.agent_capabilities);
      self.app_handle = Some(app_handle.clone());

      let status = AcpAgentStatus {
         agent_id,
         running: true,
         session_active: self.session_id.is_some(),
         initialized: true,
         session_id: self.session_id.as_ref().map(ToString::to_string),
         workspace_path: self.workspace_path.as_deref().map(path_to_string),
         agent_capabilities: self.agent_capabilities.clone(),
      };

      Ok((status, initialized.permission_sender))
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
      let auth_method_id = self.auth_method_id.clone();

      tokio::task::spawn_local(async move {
         if let Err(err) = run_prompt(
            connection,
            session_id.clone(),
            app_handle.clone(),
            prompt,
            auth_method_id,
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

   pub(super) async fn set_mode(&mut self, mode_id: &str) -> Result<()> {
      self.ensure_process_alive().await?;

      let connection = self.connection.as_ref().context("No active connection")?;
      let session_id = self.session_id.as_ref().context("No active session")?;

      // Use session/set_mode request
      let request = acp::SetSessionModeRequest::new(session_id.clone(), mode_id.to_string());

      connection
         .send_request(request)
         .block_task()
         .await
         .context("Failed to set session mode")?;

      Ok(())
   }

   pub(super) async fn set_config_option(&mut self, config_id: &str, value: &str) -> Result<()> {
      self.ensure_process_alive().await?;

      let connection = self.connection.as_ref().context("No active connection")?;
      let session_id = self.session_id.as_ref().context("No active session")?;
      let app_handle = self
         .app_handle
         .as_ref()
         .context("No app handle available")?;

      let request =
         acp::SetSessionConfigOptionRequest::new(session_id.clone(), config_id.to_string(), value);

      let response = connection
         .send_request(request)
         .block_task()
         .await
         .context("Failed to set session config option")?;
      let config_options = Self::map_config_options(response.config_options);

      let _ = app_handle.emit(
         "acp-event",
         AcpEvent::ConfigOptionsUpdate {
            session_id: session_id.to_string(),
            config_options,
         },
      );

      Ok(())
   }

   pub(super) async fn list_sessions(
      &mut self,
      cwd: Option<String>,
      cursor: Option<String>,
   ) -> Result<AcpSessionList> {
      self.ensure_process_alive().await?;

      if !self.supports_session_list() {
         bail!("ACP agent does not support session/list");
      }

      let connection = self.connection.as_ref().context("No active connection")?;
      let mut request = acp::ListSessionsRequest::new();
      if let Some(cwd) = cwd {
         let cwd = resolve_workspace_path(Some(cwd))?
            .context("Workspace path is required to list ACP sessions by cwd")?;
         request = request.cwd(cwd);
      }
      if let Some(cursor) = cursor {
         request = request.cursor(cursor);
      }

      let response = connection
         .send_request(request)
         .block_task()
         .await
         .context("Failed to list ACP sessions")?;

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
   }

   pub(super) async fn delete_session(&mut self, session_id: &str) -> Result<()> {
      self.ensure_process_alive().await?;

      if !self.supports_session_delete() {
         bail!("ACP agent does not support session/delete");
      }

      let connection = self.connection.as_ref().context("No active connection")?;
      connection
         .send_request(acp::DeleteSessionRequest::new(session_id.to_string()))
         .block_task()
         .await
         .context("Failed to delete ACP session")?;

      if self
         .session_id
         .as_ref()
         .map(|active_session_id| active_session_id.to_string() == session_id)
         .unwrap_or(false)
      {
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

      Ok(())
   }

   pub(super) async fn logout(&mut self) -> Result<()> {
      self.ensure_process_alive().await?;

      if !self.supports_logout() {
         bail!("ACP agent does not support logout");
      }

      let connection = self.connection.as_ref().context("No active connection")?;
      connection
         .send_request(acp::LogoutRequest::new())
         .block_task()
         .await
         .context("Failed to log out ACP agent")?;

      Ok(())
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
      if self.supports_session_close()
         && let (Some(connection), Some(session_id)) =
            (self.connection.as_ref(), self.session_id.as_ref())
         && let Err(error) = connection
            .send_request(acp::CloseSessionRequest::new(session_id.clone()))
            .block_task()
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

      self.connection = None;
      self.session_id = None;
      self.auth_method_id = None;
      self.client = None;
      self.workspace_path = None;
      self.agent_id = None;
      self.agent_capabilities = None;
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
   permission_tx: Arc<Mutex<Option<mpsc::Sender<PermissionResponse>>>>,
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
         permission_tx: Arc::new(Mutex::new(None)),
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

   /// Start an ACP agent by ID
   pub async fn start_agent(
      &self,
      agent_id: &str,
      workspace_path: Option<String>,
      session_id: Option<String>,
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
            config: Box::new(config),
            app_handle: self.app_handle.clone(),
            terminal_manager: self.terminal_manager.clone(),
            response_tx,
         })
         .await
         .context("Failed to send command to ACP worker")?;

      let (status, permission_sender) = response_rx.await.context("Worker disconnected")??;

      // Store permission sender for later use
      {
         let mut tx = self.permission_tx.lock().await;
         *tx = Some(permission_sender);
      }

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
      let tx = self.permission_tx.lock().await;
      if let Some(ref sender) = *tx {
         sender
            .send(PermissionResponse {
               request_id,
               approved,
               cancelled,
               option_id,
            })
            .await
            .ok();
      }
      Ok(())
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

      // Clear permission sender
      {
         let mut tx = self.permission_tx.lock().await;
         *tx = None;
      }

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
   pub async fn set_session_config_option(&self, config_id: &str, value: &str) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::SetConfigOption {
            config_id: config_id.to_string(),
            value: value.to_string(),
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

   /// Cancel the current prompt turn
   pub async fn cancel_prompt(&self) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::CancelPrompt { response_tx })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
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
