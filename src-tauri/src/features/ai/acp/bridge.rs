use super::{
   client::{AthasAcpClient, PermissionResponse},
   config::AgentRegistry,
   types::{AcpAgentStatus, AcpEvent, AgentConfig, SessionMode, SessionModeState, StopReason},
};
use acp::Agent;
use agent_client_protocol as acp;
use anyhow::{Context, Result, bail};
use std::{process::Stdio, sync::Arc, thread};
use tauri::{AppHandle, Emitter};
use tokio::{
   process::{Child, Command},
   runtime::Runtime,
   sync::{Mutex, mpsc, oneshot},
   task::LocalSet,
};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

/// Commands that can be sent to the ACP worker thread
enum AcpCommand {
   Initialize {
      agent_id: String,
      workspace_path: Option<String>,
      config: Box<AgentConfig>,
      env_vars: std::collections::HashMap<String, String>,
      app_handle: AppHandle,
      response_tx: oneshot::Sender<Result<(AcpAgentStatus, mpsc::Sender<PermissionResponse>)>>,
   },
   SendPrompt {
      prompt: String,
      response_tx: oneshot::Sender<Result<()>>,
   },
   SetMode {
      mode_id: String,
      response_tx: oneshot::Sender<Result<()>>,
   },
   CancelPrompt {
      response_tx: oneshot::Sender<Result<()>>,
   },
   Stop {
      response_tx: oneshot::Sender<Result<()>>,
   },
}

/// Worker state running on the LocalSet thread
struct AcpWorker {
   connection: Option<Arc<acp::ClientSideConnection>>,
   session_id: Option<acp::SessionId>,
   process: Option<Child>,
   io_handle: Option<tokio::task::JoinHandle<()>>,
   client: Option<Arc<AthasAcpClient>>,
   agent_id: Option<String>,
   app_handle: Option<AppHandle>,
}

impl AcpWorker {
   fn new() -> Self {
      Self {
         connection: None,
         session_id: None,
         process: None,
         io_handle: None,
         client: None,
         agent_id: None,
         app_handle: None,
      }
   }

   async fn initialize(
      &mut self,
      agent_id: String,
      workspace_path: Option<String>,
      config: AgentConfig,
      app_handle: AppHandle,
   ) -> Result<(AcpAgentStatus, mpsc::Sender<PermissionResponse>)> {
      // Stop any existing agent first
      self.stop().await?;

      if !config.installed {
         log::warn!(
            "Agent '{}' not marked as installed; attempting to start anyway",
            config.name
         );
      }

      log::info!(
         "Starting agent '{}' (binary: {}, args: {:?})",
         config.name,
         config.binary_name,
         config.args
      );

      // Build command
      let binary = config.binary_path.as_deref().unwrap_or(&config.binary_name);

      let mut cmd = Command::new(binary);
      cmd.args(&config.args)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped());

      // Set environment variables
      for (key, value) in &config.env_vars {
         cmd.env(key, value);
      }

      // Set working directory
      if let Some(ref path) = workspace_path {
         cmd.current_dir(path);
      }

      // Spawn process
      let mut child = cmd.spawn().context("Failed to spawn agent process")?;

      let stdin = child.stdin.take().context("Failed to get stdin")?;
      let stdout = child.stdout.take().context("Failed to get stdout")?;

