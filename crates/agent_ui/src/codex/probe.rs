//! Settings > AI > Codex talking to the app-server directly (`codex-account-api.ts`,
//! `CodexAppServer::start`): Connect starts `codex app-server`, initializes it, reads the account
//! and counts the threads, skills and MCP servers it knows; Sign in and Sign out are its
//! `account/login/start` and `account/logout`.

use std::path::PathBuf;
#[cfg(not(target_family = "wasm"))]
use std::path::Path;

#[cfg(not(target_family = "wasm"))]
use futures::{FutureExt as _, StreamExt as _};
use serde_json::Value;
#[cfg(not(target_family = "wasm"))]
use serde_json::json;


use super::CodexModel;
#[cfg(not(target_family = "wasm"))]
use crate::acp::rpc::{Incoming, RpcConnection, RpcError};

/// What the Codex CLI row shows (`CodexIntegrationStatus`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CodexStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub initialized: bool,
    pub error: Option<String>,
    pub account: Option<Value>,
}

impl CodexStatus {
    /// The badge: Connected, Installed or Unavailable.
    pub fn badge(&self) -> &'static str {
        if self.initialized {
            "Connected"
        } else if self.installed {
            "Installed"
        } else {
            "Unavailable"
        }
    }

    /// The row's description: the version, else the error, else "Not installed".
    pub fn description(&self) -> String {
        self.version.clone().or_else(|| self.error.clone()).unwrap_or_else(|| "Not installed".into())
    }

    /// The signed-in account's email or plan, for the Account row.
    pub fn account_label(&self) -> Option<String> {
        let account = self.account.as_ref().filter(|account| !account.is_null())?;
        let email = account.get("email").and_then(Value::as_str).filter(|email| !email.is_empty());
        let plan = account.get("planType").and_then(Value::as_str).filter(|plan| !plan.is_empty());
        match (email, plan) {
            (Some(email), Some(plan)) => Some(format!("{email} ({plan})")),
            (Some(email), None) => Some(email.to_string()),
            (None, Some(plan)) => Some(format!("Signed in ({plan})")),
            (None, None) => account.get("type").and_then(Value::as_str).map(|kind| if kind == "apiKey" { "Signed in with an API key".to_string() } else { "Signed in".to_string() }),
        }
    }
}

/// The Capabilities row's counts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CodexCapabilities {
    pub threads: usize,
    pub skills: usize,
    pub mcp: usize,
}

/// What Connect learned.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CodexConnection {
    pub status: CodexStatus,
    pub models: Vec<CodexModel>,
    pub capabilities: CodexCapabilities,
    /// The catalog request that failed, shown under Capabilities.
    pub catalog_error: Option<String>,
}

static LAST: std::sync::Mutex<Option<CodexConnection>> = std::sync::Mutex::new(None);

/// The last Connect's result, so Settings reopened shows it again.
pub fn last() -> Option<CodexConnection> {
    LAST.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
}

pub fn remember(connection: &CodexConnection) {
    *LAST.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(connection.clone());
}

/// `codex --version`, trimmed.
#[cfg(not(target_family = "wasm"))]
pub fn read_version(binary: &Path) -> Option<String> {
    let output = std::process::Command::new(binary).arg("--version").output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string()).filter(|version| !version.is_empty())
}

/// The status before connecting: installed and its version.
#[cfg(target_family = "wasm")]
pub fn status() -> CodexStatus {
    CodexStatus::default()
}

/// The status before connecting: installed and its version.
#[cfg(not(target_family = "wasm"))]
pub fn status() -> CodexStatus {
    match super::resolve() {
        Some(binary) => CodexStatus { installed: true, version: read_version(&binary), ..Default::default() },
        None => CodexStatus::default(),
    }
}

/// `thread/list` threads with an id (`normalizeCodexThreads`).
pub fn count_threads(value: &Value) -> usize {
    value.get("data").and_then(Value::as_array).map_or(0, |threads| threads.iter().filter(|thread| thread.get("id").and_then(Value::as_str).is_some_and(|id| !id.is_empty())).count())
}

