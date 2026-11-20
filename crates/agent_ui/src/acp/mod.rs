//! The Agent Client Protocol client: a JSON-RPC connection to an agent and what the client does
//! for it. The connection only needs a [`rpc::Transport`]; on desktop that is the agent process's
//! stdio ([`process`]), and the web build runs it on the workspace server ([`remote`]).

pub mod agents;
pub mod client;
pub mod rpc;
pub mod traffic;
pub mod traffic_secrets;

pub mod host;
#[cfg(not(target_family = "wasm"))]
pub mod process;
pub mod remote;

#[cfg(test)]
pub mod fake_agent;

use std::path::Path;

pub use agent_client_protocol_schema::v1 as schema;
use client::AgentConnection;
use rpc::RpcError;

/// The `_meta` key agents that predate `auth.terminal` describe a terminal sign-in under, and
/// the client capability telling them Athas runs it (`LEGACY_TERMINAL_AUTH_META_KEY`).
pub const LEGACY_TERMINAL_AUTH_META_KEY: &str = "terminal-auth";

/// How a sign-in method runs in a terminal (`auth.rs terminal_launch`): the agent's own program
/// with its arguments and the method's, or for a method described the older way its own
/// `command` in `program`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TerminalLaunch {
    pub program: Option<String>,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// The terminal launch of `method`, `None` for one the agent completes through `authenticate`
/// (`terminal_launch`, `legacy_terminal_launch`). `agent_args` are the arguments the agent's
/// program runs with, which a terminal method's own follow.
pub fn terminal_launch(method: &schema::AuthMethod, agent_args: &[String]) -> Option<TerminalLaunch> {
    let sorted = |mut env: Vec<(String, String)>| {
        env.sort();
        env
    };
    match method {
        schema::AuthMethod::Terminal(terminal) => Some(TerminalLaunch {
            program: None,
            args: agent_args.iter().chain(&terminal.args).cloned().collect(),
            env: sorted(terminal.env.iter().map(|(name, value)| (name.clone(), value.clone())).collect()),
        }),
        schema::AuthMethod::Agent(agent) => {
            let legacy = agent.meta.as_ref()?.get(LEGACY_TERMINAL_AUTH_META_KEY)?;
            let command = legacy.get("command")?.as_str()?.trim();
            if command.is_empty() {
                return None;
            }
            let strings = |value: Option<&serde_json::Value>| -> Vec<String> {
                value.and_then(serde_json::Value::as_array).map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect()).unwrap_or_default()
            };
            let env = legacy
                .get("env")
                .and_then(serde_json::Value::as_object)
                .map(|env| env.iter().filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string()))).collect())
                .unwrap_or_default();
            Some(TerminalLaunch { program: Some(command.to_string()), args: strings(legacy.get("args")), env: sorted(env) })
        }
        _ => None,
    }
}

/// Whether the agent completes `method` through `authenticate` (`uses_authenticate`).
pub fn uses_authenticate(method: &schema::AuthMethod) -> bool {
    matches!(method, schema::AuthMethod::Agent(_)) && terminal_launch(method, &[]).is_none()
}

/// What opening a session gave.
#[derive(Debug)]
pub struct OpenedSession {
    pub session_id: String,
    pub modes: Option<schema::SessionModeState>,
    pub config_options: Option<Vec<schema::SessionConfigOption>>,
    /// The earlier session was gone or could not be loaded, so this is a new one and the agent
    /// does not remember the conversation.
    pub context_lost: bool,
    /// MCP servers left out because the agent cannot use their transport.
    pub skipped_mcp: Vec<String>,
}

/// Why a session could not be opened.
#[derive(Debug)]
pub enum OpenError {
    /// The agent wants the user signed in; these are the ways it offers, and why the method
    /// tried failed, when one was.
    AuthRequired(Vec<schema::AuthMethod>, Option<String>),
    Failed(RpcError),
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::AuthRequired(..) => f.write_str("The agent needs you to sign in"),
            OpenError::Failed(error) => error.fmt(f),
        }
    }
}