      // Consume stderr and log it (helps debug agent startup issues)
      if let Some(stderr) = child.stderr.take() {
         let agent_name = config.name.clone();
         tokio::task::spawn_local(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
               log::warn!("[{}] stderr: {}", agent_name, line);
            }
         });
      }

      // Create ACP client
      let client = Arc::new(AthasAcpClient::new(
         app_handle.clone(),
         agent_id.clone(),
         workspace_path.clone(),
      ));
      let permission_sender = client.permission_sender();

      // Create ACP connection
      let (connection, io) = acp::ClientSideConnection::new(
         client.clone(),
         stdin.compat_write(),
         stdout.compat(),
         |fut| {
            tokio::task::spawn_local(fut);
         },
      );

      let connection = Arc::new(connection);

      // Spawn I/O handler on LocalSet
      let io_handle = tokio::task::spawn_local(async move {
         if let Err(e) = io.await {
            log::error!("ACP I/O error: {}", e);
         }
      });

      // Initialize connection with timeout
      let init_request = acp::InitializeRequest::new(acp::ProtocolVersion::LATEST)
         .client_capabilities(acp::ClientCapabilities::default())
         .client_info(acp::Implementation::new("Athas", env!("CARGO_PKG_VERSION")));

      log::info!("Sending ACP initialize request...");

      match tokio::time::timeout(
         std::time::Duration::from_secs(30),
         connection.initialize(init_request),
      )
      .await
      {
         Ok(Ok(_)) => {
            log::info!("ACP connection initialized successfully");
         }
         Ok(Err(e)) => {
            io_handle.abort();
            let _ = child.kill().await;
            bail!("Failed to initialize ACP connection: {}", e);
         }
         Err(_) => {
            io_handle.abort();
            let _ = child.kill().await;
            bail!(
               "ACP initialization timed out - agent may not support ACP protocol or requires \
                different arguments"
            );
         }
      }

      // Create session with timeout
      let cwd = workspace_path
         .clone()
         .map(std::path::PathBuf::from)
         .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

      log::info!("Creating ACP session in {:?}...", cwd);

      let session_request = acp::NewSessionRequest::new(cwd);
      let session_result = tokio::time::timeout(
         std::time::Duration::from_secs(30),
         connection.new_session(session_request),
      )
      .await;

      let (session_id, initial_modes) = match session_result {
         Ok(Ok(session)) => {
            log::info!("ACP session created: {}", session.session_id);
            client.set_session_id(session.session_id.to_string()).await;

            // Extract initial mode state if available
            let modes = session.modes.map(|m| SessionModeState {
               current_mode_id: Some(m.current_mode_id.to_string()),
               available_modes: m
                  .available_modes
                  .into_iter()
                  .map(|mode| SessionMode {
                     id: mode.id.to_string(),
                     name: mode.name,
                     description: mode.description,
                  })
                  .collect(),
            });

            (Some(session.session_id), modes)
         }
         Ok(Err(e)) => {
            log::error!("Failed to create ACP session: {}", e);
            io_handle.abort();
            let _ = child.kill().await;
            bail!("Failed to create ACP session: {}", e);
         }
         Err(_) => {
            log::error!("ACP session creation timed out");
            io_handle.abort();
            let _ = child.kill().await;
            bail!("ACP session creation timed out");
         }
      };

      // Emit initial session mode state if available
      if let (Some(sid), Some(mode_state)) = (&session_id, initial_modes)
         && let Err(e) = app_handle.emit(
            "acp-event",
            AcpEvent::SessionModeUpdate {
               session_id: sid.to_string(),
               mode_state,
            },
         )
      {
         log::warn!("Failed to emit initial session mode state: {}", e);
      }

      // Store state
      self.connection = Some(connection);
      self.session_id = session_id.clone();
      self.process = Some(child);
      self.io_handle = Some(io_handle);
      self.client = Some(client);
      self.agent_id = Some(agent_id.clone());
      self.app_handle = Some(app_handle.clone());

      let status = AcpAgentStatus {
         agent_id,
         running: true,
         session_active: session_id.is_some(),
         initialized: true,
      };

      Ok((status, permission_sender))
   }

   async fn send_prompt(&self, prompt: &str) -> Result<()> {
      let connection = self.connection.as_ref().context("No active connection")?;
      let session_id = self.session_id.as_ref().context("No active session")?;
      let app_handle = self
         .app_handle
         .as_ref()
         .context("No app handle available")?;

      let prompt_request = acp::PromptRequest::new(
         session_id.clone(),
         vec![acp::ContentBlock::Text(acp::TextContent::new(
            prompt.to_string(),
         ))],
      );

      let response = connection
         .prompt(prompt_request)
         .await
         .context("Failed to send prompt")?;

      // Emit prompt complete event with stop reason
      let stop_reason: StopReason = response.stop_reason.into();
      if let Err(e) = app_handle.emit(
         "acp-event",
         AcpEvent::PromptComplete {
            session_id: session_id.to_string(),
            stop_reason,
         },
      ) {
         log::warn!("Failed to emit prompt complete event: {}", e);
      }

      Ok(())
   }

   async fn cancel_prompt(&self) -> Result<()> {
      let connection = self.connection.as_ref().context("No active connection")?;
      let session_id = self.session_id.as_ref().context("No active session")?;

      let cancel_notification = acp::CancelNotification::new(session_id.clone());

      connection
         .cancel(cancel_notification)
         .await
         .context("Failed to cancel prompt")?;

      Ok(())
   }

   async fn set_mode(&self, mode_id: &str) -> Result<()> {
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

   async fn stop(&mut self) -> Result<()> {
      if let Some(handle) = self.io_handle.take() {
         handle.abort();
      }

      if let Some(mut process) = self.process.take() {
         let _ = process.kill().await;
      }

      self.connection = None;
      self.session_id = None;
      self.client = None;
      self.agent_id = None;
      self.app_handle = None;

      Ok(())
   }

   fn get_status(&self) -> AcpAgentStatus {
      match &self.agent_id {
         Some(agent_id) => AcpAgentStatus {
            agent_id: agent_id.clone(),
            running: true,
            session_active: self.session_id.is_some(),
            initialized: self.connection.is_some(),
         },
         None => AcpAgentStatus::default(),
      }
   }
}