/// `mcpServerStatus/list` servers (`data ?? servers ?? []`).
pub fn count_mcp(value: &Value) -> usize {
    value.get("data").or_else(|| value.get("servers")).and_then(Value::as_array).map_or(0, Vec::len)
}

/// A running app-server, initialized; dropping it stops the process.
#[cfg(not(target_family = "wasm"))]
struct AppServer {
    rpc: std::sync::Arc<RpcConnection>,
    executor: gpui::BackgroundExecutor,
    _process: crate::acp::process::AgentProcess,
    _io: Vec<gpui::Task<()>>,
}

#[cfg(not(target_family = "wasm"))]
impl AppServer {
    async fn start(binary: PathBuf, cwd: &Path, executor: &gpui::BackgroundExecutor) -> Result<(Self, Value), String> {
        let command = crate::acp::agents::AgentCommand { program: binary, args: super::ARGS.iter().map(|arg| arg.to_string()).collect(), env: Vec::new() };
        let (process, transport) = crate::acp::process::AgentProcess::spawn(&command, cwd).map_err(|error| error.to_string())?;
        let (transport, forward) = super::server::plain_json_rpc(transport);
        let (rpc, mut incoming, reader) = RpcConnection::new(transport);
        let router = rpc.clone();
        let io = vec![
            executor.spawn(forward),
            executor.spawn(reader),
            executor.spawn(async move {
                while let Some(message) = incoming.next().await {
                    match message {
                        Incoming::Response { id, result } => router.resolve(id, result),
                        Incoming::Request { id, method, .. } => router.respond(id, Err(RpcError::method_not_found(&method))),
                        Incoming::Notification { .. } => {}
                    }
                }
                router.fail_pending();
            }),
        ];
        let server = Self { rpc, executor: executor.clone(), _process: process, _io: io };
        let account = server.initialize().await.map_err(|error| error.message)?;
        Ok((server, account))
    }

    async fn initialize(&self) -> Result<Value, RpcError> {
        self.request("initialize", json!({ "clientInfo": { "name": "athas", "title": "Athas", "version": env!("CARGO_PKG_VERSION") }, "capabilities": { "experimentalApi": true } })).await?;
        self.rpc.notify("initialized", json!({}));
        self.request("account/read", json!({ "refreshToken": false })).await
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let answer = self.rpc.request_value(method, params).fuse();
        let timeout = self.executor.timer(std::time::Duration::from_secs(30)).fuse();
        futures::pin_mut!(answer, timeout);
        futures::select! {
            result = answer => result,
            _ = timeout => Err(RpcError::internal(format!("Codex did not answer {method}"))),
        }
    }
}

/// Connect / Refresh: starts the app-server in `cwd`, reads the account, models and catalog.
#[cfg(not(target_family = "wasm"))]
pub async fn connect(cwd: PathBuf, executor: gpui::BackgroundExecutor) -> CodexConnection {
    let mut status = status();
    let Some(binary) = super::resolve() else { return CodexConnection { status, ..Default::default() } };
    let (server, account) = match AppServer::start(binary, &cwd, &executor).await {
        Ok(started) => started,
        Err(error) => {
            status.error = Some(error);
            status.version = None;
            return CodexConnection { status, ..Default::default() };
        }
    };
    status.initialized = true;
    status.account = account.get("account").cloned().filter(|account| !account.is_null());
    let models = server.request("model/list", json!({ "limit": 100, "includeHidden": false })).await.map(|models| super::normalize_models(&models)).unwrap_or_default();
    let cwd_text = cwd.to_string_lossy().into_owned();
    let skills = server.request("skills/list", json!({ "cwds": [cwd_text.clone()], "forceReload": false })).await;
    let mcp = server.request("mcpServerStatus/list", json!({ "limit": 100, "detail": "toolsAndAuthOnly" })).await;
    let threads = server.request("thread/list", json!({ "limit": 100, "cwd": cwd_text })).await;
    let (capabilities, catalog_error) = match (skills, mcp, threads) {
        (Ok(skills), Ok(mcp), Ok(threads)) => (CodexCapabilities { skills: super::normalize_skills(&skills).0.len(), mcp: count_mcp(&mcp), threads: count_threads(&threads) }, None),
        (Err(error), _, _) | (_, Err(error), _) | (_, _, Err(error)) => (CodexCapabilities::default(), Some(error.message)),
    };
    CodexConnection { status, models, capabilities, catalog_error }
}

