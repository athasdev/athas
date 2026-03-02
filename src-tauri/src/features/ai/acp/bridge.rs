use super::{
   client::{AthasAcpClient, PermissionResponse},
   config::AgentRegistry,
   types::{AcpAgentStatus, AcpEvent, AgentConfig, SessionMode, SessionModeState, StopReason},
};
use crate::terminal::TerminalManager;
use acp::Agent;
use agent_client_protocol as acp;
use anyhow::{Context, Result, bail};
use serde_json::json;
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
#[allow(clippy::large_enum_variant)]
enum AcpCommand {
   Initialize {
      agent_id: String,
      workspace_path: Option<String>,
      session_id: Option<String>,
      config: Box<AgentConfig>,
      app_handle: AppHandle,
      terminal_manager: Arc<TerminalManager>,
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

   async fn ensure_process_alive(&mut self) -> Result<()> {
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
            self.app_handle = None;

            bail!("ACP agent process exited: {}", status);
         }
         Ok(None) => Ok(()),
         Err(e) => Err(anyhow::anyhow!("Failed to check ACP process status: {}", e)),
      }
   }

   async fn initialize(
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

      let binary = config.binary_path.as_deref().unwrap_or(&config.binary_name);
      log::info!(
         "Starting agent '{}' (binary: {}, resolved: {}, args: {:?})",
         config.name,
         config.binary_name,
         binary,
         config.args
      );

      // Build command

      let mut cmd = Command::new(binary);
      cmd.args(&config.args)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped());

      let uses_npx_codex_adapter = binary.ends_with("npx")
         && config
            .args
            .iter()
            .any(|arg| arg == "@zed-industries/codex-acp");

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
         workspace_path.clone(),
         terminal_manager,
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
      let mut client_meta = acp::Meta::new();
      client_meta.insert(
         "athas".to_string(),
         json!({
            "extensionMethods": [
               {
                  "name": "athas.openWebViewer",
                  "description": "Open a URL in Athas web viewer",
                  "params": { "url": "string" }
               },
               {
                  "name": "athas.openTerminal",
                  "description": "Open a terminal tab in Athas",
                  "params": { "command": "string|null" }
               }
            ],
            "notes": "Call these via ACP extension methods, not shell commands."
         }),
      );

      let client_capabilities = acp::ClientCapabilities::new()
         .fs(
            acp::FileSystemCapability::new()
               .read_text_file(true)
               .write_text_file(true),
         )
         .terminal(true)
         .meta(client_meta);

      let init_request = acp::InitializeRequest::new(acp::ProtocolVersion::LATEST)
         .client_capabilities(client_capabilities)
         .client_info(acp::Implementation::new("Athas", env!("CARGO_PKG_VERSION")));

      let initialize_timeout_secs = if uses_npx_codex_adapter { 120 } else { 30 };
      log::info!(
         "Sending ACP initialize request (timeout: {}s)...",
         initialize_timeout_secs
      );

      let init_response = match tokio::time::timeout(
         std::time::Duration::from_secs(initialize_timeout_secs),
         connection.initialize(init_request),
      )
      .await
      {
         Ok(Ok(response)) => {
            log::info!("ACP connection initialized successfully");
            response
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
      };

      let auth_methods = init_response.auth_methods.clone();

      // Create or load session with timeout
      let cwd = workspace_path
         .clone()
         .map(std::path::PathBuf::from)
         .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

      log::info!("Creating ACP session in {:?}...", cwd);

      let new_session = |connection: Arc<acp::ClientSideConnection>, cwd: std::path::PathBuf| async move {
         let session_request = acp::NewSessionRequest::new(cwd);
         tokio::time::timeout(
            std::time::Duration::from_secs(30),
            connection.new_session(session_request),
         )
         .await
      };

      let load_session = |connection: Arc<acp::ClientSideConnection>,
                          cwd: std::path::PathBuf,
                          existing_session_id: String| async move {
         let request = acp::LoadSessionRequest::new(existing_session_id, cwd);
         tokio::time::timeout(
            std::time::Duration::from_secs(30),
            connection.load_session(request),
         )
         .await
      };

      let authenticate = |connection: Arc<acp::ClientSideConnection>| {
         let auth_methods = auth_methods.clone();
         async move {
            if let Some(method) = auth_methods.first() {
               log::info!(
                  "Agent requires authentication, attempting ACP authenticate with method: {}",
                  method.id
               );
               let auth_request = acp::AuthenticateRequest::new(method.id.clone());
               match tokio::time::timeout(
                  std::time::Duration::from_secs(30),
                  connection.authenticate(auth_request),
               )
               .await
               {
                  Ok(Ok(_)) => Ok(()),
                  Ok(Err(e)) => Err(anyhow::anyhow!("ACP authentication failed: {}", e)),
                  Err(_) => Err(anyhow::anyhow!("ACP authentication timed out")),
               }
            } else {
               Err(anyhow::anyhow!(
                  "Agent requires authentication but did not advertise auth methods"
               ))
            }
         }
      };

      let mut active_session_id: Option<acp::SessionId> = None;
      let mut initial_modes: Option<SessionModeState> = None;

      if let Some(existing_session_id) = session_id.clone() {
         log::info!(
            "Attempting ACP session/load for session ID: {}",
            existing_session_id
         );
         let mut load_result =
            load_session(connection.clone(), cwd.clone(), existing_session_id.clone()).await;

         if let Ok(Err(err)) = &load_result
            && matches!(err.code, acp::ErrorCode::AuthRequired)
         {
            if let Err(e) = authenticate(connection.clone()).await {
               io_handle.abort();
               let _ = child.kill().await;
               bail!("{}", e);
            }
            load_result =
               load_session(connection.clone(), cwd.clone(), existing_session_id.clone()).await;
         }

         match load_result {
            Ok(Ok(load_response)) => {
               log::info!("ACP session loaded: {}", existing_session_id);
               active_session_id = Some(acp::SessionId::new(existing_session_id.clone()));
               client.set_session_id(existing_session_id).await;
               initial_modes = load_response.modes.map(|m| SessionModeState {
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
            }
            Ok(Err(err))
               if matches!(
                  err.code,
                  acp::ErrorCode::MethodNotFound | acp::ErrorCode::ResourceNotFound
               ) =>
            {
               log::warn!(
                  "ACP session/load unavailable or session missing ({}), falling back to \
                   session/new",
                  err
               );
            }
            Ok(Err(err)) => {
               io_handle.abort();
               let _ = child.kill().await;
               bail!(
                  "Failed to load ACP session {}: {}",
                  existing_session_id,
                  err
               );
            }
            Err(_) => {
               io_handle.abort();
               let _ = child.kill().await;
               bail!("ACP session/load timed out");
            }
         }
      }

      if active_session_id.is_none() {
         let mut session_result = new_session(connection.clone(), cwd.clone()).await;
         if let Ok(Err(err)) = &session_result
            && matches!(err.code, acp::ErrorCode::AuthRequired)
         {
            if let Err(e) = authenticate(connection.clone()).await {
               io_handle.abort();
               let _ = child.kill().await;
               bail!("{}", e);
            }
            log::info!("ACP authentication succeeded, retrying session creation");
            session_result = new_session(connection.clone(), cwd.clone()).await;
         }

         let session = match session_result {
            Ok(Ok(session)) => session,
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

         log::info!("ACP session created: {}", session.session_id);
         client.set_session_id(session.session_id.to_string()).await;
         initial_modes = session.modes.map(|m| SessionModeState {
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
         active_session_id = Some(session.session_id);
      }

      // Emit initial session mode state if available
      if let (Some(sid), Some(mode_state)) = (&active_session_id, initial_modes)
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
      self.session_id = active_session_id.clone();
      self.process = Some(child);
      self.io_handle = Some(io_handle);
      self.client = Some(client);
      self.agent_id = Some(agent_id.clone());
      self.app_handle = Some(app_handle.clone());

      let status = AcpAgentStatus {
         agent_id,
         running: true,
         session_active: active_session_id.is_some(),
         initialized: true,
         session_id: active_session_id.as_ref().map(ToString::to_string),
      };

      Ok((status, permission_sender))
   }

   async fn send_prompt(&mut self, prompt: &str) -> Result<()> {
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
      let prompt = prompt.to_string();

      tokio::task::spawn_local(async move {
         if let Err(err) =
            Self::run_prompt(connection, session_id.clone(), app_handle.clone(), prompt).await
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

   async fn run_prompt(
      connection: Arc<acp::ClientSideConnection>,
      session_id: acp::SessionId,
      app_handle: AppHandle,
      prompt: String,
   ) -> Result<()> {
      let prompt_request = acp::PromptRequest::new(
         session_id.clone(),
         vec![acp::ContentBlock::Text(acp::TextContent::new(prompt))],
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

   async fn cancel_prompt(&mut self) -> Result<()> {
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

   async fn set_mode(&mut self, mode_id: &str) -> Result<()> {
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
            session_id: self.session_id.as_ref().map(ToString::to_string),
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
         terminal_manager,
      }
   }

   async fn run_worker(
      mut command_rx: mpsc::Receiver<AcpCommand>,
      status: Arc<Mutex<AcpAgentStatus>>,
   ) {
      let mut worker = AcpWorker::new();
      let mut health_check = tokio::time::interval(std::time::Duration::from_secs(1));
      health_check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

      loop {
         tokio::select! {
            maybe_cmd = command_rx.recv() => {
               let Some(cmd) = maybe_cmd else {
                  break;
               };

               match cmd {
                  AcpCommand::Initialize {
                     agent_id,
                     workspace_path,
                     session_id,
                     config,
                     app_handle,
                     terminal_manager,
                     response_tx,
                  } => {
                     let result = worker
                        .initialize(
                           agent_id,
                           workspace_path,
                           session_id,
                           *config,
                           app_handle,
                           terminal_manager,
                        )
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
                     {
                        let mut s = status.lock().await;
                        *s = worker.get_status();
                     }
                     let _ = response_tx.send(result);
                  }
                  AcpCommand::SetMode {
                     mode_id,
                     response_tx,
                  } => {
                     let result = worker.set_mode(&mode_id).await;
                     {
                        let mut s = status.lock().await;
                        *s = worker.get_status();
                     }
                     let _ = response_tx.send(result);
                  }
                  AcpCommand::CancelPrompt { response_tx } => {
                     let result = worker.cancel_prompt().await;
                     {
                        let mut s = status.lock().await;
                        *s = worker.get_status();
                     }
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
            _ = health_check.tick() => {
               if let Err(err) = worker.ensure_process_alive().await {
                  log::warn!("ACP worker process health check failed: {}", err);
               }
               {
                  let mut s = status.lock().await;
                  *s = worker.get_status();
               }
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
