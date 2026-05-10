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
   let (mut child, uses_lazy_package_runner) =
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
      uses_lazy_package_runner,
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
         default_mode: config.default_mode.clone(),
         default_model: config.default_model.clone(),
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
   default_mode: Option<String>,
   default_model: Option<String>,
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
   let args = launch_args(config);
   log::info!(
      "Starting agent '{}' (binary: {}, resolved: {}, args: {:?})",
      config.name,
      config.binary_name,
      binary,
      args
   );

   let mut cmd = Command::new(binary);
   configure_background_agent_command(&mut cmd);
   cmd.args(&args)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

   // Augment PATH with user's shell PATH for bundled app launches
   if let Some(shell_path) = super::config::user_shell_path() {
      let current = std::env::var("PATH").unwrap_or_default();
      cmd.env("PATH", format!("{current}:{shell_path}"));
   }

   let uses_lazy_package_runner = binary.ends_with("npx") && args.iter().any(|arg| arg == "-y");

   for (key, value) in &config.env_vars {
      cmd.env(key, value);
   }

   if let Some(path) = workspace_path {
      cmd.current_dir(path);
   }

   Ok((cmd.spawn()?, uses_lazy_package_runner))
}

fn launch_args(config: &AgentConfig) -> Vec<String> {
   if config.id != "qwen-code" {
      return config.args.clone();
   }

   let mut args = config
      .args
      .iter()
      .filter(|arg| arg.as_str() != "--experimental-skills")
      .map(|arg| {
         if arg == "--acp" || arg == "acp" {
            "--experimental-acp".to_string()
         } else {
            arg.clone()
         }
      })
      .collect::<Vec<_>>();

   if !args.iter().any(|arg| arg == "--experimental-acp") {
      args.push("--experimental-acp".to_string());
   }

   args
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
   uses_lazy_package_runner: bool,
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

   let initialize_timeout_secs = if uses_lazy_package_runner { 120 } else { 30 };
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
         && matches!(err.code, acp::ErrorCode::AuthRequired)
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
            apply_session_defaults(
               connection.clone(),
               acp::SessionId::new(existing_session_id.clone()),
               ctx.default_mode.as_deref(),
               ctx.default_model.as_deref(),
               load_response.config_options.as_ref(),
            )
            .await;
            log::info!("ACP session loaded: {}", existing_session_id);
            client.set_session_id(existing_session_id.clone()).await;
            return Ok(SessionBootstrap {
               session_id: Some(acp::SessionId::new(existing_session_id)),
               initial_modes: load_response.modes.map(map_mode_state),
               initial_config_options: load_response.config_options.map(&ctx.map_config_options),
            });
         }
         Ok(Err(err))
            if matches!(err.code, acp::ErrorCode::MethodNotFound)
               && ctx.supports_session_resume =>
         {
            log::warn!(
               "ACP session/load unavailable ({}), trying session/resume",
               err
            );
            let mut resume_result =
               resume_session(connection.clone(), cwd.clone(), existing_session_id.clone()).await;

            if let Ok(Err(err)) = &resume_result
               && matches!(err.code, acp::ErrorCode::AuthRequired)
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
                  apply_session_defaults(
                     connection.clone(),
                     acp::SessionId::new(existing_session_id.clone()),
                     ctx.default_mode.as_deref(),
                     ctx.default_model.as_deref(),
                     resume_response.config_options.as_ref(),
                  )
                  .await;
                  log::info!("ACP session resumed: {}", existing_session_id);
                  client.set_session_id(existing_session_id.clone()).await;
                  return Ok(SessionBootstrap {
                     session_id: Some(acp::SessionId::new(existing_session_id)),
                     initial_modes: resume_response.modes.map(map_mode_state),
                     initial_config_options: resume_response
                        .config_options
                        .map(&ctx.map_config_options),
                  });
               }
               Ok(Err(err))
                  if matches!(
                     err.code,
                     acp::ErrorCode::MethodNotFound | acp::ErrorCode::ResourceNotFound
                  ) =>
               {
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
         Ok(Err(err))
            if matches!(
               err.code,
               acp::ErrorCode::MethodNotFound | acp::ErrorCode::ResourceNotFound
            ) =>
         {
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
      && matches!(err.code, acp::ErrorCode::AuthRequired)
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
   apply_session_defaults(
      connection.clone(),
      session.session_id.clone(),
      ctx.default_mode.as_deref(),
      ctx.default_model.as_deref(),
      session.config_options.as_ref(),
   )
   .await;
   client.set_session_id(session.session_id.to_string()).await;

   Ok(SessionBootstrap {
      session_id: Some(session.session_id),
      initial_modes: session.modes.map(map_mode_state),
      initial_config_options: session.config_options.map(ctx.map_config_options),
   })
}

async fn create_session(
   connection: Arc<acp::ClientSideConnection>,
   cwd: PathBuf,
) -> Result<Result<acp::NewSessionResponse, acp::Error>, tokio::time::error::Elapsed> {
   let session_request = new_session_request(cwd);
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
   let request = load_session_request(existing_session_id, cwd);
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
   let request = resume_session_request(existing_session_id, cwd);
   tokio::time::timeout(
      std::time::Duration::from_secs(30),
      connection.resume_session(request),
   )
   .await
}

fn new_session_request(cwd: PathBuf) -> acp::NewSessionRequest {
   acp::NewSessionRequest::new(cwd)
}

fn load_session_request(existing_session_id: String, cwd: PathBuf) -> acp::LoadSessionRequest {
   acp::LoadSessionRequest::new(existing_session_id, cwd)
}

fn resume_session_request(existing_session_id: String, cwd: PathBuf) -> acp::ResumeSessionRequest {
   acp::ResumeSessionRequest::new(existing_session_id, cwd)
}

async fn apply_session_defaults(
   connection: Arc<acp::ClientSideConnection>,
   session_id: acp::SessionId,
   default_mode: Option<&str>,
   default_model: Option<&str>,
   config_options: Option<&Vec<acp::SessionConfigOption>>,
) {
   if let Some(mode_id) = default_mode.filter(|mode| !mode.trim().is_empty())
      && let Err(error) = connection
         .set_session_mode(acp::SetSessionModeRequest::new(
            session_id.clone(),
            mode_id.to_string(),
         ))
         .await
   {
      log::warn!("Failed to apply ACP default mode '{}': {}", mode_id, error);
   }

   let Some(model_id) = default_model.filter(|model| !model.trim().is_empty()) else {
      return;
   };
   let Some(config_id) = model_config_option_id(config_options) else {
      log::debug!(
         "ACP default model '{}' configured, but the agent did not expose a model config option",
         model_id
      );
      return;
   };

   if let Err(error) = connection
      .set_session_config_option(acp::SetSessionConfigOptionRequest::new(
         session_id,
         config_id,
         model_id.to_string(),
      ))
      .await
   {
      log::warn!(
         "Failed to apply ACP default model '{}': {}",
         model_id,
         error
      );
   }
}

fn model_config_option_id(
   config_options: Option<&Vec<acp::SessionConfigOption>>,
) -> Option<String> {
   config_options?
      .iter()
      .find(|option| {
         option.id.to_string() == "model" || option.category.as_deref() == Some("model")
      })
      .map(|option| option.id.to_string())
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

   #[test]
   fn new_session_request_sets_cwd() {
      let request = new_session_request(PathBuf::from("/repo"));

      assert_eq!(request.cwd, PathBuf::from("/repo"));
      assert!(request.mcp_servers.is_empty());
   }

   #[test]
   fn load_session_request_sets_session_and_cwd() {
      let request = load_session_request("session-1".to_string(), PathBuf::from("/repo"));

      assert_eq!(request.session_id, acp::SessionId::new("session-1"));
      assert_eq!(request.cwd, PathBuf::from("/repo"));
      assert!(request.mcp_servers.is_empty());
   }

   #[test]
   fn resume_session_request_sets_session_and_cwd() {
      let request = resume_session_request("session-1".to_string(), PathBuf::from("/repo"));

      assert_eq!(request.session_id, acp::SessionId::new("session-1"));
      assert_eq!(request.cwd, PathBuf::from("/repo"));
      assert!(request.mcp_servers.is_empty());
   }

   #[test]
   fn qwen_launch_args_use_current_acp_flag() {
      let mut config = AgentConfig::new("qwen-code", "Qwen Code", "qwen");
      config.args = vec![
         "--acp".to_string(),
         "--experimental-skills".to_string(),
         "--other".to_string(),
      ];

      assert_eq!(
         launch_args(&config),
         vec!["--experimental-acp".to_string(), "--other".to_string()]
      );
   }
}