/// Codex's own skills for `cwd` (`listCodexComposerSkills`), for Settings > Integrations >
/// Skills; empty when Codex is missing or cannot list them.
#[cfg(not(target_family = "wasm"))]
pub async fn list_skills(cwd: PathBuf, executor: gpui::BackgroundExecutor) -> Vec<super::CodexSkill> {
    let Some(binary) = super::resolve() else { return Vec::new() };
    let Ok((server, _)) = AppServer::start(binary, &cwd, &executor).await else { return Vec::new() };
    server
        .request("skills/list", json!({ "cwds": [cwd.to_string_lossy()], "forceReload": false }))
        .await
        .map(|skills| super::normalize_skills(&skills).0)
        .unwrap_or_default()
}

/// Sign in: starts the ChatGPT login and returns the page to open.
#[cfg(not(target_family = "wasm"))]
pub async fn sign_in(cwd: PathBuf, executor: gpui::BackgroundExecutor) -> Result<Option<String>, String> {
    let binary = super::resolve().ok_or_else(|| "Codex is not installed".to_string())?;
    let (server, _) = AppServer::start(binary, &cwd, &executor).await?;
    let result = server.request("account/login/start", json!({ "type": "chatgpt", "useHostedLoginSuccessPage": true, "appBrand": "codex" })).await.map_err(|error| error.message)?;
    let url = result.get("authUrl").and_then(Value::as_str).map(str::to_string);
    // The login finishes in the browser; the app-server stays up a while to receive it.
    if url.is_some() {
        executor
            .spawn(async move {
                server.executor.timer(std::time::Duration::from_secs(600)).await;
                drop(server);
            })
            .detach();
    }
    Ok(url)
}

/// Sign out.
#[cfg(not(target_family = "wasm"))]
pub async fn sign_out(cwd: PathBuf, executor: gpui::BackgroundExecutor) -> Result<(), String> {
    let binary = super::resolve().ok_or_else(|| "Codex is not installed".to_string())?;
    let (server, _) = AppServer::start(binary, &cwd, &executor).await?;
    server.request("account/logout", json!({})).await.map(|_| ()).map_err(|error| error.message)
}

/// The web build has no Codex CLI to start: it shows Codex as unavailable.
#[cfg(target_family = "wasm")]
pub async fn connect(_cwd: PathBuf, _executor: gpui::BackgroundExecutor) -> CodexConnection {
    CodexConnection::default()
}

#[cfg(target_family = "wasm")]
pub async fn sign_in(_cwd: PathBuf, _executor: gpui::BackgroundExecutor) -> Result<Option<String>, String> {
    Err("Codex is not available in the web build".into())
}

#[cfg(target_family = "wasm")]
pub async fn sign_out(_cwd: PathBuf, _executor: gpui::BackgroundExecutor) -> Result<(), String> {
    Err("Codex is not available in the web build".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cli_row_reads_its_status() {
        let mut status = CodexStatus::default();
        assert_eq!((status.badge(), status.description().as_str()), ("Unavailable", "Not installed"));
        status.installed = true;
        status.version = Some("codex-cli 1.2.3".into());
        assert_eq!((status.badge(), status.description().as_str()), ("Installed", "codex-cli 1.2.3"));
        status.initialized = true;
        status.account = Some(json!({ "type": "chatgpt", "email": "a@b.c", "planType": "plus" }));
        assert_eq!(status.badge(), "Connected");
        assert_eq!(status.account_label().as_deref(), Some("a@b.c (plus)"));
    }

    #[test]
    fn the_capabilities_count_threads_and_servers() {
        assert_eq!(count_threads(&json!({ "data": [{ "id": "t1" }, { "id": "" }, { "name": "x" }] })), 1);
        assert_eq!(count_mcp(&json!({ "servers": [{}, {}] })), 2);
        assert_eq!(count_mcp(&json!({})), 0);
    }
}