/// Manages ACP agent connections via a dedicated worker thread
pub struct AcpAgentBridge {
   app_handle: AppHandle,
   registry: AgentRegistry,
   command_tx: mpsc::Sender<AcpCommand>,
   status: Arc<Mutex<AcpAgentStatus>>,
   permission_tx: Arc<Mutex<Option<mpsc::Sender<PermissionResponse>>>>,
}

impl AcpAgentBridge {
   pub fn new(app_handle: AppHandle) -> Self {
      let mut registry = AgentRegistry::new();
      registry.detect_installed();

      let (command_tx, command_rx) = mpsc::channel::<AcpCommand>(32);
      let status = Arc::new(Mutex::new(AcpAgentStatus::default()));
      let status_clone = status.clone();

      // Spawn the worker thread with its own runtime and LocalSet
      thread::spawn(move || {
         let rt = Runtime::new().expect("Failed to create Tokio runtime for ACP worker");
         let local = LocalSet::new();

         local.block_on(&rt, async move {
            Self::run_worker(command_rx, status_clone).await;
         });
      });

      Self {
         app_handle,
         registry,
         command_tx,
         status,
         permission_tx: Arc::new(Mutex::new(None)),
      }
   }

   async fn run_worker(
      mut command_rx: mpsc::Receiver<AcpCommand>,
      status: Arc<Mutex<AcpAgentStatus>>,
   ) {
      let mut worker = AcpWorker::new();

      while let Some(cmd) = command_rx.recv().await {
         match cmd {
            AcpCommand::Initialize {
               agent_id,
               workspace_path,
               config,
               env_vars,
               app_handle,
               response_tx,
            } => {
               let mut config = *config;
               for (key, value) in env_vars {
                  config.env_vars.insert(key, value);
               }
               let result = worker
                  .initialize(agent_id, workspace_path, config, app_handle)
                  .await;

               // Update shared status
               {
                  let mut s = status.lock().await;
                  *s = worker.get_status();
               }

               let _ = response_tx.send(result);
            }
            AcpCommand::SendPrompt {
               prompt,
               response_tx,
            } => {
               let result = worker.send_prompt(&prompt).await;
               let _ = response_tx.send(result);
            }
            AcpCommand::SetMode {
               mode_id,
               response_tx,
            } => {
               let result = worker.set_mode(&mode_id).await;
               let _ = response_tx.send(result);
            }
            AcpCommand::CancelPrompt { response_tx } => {
               let result = worker.cancel_prompt().await;
               let _ = response_tx.send(result);
            }
            AcpCommand::Stop { response_tx } => {
               let result = worker.stop().await;

               // Update shared status
               {
                  let mut s = status.lock().await;
                  *s = AcpAgentStatus::default();
               }

               let _ = response_tx.send(result);
            }
         }
      }
   }

   /// Detect which agents are installed on the system
   pub fn detect_agents(&mut self) -> Vec<AgentConfig> {
      self.registry.detect_installed();
      self.registry.list_all()
   }

   /// Start an ACP agent by ID
   pub async fn start_agent(
      &mut self,
      agent_id: &str,
      workspace_path: Option<String>,
      env_vars: std::collections::HashMap<String, String>,
   ) -> Result<AcpAgentStatus> {
      let mut config = self
         .registry
         .get(agent_id)
         .context("Agent not found")?
         .clone();

      // Runtime-provided env vars override static agent config.
      for (key, value) in &env_vars {
         config.env_vars.insert(key.clone(), value.clone());
      }

      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::Initialize {
            agent_id: agent_id.to_string(),
            workspace_path,
            config: Box::new(config),
            env_vars,
            app_handle: self.app_handle.clone(),
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
   pub async fn send_prompt(&self, prompt: &str) -> Result<()> {
      let (response_tx, response_rx) = oneshot::channel();

      self
         .command_tx
         .send(AcpCommand::SendPrompt {
            prompt: prompt.to_string(),
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
   ) -> Result<()> {
      let tx = self.permission_tx.lock().await;
      if let Some(ref sender) = *tx {
         sender
            .send(PermissionResponse {
               request_id,
               approved,
               cancelled,
            })
            .await
            .ok();
      }
      Ok(())
   }

   /// Stop the active agent
   pub async fn stop_agent(&mut self) -> Result<()> {
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
