use super::types::{
   CodexIntegrationStatus, CodexProtocolEvent, CodexRequestDecision, CodexThreadSettings,
};
use crate::runtime::AthasAppHandle as AppHandle;
use anyhow::{Context, Result, anyhow, bail};
use serde_json::{Map, Value, json};
use std::{
   collections::HashMap,
   path::{Path, PathBuf},
   process::Stdio,
   sync::{
      Arc,
      atomic::{AtomicU64, Ordering},
   },
   time::Duration,
};
use tauri::Emitter;
use tokio::{
   io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
   process::{Child, ChildStdin, Command},
   sync::{Mutex, OnceCell, RwLock, oneshot},
   task::JoinHandle,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

type PendingRequest = oneshot::Sender<Result<Value, String>>;

struct CodexProcess {
   child: Child,
   stdin: Arc<Mutex<ChildStdin>>,
   pending: Arc<Mutex<HashMap<u64, PendingRequest>>>,
   reader_task: JoinHandle<()>,
   stderr_task: JoinHandle<()>,
}

#[derive(Clone)]
struct CodexInstallation {
   binary: PathBuf,
   version: Option<String>,
}

#[derive(Clone)]
pub struct CodexAppServer {
   app_handle: AppHandle,
   process: Arc<Mutex<Option<CodexProcess>>>,
   status: Arc<RwLock<CodexIntegrationStatus>>,
   installation: Arc<OnceCell<Option<CodexInstallation>>>,
   start_lock: Arc<Mutex<()>>,
   next_request_id: Arc<AtomicU64>,
}

impl CodexAppServer {
   pub fn new(app_handle: AppHandle) -> Self {
      Self {
         app_handle,
         process: Arc::new(Mutex::new(None)),
         status: Arc::new(RwLock::new(CodexIntegrationStatus::default())),
         installation: Arc::new(OnceCell::new()),
         start_lock: Arc::new(Mutex::new(())),
         next_request_id: Arc::new(AtomicU64::new(1)),
      }
   }

   pub async fn status(&self) -> CodexIntegrationStatus {
      self.detect_installation().await;
      self.status_snapshot().await
   }

   async fn status_snapshot(&self) -> CodexIntegrationStatus {
      self.status.read().await.clone()
   }

   async fn detect_installation(&self) -> Option<CodexInstallation> {
      let installation = self
         .installation
         .get_or_init(|| async {
            tokio::task::spawn_blocking(|| {
               let binary = detect_codex_binary()?;
               let version = read_codex_version(&binary);
               Some(CodexInstallation { binary, version })
            })
            .await
            .unwrap_or(None)
         })
         .await
         .clone();

      if let Some(installation) = installation.as_ref() {
         self
            .update_status(|status| {
               status.installed = true;
               status.version = installation.version.clone();
               if !status.running && status.state == "unavailable" {
                  status.state = "stopped".to_string();
               }
            })
            .await;
      }

      installation
   }

   pub async fn start(&self, cwd: String) -> Result<CodexIntegrationStatus> {
      let _start_guard = self.start_lock.lock().await;
      if self.process.lock().await.is_some() {
         let mut status = self.status.write().await;
         status.cwd = Some(cwd);
         return Ok(status.clone());
      }

      let installation = self.detect_installation().await.context(
         "Codex CLI is not installed. Install the Codex integration before starting a session.",
      )?;
      let CodexInstallation { binary, version } = installation;

      self
         .update_status(|status| {
            status.installed = true;
            status.version = version;
            status.running = false;
            status.initialized = false;
            status.state = "starting".to_string();
            status.error = None;
            status.cwd = Some(cwd.clone());
         })
         .await;

      let mut command = Command::new(&binary);
      configure_background_process(&mut command);
      command
         .args(["app-server", "--listen", "stdio://"])
         .current_dir(&cwd)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped());

      if let Some(path) = user_shell_path() {
         let current = std::env::var("PATH").unwrap_or_default();
         command.env("PATH", format!("{current}:{path}"));
      }

      let mut child = match command.spawn() {
         Ok(child) => child,
         Err(error) => {
            self.record_failure(error.to_string()).await;
            return Err(error.into());
         }
      };
      let stdin = child
         .stdin
         .take()
         .context("Codex app-server stdin unavailable")?;
      let stdout = child
         .stdout
         .take()
         .context("Codex app-server stdout unavailable")?;
      let stderr = child
         .stderr
         .take()
         .context("Codex app-server stderr unavailable")?;

      let stdin = Arc::new(Mutex::new(stdin));
      let pending = Arc::new(Mutex::new(HashMap::new()));
      let reader_owner = self.clone();
      let reader_task = tokio::spawn(async move {
         let mut lines = BufReader::new(stdout).lines();
         loop {
            match lines.next_line().await {
               Ok(Some(line)) => reader_owner.handle_line(&line).await,
               Ok(None) => {
                  reader_owner.server_stopped(None).await;
                  break;
               }
               Err(error) => {
                  reader_owner.server_stopped(Some(error.to_string())).await;
                  break;
               }
            }
         }
      });
      let stderr_task = tokio::spawn(async move {
         let mut lines = BufReader::new(stderr).lines();
         while let Ok(Some(line)) = lines.next_line().await {
            log::warn!("[Codex app-server] {line}");
         }
      });

      *self.process.lock().await = Some(CodexProcess {
         child,
         stdin,
         pending,
         reader_task,
         stderr_task,
      });

      self
         .update_status(|status| {
            status.running = true;
            status.state = "connecting".to_string();
         })
         .await;

      let initialized = async {
         self
            .request(
               "initialize",
               json!({
                  "clientInfo": {
                     "name": "athas",
                     "title": "Athas",
                     "version": env!("CARGO_PKG_VERSION")
                  },
                  "capabilities": {
                     "experimentalApi": true
                  }
               }),
               REQUEST_TIMEOUT,
            )
            .await?;
         self.notify("initialized", json!({})).await?;
         let account = self
            .request(
               "account/read",
               json!({ "refreshToken": false }),
               REQUEST_TIMEOUT,
            )
            .await?;
         Ok::<_, anyhow::Error>(account)
      }
      .await;

      match initialized {
         Ok(account) => {
            self
               .update_status(|status| {
                  status.initialized = true;
                  status.state = "ready".to_string();
                  status.account = account.get("account").cloned();
               })
               .await;
            self.emit_status().await;
            Ok(self.status().await)
         }
         Err(error) => {
            self.stop().await;
            self.record_failure(error.to_string()).await;
            Err(error)
         }
      }
   }

   pub async fn stop(&self) {
      let process = self.process.lock().await.take();
      if let Some(mut process) = process {
         process.reader_task.abort();
         process.stderr_task.abort();
         let _ = process.child.start_kill();
         let _ = process.child.wait().await;
         fail_pending_requests(&process.pending, "Codex app-server stopped").await;
      }

      self
         .update_status(|status| {
            status.running = false;
            status.initialized = false;
            status.thread_id = None;
            status.turn_id = None;
            status.state = if status.installed {
               "stopped".to_string()
            } else {
               "unavailable".to_string()
            };
         })
         .await;
      self.emit_status().await;
   }

   pub async fn start_thread(
      &self,
      cwd: String,
      thread_id: Option<String>,
      settings: CodexThreadSettings,
   ) -> Result<Value> {
      self.start(cwd.clone()).await?;

      let result = if let Some(thread_id) = thread_id {
         self
            .request(
               "thread/resume",
               json!({ "threadId": thread_id }),
               REQUEST_TIMEOUT,
            )
            .await?
      } else {
         let mut params = Map::from_iter([
            ("serviceName".to_string(), json!("athas")),
            ("cwd".to_string(), json!(cwd)),
            ("ephemeral".to_string(), json!(false)),
            ("dynamicTools".to_string(), athas_dynamic_tools()),
         ]);
         apply_thread_settings(&mut params, &settings);
         apply_athas_developer_instructions(&mut params);
         self
            .request("thread/start", Value::Object(params), REQUEST_TIMEOUT)
            .await?
      };

      let thread_id = result
         .get("thread")
         .and_then(|thread| thread.get("id"))
         .and_then(Value::as_str)
         .context("Codex returned a thread without an id")?
         .to_string();
      self
         .update_status(|status| {
            status.thread_id = Some(thread_id);
            status.state = "ready".to_string();
         })
         .await;
      self.emit_status().await;
      Ok(result)
   }

   pub async fn start_turn(
      &self,
      thread_id: String,
      input: Vec<Value>,
      settings: CodexThreadSettings,
   ) -> Result<Value> {
      let mut params = Map::from_iter([
         ("threadId".to_string(), json!(thread_id)),
         ("input".to_string(), Value::Array(input)),
      ]);
      apply_turn_settings(&mut params, &settings);

      self
         .update_status(|status| {
            status.state = "working".to_string();
            status.error = None;
         })
         .await;
      self.emit_status().await;

      let response = self
         .request("turn/start", Value::Object(params), TURN_REQUEST_TIMEOUT)
         .await?;
      if let Some(turn_id) = response
         .get("turn")
         .and_then(|turn| turn.get("id"))
         .and_then(Value::as_str)
      {
         self
            .update_status(|status| status.turn_id = Some(turn_id.to_string()))
            .await;
      }
      Ok(response)
   }

   pub async fn interrupt_turn(&self, thread_id: String, turn_id: String) -> Result<Value> {
      self
         .request(
            "turn/interrupt",
            json!({ "threadId": thread_id, "turnId": turn_id }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn respond(&self, response: CodexRequestDecision) -> Result<()> {
      let message = json!({
         "id": response.request_id,
         "result": response.decision
      });
      self.write_message(&message).await
   }

   pub async fn list_threads(
      &self,
      cwd: Option<String>,
      cursor: Option<String>,
      limit: Option<usize>,
   ) -> Result<Value> {
      let mut params = Map::new();
      params.insert(
         "limit".to_string(),
         json!(limit.unwrap_or(100).clamp(1, 100)),
      );
      if let Some(cwd) = cwd {
         params.insert("cwd".to_string(), json!(cwd));
      }
      if let Some(cursor) = cursor {
         params.insert("cursor".to_string(), json!(cursor));
      }
      self
         .request("thread/list", Value::Object(params), REQUEST_TIMEOUT)
         .await
   }

   pub async fn read_thread(&self, thread_id: String) -> Result<Value> {
      self
         .request(
            "thread/read",
            json!({ "threadId": thread_id, "includeTurns": true }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn archive_thread(&self, thread_id: String) -> Result<Value> {
      self
         .request(
            "thread/archive",
            json!({ "threadId": thread_id }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn delete_thread(&self, thread_id: String) -> Result<Value> {
      self
         .request(
            "thread/delete",
            json!({ "threadId": thread_id }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn read_account(&self) -> Result<Value> {
      self
         .request(
            "account/read",
            json!({ "refreshToken": true }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn start_login(&self, login_type: String) -> Result<Value> {
      let params = match login_type.as_str() {
         "chatgptDeviceCode" => json!({ "type": "chatgptDeviceCode" }),
         _ => json!({
            "type": "chatgpt",
            "useHostedLoginSuccessPage": true,
            "appBrand": "codex"
         }),
      };
      self
         .request("account/login/start", params, REQUEST_TIMEOUT)
         .await
   }

   pub async fn logout(&self) -> Result<Value> {
      self
         .request("account/logout", json!({}), REQUEST_TIMEOUT)
         .await
   }

   pub async fn list_models(&self) -> Result<Value> {
      self
         .request(
            "model/list",
            json!({ "limit": 100, "includeHidden": false }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn read_rate_limits(&self) -> Result<Value> {
      self
         .request("account/rateLimits/read", json!({}), REQUEST_TIMEOUT)
         .await
   }

   pub async fn list_skills(&self, cwd: String) -> Result<Value> {
      self
         .request(
            "skills/list",
            json!({ "cwds": [cwd], "forceReload": false }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn list_mcp_servers(&self) -> Result<Value> {
      self
         .request(
            "mcpServerStatus/list",
            json!({ "limit": 100, "detail": "toolsAndAuthOnly" }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn list_permission_profiles(&self) -> Result<Value> {
      self
         .request(
            "permissionProfile/list",
            json!({ "limit": 100 }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   pub async fn list_collaboration_modes(&self) -> Result<Value> {
      self
         .request("collaborationMode/list", json!({}), REQUEST_TIMEOUT)
         .await
   }

   pub async fn start_review(&self, thread_id: String) -> Result<Value> {
      self
         .request(
            "review/start",
            json!({
               "threadId": thread_id,
               "target": { "type": "uncommittedChanges" }
            }),
            REQUEST_TIMEOUT,
         )
         .await
   }

   async fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value> {
      let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
      let (response_tx, response_rx) = oneshot::channel();
      let (stdin, pending) = {
         let process = self.process.lock().await;
         let process = process
            .as_ref()
            .context("Codex app-server is not running")?;
         (process.stdin.clone(), process.pending.clone())
      };
      pending.lock().await.insert(id, response_tx);

      if let Err(error) = write_json_line(
         &stdin,
         &json!({
            "method": method,
            "id": id,
            "params": params
         }),
      )
      .await
      {
         pending.lock().await.remove(&id);
         return Err(error);
      }

      match tokio::time::timeout(timeout, response_rx).await {
         Ok(Ok(Ok(value))) => Ok(value),
         Ok(Ok(Err(error))) => Err(anyhow!(error)),
         Ok(Err(_)) => bail!("Codex response channel closed for {method}"),
         Err(_) => {
            pending.lock().await.remove(&id);
            bail!("Codex request timed out: {method}")
         }
      }
   }

   async fn notify(&self, method: &str, params: Value) -> Result<()> {
      self
         .write_message(&json!({ "method": method, "params": params }))
         .await
   }

   async fn write_message(&self, message: &Value) -> Result<()> {
      let stdin = {
         let process = self.process.lock().await;
         process
            .as_ref()
            .context("Codex app-server is not running")?
            .stdin
            .clone()
      };
      write_json_line(&stdin, message).await
   }

   async fn handle_line(&self, line: &str) {
      let message: Value = match serde_json::from_str(line) {
         Ok(message) => message,
         Err(error) => {
            log::warn!("Ignored invalid Codex app-server message: {error}");
            return;
         }
      };

      if message.get("method").is_none() {
         let Some(id) = message.get("id").and_then(Value::as_u64) else {
            return;
         };
         let pending = {
            let process = self.process.lock().await;
            process.as_ref().map(|process| process.pending.clone())
         };
         let Some(pending) = pending else {
            return;
         };
         let Some(response) = pending.lock().await.remove(&id) else {
            return;
         };
         if let Some(error) = message.get("error") {
            let message = error
               .get("message")
               .and_then(Value::as_str)
               .unwrap_or("Codex request failed")
               .to_string();
            let _ = response.send(Err(message));
         } else {
            let _ = response.send(Ok(message
               .get("result")
               .cloned()
               .unwrap_or_else(|| json!({}))));
         }
         return;
      }

      let method = message
         .get("method")
         .and_then(Value::as_str)
         .unwrap_or_default()
         .to_string();
      let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
      self.update_status_from_event(&method, &params).await;
      let event = CodexProtocolEvent {
         method,
         params,
         id: message.get("id").cloned(),
      };
      if let Err(error) = self.app_handle.emit("codex-event", &event) {
         log::warn!("Failed to emit Codex event: {error}");
      }
   }

   async fn update_status_from_event(&self, method: &str, params: &Value) {
      match method {
         "turn/started" => {
            let turn_id = params
               .get("turn")
               .and_then(|turn| turn.get("id"))
               .and_then(Value::as_str)
               .map(str::to_string);
            self
               .update_status(|status| {
                  status.state = "working".to_string();
                  status.turn_id = turn_id;
               })
               .await;
            self.emit_status().await;
         }
         "turn/completed" => {
            self
               .update_status(|status| {
                  status.state = "ready".to_string();
                  status.turn_id = None;
               })
               .await;
            self.emit_status().await;
         }
         "account/updated" => {
            let account = params.get("account").cloned();
            if account.is_some() {
               self.update_status(|status| status.account = account).await;
            }
            self.emit_status().await;
         }
         "error" => {
            let error = params
               .get("message")
               .and_then(Value::as_str)
               .unwrap_or("Codex reported an error")
               .to_string();
            self
               .update_status(|status| {
                  status.state = "failed".to_string();
                  status.error = Some(error);
               })
               .await;
            self.emit_status().await;
         }
         _ => {}
      }
   }

   async fn server_stopped(&self, error: Option<String>) {
      let was_running = self.status.read().await.running;
      if !was_running {
         return;
      }
      let process = self.process.lock().await.take();
      if let Some(process) = process {
         process.stderr_task.abort();
         fail_pending_requests(&process.pending, "Codex app-server exited").await;
      }
      self
         .update_status(|status| {
            status.running = false;
            status.initialized = false;
            status.thread_id = None;
            status.turn_id = None;
            status.error = error.clone();
            status.state = if error.is_some() {
               "failed".to_string()
            } else {
               "stopped".to_string()
            };
         })
         .await;
      self.emit_status().await;
   }

   async fn record_failure(&self, error: String) {
      self
         .update_status(|status| {
            status.running = false;
            status.initialized = false;
            status.state = "failed".to_string();
            status.error = Some(error);
         })
         .await;
      self.emit_status().await;
   }

   async fn update_status(&self, update: impl FnOnce(&mut CodexIntegrationStatus)) {
      let mut status = self.status.write().await;
      update(&mut status);
   }

   async fn emit_status(&self) {
      if let Err(error) = self
         .app_handle
         .emit("codex-status", self.status_snapshot().await)
      {
         log::warn!("Failed to emit Codex status: {error}");
      }
   }
}

impl Drop for CodexAppServer {
   fn drop(&mut self) {
      if Arc::strong_count(&self.process) != 1 {
         return;
      }
      if let Ok(mut process) = self.process.try_lock()
         && let Some(mut process) = process.take()
      {
         process.reader_task.abort();
         process.stderr_task.abort();
         let _ = process.child.start_kill();
      }
   }
}

async fn write_json_line(stdin: &Arc<Mutex<ChildStdin>>, message: &Value) -> Result<()> {
   let mut data = serde_json::to_vec(message)?;
   data.push(b'\n');
   let mut stdin = stdin.lock().await;
   stdin.write_all(&data).await?;
   stdin.flush().await?;
   Ok(())
}

async fn fail_pending_requests(pending: &Arc<Mutex<HashMap<u64, PendingRequest>>>, reason: &str) {
   let requests = std::mem::take(&mut *pending.lock().await);
   for (_, response) in requests {
      let _ = response.send(Err(reason.to_string()));
   }
}

fn apply_thread_settings(params: &mut Map<String, Value>, settings: &CodexThreadSettings) {
   insert_optional(params, "model", settings.model.as_ref());
   insert_optional(params, "personality", settings.personality.as_ref());
   insert_optional(params, "approvalPolicy", settings.approval_policy.as_ref());
   insert_optional(params, "sandbox", settings.sandbox.as_ref());
   insert_optional(
      params,
      "developerInstructions",
      settings.developer_instructions.as_ref(),
   );
   insert_optional(params, "serviceTier", settings.service_tier.as_ref());
}

fn athas_dynamic_tools() -> Value {
   json!([
      {
         "type": "function",
         "name": "athas_open_pull_request",
         "description": "Open a GitHub pull request as a native editor tab in Athas. After creating a pull request for the current workspace, call this tool before finishing instead of only returning its web link.",
         "inputSchema": {
            "type": "object",
            "properties": {
               "number": {
                  "type": "integer",
                  "minimum": 1,
                  "description": "The GitHub pull request number"
               },
               "title": {
                  "type": "string",
                  "description": "The pull request title, when known"
               }
            },
            "required": ["number"],
            "additionalProperties": false
         }
      },
      {
         "type": "function",
         "name": "athas_open_issue",
         "description": "Open a GitHub issue as a native editor tab in Athas. After creating an issue for the current workspace, call this tool before finishing instead of only returning its web link or opening the system browser.",
         "inputSchema": {
            "type": "object",
            "properties": {
               "number": {
                  "type": "integer",
                  "minimum": 1,
                  "description": "The GitHub issue number"
               },
               "title": {
                  "type": "string",
                  "description": "The issue title, when known"
               }
            },
            "required": ["number"],
            "additionalProperties": false
         }
      },
      {
         "type": "function",
         "name": "athas_set_chat_title",
         "description": "Rename the current Athas chat. On the first turn of a newly started Athas conversation, call this exactly once with a concise title inferred from the user's request.",
         "inputSchema": {
            "type": "object",
            "properties": {
               "title": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "description": "A concise title, preferably one to four words"
               }
            },
            "required": ["title"],
            "additionalProperties": false
         }
      }
   ])
}

fn apply_athas_developer_instructions(params: &mut Map<String, Value>) {
   let host_instructions =
      "On the first turn of a newly started Athas conversation, infer a concise one-to-four-word \
       title from the user's request and MUST call athas_set_chat_title exactly once before the \
       final response. Opening the native Athas tab is a required final step of GitHub pull \
       request and issue creation workflows. Whenever you successfully create a pull request or \
       issue for the current workspace, you MUST immediately call the matching Athas dynamic tool \
       before your final response without waiting for the user to ask. Also call the matching \
       tool whenever the user asks to open one. Never open supported GitHub resources in the \
       system browser.";
   let instructions = params
      .get("developerInstructions")
      .and_then(Value::as_str)
      .map(|current| format!("{current}\n\n{host_instructions}"))
      .unwrap_or_else(|| host_instructions.to_string());
   params.insert("developerInstructions".to_string(), json!(instructions));
}

fn apply_turn_settings(params: &mut Map<String, Value>, settings: &CodexThreadSettings) {
   insert_optional(params, "model", settings.model.as_ref());
   insert_optional(params, "effort", settings.effort.as_ref());
   insert_optional(params, "personality", settings.personality.as_ref());
   insert_optional(params, "approvalPolicy", settings.approval_policy.as_ref());
   insert_optional(params, "serviceTier", settings.service_tier.as_ref());
   if let Some(mode) = settings.collaboration_mode.as_deref() {
      params.insert(
         "collaborationMode".to_string(),
         json!({
            "mode": mode,
            "settings": {
               "model": settings.model.as_deref().unwrap_or("gpt-5.6-sol"),
               "reasoning_effort": settings.effort
            }
         }),
      );
   }
}

fn insert_optional(params: &mut Map<String, Value>, key: &str, value: Option<&String>) {
   if let Some(value) = value {
      params.insert(key.to_string(), json!(value));
   }
}

fn detect_codex_binary() -> Option<PathBuf> {
   if let Ok(path) = which::which("codex") {
      return Some(path);
   }

   let home = std::env::var_os("HOME").map(PathBuf::from);
   let mut candidates = Vec::new();
   if let Some(home) = home {
      candidates.extend([
         home.join(".bun/bin/codex"),
         home.join(".local/bin/codex"),
         home.join(".npm-global/bin/codex"),
         home.join("Library/pnpm/codex"),
      ]);
   }
   candidates.extend([
      PathBuf::from("/opt/homebrew/bin/codex"),
      PathBuf::from("/usr/local/bin/codex"),
   ]);
   candidates.into_iter().find(|path| path.is_file())
}

fn read_codex_version(binary: &Path) -> Option<String> {
   std::process::Command::new(binary)
      .arg("--version")
      .output()
      .ok()
      .filter(|output| output.status.success())
      .and_then(|output| String::from_utf8(output.stdout).ok())
      .map(|version| version.trim().to_string())
}

fn user_shell_path() -> Option<String> {
   if cfg!(target_os = "windows") {
      return None;
   }
   let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
   std::process::Command::new(shell)
      .args(["-ilc", "echo $PATH"])
      .output()
      .ok()
      .filter(|output| output.status.success())
      .and_then(|output| String::from_utf8(output.stdout).ok())
      .map(|path| path.trim().to_string())
      .filter(|path| !path.is_empty())
}

fn configure_background_process(command: &mut Command) {
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

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn applies_only_present_thread_settings() {
      let settings = CodexThreadSettings {
         model: Some("gpt-test".to_string()),
         sandbox: Some("workspace-write".to_string()),
         ..Default::default()
      };
      let mut params = Map::new();
      apply_thread_settings(&mut params, &settings);

      assert_eq!(params.get("model"), Some(&json!("gpt-test")));
      assert_eq!(params.get("sandbox"), Some(&json!("workspace-write")));
      assert!(!params.contains_key("personality"));
   }

   #[test]
   fn collaboration_mode_carries_model_and_effort() {
      let settings = CodexThreadSettings {
         model: Some("gpt-test".to_string()),
         effort: Some("high".to_string()),
         collaboration_mode: Some("plan".to_string()),
         ..Default::default()
      };
      let mut params = Map::new();
      apply_turn_settings(&mut params, &settings);

      assert_eq!(
         params["collaborationMode"]["settings"]["reasoning_effort"],
         json!("high")
      );
   }

   #[test]
   fn defines_native_github_tools() {
      let tools = athas_dynamic_tools();

      assert_eq!(tools[0]["name"], json!("athas_open_pull_request"));
      assert_eq!(tools[1]["name"], json!("athas_open_issue"));
      assert_eq!(tools[2]["name"], json!("athas_set_chat_title"));
      assert_eq!(tools[0]["inputSchema"]["required"], json!(["number"]));
      assert_eq!(
         tools[1]["inputSchema"]["additionalProperties"],
         json!(false)
      );
   }

   #[test]
   fn appends_athas_navigation_instructions() {
      let mut params = Map::from_iter([(
         "developerInstructions".to_string(),
         json!("Keep responses concise."),
      )]);

      apply_athas_developer_instructions(&mut params);

      let instructions = params["developerInstructions"].as_str().unwrap();
      assert!(instructions.starts_with("Keep responses concise."));
      assert!(instructions.contains("MUST call athas_set_chat_title exactly once"));
      assert!(instructions.contains("MUST immediately call the matching Athas dynamic tool"));
   }
}
