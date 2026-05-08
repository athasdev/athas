use super::{
   client::{AthasAcpClient, PermissionResponse},
   process::{force_kill_process_group, stop_child_tree_mut, terminate_process_group},
   types::{
      AcpAgentCapabilities, AcpEvent, AgentConfig, SessionConfigOption, SessionMode,
      SessionModeState,
   },
};
use crate::runtime::AthasAppHandle as AppHandle;
use acp::Agent;
use agent_client_protocol as acp;
use anyhow::{Result, bail};
use athas_terminal::TerminalManager;
use serde_json::json;
use std::{path::PathBuf, process::Stdio, sync::Arc};
use tauri::Emitter;
use tokio::{
   process::{Child, Command},
   sync::mpsc,
};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

pub(super) struct InitializedAcpWorker {
   pub connection: Arc<acp::ClientSideConnection>,
   pub session_id: Option<acp::SessionId>,
   pub auth_method_id: Option<String>,
   pub agent_capabilities: AcpAgentCapabilities,
   pub process: Child,
   pub process_group_id: Option<u32>,
   pub io_handle: tokio::task::JoinHandle<()>,
   pub client: Arc<AthasAcpClient>,
   pub permission_sender: mpsc::Sender<PermissionResponse>,
}

pub(super) async fn initialize_worker(
   config: &AgentConfig,
   workspace_path: Option<String>,
   app_handle: AppHandle,
   terminal_manager: Arc<TerminalManager>,
   requested_session_id: Option<String>,
   map_config_options: impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
) -> Result<InitializedAcpWorker> {
   let (mut child, uses_npx_codex_adapter) =
      spawn_agent_process(config, workspace_path.as_deref())?;
   let process_group_id = child.id();
   let stdin = child
      .stdin
      .take()
      .ok_or_else(|| anyhow::anyhow!("Failed to get stdin"))?;
   let stdout = child
      .stdout
      .take()
      .ok_or_else(|| anyhow::anyhow!("Failed to get stdout"))?;
   spawn_stderr_logger(&mut child, config.name.clone());

   let client = Arc::new(AthasAcpClient::new(
      app_handle.clone(),
      workspace_path.clone(),
      terminal_manager,
   ));
   let permission_sender = client.permission_sender();

   let (connection, io) = acp::ClientSideConnection::new(
      client.clone(),
      stdin.compat_write(),
      stdout.compat(),
      |fut| {
         tokio::task::spawn_local(fut);
      },
   );
   let connection = Arc::new(connection);
   let io_handle = tokio::task::spawn_local(async move {
      if let Err(e) = io.await {
         log::error!("ACP I/O error: {}", e);
      }
   });

   let init_response = initialize_connection(
      connection.clone(),
      uses_npx_codex_adapter,
      &mut child,
      &io_handle,
   )
   .await?;
   let auth_methods = init_response.auth_methods.clone();
   let auth_method_id = auth_methods.first().map(|method| method.id.to_string());
   let supports_session_resume = init_response
      .agent_capabilities
      .session_capabilities
      .resume
      .is_some();
   let agent_capabilities = init_response.agent_capabilities.into();

   let cwd = workspace_path
      .clone()
      .map(PathBuf::from)
      .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

   let session_bootstrap = bootstrap_session(
      connection.clone(),
      client.clone(),
      cwd,
      requested_session_id,
      SessionBootstrapContext {
         auth_methods,
         supports_session_resume,
         map_config_options,
         child: &mut child,
         io_handle: &io_handle,
      },
   )
   .await?;

   emit_initial_session_state(
      &app_handle,
      session_bootstrap.session_id.as_ref(),
      session_bootstrap.initial_modes,
      session_bootstrap.initial_config_options,
   );

   Ok(InitializedAcpWorker {
      connection,
      session_id: session_bootstrap.session_id,
      auth_method_id,
      agent_capabilities,
      process: child,
      process_group_id,
      io_handle,
      client,
      permission_sender,
   })
}

