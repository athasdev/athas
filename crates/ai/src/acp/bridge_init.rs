use super::{
   AcpConnection,
   auth::{
      ACP_AUTHENTICATE_TIMEOUT, AuthenticationRequired, LEGACY_TERMINAL_AUTH_META_KEY,
      describe_auth_methods, startup_auth_method,
   },
   client::{AthasAcpClient, ClientResponders},
   mcp_servers::{AcpSkippedMcpServer, McpServerConfig, select_mcp_servers},
   process::{
      force_kill_process_group, stop_child_tree, stop_child_tree_mut, terminate_process_group,
   },
   types::{
      AcpAgentCapabilities, AcpAuthMethod, AcpEvent, AgentConfig, SessionConfigOption, SessionMode,
      SessionModeState,
   },
   workspace_path::{path_to_string, resolve_workspace_path},
};
use crate::{executable_path::find_executable, runtime::AthasAppHandle as AppHandle};
use agent_client_protocol::{
   self as acp_sdk,
   schema::{ProtocolVersion, v1 as acp},
};
use anyhow::{Result, bail};
use athas_terminal::TerminalManager;
use serde_json::json;
use std::{
   collections::VecDeque,
   path::{Path, PathBuf},
   process::Stdio,
   sync::Arc,
};
use tauri::Emitter;
use tokio::{
   process::{Child, Command},
   sync::Mutex,
};
use tokio_util::{
   compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt},
   sync::CancellationToken,
};

pub(super) struct InitializedAcpWorker {
   pub connection: Arc<AcpConnection>,
   pub session_id: Option<acp::SessionId>,
   pub auth_methods: Vec<acp::AuthMethod>,
   pub described_auth_methods: Vec<AcpAuthMethod>,
   pub agent_capabilities: AcpAgentCapabilities,
   /// Configured MCP servers the agent cannot take, reported to the user.
   pub skipped_mcp_servers: Vec<AcpSkippedMcpServer>,
   pub process: Child,
   pub process_group_id: Option<u32>,
   pub io_handle: tokio::task::JoinHandle<()>,
   pub client: Arc<AthasAcpClient>,
   pub responders: ClientResponders,
   pub workspace_path: Option<PathBuf>,
}

impl InitializedAcpWorker {
   /// Stops an agent that finished starting after the user already asked to stop it.
   pub(super) async fn shut_down(self) {
      self.io_handle.abort();
      stop_child_tree(self.process, self.process_group_id).await;
   }
}

const MAX_RECENT_STDERR_LINES: usize = 20;
pub(super) const ACP_STARTUP_STOPPED: &str = "ACP agent startup was stopped";
type RecentAgentStderr = Arc<Mutex<VecDeque<String>>>;

/// How startup may sign in when the agent asks for it.
#[derive(Debug, Clone, Default)]
pub(super) struct StartupAuth {
   /// The method the user picked after an earlier attempt needed sign-in.
   pub chosen_method_id: Option<String>,
   /// Whether a lone `authenticate` method may be used without asking. Off after a logout, so
   /// the user chooses again.
   pub allow_automatic: bool,
}