/// Initializes the connection and opens a session in `cwd`: `resume` reattaches to an earlier
/// session with `session/load` when the agent supports it (dropping the history it replays when
/// `have_history`), otherwise a new session starts. An agent that wants its user signed in is
/// asked to sign in by the one method that needs no terminal, when it offers exactly one.
/// The user's MCP servers go along, those over HTTP or SSE only to an agent that takes them.
pub async fn open_session(
    connection: &AgentConnection,
    cwd: &Path,
    resume: Option<&str>,
    have_history: bool,
    mcp: &[ai_mcp::McpServerConfig],
) -> Result<OpenedSession, OpenError> {
    let init = connection.initialize().await.map_err(OpenError::Failed)?;
    let capabilities = &init.agent_capabilities.mcp_capabilities;
    let (mcp_servers, skipped) = ai_mcp::acp_servers(mcp, capabilities.http, capabilities.sse, resolve_command);
    let skipped_mcp: Vec<String> = skipped.into_iter().map(|skipped| skipped.name).collect();
    let auth_methods = init.auth_methods.clone();
    let mut authenticated = false;
    let mut authenticate = async |error: RpcError| -> Result<(), OpenError> {
        if error.code != RpcError::AUTH_REQUIRED || authenticated {
            return Err(if error.code == RpcError::AUTH_REQUIRED {
                OpenError::AuthRequired(auth_methods.clone(), None)
            } else {
                OpenError::Failed(error)
            });
        }
        authenticated = true;
        // The user's pick when the agent completes it, else the one way the agent offers when it
        // is through `authenticate` (`startup_auth_method`); terminal methods are the user's.
        if let Some(picked) = connection
            .preferred_auth()
            .filter(|picked| auth_methods.iter().any(|method| method.id().0.as_ref() == picked.as_str() && uses_authenticate(method)))
        {
            return connection.authenticate(&picked).await.map_err(|error| OpenError::AuthRequired(auth_methods.clone(), Some(error.message)));
        }
        match auth_methods.as_slice() {
            [method] if uses_authenticate(method) => {
                connection.authenticate(&method.id().0).await.map_err(|error| OpenError::AuthRequired(auth_methods.clone(), Some(error.message)))
            }
            _ => Err(OpenError::AuthRequired(auth_methods.clone(), None)),
        }
    };

    let mut context_lost = false;
    if let Some(session_id) = resume {
        if init.agent_capabilities.load_session {
            let mut loaded = connection.load_session(session_id, cwd, mcp_servers.clone(), have_history).await;
            if let Err(error) = &loaded
                && error.code == RpcError::AUTH_REQUIRED
            {
                authenticate(error.clone()).await?;
                loaded = connection.load_session(session_id, cwd, mcp_servers.clone(), have_history).await;
            }
            match loaded {
                Ok(response) => {
                    return Ok(OpenedSession {
                        session_id: session_id.to_string(),
                        modes: response.modes,
                        config_options: response.config_options,
                        context_lost: false,
                        skipped_mcp,
                    });
                }
                Err(error) if error.code == RpcError::DISCONNECTED => return Err(OpenError::Failed(error)),
                Err(_) => {}
            }
        }
        context_lost = true;
    }

    let mut created = connection.new_session(cwd, mcp_servers.clone()).await;
    if let Err(error) = &created
        && error.code == RpcError::AUTH_REQUIRED
    {
        authenticate(error.clone()).await?;
        created = connection.new_session(cwd, mcp_servers.clone()).await;
    }
    let created = match created {
        Ok(created) => created,
        Err(error) if error.code == RpcError::AUTH_REQUIRED => return Err(OpenError::AuthRequired(auth_methods, None)),
        Err(error) => return Err(OpenError::Failed(error)),
    };
    Ok(OpenedSession {
        session_id: created.session_id.0.to_string(),
        modes: created.modes,
        config_options: created.config_options,
        context_lost,
        skipped_mcp,
    })
}

/// A bare MCP command such as `npx` as a path, since ACP asks for one.
pub(crate) fn resolve_command(command: &str) -> Option<std::path::PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    {
        agents::find_on_path(command, &agents::search_path())
    }
    #[cfg(target_family = "wasm")]
    {
        let _ = command;
        None
    }
}

#[cfg(test)]
mod tests;
