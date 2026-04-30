use super::{
   bridge_commands::{AcpCommand, run_worker_loop},
   bridge_init::initialize_worker,
   bridge_prompt::run_prompt,
   client::{AthasAcpClient, PermissionResponse},
   config::AgentRegistry,
   types::{AcpAgentCapabilities, AcpAgentStatus, AcpEvent, AgentConfig, SessionConfigOption},
};
use acp::Agent;
use agent_client_protocol as acp;
use anyhow::{Context, Result, bail};
use athas_terminal::TerminalManager;
use std::{sync::Arc, thread};
use tauri::{AppHandle, Emitter};
use tokio::{
   process::Child,
   runtime::Runtime,
   sync::{Mutex, mpsc, oneshot},
   task::LocalSet,
};

/// Worker state running on the LocalSet thread
pub(super) struct AcpWorker {
   connection: Option<Arc<acp::ClientSideConnection>>,
   session_id: Option<acp::SessionId>,
   auth_method_id: Option<String>,
   process: Option<Child>,
   io_handle: Option<tokio::task::JoinHandle<()>>,
   client: Option<Arc<AthasAcpClient>>,
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
         io_handle: None,
         client: None,
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
            self.client = None;
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
      self.process = Some(initialized.process);
      self.io_handle = Some(initialized.io_handle);
      self.client = Some(initialized.client);
      self.agent_id = Some(agent_id.clone());
      self.agent_capabilities = Some(initialized.agent_capabilities);
      self.app_handle = Some(app_handle.clone());

      let status = AcpAgentStatus {
         agent_id,
         running: true,
         session_active: self.session_id.is_some(),
         initialized: true,
         session_id: self.session_id.as_ref().map(ToString::to_string),
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
         .cancel(cancel_notification)
         .await
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
         .set_session_mode(request)
         .await
         .context("Failed to set session mode")?;

      Ok(())
   }

   pub(super) async fn set_config_option(&mut self, config_id: &str, value: &str) -> Result<()> {
      self.ensure_process_alive().await?;

      let connection = self.connection.as_ref().context("No active connection")?;
      let session_id = self.session_id.as_ref().context("No active session")?;

      let request = acp::SetSessionConfigOptionRequest::new(
         session_id.clone(),
         config_id.to_string(),
         value.to_string(),
      );

      connection
         .set_session_config_option(request)
         .await
         .context("Failed to set session config option")?;

      Ok(())
   }

   pub(super) async fn stop(&mut self) -> Result<()> {
      if let Some(handle) = self.io_handle.take() {
         handle.abort();
      }

      if let Some(mut process) = self.process.take() {
         let _ = process.kill().await;
      }

      self.connection = None;
      self.session_id = None;
      self.auth_method_id = None;
      self.client = None;
      self.agent_id = None;
      self.agent_capabilities = None;
      self.app_handle = None;

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
            agent_capabilities: self.agent_capabilities.clone(),
         },
         None => AcpAgentStatus::default(),
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
