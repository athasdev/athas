use super::{
   AcpConnection,
   auth::{
      ACP_AUTHENTICATE_TIMEOUT, AuthenticationRequired, LEGACY_TERMINAL_AUTH_META_KEY,
      describe_auth_methods, startup_auth_method,
   },
   client::{AthasAcpClient, ClientResponders},
   mcp_servers::{AcpSkippedMcpServer, McpServerConfig, select_mcp_servers},
   process::{stop_child_tree, stop_child_tree_mut},
   replay::{ReplayMode, ReplayRouter},
   traffic::{TrafficDirection, TrafficInspector, TrafficTap, tapped_transport},
   types::{
      AcpAgentCapabilities, AcpAuthMethod, AcpEvent, AgentConfig, SessionConfigOption, SessionMode,
      SessionModeState,
   },
   workspace_path::path_to_string,
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

/// An agent process that finished `initialize` and can hold sessions.
pub(super) struct StartedConnection {
   pub handle: ConnectionHandle,
   pub process: Child,
   pub process_group_id: Option<u32>,
   pub io_handle: tokio::task::JoinHandle<()>,
   pub responders: ClientResponders,
}

impl StartedConnection {
   /// Stops an agent that is not wanted anymore.
   pub(super) async fn shut_down(self) {
      self.io_handle.abort();
      stop_child_tree(self.process, self.process_group_id).await;
   }
}

/// What session requests need from a running agent connection. Cheap to clone, so session setup
/// can run off the worker loop.
#[derive(Clone)]
pub(super) struct ConnectionHandle {
   pub agent_id: String,
   pub agent_name: String,
   pub connection: Arc<AcpConnection>,
   pub client: Arc<AthasAcpClient>,
   pub app_handle: AppHandle,
   /// The resolved workspace the process runs in; `None` without a project.
   pub workspace_path: Option<PathBuf>,
   pub auth_methods: Vec<acp::AuthMethod>,
   pub described_auth_methods: Vec<AcpAuthMethod>,
   pub agent_capabilities: AcpAgentCapabilities,
   pub supports_session_resume: bool,
   recent_stderr: RecentAgentStderr,
}

impl ConnectionHandle {
   /// The directory sessions are created in.
   pub(super) fn cwd(&self) -> PathBuf {
      self
         .workspace_path
         .clone()
         .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
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

/// Starts the agent process and runs `initialize`. Sessions are opened on it afterwards with
/// [`open_session`]. `stop` ends startup at any point: the process is killed and the caller hears
/// that startup was stopped.
pub(super) async fn start_connection(
   config: &AgentConfig,
   workspace_path: Option<PathBuf>,
   app_handle: AppHandle,
   terminal_manager: Arc<TerminalManager>,
   traffic: TrafficInspector,
   stop: CancellationToken,
) -> Result<StartedConnection> {
   let mut child = spawn_agent_process(config, workspace_path.as_deref())?;
   let tap = traffic.start_process(&config.id, &config.name, workspace_path.as_deref());
   let process_group_id = child.id();
   let stdin = child
      .stdin
      .take()
      .ok_or_else(|| anyhow::anyhow!("Failed to get stdin"))?;
   let stdout = child
      .stdout
      .take()
      .ok_or_else(|| anyhow::anyhow!("Failed to get stdout"))?;
   let recent_stderr = spawn_stderr_logger(&mut child, config.name.clone(), tap.clone());

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
      let transport = tapped_transport(stdin.compat_write(), stdout.compat(), tap);
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
   // Startup can take minutes (a first `npx` download), so Stop must be able to end it.
   let startup = async {
      let connection = Arc::new(
         connection_rx
            .await
            .map_err(|_| anyhow::anyhow!("Failed to establish ACP connection"))?,
      );
      let init_response = initialize_connection(connection.clone()).await?;
      Ok::<_, anyhow::Error>((connection, init_response))
   };
   let outcome = tokio::select! {
      result = startup => Some(result),
      () = stop.cancelled() => None,
   };
   let result = match outcome {
      Some(Ok(result)) => result,
      Some(Err(error)) => {
         io_handle.abort();
         stop_child_tree_mut(&mut child, process_group_id).await;
         return Err(with_agent_stderr(error, &recent_stderr).await);
      }
      None => {
         io_handle.abort();
         stop_child_tree_mut(&mut child, process_group_id).await;
         bail!(ACP_STARTUP_STOPPED);
      }
   };
   let (connection, init_response) = result;
   let auth_methods = init_response.auth_methods.clone();
   let described_auth_methods = describe_auth_methods(&auth_methods, config);
   let supports_session_resume = init_response
      .agent_capabilities
      .session_capabilities
      .resume
      .is_some();

   Ok(StartedConnection {
      handle: ConnectionHandle {
         agent_id: config.id.clone(),
         agent_name: config.name.clone(),
         connection,
         client,
         app_handle,
         workspace_path,
         auth_methods,
         described_auth_methods,
         agent_capabilities: init_response.agent_capabilities.into(),
         supports_session_resume,
         recent_stderr,
      },
      process: child,
      process_group_id,
      io_handle,
      responders,
   })
}

/// A session a chat can prompt.
pub(super) struct OpenedSession {
   pub session_id: acp::SessionId,
   /// The chat asked for its earlier session, but the agent could not restore it, so this is a
   /// new session without the earlier context.
   pub context_lost: bool,
   /// The conversation an imported session replayed.
   pub history: Vec<AcpEvent>,
   /// Configured MCP servers the agent cannot take, reported to the user.
   pub skipped_mcp_servers: Vec<AcpSkippedMcpServer>,
}

/// Opens the session `target` asks for on a running agent (see [`bootstrap_session`]). The
/// session's initial modes and config options are emitted as events. When the agent wants a sign-in
/// Athas may not do on its own, an `auth_required` event is emitted and the open fails with
/// [`AuthenticationRequired`].
pub(super) async fn open_session(
   handle: ConnectionHandle,
   target: SessionTarget,
   startup_auth: StartupAuth,
   mcp_servers: Vec<McpServerConfig>,
   map_config_options: impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
) -> Result<OpenedSession> {
   let mcp_selection = select_mcp_servers(
      &mcp_servers,
      &handle.agent_capabilities.mcp_capabilities,
      find_executable,
   );
   if !mcp_selection.servers.is_empty() || !mcp_selection.skipped.is_empty() {
      log::info!(
         "Offering {} MCP server(s) to {}; skipped {} the agent does not support",
         mcp_selection.servers.len(),
         handle.agent_name,
         mcp_selection.skipped.len()
      );
   }

   let cwd = handle.cwd();
   log::info!(
      "ACP workspace path resolved to {}",
      path_to_string(cwd.as_path())
   );

   let session_bootstrap = bootstrap_session(
      handle.connection.clone(),
      cwd,
      target,
      SessionBootstrapContext {
         auth_methods: &handle.auth_methods,
         startup_auth,
         can_load_session: handle.agent_capabilities.load_session,
         can_resume_session: handle.supports_session_resume,
         replay: handle.client.replay(),
         mcp_servers: &mcp_selection.servers,
         map_config_options,
      },
   )
   .await;
   let session_bootstrap = match session_bootstrap {
      Ok(session) => session,
      Err(error) => {
         if error.is::<AuthenticationRequired>()
            && let Err(emit_error) = handle.app_handle.emit(
               "acp-event",
               AcpEvent::AuthRequired {
                  agent_id: handle.agent_id.clone(),
                  session_id: None,
                  methods: handle.described_auth_methods.clone(),
               },
            )
         {
            log::warn!("Failed to emit ACP auth required event: {}", emit_error);
         }
         tokio::task::yield_now().await;
         return Err(with_agent_stderr(error, &handle.recent_stderr).await);
      }
   };

   handle
      .client
      .set_session_id(session_bootstrap.session_id.to_string())
      .await;
   emit_initial_session_state(
      &handle.app_handle,
      &session_bootstrap.session_id,
      session_bootstrap.initial_modes,
      session_bootstrap.initial_config_options,
   );

   Ok(OpenedSession {
      session_id: session_bootstrap.session_id,
      context_lost: session_bootstrap.context_lost,
      history: session_bootstrap.history,
      skipped_mcp_servers: mcp_selection.skipped,
   })
}

struct SessionBootstrap {
   session_id: acp::SessionId,
   initial_modes: Option<SessionModeState>,
   initial_config_options: Option<Vec<SessionConfigOption>>,
   context_lost: bool,
   history: Vec<AcpEvent>,
}

struct SessionBootstrapContext<'a, F>
where
   F: Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
{
   auth_methods: &'a [acp::AuthMethod],
   startup_auth: StartupAuth,
   can_load_session: bool,
   can_resume_session: bool,
   replay: &'a ReplayRouter,
   /// Sent in `session/new`, `session/load` and `session/resume`.
   mcp_servers: &'a [acp::McpServer],
   map_config_options: F,
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

fn spawn_stderr_logger(
   child: &mut Child,
   agent_name: String,
   tap: TrafficTap,
) -> RecentAgentStderr {
   let recent_stderr = Arc::new(Mutex::new(VecDeque::new()));
   if let Some(stderr) = child.stderr.take() {
      let captured_stderr = recent_stderr.clone();
      tokio::task::spawn_local(async move {
         use tokio::io::{AsyncBufReadExt, BufReader};
         let mut lines = BufReader::new(stderr).lines();
         while let Ok(Some(line)) = lines.next_line().await {
            log::warn!("[{}] stderr: {}", agent_name, line);
            tap.record(TrafficDirection::Stderr, &line);
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

async fn initialize_connection(connection: Arc<AcpConnection>) -> Result<acp::InitializeResponse> {
   let init_request = acp::InitializeRequest::new(SUPPORTED_PROTOCOL_VERSION)
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
         check_protocol_version(response.protocol_version)?;
         log::info!("ACP connection initialized successfully");
         Ok(response)
      }
      Ok(Err(e)) => bail!("Failed to initialize ACP connection: {}", e),
      Err(_) => bail!(
         "ACP initialization timed out - agent may not support ACP protocol or requires different \
          arguments"
      ),
   }
}

/// The ACP version Athas speaks. An agent answers `initialize` with the version it will use;
/// any other version means the two cannot talk, and the spec asks the client to disconnect.
const SUPPORTED_PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion::V1;

fn check_protocol_version(version: ProtocolVersion) -> Result<()> {
   if version == SUPPORTED_PROTOCOL_VERSION {
      return Ok(());
   }
   bail!(
      "The agent uses ACP protocol version {}, but Athas supports version {}. Update the agent or \
       Athas to a matching version.",
      version.as_u16(),
      SUPPORTED_PROTOCOL_VERSION.as_u16()
   )
}

/// Opens the session `target` asks for, signing in when the agent asks for it. An existing
/// session is reopened in the order [`reopen_methods`] gives; when none of them works, the chat
/// gets a new session with `context_lost` set, while an import fails. Failing does not touch the
/// agent process; the caller decides.
async fn bootstrap_session(
   connection: Arc<AcpConnection>,
   cwd: PathBuf,
   target: SessionTarget,
   ctx: SessionBootstrapContext<
      '_,
      impl Fn(Vec<acp::SessionConfigOption>) -> Vec<SessionConfigOption>,
   >,
) -> Result<SessionBootstrap> {
   log::info!("Opening ACP session in {:?}...", cwd);

   // Terminal methods are never sent here: the user runs them, and the open is retried after.
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

   let mut context_lost = false;
   if let Some(existing_session_id) = target.session_id() {
      for method in reopen_methods(&target, ctx.can_load_session, ctx.can_resume_session) {
         let replay_mode = match (method, &target) {
            (ReopenMethod::Resume, _) => None,
            (ReopenMethod::Load, SessionTarget::Import(_)) => Some(ReplayMode::Collect),
            (ReopenMethod::Load, _) => Some(ReplayMode::Suppress),
         };
         if let Some(mode) = replay_mode {
            ctx.replay.begin(existing_session_id, mode);
         }
         let abandon_replay = || {
            if replay_mode.is_some() {
               ctx.replay.discard(existing_session_id);
            }
         };

         let mut result = reopen_session(
            connection.clone(),
            cwd.clone(),
            existing_session_id,
            ctx.mcp_servers,
            method,
         )
         .await;
         if let Ok(Err(err)) = &result
            && matches!(err.code, acp::ErrorCode::AuthRequired)
         {
            if let Err(error) = authenticate(connection.clone()).await {
               abandon_replay();
               return Err(error);
            }
            result = reopen_session(
               connection.clone(),
               cwd.clone(),
               existing_session_id,
               ctx.mcp_servers,
               method,
            )
            .await;
         }

         match result {
            Ok(Ok(setup)) => {
               log::info!(
                  "ACP session {}: {}",
                  method.past_tense(),
                  existing_session_id
               );
               // Also clears what an earlier, failed load of this session left behind.
               let history = ctx.replay.finish(existing_session_id);
               return Ok(SessionBootstrap {
                  session_id: acp::SessionId::new(existing_session_id),
                  initial_modes: setup.modes.map(map_mode_state),
                  initial_config_options: setup.config_options.map(&ctx.map_config_options),
                  context_lost: false,
                  history,
               });
            }
            Ok(Err(err))
               if matches!(
                  err.code,
                  acp::ErrorCode::MethodNotFound | acp::ErrorCode::ResourceNotFound
               ) =>
            {
               abandon_replay();
               log::warn!(
                  "ACP {} unavailable or session missing ({})",
                  method.method_name(),
                  err
               );
            }
            Ok(Err(err)) => {
               abandon_replay();
               bail!(
                  "Failed to {} ACP session {}: {}",
                  method.verb(),
                  existing_session_id,
                  err
               );
            }
            Err(_) => {
               abandon_replay();
               bail!("ACP {} timed out", method.method_name());
            }
         }
      }

      if let SessionTarget::Import(session_id) = &target {
         bail!("The agent could not load session {session_id}");
      }
      log::warn!(
         "Could not restore ACP session {}; starting a new one",
         existing_session_id
      );
      context_lost = true;
   }

   let mut session_result = create_session(connection.clone(), cwd.clone(), ctx.mcp_servers).await;
   if let Ok(Err(err)) = &session_result
      && matches!(err.code, acp::ErrorCode::AuthRequired)
   {
      authenticate(connection.clone()).await?;
      log::info!("ACP authentication succeeded, retrying session creation");
      session_result = create_session(connection.clone(), cwd, ctx.mcp_servers).await;
   }

   let session = match session_result {
      Ok(Ok(session)) => session,
      Ok(Err(e)) => {
         log::error!("Failed to create ACP session: {}", e);
         bail!("Failed to create ACP session: {}", e);
      }
      Err(_) => {
         log::error!("ACP session creation timed out");
         bail!("ACP session creation timed out");
      }
   };

   log::info!("ACP session created: {}", session.session_id);

   Ok(SessionBootstrap {
      session_id: session.session_id,
      initial_modes: session.modes.map(map_mode_state),
      initial_config_options: session.config_options.map(ctx.map_config_options),
      context_lost,
      history: Vec::new(),
   })
}

/// Which session a chat asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum SessionTarget {
   /// A fresh session.
   New,
   /// The chat's earlier session. Athas keeps the chat's history, so the agent's replay of it is
   /// dropped.
   Reattach(String),
   /// An agent session imported into a new chat. Its history is replayed and returned.
   Import(String),
}

impl SessionTarget {
   pub(super) fn session_id(&self) -> Option<&str> {
      match self {
         Self::New => None,
         Self::Reattach(session_id) | Self::Import(session_id) => Some(session_id),
      }
   }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReopenMethod {
   Resume,
   Load,
}

impl ReopenMethod {
   fn method_name(self) -> &'static str {
      match self {
         Self::Resume => "session/resume",
         Self::Load => "session/load",
      }
   }

   fn verb(self) -> &'static str {
      match self {
         Self::Resume => "resume",
         Self::Load => "load",
      }
   }

   fn past_tense(self) -> &'static str {
      match self {
         Self::Resume => "resumed",
         Self::Load => "loaded",
      }
   }
}

/// How to reopen `target`'s session, in order, from what the agent advertises. A chat prefers
/// `session/resume`, which restores the agent's context without replaying history Athas already
/// shows, and falls back to `session/load`. An import needs the replay, so only `session/load`
/// will do.
fn reopen_methods(target: &SessionTarget, can_load: bool, can_resume: bool) -> Vec<ReopenMethod> {
   match target {
      SessionTarget::New => Vec::new(),
      SessionTarget::Reattach(_) => [
         can_resume.then_some(ReopenMethod::Resume),
         can_load.then_some(ReopenMethod::Load),
      ]
      .into_iter()
      .flatten()
      .collect(),
      SessionTarget::Import(_) => can_load.then_some(ReopenMethod::Load).into_iter().collect(),
   }
}

/// What `session/new`, `session/load` and `session/resume` answer in common.
struct SessionSetup {
   modes: Option<acp::SessionModeState>,
   config_options: Option<Vec<acp::SessionConfigOption>>,
}

async fn reopen_session(
   connection: Arc<AcpConnection>,
   cwd: PathBuf,
   session_id: &str,
   mcp_servers: &[acp::McpServer],
   method: ReopenMethod,
) -> Result<Result<SessionSetup, acp::Error>, tokio::time::error::Elapsed> {
   let session_id = session_id.to_string();
   match method {
      ReopenMethod::Load => load_session(connection, cwd, session_id, mcp_servers)
         .await
         .map(|result| {
            result.map(|response| SessionSetup {
               modes: response.modes,
               config_options: response.config_options,
            })
         }),
      ReopenMethod::Resume => resume_session(connection, cwd, session_id, mcp_servers)
         .await
         .map(|result| {
            result.map(|response| SessionSetup {
               modes: response.modes,
               config_options: response.config_options,
            })
         }),
   }
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
   session_id: &acp::SessionId,
   initial_modes: Option<SessionModeState>,
   initial_config_options: Option<Vec<SessionConfigOption>>,
) {
   if let Some(mode_state) = initial_modes
      && let Err(e) = app_handle.emit(
         "acp-event",
         AcpEvent::SessionModeUpdate {
            session_id: session_id.to_string(),
            mode_state,
         },
      )
   {
      log::warn!("Failed to emit initial session mode state: {}", e);
   }

   if let Some(config_options) = initial_config_options
      && let Err(e) = app_handle.emit(
         "acp-event",
         AcpEvent::ConfigOptionsUpdate {
            session_id: session_id.to_string(),
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
   fn reattaching_prefers_resume_then_load() {
      let chat = SessionTarget::Reattach("s1".to_string());
      assert_eq!(
         reopen_methods(&chat, true, true),
         vec![ReopenMethod::Resume, ReopenMethod::Load]
      );
      assert_eq!(
         reopen_methods(&chat, false, true),
         vec![ReopenMethod::Resume]
      );
      assert_eq!(reopen_methods(&chat, true, false), vec![ReopenMethod::Load]);
      // Neither advertised: no request is sent; the chat gets a new session.
      assert!(reopen_methods(&chat, false, false).is_empty());
   }

   #[test]
   fn importing_needs_load_session() {
      let import = SessionTarget::Import("s1".to_string());
      assert_eq!(
         reopen_methods(&import, true, true),
         vec![ReopenMethod::Load]
      );
      // Resume would not replay the history the new chat needs.
      assert!(reopen_methods(&import, false, true).is_empty());
   }

   #[test]
   fn a_new_session_reopens_nothing() {
      assert!(reopen_methods(&SessionTarget::New, true, true).is_empty());
   }

   #[test]
   fn accepts_only_the_supported_protocol_version() {
      assert!(check_protocol_version(ProtocolVersion::V1).is_ok());
      for unsupported in [0u16, 2, 7] {
         let error = check_protocol_version(ProtocolVersion::from(unsupported))
            .expect_err("unsupported versions must fail startup")
            .to_string();
         assert!(error.contains(&format!("protocol version {unsupported}")));
      }
   }

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