pub(super) async fn initialize_worker(
   config: &AgentConfig,
   workspace_path: Option<String>,
   app_handle: AppHandle,
   terminal_manager: Arc<TerminalManager>,
   requested_session_id: Option<String>,
   startup_auth: StartupAuth,
   mcp_servers: &[McpServerConfig],
   map_config_options: impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
   stop: CancellationToken,
) -> Result<InitializedAcpWorker> {
   let workspace_path = resolve_workspace_path(workspace_path)?;
   let mut child = spawn_agent_process(config, workspace_path.as_deref())?;
   let process_group_id = child.id();
   let stdin = child
      .stdin
      .take()
      .ok_or_else(|| anyhow::anyhow!("Failed to get stdin"))?;
   let stdout = child
      .stdout
      .take()
      .ok_or_else(|| anyhow::anyhow!("Failed to get stdout"))?;
   let recent_stderr = spawn_stderr_logger(&mut child, config.name.clone());

   let client = Arc::new(AthasAcpClient::new(
      app_handle.clone(),
      workspace_path.clone(),
      terminal_manager,
   ));
   let responders = client.responders();

   let (connection_tx, connection_rx) = tokio::sync::oneshot::channel();
   let request_client = client.clone();
   let notification_client = client.clone();
   let io_handle = tokio::task::spawn_local(async move {
      let transport = acp_sdk::ByteStreams::new(stdin.compat_write(), stdout.compat());
      let result = acp_sdk::Client
         .builder()
         .on_receive_request(
            // Requests like permissions and questions wait on the user, so they run off the
            // dispatch loop: session updates, `$/cancel_request` and further requests keep
            // flowing.
            async move |request: acp::AgentRequest, responder, connection: AcpConnection| {
               let client = request_client.clone();
               let cancellation = responder.cancellation();
               connection.spawn(async move {
                  let response = cancellation
                     .run_until_cancelled(client.handle_agent_request(request))
                     .await
                     .and_then(|response| {
                        serde_json::to_value(response).map_err(acp_sdk::Error::into_internal_error)
                     });
                  responder.respond_with_result(response)
               })
            },
            acp_sdk::on_receive_request!(),
         )
         .on_receive_notification(
            async move |notification: acp::AgentNotification, connection| {
               notification_client
                  .handle_agent_notification(notification, connection)
                  .await
            },
            acp_sdk::on_receive_notification!(),
         )
         .connect_with(transport, async move |connection: AcpConnection| {
            let _ = connection_tx.send(connection);
            std::future::pending::<acp_sdk::Result<()>>().await
         })
         .await;

      if let Err(e) = result {
         log::error!("ACP I/O error: {}", e);
      }
   });
   // Startup can take minutes (a first `npx` download, a slow login), so Stop must be able to
   // end it: the process is killed and the caller hears that startup was stopped.
   let startup = async {
      let connection = Arc::new(
         connection_rx
            .await
            .map_err(|_| anyhow::anyhow!("Failed to establish ACP connection"))?,
      );

      let init_response = initialize_connection(connection.clone(), &mut child, &io_handle).await?;
      let auth_methods = init_response.auth_methods.clone();
      let described_auth_methods = describe_auth_methods(&auth_methods, config);
      let supports_session_resume = init_response
         .agent_capabilities
         .session_capabilities
         .resume
         .is_some();
      let agent_capabilities: AcpAgentCapabilities = init_response.agent_capabilities.into();
      let mcp_selection = select_mcp_servers(
         mcp_servers,
         &agent_capabilities.mcp_capabilities,
         find_executable,
      );
      if !mcp_selection.servers.is_empty() || !mcp_selection.skipped.is_empty() {
         log::info!(
            "Offering {} MCP server(s) to {}; skipped {} the agent does not support",
            mcp_selection.servers.len(),
            config.name,
            mcp_selection.skipped.len()
         );
      }

      let cwd = workspace_path
         .clone()
         .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
      log::info!(
         "ACP workspace path resolved to {}",
         path_to_string(cwd.as_path())
      );

      let session_bootstrap = bootstrap_session(
         connection.clone(),
         client.clone(),
         cwd,
         requested_session_id,
         SessionBootstrapContext {
            auth_methods: &auth_methods,
            startup_auth,
            supports_session_resume,
            mcp_servers: &mcp_selection.servers,
            map_config_options,
            child: &mut child,
            io_handle: &io_handle,
         },
      )
      .await;
      let session_bootstrap = match session_bootstrap {
         Ok(session) => session,
         Err(error) => {
            if error.is::<AuthenticationRequired>()
               && let Err(emit_error) = app_handle.emit(
                  "acp-event",
                  AcpEvent::AuthRequired {
                     agent_id: config.id.clone(),
                     session_id: None,
                     methods: described_auth_methods,
                  },
               )
            {
               log::warn!("Failed to emit ACP auth required event: {}", emit_error);
            }
            tokio::task::yield_now().await;
            return Err(with_agent_stderr(error, &recent_stderr).await);
         }
      };

      Ok::<_, anyhow::Error>((
         connection,
         auth_methods,
         described_auth_methods,
         agent_capabilities,
         mcp_selection.skipped,
         session_bootstrap,
      ))
   };
   let outcome = tokio::select! {
      result = startup => Some(result),
      () = stop.cancelled() => None,
   };
   let Some(result) = outcome else {
      io_handle.abort();
      stop_child_tree_mut(&mut child, process_group_id).await;
      bail!(ACP_STARTUP_STOPPED);
   };
   let (
      connection,
      auth_methods,
      described_auth_methods,
      agent_capabilities,
      skipped_mcp_servers,
      session_bootstrap,
   ) = result?;

   emit_initial_session_state(
      &app_handle,
      session_bootstrap.session_id.as_ref(),
      session_bootstrap.initial_modes,
      session_bootstrap.initial_config_options,
   );

   Ok(InitializedAcpWorker {
      connection,
      session_id: session_bootstrap.session_id,
      auth_methods,
      described_auth_methods,
      agent_capabilities,
      skipped_mcp_servers,
      process: child,
      process_group_id,
      io_handle,
      client,
      responders,
      workspace_path,
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
   auth_methods: &'a [acp::AuthMethod],
   startup_auth: StartupAuth,
   supports_session_resume: bool,
   /// Sent in `session/new`, `session/load` and `session/resume`.
   mcp_servers: &'a [acp::McpServer],
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

fn spawn_agent_process(config: &AgentConfig, workspace_path: Option<&Path>) -> Result<Child> {
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
   if let Some(shell_path) = crate::executable_path::user_shell_path() {
      let current = std::env::var("PATH").unwrap_or_default();
      cmd.env("PATH", format!("{current}:{shell_path}"));
   }

   for (key, value) in &config.env_vars {
      cmd.env(key, value);
   }

   if let Some(path) = workspace_path {
      cmd.current_dir(path);
   }

   Ok(cmd.spawn()?)
}

fn spawn_stderr_logger(child: &mut Child, agent_name: String) -> RecentAgentStderr {
   let recent_stderr = Arc::new(Mutex::new(VecDeque::new()));
   if let Some(stderr) = child.stderr.take() {
      let captured_stderr = recent_stderr.clone();
      tokio::task::spawn_local(async move {
         use tokio::io::{AsyncBufReadExt, BufReader};
         let mut lines = BufReader::new(stderr).lines();
         while let Ok(Some(line)) = lines.next_line().await {
            log::warn!("[{}] stderr: {}", agent_name, line);
            let mut recent = captured_stderr.lock().await;
            recent.push_back(line);
            if recent.len() > MAX_RECENT_STDERR_LINES {
               recent.pop_front();
            }
         }
      });
   }
   recent_stderr
}

async fn with_agent_stderr(
   error: anyhow::Error,
   recent_stderr: &RecentAgentStderr,
) -> anyhow::Error {
   let recent = recent_stderr.lock().await;
   let Some(detail) = relevant_agent_stderr(&recent) else {
      return error;
   };

   anyhow::anyhow!("{}. Agent stderr: {}", error, detail)
}

fn relevant_agent_stderr(lines: &VecDeque<String>) -> Option<String> {
   let line = lines
      .iter()
      .rev()
      .find(|line| {
         let normalized = line.to_lowercase();
         normalized.contains("authentication failed")
            || normalized.contains("requires setting")
            || normalized.contains("error:")
      })
      .or_else(|| lines.back())?;

   let normalized = line.split_whitespace().collect::<Vec<_>>().join(" ");
   (!normalized.is_empty()).then_some(normalized)
}

/// What Athas can do for agents, sent in `initialize`.
fn client_capabilities() -> acp::ClientCapabilities {
   let mut client_meta = acp::Meta::new();
   client_meta.insert(
      "athas.dev".to_string(),
      json!({
         "extensionMethods": [
            { "name": "_athas/open_terminal", "description": "Open a terminal tab in Athas", "params": { "command": "string|null" } },
            { "name": "_athas/set_chat_title", "description": "Rename the active Athas chat title", "params": { "title": "string" } }
         ]
      }),
   );
   // Agents that predate `auth.terminal` describe terminal sign-in under this key instead.
   client_meta.insert(LEGACY_TERMINAL_AUTH_META_KEY.to_string(), json!(true));

   acp::ClientCapabilities::new()
      .fs(
         acp::FileSystemCapabilities::new()
            .read_text_file(true)
            .write_text_file(true),
      )
      .terminal(true)
      .auth(acp::AuthCapabilities::new().terminal(true))
      .elicitation(
         acp::ElicitationCapabilities::new()
            .form(acp::ElicitationFormCapabilities::new())
            .url(acp::ElicitationUrlCapabilities::new()),
      )
      .session(
         acp::ClientSessionCapabilities::new().config_options(
            acp::SessionConfigOptionsCapabilities::new()
               .boolean(acp::BooleanConfigOptionCapabilities::new()),
         ),
      )
      .meta(client_meta)
}

async fn initialize_connection(
   connection: Arc<AcpConnection>,
   child: &mut Child,
   io_handle: &tokio::task::JoinHandle<()>,
) -> Result<acp::InitializeResponse> {
   let init_request = acp::InitializeRequest::new(ProtocolVersion::LATEST)
      .client_capabilities(client_capabilities())
      .client_info(acp::Implementation::new("athas", env!("CARGO_PKG_VERSION")).title("Athas"));

   // A first run through `npx` downloads the agent before it can answer, so initialize gets
   // longer than the other startup steps. Stop ends startup at any point.
   let initialize_timeout_secs = 120;
   log::info!(
      "Sending ACP initialize request (timeout: {}s)...",
      initialize_timeout_secs
   );

   match tokio::time::timeout(
      std::time::Duration::from_secs(initialize_timeout_secs),
      connection.send_request(init_request).block_task(),
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
   connection: Arc<AcpConnection>,
   client: Arc<AthasAcpClient>,
   cwd: PathBuf,
   requested_session_id: Option<String>,
   ctx: SessionBootstrapContext<
      '_,
      impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
   >,
) -> Result<SessionBootstrap> {
   log::info!("Creating ACP session in {:?}...", cwd);

   // Terminal methods are never sent here: the user runs them, and startup is retried after.
   let authenticate = |connection: Arc<AcpConnection>| {
      let method = startup_auth_method(
         ctx.auth_methods,
         ctx.startup_auth.chosen_method_id.as_deref(),
         ctx.startup_auth.allow_automatic,
      );
      async move {
         let Some(method_id) = method? else {
            return Err(AuthenticationRequired.into());
         };
         log::info!(
            "Agent requires authentication, attempting ACP authenticate with method: {}",
            method_id
         );
         let auth_request = acp::AuthenticateRequest::new(method_id);
         match tokio::time::timeout(
            ACP_AUTHENTICATE_TIMEOUT,
            connection.send_request(auth_request).block_task(),
         )
         .await
         {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(e)) => Err(anyhow::anyhow!("ACP authentication failed: {}", e)),
            Err(_) => Err(anyhow::anyhow!("ACP authentication timed out")),
         }
      }
   };

   if let Some(existing_session_id) = requested_session_id {
      let mut load_result = load_session(
         connection.clone(),
         cwd.clone(),
         existing_session_id.clone(),
         ctx.mcp_servers,
      )
      .await;

      if let Ok(Err(err)) = &load_result
         && matches!(err.code, acp::ErrorCode::AuthRequired)
      {
         if let Err(e) = authenticate(connection.clone()).await {
            ctx.io_handle.abort();
            terminate_process_group(ctx.child.id());
            let _ = ctx.child.kill().await;
            return Err(e);
         }
         load_result = load_session(
            connection.clone(),
            cwd.clone(),
            existing_session_id.clone(),
            ctx.mcp_servers,
         )
         .await;
      }

      match load_result {
         Ok(Ok(load_response)) => {
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
            let mut resume_result = resume_session(
               connection.clone(),
               cwd.clone(),
               existing_session_id.clone(),
               ctx.mcp_servers,
            )
            .await;

            if let Ok(Err(err)) = &resume_result
               && matches!(err.code, acp::ErrorCode::AuthRequired)
            {
               if let Err(e) = authenticate(connection.clone()).await {
                  ctx.io_handle.abort();
                  terminate_process_group(ctx.child.id());
                  let _ = ctx.child.kill().await;
                  return Err(e);
               }
               resume_result = resume_session(
                  connection.clone(),
                  cwd.clone(),
                  existing_session_id.clone(),
                  ctx.mcp_servers,
               )
               .await;
            }

            match resume_result {
               Ok(Ok(resume_response)) => {
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

   let mut session_result = create_session(connection.clone(), cwd.clone(), ctx.mcp_servers).await;
   if let Ok(Err(err)) = &session_result
      && matches!(err.code, acp::ErrorCode::AuthRequired)
   {
      if let Err(e) = authenticate(connection.clone()).await {
         ctx.io_handle.abort();
         terminate_process_group(ctx.child.id());
         let _ = ctx.child.kill().await;
         return Err(e);
      }
      log::info!("ACP authentication succeeded, retrying session creation");
      session_result = create_session(connection.clone(), cwd, ctx.mcp_servers).await;
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

   Ok(SessionBootstrap {
      session_id: Some(session.session_id),
      initial_modes: session.modes.map(map_mode_state),
      initial_config_options: session.config_options.map(ctx.map_config_options),
   })
}

async fn create_session(
   connection: Arc<AcpConnection>,
   cwd: PathBuf,
   mcp_servers: &[acp::McpServer],
) -> Result<Result<acp::NewSessionResponse, acp::Error>, tokio::time::error::Elapsed> {
   let session_request = acp::NewSessionRequest::new(cwd).mcp_servers(mcp_servers.to_vec());
   tokio::time::timeout(
      std::time::Duration::from_secs(30),
      connection.send_request(session_request).block_task(),
   )
   .await
}

async fn load_session(
   connection: Arc<AcpConnection>,
   cwd: PathBuf,
   existing_session_id: String,
   mcp_servers: &[acp::McpServer],
) -> Result<Result<acp::LoadSessionResponse, acp::Error>, tokio::time::error::Elapsed> {
   let request =
      acp::LoadSessionRequest::new(existing_session_id, cwd).mcp_servers(mcp_servers.to_vec());
   tokio::time::timeout(
      std::time::Duration::from_secs(30),
      connection.send_request(request).block_task(),
   )
   .await
}

async fn resume_session(
   connection: Arc<AcpConnection>,
   cwd: PathBuf,
   existing_session_id: String,
   mcp_servers: &[acp::McpServer],
) -> Result<Result<acp::ResumeSessionResponse, acp::Error>, tokio::time::error::Elapsed> {
   let request =
      acp::ResumeSessionRequest::new(existing_session_id, cwd).mcp_servers(mcp_servers.to_vec());
   tokio::time::timeout(
      std::time::Duration::from_secs(30),
      connection.send_request(request).block_task(),
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

   #[test]
   fn advertises_terminal_sign_in() {
      let capabilities = client_capabilities();
      assert!(capabilities.auth.terminal);
      assert_eq!(
         capabilities
            .meta
            .as_ref()
            .and_then(|meta| meta.get(LEGACY_TERMINAL_AUTH_META_KEY)),
         Some(&json!(true))
      );
   }

   #[test]
   fn prefers_actionable_authentication_stderr() {
      let lines = VecDeque::from([
         "Loaded cached credentials.".to_string(),
         "Authentication failed: Error: This account requires setting the GOOGLE_CLOUD_PROJECT \
          env var."
            .to_string(),
      ]);

      assert_eq!(
         relevant_agent_stderr(&lines).as_deref(),
         Some(
            "Authentication failed: Error: This account requires setting the GOOGLE_CLOUD_PROJECT \
             env var."
         )
      );
   }

   #[test]
   fn normalizes_multiline_spacing_in_stderr() {
      let lines = VecDeque::from(["Error:   invalid\tconfiguration".to_string()]);

      assert_eq!(
         relevant_agent_stderr(&lines).as_deref(),
         Some("Error: invalid configuration")
      );
   }
}