struct SessionBootstrap {
   session_id: Option<acp::SessionId>,
   initial_modes: Option<SessionModeState>,
   initial_config_options: Option<Vec<SessionConfigOption>>,
}

struct SessionBootstrapContext<'a, F>
where
   F: Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
{
   auth_methods: Vec<acp::AuthMethod>,
   supports_session_resume: bool,
   map_config_options: F,
   child: &'a mut Child,
   io_handle: &'a tokio::task::JoinHandle<()>,
}

fn configure_background_agent_command(command: &mut Command) {
   #[cfg(unix)]
   {
      command.process_group(0);
   }

   #[cfg(target_os = "windows")]
   {
      use std::os::windows::process::CommandExt;
      command.creation_flags(0x08000000);
   }
}

fn spawn_agent_process(
   config: &AgentConfig,
   workspace_path: Option<&str>,
) -> Result<(Child, bool)> {
   let binary = config.binary_path.as_deref().unwrap_or(&config.binary_name);
   log::info!(
      "Starting agent '{}' (binary: {}, resolved: {}, args: {:?})",
      config.name,
      config.binary_name,
      binary,
      config.args
   );

   let mut cmd = Command::new(binary);
   configure_background_agent_command(&mut cmd);
   cmd.args(&config.args)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

   // Augment PATH with user's shell PATH for bundled app launches
   if let Some(shell_path) = super::config::user_shell_path() {
      let current = std::env::var("PATH").unwrap_or_default();
      cmd.env("PATH", format!("{current}:{shell_path}"));
   }

   let uses_npx_codex_adapter = binary.ends_with("npx")
      && config
         .args
         .iter()
         .any(|arg| arg == "@zed-industries/codex-acp");

   for (key, value) in &config.env_vars {
      cmd.env(key, value);
   }

   if let Some(path) = workspace_path {
      cmd.current_dir(path);
   }

   Ok((cmd.spawn()?, uses_npx_codex_adapter))
}

fn spawn_stderr_logger(child: &mut Child, agent_name: String) {
   if let Some(stderr) = child.stderr.take() {
      tokio::task::spawn_local(async move {
         use tokio::io::{AsyncBufReadExt, BufReader};
         let mut lines = BufReader::new(stderr).lines();
         while let Ok(Some(line)) = lines.next_line().await {
            log::warn!("[{}] stderr: {}", agent_name, line);
         }
      });
   }
}

async fn initialize_connection(
   connection: Arc<acp::ClientSideConnection>,
   uses_npx_codex_adapter: bool,
   child: &mut Child,
   io_handle: &tokio::task::JoinHandle<()>,
) -> Result<acp::InitializeResponse> {
   let mut client_meta = acp::Meta::new();
   client_meta.insert(
      "athas".to_string(),
      json!({
         "extensionMethods": [
            { "name": "athas.openWebViewer", "description": "Open a URL in Athas web viewer", "params": { "url": "string" } },
            { "name": "athas.openTerminal", "description": "Open a terminal tab in Athas", "params": { "command": "string|null" } },
            { "name": "athas.setChatTitle", "description": "Rename the active Athas chat title", "params": { "title": "string" } }
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
      .client_info(acp::Implementation::new("athas", env!("CARGO_PKG_VERSION")).title("Athas"));

   let initialize_timeout_secs = if uses_npx_codex_adapter { 120 } else { 30 };
   log::info!(
      "Sending ACP initialize request (timeout: {}s)...",
      initialize_timeout_secs
   );

   match tokio::time::timeout(
      std::time::Duration::from_secs(initialize_timeout_secs),
      connection.initialize(init_request),
   )
   .await
   {
      Ok(Ok(response)) => {
         log::info!("ACP connection initialized successfully");
         Ok(response)
      }
      Ok(Err(e)) => {
         io_handle.abort();
         let process_group_id = child.id();
         stop_child_tree_mut(child, process_group_id).await;
         bail!("Failed to initialize ACP connection: {}", e);
      }
      Err(_) => {
         io_handle.abort();
         let process_group_id = child.id();
         stop_child_tree_mut(child, process_group_id).await;
         bail!(
            "ACP initialization timed out - agent may not support ACP protocol or requires \
             different arguments"
         );
      }
   }
}

async fn bootstrap_session(
   connection: Arc<acp::ClientSideConnection>,
   client: Arc<AthasAcpClient>,
   cwd: PathBuf,
   requested_session_id: Option<String>,
   ctx: SessionBootstrapContext<
      '_,
      impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
   >,
) -> Result<SessionBootstrap> {
   log::info!("Creating ACP session in {:?}...", cwd);

   let authenticate = |connection: Arc<acp::ClientSideConnection>| {
      let auth_methods = ctx.auth_methods.clone();
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

   if let Some(existing_session_id) = requested_session_id {
      let mut load_result =
         load_session(connection.clone(), cwd.clone(), existing_session_id.clone()).await;

      if let Ok(Err(err)) = &load_result
         && is_auth_required(err)
      {
         if let Err(e) = authenticate(connection.clone()).await {
            ctx.io_handle.abort();
            terminate_process_group(ctx.child.id());
            let _ = ctx.child.kill().await;
            bail!("{}", e);
         }
         load_result =
            load_session(connection.clone(), cwd.clone(), existing_session_id.clone()).await;
      }

      match load_result {
         Ok(Ok(load_response)) => {
            log::info!("ACP session loaded: {}", existing_session_id);
            client.set_session_id(existing_session_id.clone()).await;
            return Ok(bootstrap_from_loaded_session(
               existing_session_id,
               load_response,
               &ctx.map_config_options,
            ));
         }
         Ok(Err(err)) if should_try_resume_after_load(&err, ctx.supports_session_resume) => {
            log::warn!(
               "ACP session/load unavailable ({}), trying session/resume",
               err
            );
            let mut resume_result =
               resume_session(connection.clone(), cwd.clone(), existing_session_id.clone()).await;

            if let Ok(Err(err)) = &resume_result
               && is_auth_required(err)
            {
               if let Err(e) = authenticate(connection.clone()).await {
                  ctx.io_handle.abort();
                  terminate_process_group(ctx.child.id());
                  let _ = ctx.child.kill().await;
                  bail!("{}", e);
               }
               resume_result =
                  resume_session(connection.clone(), cwd.clone(), existing_session_id.clone())
                     .await;
            }

            match resume_result {
               Ok(Ok(resume_response)) => {
                  log::info!("ACP session resumed: {}", existing_session_id);
                  client.set_session_id(existing_session_id.clone()).await;
                  return Ok(bootstrap_from_resumed_session(
                     existing_session_id,
                     resume_response,
                     &ctx.map_config_options,
                  ));
               }
               Ok(Err(err)) if should_fallback_to_new_after_resume(&err) => {
                  log::warn!(
                     "ACP session/resume unavailable or session missing ({}), falling back to \
                      session/new",
                     err
                  );
               }
               Ok(Err(err)) => {
                  ctx.io_handle.abort();
                  terminate_process_group(ctx.child.id());
                  let _ = ctx.child.kill().await;
                  bail!(
                     "Failed to resume ACP session {}: {}",
                     existing_session_id,
                     err
                  );
               }
               Err(_) => {
                  ctx.io_handle.abort();
                  force_kill_process_group(ctx.child.id());
                  let _ = ctx.child.kill().await;
                  bail!("ACP session/resume timed out");
               }
            }
         }
         Ok(Err(err)) if should_fallback_to_new_after_load(&err) => {
            log::warn!(
               "ACP session/load unavailable or session missing ({}), falling back to session/new",
               err
            );
         }
         Ok(Err(err)) => {
            ctx.io_handle.abort();
            terminate_process_group(ctx.child.id());
            let _ = ctx.child.kill().await;
            bail!(
               "Failed to load ACP session {}: {}",
               existing_session_id,
               err
            );
         }
         Err(_) => {
            ctx.io_handle.abort();
            force_kill_process_group(ctx.child.id());
            let _ = ctx.child.kill().await;
            bail!("ACP session/load timed out");
         }
      }
   }

   let mut session_result = create_session(connection.clone(), cwd.clone()).await;
   if let Ok(Err(err)) = &session_result
      && is_auth_required(err)
   {
      if let Err(e) = authenticate(connection.clone()).await {
         ctx.io_handle.abort();
         terminate_process_group(ctx.child.id());
         let _ = ctx.child.kill().await;
         bail!("{}", e);
      }
      log::info!("ACP authentication succeeded, retrying session creation");
      session_result = create_session(connection.clone(), cwd).await;
   }

   let session = match session_result {
      Ok(Ok(session)) => session,
      Ok(Err(e)) => {
         log::error!("Failed to create ACP session: {}", e);
         ctx.io_handle.abort();
         terminate_process_group(ctx.child.id());
         let _ = ctx.child.kill().await;
         bail!("Failed to create ACP session: {}", e);
      }
      Err(_) => {
         log::error!("ACP session creation timed out");
         ctx.io_handle.abort();
         force_kill_process_group(ctx.child.id());
         let _ = ctx.child.kill().await;
         bail!("ACP session creation timed out");
      }
   };

   log::info!("ACP session created: {}", session.session_id);
   client.set_session_id(session.session_id.to_string()).await;

   Ok(bootstrap_from_new_session(session, &ctx.map_config_options))
}

fn is_auth_required(err: &acp::Error) -> bool {
   matches!(err.code, acp::ErrorCode::AuthRequired)
}

fn should_try_resume_after_load(err: &acp::Error, supports_session_resume: bool) -> bool {
   supports_session_resume && matches!(err.code, acp::ErrorCode::MethodNotFound)
}

fn should_fallback_to_new_after_load(err: &acp::Error) -> bool {
   matches!(
      err.code,
      acp::ErrorCode::MethodNotFound | acp::ErrorCode::ResourceNotFound
   )
}

fn should_fallback_to_new_after_resume(err: &acp::Error) -> bool {
   matches!(
      err.code,
      acp::ErrorCode::MethodNotFound | acp::ErrorCode::ResourceNotFound
   )
}

fn bootstrap_from_loaded_session(
   existing_session_id: String,
   load_response: acp::LoadSessionResponse,
   map_config_options: &impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
) -> SessionBootstrap {
   SessionBootstrap {
      session_id: Some(acp::SessionId::new(existing_session_id)),
      initial_modes: load_response.modes.map(map_mode_state),
      initial_config_options: load_response.config_options.map(map_config_options),
   }
}

fn bootstrap_from_resumed_session(
   existing_session_id: String,
   resume_response: acp::ResumeSessionResponse,
   map_config_options: &impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
) -> SessionBootstrap {
   SessionBootstrap {
      session_id: Some(acp::SessionId::new(existing_session_id)),
      initial_modes: resume_response.modes.map(map_mode_state),
      initial_config_options: resume_response.config_options.map(map_config_options),
   }
}

fn bootstrap_from_new_session(
   session: acp::NewSessionResponse,
   map_config_options: &impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
) -> SessionBootstrap {
   SessionBootstrap {
      session_id: Some(session.session_id),
      initial_modes: session.modes.map(map_mode_state),
      initial_config_options: session.config_options.map(map_config_options),
   }
}

async fn create_session(
   connection: Arc<acp::ClientSideConnection>,
   cwd: PathBuf,
) -> Result<Result<acp::NewSessionResponse, acp::Error>, tokio::time::error::Elapsed> {
   let session_request = acp::NewSessionRequest::new(cwd);
   tokio::time::timeout(
      std::time::Duration::from_secs(30),
      connection.new_session(session_request),
   )
   .await
}

async fn load_session(
   connection: Arc<acp::ClientSideConnection>,
   cwd: PathBuf,
   existing_session_id: String,
) -> Result<Result<acp::LoadSessionResponse, acp::Error>, tokio::time::error::Elapsed> {
   let request = acp::LoadSessionRequest::new(existing_session_id, cwd);
   tokio::time::timeout(
      std::time::Duration::from_secs(30),
      connection.load_session(request),
   )
   .await
}

async fn resume_session(
   connection: Arc<acp::ClientSideConnection>,
   cwd: PathBuf,
   existing_session_id: String,
) -> Result<Result<acp::ResumeSessionResponse, acp::Error>, tokio::time::error::Elapsed> {
   let request = acp::ResumeSessionRequest::new(existing_session_id, cwd);
   tokio::time::timeout(
      std::time::Duration::from_secs(30),
      connection.resume_session(request),
   )
   .await
}

fn map_mode_state(modes: acp::SessionModeState) -> SessionModeState {
   SessionModeState {
      current_mode_id: Some(modes.current_mode_id.to_string()),
      available_modes: modes
         .available_modes
         .into_iter()
         .map(|mode| SessionMode {
            id: mode.id.to_string(),
            name: mode.name,
            description: mode.description,
         })
         .collect(),
   }
}

fn emit_initial_session_state(
   app_handle: &AppHandle,
   session_id: Option<&acp::SessionId>,
   initial_modes: Option<SessionModeState>,
   initial_config_options: Option<Vec<SessionConfigOption>>,
) {
   if let (Some(sid), Some(mode_state)) = (session_id, initial_modes)
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

   if let (Some(sid), Some(config_options)) = (session_id, initial_config_options)
      && let Err(e) = app_handle.emit(
         "acp-event",
         AcpEvent::ConfigOptionsUpdate {
            session_id: sid.to_string(),
            config_options,
         },
      )
   {
      log::warn!("Failed to emit initial session config options: {}", e);
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   fn no_config_options(_: Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption> {
      Vec::new()
   }

   #[test]
   fn loaded_session_bootstrap_preserves_requested_session_id() {
      let bootstrap = bootstrap_from_loaded_session(
         "existing-session".to_string(),
         acp::LoadSessionResponse::new(),
         &no_config_options,
      );

      assert_eq!(
         bootstrap.session_id.map(|id| id.to_string()),
         Some("existing-session".to_string())
      );
      assert!(bootstrap.initial_modes.is_none());
      assert!(bootstrap.initial_config_options.is_none());
   }

   #[test]
   fn method_not_found_load_uses_resume_only_when_supported() {
      let err = acp::Error::method_not_found();

      assert!(should_try_resume_after_load(&err, true));
      assert!(!should_try_resume_after_load(&err, false));
   }

   #[test]
   fn missing_or_unsupported_load_falls_back_to_new_session() {
      assert!(should_fallback_to_new_after_load(
         &acp::Error::method_not_found()
      ));
      assert!(should_fallback_to_new_after_load(
         &acp::Error::resource_not_found(None)
      ));
      assert!(!should_fallback_to_new_after_load(
         &acp::Error::invalid_params()
      ));
   }

   #[test]
   fn missing_or_unsupported_resume_falls_back_to_new_session() {
      assert!(should_fallback_to_new_after_resume(
         &acp::Error::method_not_found()
      ));
      assert!(should_fallback_to_new_after_resume(
         &acp::Error::resource_not_found(None)
      ));
      assert!(!should_fallback_to_new_after_resume(
         &acp::Error::internal_error()
      ));
   }

   #[test]
   fn auth_required_errors_are_retriable_before_session_fallbacks() {
      assert!(is_auth_required(&acp::Error::auth_required()));
      assert!(!is_auth_required(&acp::Error::method_not_found()));
      assert!(!should_fallback_to_new_after_load(
         &acp::Error::auth_required()
      ));
      assert!(!should_fallback_to_new_after_resume(
         &acp::Error::auth_required()
      ));
   }

   #[test]
   fn new_session_bootstrap_uses_agent_created_session_id() {
      let bootstrap = bootstrap_from_new_session(
         acp::NewSessionResponse::new("created-session"),
         &no_config_options,
      );

      assert_eq!(
         bootstrap.session_id.map(|id| id.to_string()),
         Some("created-session".to_string())
      );
      assert!(bootstrap.initial_modes.is_none());
      assert!(bootstrap.initial_config_options.is_none());
   }
}
