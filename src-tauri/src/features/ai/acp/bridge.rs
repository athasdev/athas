use super::{
   client::{AthasAcpClient, PermissionResponse},
   config::AgentRegistry,
   types::{
      AcpAgentStatus, AcpBootstrapContext, AcpEvent, AcpRuntimeState, AgentConfig, SessionMode,
      SessionModeState, StopReason,
   },
};
use crate::terminal::TerminalManager;
use acp::Agent;
use agent_client_protocol as acp;
use anyhow::{Context, Result, bail};
use serde_json::json;
use std::{
   collections::HashMap,
   fs::File,
   io::{BufRead, BufReader as StdBufReader},
   path::{Path, PathBuf},
   process::Stdio,
   sync::{
      Arc,
      atomic::{AtomicU64, Ordering},
   },
   thread,
   time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::{
   io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
   process::{Child, Command},
   runtime::Runtime,
   sync::{Mutex, mpsc, oneshot},
   task::LocalSet,
};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

const DEFAULT_ACP_ROUTE_KEY: &str = "panel";
const PI_CANONICAL_PROVIDER: &str = "openai-codex";
const PI_CANONICAL_MODEL_ID: &str = "gpt-5.4";
const PI_CANONICAL_THINKING_LEVEL: &str = "medium";

#[derive(Clone)]
struct AcpRouteWorkerHandle {
   command_tx: mpsc::Sender<AcpCommand>,
   status: Arc<Mutex<AcpAgentStatus>>,
   permission_tx: Arc<Mutex<Option<mpsc::Sender<PermissionResponse>>>>,
}

#[derive(Clone)]
struct PiRpcSession {
   stdin: Arc<Mutex<tokio::process::ChildStdin>>,
   response_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<Result<serde_json::Value>>>>>,
   closed_error: Arc<Mutex<Option<String>>>,
   pending_permission_requests: Arc<Mutex<HashMap<String, String>>>,
   request_counter: Arc<AtomicU64>,
   current_session_id: Arc<Mutex<Option<String>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PiWorkspaceSessionInfo {
   id: String,
   path: PathBuf,
}

#[derive(Debug, Clone, PartialEq)]
struct ParsedPiThoughtToolEvent {
   tool_name: String,
   input: serde_json::Value,
   output: serde_json::Value,
   success: bool,
}

impl PiRpcSession {
   async fn fail_response_waiters(
      response_waiters: &Arc<Mutex<HashMap<String, oneshot::Sender<Result<serde_json::Value>>>>>,
      error_message: String,
   ) {
      let waiters = {
         let mut pending = response_waiters.lock().await;
         pending
            .drain()
            .map(|(_, waiter)| waiter)
            .collect::<Vec<_>>()
      };

      for waiter in waiters {
         let _ = waiter.send(Err(anyhow::anyhow!("{}", error_message)));
      }
   }

   async fn get_closed_error(closed_error: &Arc<Mutex<Option<String>>>) -> Option<String> {
      closed_error.lock().await.clone()
   }

   fn new(
      route_key: String,
      app_handle: AppHandle,
      stdin: tokio::process::ChildStdin,
      stdout: tokio::process::ChildStdout,
      workspace_path: Option<String>,
      initial_session_id: Option<String>,
   ) -> Self {
      let stdin = Arc::new(Mutex::new(stdin));
      let response_waiters = Arc::new(Mutex::new(HashMap::<
         String,
         oneshot::Sender<Result<serde_json::Value>>,
      >::new()));
      let closed_error = Arc::new(Mutex::new(None));
      let pending_permission_requests = Arc::new(Mutex::new(HashMap::<String, String>::new()));
      let current_session_id = Arc::new(Mutex::new(initial_session_id));
      let response_waiters_reader = response_waiters.clone();
      let closed_error_reader = closed_error.clone();
      let pending_permission_requests_reader = pending_permission_requests.clone();
      let current_session_id_reader = current_session_id.clone();
      let route_key_reader = route_key.clone();
      let workspace_path_reader = workspace_path.clone();

      tokio::task::spawn_local(async move {
         let mut lines = BufReader::new(stdout).lines();
         let mut last_stop_reason: Option<String> = None;
         let mut last_error_message: Option<String> = None;
         let mut synthetic_tool_counter = 0_u64;
         let mut emitted_assistant_text_in_turn = false;
         let mut emitted_assistant_thinking_in_turn = false;
         let stream_close_error = loop {
            let line = match lines.next_line().await {
               Ok(Some(line)) => line,
               Ok(None) => break "Pi RPC stream ended before responding".to_string(),
               Err(error) => break format!("Pi RPC stream failed: {}", error),
            };

            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
               log::warn!("Failed to parse pi rpc output: {}", line);
               continue;
            };

            match value.get("type").and_then(serde_json::Value::as_str) {
               Some("response") => {
                  let Some(id) = value.get("id").and_then(serde_json::Value::as_str) else {
                     continue;
                  };
                  let waiter = response_waiters_reader.lock().await.remove(id);
                  if let Some(waiter) = waiter {
                     let result = if value
                        .get("success")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false)
                     {
                        Ok(value)
                     } else {
                        Err(anyhow::anyhow!(
                           "{}",
                           value
                              .get("error")
                              .and_then(serde_json::Value::as_str)
                              .unwrap_or("pi rpc command failed")
                        ))
                     };
                     let _ = waiter.send(result);
                  }
               }
               Some("extension_ui_request") => {
                  AcpWorker::handle_pi_extension_ui_request(
                     &app_handle,
                     &route_key_reader,
                     &pending_permission_requests_reader,
                     &value,
                  )
                  .await;
               }
               Some(event_type) => {
                  let active_session_id = current_session_id_reader
                     .lock()
                     .await
                     .clone()
                     .unwrap_or_else(|| format!("pi:{}", route_key_reader));
                  AcpWorker::emit_pi_event(
                     &app_handle,
                     &route_key_reader,
                     &active_session_id,
                     &mut last_stop_reason,
                     &mut last_error_message,
                     &mut synthetic_tool_counter,
                     &mut emitted_assistant_text_in_turn,
                     &mut emitted_assistant_thinking_in_turn,
                     &value,
                  )
                  .await;

                  if event_type == "agent_end" {
                     let runtime_state = AcpWorker::load_pi_runtime_state(
                        workspace_path_reader.as_deref(),
                        None,
                        &route_key_reader,
                        true,
                     );
                     {
                        let mut session_id = current_session_id_reader.lock().await;
                        *session_id = runtime_state.session_id.clone();
                     }
                     let _ = app_handle.emit(
                        "acp-event",
                        AcpEvent::RuntimeStateUpdate {
                           route_key: route_key_reader.clone(),
                           session_id: runtime_state.session_id.clone(),
                           runtime_state,
                        },
                     );
                  }
               }
               None => {}
            }
         };

         {
            let mut closed = closed_error_reader.lock().await;
            *closed = Some(stream_close_error.clone());
         }
         Self::fail_response_waiters(&response_waiters_reader, stream_close_error).await;
      });

      Self {
         stdin,
         response_waiters,
         closed_error,
         pending_permission_requests,
         request_counter: Arc::new(AtomicU64::new(1)),
         current_session_id,
      }
   }

   async fn send_command(&self, mut value: serde_json::Value) -> Result<serde_json::Value> {
      if let Some(error) = Self::get_closed_error(&self.closed_error).await {
         bail!("{}", error);
      }

      let request_id = format!(
         "pi-rpc-{}",
         self.request_counter.fetch_add(1, Ordering::Relaxed)
      );
      value["id"] = serde_json::Value::String(request_id.clone());

      let (tx, rx) = oneshot::channel();
      self
         .response_waiters
         .lock()
         .await
         .insert(request_id.clone(), tx);

      if let Some(error) = Self::get_closed_error(&self.closed_error).await {
         self.response_waiters.lock().await.remove(&request_id);
         bail!("{}", error);
      }

      {
         let mut stdin = self.stdin.lock().await;
         if let Err(error) = async {
            stdin
               .write_all(serde_json::to_string(&value)?.as_bytes())
               .await
               .context("Failed to write pi rpc command")?;
            stdin
               .write_all(b"\n")
               .await
               .context("Failed to terminate pi rpc command")?;
            stdin
               .flush()
               .await
               .context("Failed to flush pi rpc command")?;
            Ok::<(), anyhow::Error>(())
         }
         .await
         {
            self.response_waiters.lock().await.remove(&request_id);
            return Err(error);
         }
      }

      rx.await.context("Pi rpc response channel closed")?
   }

   async fn fetch_and_emit_commands(
      &self,
      route_key: &str,
      session_id: &str,
      app_handle: &AppHandle,
   ) -> Result<()> {
      let response = self.send_command(json!({ "type": "get_commands" })).await?;
      let commands = response
         .get("data")
         .and_then(|data| data.get("commands"))
         .and_then(serde_json::Value::as_array)
         .cloned()
         .unwrap_or_default()
         .into_iter()
         .filter_map(|command| {
            Some(super::types::SlashCommand {
               name: command.get("name")?.as_str()?.to_string(),
               description: command
                  .get("description")
                  .and_then(serde_json::Value::as_str)
                  .unwrap_or("")
                  .to_string(),
               input: None,
            })
         })
         .collect::<Vec<_>>();

      let _ = app_handle.emit(
         "acp-event",
         AcpEvent::SlashCommandsUpdate {
            route_key: route_key.to_string(),
            session_id: session_id.to_string(),
            commands,
         },
      );

      Ok(())
   }

   async fn respond_to_permission(
      &self,
      request_id: String,
      approved: bool,
      cancelled: bool,
      value: Option<String>,
   ) -> Result<()> {
      let method = self
         .pending_permission_requests
         .lock()
         .await
         .remove(&request_id)
         .unwrap_or_default();

      let response = match method.as_str() {
         "confirm" => {
            if cancelled {
               json!({
                  "type": "extension_ui_response",
                  "id": request_id,
                  "cancelled": true
               })
            } else {
               json!({
                  "type": "extension_ui_response",
                  "id": request_id,
                  "confirmed": approved
               })
            }
         }
         "input" | "select" => {
            if cancelled {
               json!({
                  "type": "extension_ui_response",
                  "id": request_id,
                  "cancelled": true
               })
            } else {
               json!({
                  "type": "extension_ui_response",
                  "id": request_id,
                  "value": value.unwrap_or_default()
               })
            }
         }
         _ => bail!("Unsupported pi permission request: {}", request_id),
      };

      let mut stdin = self.stdin.lock().await;
      stdin
         .write_all(serde_json::to_string(&response)?.as_bytes())
         .await
         .context("Failed to write pi ui response")?;
      stdin
         .write_all(b"\n")
         .await
         .context("Failed to terminate pi ui response")?;
      stdin
         .flush()
         .await
         .context("Failed to flush pi ui response")?;
      Ok(())
   }
}

/// Commands that can be sent to the ACP worker thread
#[allow(clippy::large_enum_variant)]
enum AcpCommand {
   Initialize {
      agent_id: String,
      workspace_path: Option<String>,
      session_id: Option<String>,
      fresh_session: bool,
      bootstrap: Option<AcpBootstrapContext>,
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
   route_key: String,
   connection: Option<Arc<acp::ClientSideConnection>>,
   session_id: Option<acp::SessionId>,
   pending_bootstrap: Option<AcpBootstrapContext>,
   pi_session: Option<PiRpcSession>,
   process: Option<Child>,
   io_handle: Option<tokio::task::JoinHandle<()>>,
   client: Option<Arc<AthasAcpClient>>,
   agent_id: Option<String>,
   app_handle: Option<AppHandle>,
}

impl AcpWorker {
   fn new(route_key: String) -> Self {
      Self {
         route_key,
         connection: None,
         session_id: None,
         pending_bootstrap: None,
         pi_session: None,
         process: None,
         io_handle: None,
         client: None,
         agent_id: None,
         app_handle: None,
      }
   }

   fn pi_agent_root() -> Option<PathBuf> {
      std::env::var_os("PI_CODING_AGENT_DIR")
         .filter(|value| !value.is_empty())
         .map(PathBuf::from)
         .or_else(|| dirs::home_dir().map(|home| home.join(".pi").join("agent")))
   }

   fn resolve_workspace_path(workspace_path: Option<&str>) -> Option<PathBuf> {
      workspace_path
         .map(PathBuf::from)
         .or_else(|| std::env::current_dir().ok())
   }

   fn read_json_file(path: &Path) -> Option<serde_json::Value> {
      let content = std::fs::read_to_string(path).ok()?;
      serde_json::from_str::<serde_json::Value>(&content).ok()
   }

   fn read_json_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
      keys
         .iter()
         .find_map(|key| value.get(*key).and_then(serde_json::Value::as_str))
         .map(ToString::to_string)
   }

   fn current_timestamp_millis() -> u64 {
      SystemTime::now()
         .duration_since(UNIX_EPOCH)
         .unwrap_or_default()
         .as_millis() as u64
   }

   fn read_json_object(path: &Path) -> serde_json::Map<String, serde_json::Value> {
      Self::read_json_file(path)
         .and_then(|value| value.as_object().cloned())
         .unwrap_or_default()
   }

   fn write_json_file(path: &Path, value: &serde_json::Value) -> Result<()> {
      if let Some(parent) = path.parent() {
         std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create parent directory for {}", path.display()))?;
      }

      std::fs::write(path, format!("{}\n", serde_json::to_string_pretty(value)?))
         .with_context(|| format!("Failed to write {}", path.display()))?;

      Ok(())
   }

   fn repair_pi_settings_json(agent_root: &Path) -> Result<()> {
      let path = agent_root.join("settings.json");
      let mut settings = Self::read_json_object(&path);

      settings.insert(
         "default_provider".to_string(),
         serde_json::Value::String(PI_CANONICAL_PROVIDER.to_string()),
      );
      settings.insert(
         "defaultProvider".to_string(),
         serde_json::Value::String(PI_CANONICAL_PROVIDER.to_string()),
      );
      settings.insert(
         "default_model".to_string(),
         serde_json::Value::String(PI_CANONICAL_MODEL_ID.to_string()),
      );
      settings.insert(
         "defaultModel".to_string(),
         serde_json::Value::String(PI_CANONICAL_MODEL_ID.to_string()),
      );
      settings.insert(
         "default_thinking_level".to_string(),
         serde_json::Value::String(PI_CANONICAL_THINKING_LEVEL.to_string()),
      );
      settings.insert(
         "defaultThinkingLevel".to_string(),
         serde_json::Value::String(PI_CANONICAL_THINKING_LEVEL.to_string()),
      );

      Self::write_json_file(&path, &serde_json::Value::Object(settings))
   }

   fn repair_pi_reasoning_state_json(agent_root: &Path) -> Result<()> {
      let path = agent_root.join("reasoning-state.json");
      let mut reasoning = Self::read_json_object(&path);

      let requested = json!({
         "provider": PI_CANONICAL_PROVIDER,
         "modelId": PI_CANONICAL_MODEL_ID,
         "family": PI_CANONICAL_MODEL_ID,
         "thinkingLevel": PI_CANONICAL_THINKING_LEVEL,
      });
      let effective = requested.clone();

      reasoning.insert("requested".to_string(), requested);
      reasoning.insert("effective".to_string(), effective);
      reasoning.insert(
         "display".to_string(),
         json!({
            "label": format!("{}/{}", PI_CANONICAL_MODEL_ID, PI_CANONICAL_THINKING_LEVEL),
            "mode": "raw-family",
            "rawPinned": true,
         }),
      );
      reasoning.insert(
         "normalization".to_string(),
         json!({
            "kind": "none",
         }),
      );
      reasoning.insert(
         "updatedAt".to_string(),
         serde_json::Value::Number(Self::current_timestamp_millis().into()),
      );

      Self::write_json_file(&path, &serde_json::Value::Object(reasoning))
   }

   fn repair_pi_behavior_mode_state(agent_root: &Path) -> Result<()> {
      let path = agent_root.join("behavior-mode-state.json");
      if !path.exists() {
         return Ok(());
      }

      let mut behavior = Self::read_json_object(&path);
      behavior.remove("currentBehavior");

      if behavior.is_empty() {
         std::fs::remove_file(&path)
            .with_context(|| format!("Failed to remove {}", path.display()))?;
         return Ok(());
      }

      behavior.insert(
         "updatedAt".to_string(),
         serde_json::Value::Number(Self::current_timestamp_millis().into()),
      );

      Self::write_json_file(&path, &serde_json::Value::Object(behavior))
   }

   fn repair_pi_local_runtime_files(agent_root: &Path) -> Result<()> {
      std::fs::create_dir_all(agent_root)
         .with_context(|| format!("Failed to create {}", agent_root.display()))?;
      Self::repair_pi_settings_json(agent_root)?;
      Self::repair_pi_reasoning_state_json(agent_root)?;
      Self::repair_pi_behavior_mode_state(agent_root)?;
      Ok(())
   }

   fn parse_pi_ui_options(value: &serde_json::Value) -> Option<Vec<String>> {
      let array = value
         .get("options")
         .or_else(|| value.get("items"))
         .or_else(|| value.get("choices"))
         .and_then(serde_json::Value::as_array)?;

      let options = array
         .iter()
         .filter_map(|entry| {
            if let Some(option) = entry.as_str() {
               return Some(option.to_string());
            }

            Some(Self::read_json_string(
               entry,
               &["value", "label", "title", "name", "id"],
            )?)
         })
         .collect::<Vec<_>>();

      (!options.is_empty()).then_some(options)
   }

   fn pi_session_dir_name(workspace_path: &Path) -> String {
      let raw = workspace_path.to_string_lossy();
      let sanitized = raw
         .chars()
         .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
         .collect::<String>();
      format!("--{}--", sanitized.trim_matches('-'))
   }

   fn read_pi_workspace_session(path: &Path) -> Option<PiWorkspaceSessionInfo> {
      let file = File::open(path).ok()?;
      let mut lines = StdBufReader::new(file).lines();
      let first_line = lines.next()?.ok()?;
      let value = serde_json::from_str::<serde_json::Value>(&first_line).ok()?;
      if value.get("type").and_then(serde_json::Value::as_str) != Some("session") {
         return None;
      }

      Some(PiWorkspaceSessionInfo {
         id: value.get("id")?.as_str()?.to_string(),
         path: path.to_path_buf(),
      })
   }

   fn find_pi_workspace_session(
      workspace_path: Option<&str>,
      preferred_session_id: Option<&str>,
      allow_latest_existing: bool,
   ) -> Option<PiWorkspaceSessionInfo> {
      let agent_root = Self::pi_agent_root()?;
      let workspace_path = Self::resolve_workspace_path(workspace_path)?;
      let session_dir = agent_root
         .join("sessions")
         .join(Self::pi_session_dir_name(&workspace_path));
      let entries = std::fs::read_dir(session_dir).ok()?;
      let mut sessions = entries
         .flatten()
         .filter_map(|entry| {
            let path = entry.path();
            (path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")).then_some(path)
         })
         .collect::<Vec<_>>();
      sessions.sort();
      sessions.reverse();

      if let Some(session_id) = preferred_session_id {
         for session_path in &sessions {
            let Some(session) = Self::read_pi_workspace_session(session_path) else {
               continue;
            };
            if session.id == session_id {
               return Some(session);
            }
         }
      }

      if !allow_latest_existing {
         return None;
      }

      sessions
         .into_iter()
         .find_map(|session_path| Self::read_pi_workspace_session(&session_path))
   }

   fn load_pi_session_mode_state() -> SessionModeState {
      let Some(agent_root) = Self::pi_agent_root() else {
         return SessionModeState::default();
      };
      let Some(value) = Self::read_json_file(&agent_root.join("modes.json")) else {
         return SessionModeState::default();
      };

      let available_modes = value
         .get("modes")
         .and_then(serde_json::Value::as_object)
         .map(|modes| {
            modes
               .keys()
               .map(|mode_id| SessionMode {
                  id: mode_id.clone(),
                  name: mode_id.clone(),
                  description: None,
               })
               .collect::<Vec<_>>()
         })
         .unwrap_or_default();

      SessionModeState {
         current_mode_id: Self::read_json_string(&value, &["currentMode"]),
         available_modes,
      }
   }

   fn load_pi_runtime_state(
      workspace_path: Option<&str>,
      preferred_session_id: Option<&str>,
      route_key: &str,
      allow_latest_existing: bool,
   ) -> AcpRuntimeState {
      let resolved_workspace_path = Self::resolve_workspace_path(workspace_path)
         .map(|path| path.to_string_lossy().to_string());
      let mut runtime_state = AcpRuntimeState {
         agent_id: "pi".to_string(),
         source: Some("pi-local".to_string()),
         session_id: Some(format!("pi:{}", route_key)),
         session_path: None,
         workspace_path: resolved_workspace_path.clone(),
         provider: None,
         model_id: None,
         thinking_level: None,
         behavior: None,
      };

      if let Some(agent_root) = Self::pi_agent_root() {
         if let Err(error) = Self::repair_pi_local_runtime_files(&agent_root) {
            log::warn!("Failed to repair Pi local runtime config: {}", error);
         }

         if let Some(settings) = Self::read_json_file(&agent_root.join("settings.json")) {
            runtime_state.provider =
               Self::read_json_string(&settings, &["defaultProvider", "default_provider"]);
            runtime_state.model_id =
               Self::read_json_string(&settings, &["defaultModel", "default_model"]);
            runtime_state.thinking_level = Self::read_json_string(
               &settings,
               &["defaultThinkingLevel", "default_thinking_level"],
            );
         }

         if let Some(reasoning) = Self::read_json_file(&agent_root.join("reasoning-state.json")) {
            if let Some(effective) = reasoning.get("effective") {
               runtime_state.provider = Self::read_json_string(effective, &["provider"])
                  .or_else(|| runtime_state.provider.clone());
               runtime_state.model_id = Self::read_json_string(effective, &["modelId"])
                  .or_else(|| runtime_state.model_id.clone());
               runtime_state.thinking_level = Self::read_json_string(effective, &["thinkingLevel"])
                  .or_else(|| runtime_state.thinking_level.clone());
            }
         }

         if let Some(behavior) = Self::read_json_file(&agent_root.join("behavior-mode-state.json"))
         {
            runtime_state.behavior = Self::read_json_string(&behavior, &["currentBehavior"]);
         }
      }

      if let Some(session) = Self::find_pi_workspace_session(
         resolved_workspace_path.as_deref(),
         preferred_session_id,
         allow_latest_existing,
      ) {
         runtime_state.session_id = Some(session.id);
         runtime_state.session_path = Some(session.path.to_string_lossy().to_string());
      }

      runtime_state
   }

   fn format_bootstrap_prompt(prompt: &str, bootstrap: Option<AcpBootstrapContext>) -> String {
      let Some(bootstrap) = bootstrap.filter(|context| !context.conversation_history.is_empty())
      else {
         return prompt.to_string();
      };

      let conversation = bootstrap
         .conversation_history
         .into_iter()
         .map(|message| format!("{}: {}", message.role.to_uppercase(), message.content))
         .collect::<Vec<_>>()
         .join("\n\n");

      format!(
         "Previous conversation context (for continuity only):\n{}\n\nNew user message:\n{}",
         conversation, prompt
      )
   }

   fn build_pi_prompt_command(prompt: &str) -> serde_json::Value {
      json!({
         "type": "prompt",
         "message": prompt,
      })
   }

   fn build_pi_launch_args(
      base_args: &[String],
      runtime_state: &AcpRuntimeState,
      fresh_session: bool,
   ) -> Vec<String> {
      let mut args = base_args.to_vec();

      if !fresh_session && let Some(session_path) = runtime_state.session_path.as_ref() {
         args.push("--session".to_string());
         args.push(session_path.clone());
      }

      if let Some(provider) = runtime_state.provider.as_ref() {
         args.push("--provider".to_string());
         args.push(provider.clone());
      }

      if let Some(model_id) = runtime_state.model_id.as_ref() {
         args.push("--model".to_string());
         args.push(model_id.clone());
      }

      if let Some(thinking_level) = runtime_state.thinking_level.as_ref() {
         args.push("--thinking".to_string());
         args.push(thinking_level.clone());
      }

      args
   }

   fn map_pi_stop_reason(stop_reason: Option<&str>) -> StopReason {
      match stop_reason {
         Some("length") => StopReason::MaxTokens,
         Some("aborted") => StopReason::Cancelled,
         _ => StopReason::EndTurn,
      }
   }

   fn parse_pi_thought_tool_events(content: &str) -> Vec<ParsedPiThoughtToolEvent> {
      let mut events = Vec::new();
      let mut pending_tool: Option<(String, serde_json::Value)> = None;

      for line in content.lines() {
         let trimmed = line.trim();
         if trimmed.is_empty() {
            continue;
         }

         let Some(rest) = trimmed.strip_prefix('[') else {
            continue;
         };
         let Some(bracket_end) = rest.find(']') else {
            continue;
         };

         let marker = rest[..bracket_end].trim();
         let payload = rest[bracket_end + 1..].trim();

         if marker.eq_ignore_ascii_case("tool-result") {
            let Some((tool_name, input)) = pending_tool.take() else {
               continue;
            };

            let success = {
               let normalized = payload.to_ascii_lowercase();
               !(normalized.starts_with("error") || normalized.starts_with("failed"))
            };
            let output = if payload.is_empty() {
               serde_json::Value::Null
            } else {
               serde_json::Value::String(payload.to_string())
            };

            events.push(ParsedPiThoughtToolEvent {
               tool_name,
               input,
               output,
               success,
            });
            continue;
         }

         let input = if payload.is_empty() {
            serde_json::Value::Null
         } else {
            serde_json::from_str(payload)
               .unwrap_or_else(|_| serde_json::Value::String(payload.to_string()))
         };

         pending_tool = Some((marker.to_ascii_lowercase(), input));
      }

      events
   }

   fn emit_pi_thought_tool_events(
      app_handle: &AppHandle,
      route_key: &str,
      session_id: &str,
      content: &str,
      synthetic_tool_counter: &mut u64,
   ) {
      for event in Self::parse_pi_thought_tool_events(content) {
         *synthetic_tool_counter += 1;
         let tool_id = format!("pi-thought-tool-{}", synthetic_tool_counter);
         let _ = app_handle.emit(
            "acp-event",
            AcpEvent::ToolStart {
               route_key: route_key.to_string(),
               session_id: session_id.to_string(),
               tool_name: event.tool_name.clone(),
               tool_id: tool_id.clone(),
               input: event.input.clone(),
            },
         );
         let _ = app_handle.emit(
            "acp-event",
            AcpEvent::ToolComplete {
               route_key: route_key.to_string(),
               session_id: session_id.to_string(),
               tool_id,
               success: event.success,
               output: Some(event.output.clone()),
               locations: None,
            },
         );
      }
   }

   fn emit_pi_message_text_content(
      app_handle: &AppHandle,
      route_key: &str,
      session_id: &str,
      message: &serde_json::Value,
   ) -> bool {
      let Some(content_blocks) = message.get("content").and_then(serde_json::Value::as_array)
      else {
         return false;
      };

      let mut emitted = false;
      for block in content_blocks {
         let Some(block_type) = block.get("type").and_then(serde_json::Value::as_str) else {
            continue;
         };
         if block_type != "text" {
            continue;
         }

         let Some(text) = block.get("text").and_then(serde_json::Value::as_str) else {
            continue;
         };
         if text.is_empty() {
            continue;
         }

         let _ = app_handle.emit(
            "acp-event",
            AcpEvent::ContentChunk {
               route_key: route_key.to_string(),
               session_id: session_id.to_string(),
               content: super::types::AcpContentBlock::Text {
                  text: text.to_string(),
               },
               is_complete: false,
            },
         );
         emitted = true;
      }

      emitted
   }

   fn emit_pi_message_thinking_content(
      app_handle: &AppHandle,
      route_key: &str,
      session_id: &str,
      message: &serde_json::Value,
      synthetic_tool_counter: &mut u64,
   ) -> bool {
      let Some(content_blocks) = message.get("content").and_then(serde_json::Value::as_array)
      else {
         return false;
      };

      let mut emitted = false;
      for block in content_blocks {
         let Some(block_type) = block.get("type").and_then(serde_json::Value::as_str) else {
            continue;
         };
         if block_type != "thinking" {
            continue;
         }

         let Some(thinking) = block.get("thinking").and_then(serde_json::Value::as_str) else {
            continue;
         };
         if thinking.is_empty() {
            continue;
         }

         let _ = app_handle.emit(
            "acp-event",
            AcpEvent::ThoughtChunk {
               route_key: route_key.to_string(),
               session_id: session_id.to_string(),
               content: super::types::AcpContentBlock::Text {
                  text: thinking.to_string(),
               },
               is_complete: false,
            },
         );
         Self::emit_pi_thought_tool_events(
            app_handle,
            route_key,
            session_id,
            thinking,
            synthetic_tool_counter,
         );
         emitted = true;
      }

      emitted
   }

   async fn handle_pi_extension_ui_request(
      app_handle: &AppHandle,
      route_key: &str,
      pending_permission_requests: &Arc<Mutex<HashMap<String, String>>>,
      value: &serde_json::Value,
   ) {
      let Some(id) = value.get("id").and_then(serde_json::Value::as_str) else {
         return;
      };
      let Some(method) = value.get("method").and_then(serde_json::Value::as_str) else {
         return;
      };

      match method {
         "confirm" => {
            let title = value
               .get("title")
               .and_then(serde_json::Value::as_str)
               .unwrap_or("Pi confirmation");
            let message = value
               .get("message")
               .and_then(serde_json::Value::as_str)
               .unwrap_or("");
            pending_permission_requests
               .lock()
               .await
               .insert(id.to_string(), method.to_string());
            let _ = app_handle.emit(
               "acp-event",
               AcpEvent::PermissionRequest {
                  route_key: route_key.to_string(),
                  request_id: id.to_string(),
                  permission_type: "confirm".to_string(),
                  resource: "pi".to_string(),
                  description: format!("{title}: {message}"),
                  title: Some(title.to_string()),
                  placeholder: None,
                  default_value: None,
                  options: None,
               },
            );
         }
         "input" => {
            let title = Self::read_json_string(value, &["title", "label"])
               .unwrap_or_else(|| "Pi input".to_string());
            let message =
               Self::read_json_string(value, &["message", "description"]).unwrap_or_default();
            let placeholder = Self::read_json_string(value, &["placeholder", "hint"]);
            let default_value = Self::read_json_string(value, &["value", "defaultValue"]);
            pending_permission_requests
               .lock()
               .await
               .insert(id.to_string(), method.to_string());
            let _ = app_handle.emit(
               "acp-event",
               AcpEvent::PermissionRequest {
                  route_key: route_key.to_string(),
                  request_id: id.to_string(),
                  permission_type: "input".to_string(),
                  resource: "pi".to_string(),
                  description: if message.is_empty() {
                     title.clone()
                  } else {
                     format!("{title}: {message}")
                  },
                  title: Some(title),
                  placeholder,
                  default_value,
                  options: None,
               },
            );
         }
         "select" => {
            let title = Self::read_json_string(value, &["title", "label"])
               .unwrap_or_else(|| "Pi selection".to_string());
            let message =
               Self::read_json_string(value, &["message", "description"]).unwrap_or_default();
            let options = Self::parse_pi_ui_options(value);
            let default_value = Self::read_json_string(value, &["value", "defaultValue"]);
            pending_permission_requests
               .lock()
               .await
               .insert(id.to_string(), method.to_string());
            let _ = app_handle.emit(
               "acp-event",
               AcpEvent::PermissionRequest {
                  route_key: route_key.to_string(),
                  request_id: id.to_string(),
                  permission_type: "select".to_string(),
                  resource: "pi".to_string(),
                  description: if message.is_empty() {
                     title.clone()
                  } else {
                     format!("{title}: {message}")
                  },
                  title: Some(title),
                  placeholder: None,
                  default_value,
                  options,
               },
            );
         }
         "notify" => {
            let message = value
               .get("message")
               .and_then(serde_json::Value::as_str)
               .unwrap_or("Pi notification");
            log::info!("[pi] {}", message);
         }
         "setTitle" => {
            if let Some(title) = Self::read_json_string(value, &["title", "value"]) {
               log::info!("[pi] title: {}", title);
            }
         }
         "setStatus" => {
            let status_text = value
               .get("statusText")
               .and_then(serde_json::Value::as_str)
               .unwrap_or("");
            log::info!("[pi] status: {}", status_text);
         }
         "setWidget" | "set_editor_text" => {
            log::info!("[pi] ui request: {}", method);
         }
         unsupported => {
            log::warn!("Unsupported pi extension UI request: {}", unsupported);
         }
      }
   }

   async fn emit_pi_event(
      app_handle: &AppHandle,
      route_key: &str,
      session_id: &str,
      last_stop_reason: &mut Option<String>,
      last_error_message: &mut Option<String>,
      synthetic_tool_counter: &mut u64,
      emitted_assistant_text_in_turn: &mut bool,
      emitted_assistant_thinking_in_turn: &mut bool,
      value: &serde_json::Value,
   ) {
      let Some(event_type) = value.get("type").and_then(serde_json::Value::as_str) else {
         return;
      };

      match event_type {
         "message_start" => {
            let role = value
               .get("message")
               .and_then(|message| message.get("role"))
               .and_then(serde_json::Value::as_str)
               .unwrap_or_default();
            if role == "assistant" {
               *emitted_assistant_text_in_turn = false;
               *emitted_assistant_thinking_in_turn = false;
            }
         }
         "message_update" => {
            let Some(assistant_event) = value.get("assistantMessageEvent") else {
               return;
            };
            let Some(assistant_event_type) = assistant_event
               .get("type")
               .and_then(serde_json::Value::as_str)
            else {
               return;
            };

            match assistant_event_type {
               "text_delta" => {
                  if let Some(delta) = assistant_event
                     .get("delta")
                     .and_then(serde_json::Value::as_str)
                  {
                     *emitted_assistant_text_in_turn = true;
                     let _ = app_handle.emit(
                        "acp-event",
                        AcpEvent::ContentChunk {
                           route_key: route_key.to_string(),
                           session_id: session_id.to_string(),
                           content: super::types::AcpContentBlock::Text {
                              text: delta.to_string(),
                           },
                           is_complete: false,
                        },
                     );
                  }
               }
               "thinking_delta" => {
                  if let Some(delta) = assistant_event
                     .get("delta")
                     .and_then(serde_json::Value::as_str)
                  {
                     *emitted_assistant_thinking_in_turn = true;
                     let _ = app_handle.emit(
                        "acp-event",
                        AcpEvent::ThoughtChunk {
                           route_key: route_key.to_string(),
                           session_id: session_id.to_string(),
                           content: super::types::AcpContentBlock::Text {
                              text: delta.to_string(),
                           },
                           is_complete: false,
                        },
                     );
                  }
               }
               "thinking_end" => {
                  if let Some(content) = assistant_event
                     .get("content")
                     .and_then(serde_json::Value::as_str)
                  {
                     *emitted_assistant_thinking_in_turn = true;
                     Self::emit_pi_thought_tool_events(
                        app_handle,
                        route_key,
                        session_id,
                        content,
                        synthetic_tool_counter,
                     );
                  }
               }
               _ => {}
            }
         }
         "message_end" => {
            let Some(message) = value.get("message") else {
               return;
            };
            let role = message
               .get("role")
               .and_then(serde_json::Value::as_str)
               .unwrap_or_default();
            if role == "assistant" {
               if !*emitted_assistant_text_in_turn {
                  *emitted_assistant_text_in_turn =
                     Self::emit_pi_message_text_content(app_handle, route_key, session_id, message);
               }
               if !*emitted_assistant_thinking_in_turn {
                  *emitted_assistant_thinking_in_turn = Self::emit_pi_message_thinking_content(
                     app_handle,
                     route_key,
                     session_id,
                     message,
                     synthetic_tool_counter,
                  );
               }
               *last_stop_reason = message
                  .get("stopReason")
                  .and_then(serde_json::Value::as_str)
                  .map(ToString::to_string);
               *last_error_message = message
                  .get("errorMessage")
                  .and_then(serde_json::Value::as_str)
                  .map(ToString::to_string);
            }
         }
         "tool_execution_start" => {
            let tool_name = value
               .get("toolName")
               .and_then(serde_json::Value::as_str)
               .unwrap_or("tool");
            let tool_id = value
               .get("toolCallId")
               .and_then(serde_json::Value::as_str)
               .unwrap_or("tool-call");
            let input = value
               .get("args")
               .cloned()
               .unwrap_or(serde_json::Value::Null);
            let _ = app_handle.emit(
               "acp-event",
               AcpEvent::ToolStart {
                  route_key: route_key.to_string(),
                  session_id: session_id.to_string(),
                  tool_name: tool_name.to_string(),
                  tool_id: tool_id.to_string(),
                  input,
               },
            );
         }
         "tool_execution_end" => {
            let tool_id = value
               .get("toolCallId")
               .and_then(serde_json::Value::as_str)
               .unwrap_or("tool-call");
            let is_error = value
               .get("isError")
               .and_then(serde_json::Value::as_bool)
               .unwrap_or(false);
            let output = value.get("result").cloned();
            let _ = app_handle.emit(
               "acp-event",
               AcpEvent::ToolComplete {
                  route_key: route_key.to_string(),
                  session_id: session_id.to_string(),
                  tool_id: tool_id.to_string(),
                  success: !is_error,
                  output,
                  locations: None,
               },
            );
         }
         "auto_retry_start" => {
            let attempt = value
               .get("attempt")
               .and_then(serde_json::Value::as_u64)
               .unwrap_or(1);
            let max_attempts = value
               .get("maxAttempts")
               .and_then(serde_json::Value::as_u64)
               .unwrap_or(attempt);
            let error_message = value
               .get("errorMessage")
               .and_then(serde_json::Value::as_str)
               .unwrap_or("Pi retry");
            log::info!(
               "[pi] auto-retry {}/{} scheduled: {}",
               attempt,
               max_attempts,
               error_message
            );
         }
         "agent_end" => {
            if matches!(last_stop_reason.as_deref(), Some("error")) {
               let _ = app_handle.emit(
                  "acp-event",
                  AcpEvent::Error {
                     route_key: route_key.to_string(),
                     session_id: Some(session_id.to_string()),
                     error: last_error_message
                        .clone()
                        .unwrap_or_else(|| "Pi agent error".to_string()),
                  },
               );
            } else {
               let _ = app_handle.emit(
                  "acp-event",
                  AcpEvent::PromptComplete {
                     route_key: route_key.to_string(),
                     session_id: session_id.to_string(),
                     stop_reason: Self::map_pi_stop_reason(last_stop_reason.as_deref()),
                  },
               );
            }

            *last_stop_reason = None;
            *last_error_message = None;
         }
         _ => {}
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
                     route_key: self.route_key.clone(),
                     session_id: session_id.clone(),
                     error: format!("ACP agent process exited: {}", status),
                  },
               );
               let _ = app_handle.emit(
                  "acp-event",
                  AcpEvent::StatusChanged {
                     route_key: self.route_key.clone(),
                     status: AcpAgentStatus::default(),
                  },
               );
            }

            if let Some(io_handle) = self.io_handle.take() {
               io_handle.abort();
            }

            self.connection = None;
            self.session_id = None;
            self.pending_bootstrap = None;
            self.pi_session = None;
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

   async fn initialize_pi(
      &mut self,
      agent_id: String,
      workspace_path: Option<String>,
      session_id: Option<String>,
      fresh_session: bool,
      config: AgentConfig,
      bootstrap: Option<AcpBootstrapContext>,
      app_handle: AppHandle,
   ) -> Result<(AcpAgentStatus, mpsc::Sender<PermissionResponse>)> {
      let runtime_state = Self::load_pi_runtime_state(
         workspace_path.as_deref(),
         session_id.as_deref(),
         &self.route_key,
         !fresh_session,
      );
      let initial_session_id = runtime_state.session_id.clone();
      let session_mode_state = Self::load_pi_session_mode_state();
      let launch_args = Self::build_pi_launch_args(&config.args, &runtime_state, fresh_session);
      let binary = config.binary_path.as_deref().unwrap_or(&config.binary_name);
      log::info!(
         "Starting pi RPC agent '{}' (binary: {}, resolved: {}, args: {:?})",
         config.name,
         config.binary_name,
         binary,
         launch_args
      );

      let mut cmd = Command::new(binary);
      cmd.args(&launch_args)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped());

      for (key, value) in &config.env_vars {
         cmd.env(key, value);
      }

      if let Some(ref path) = workspace_path {
         cmd.current_dir(path);
      }

      let mut child = cmd.spawn().context("Failed to spawn pi process")?;
      let stdin = child.stdin.take().context("Failed to get pi stdin")?;
      let stdout = child.stdout.take().context("Failed to get pi stdout")?;

      if let Some(stderr) = child.stderr.take() {
         let agent_name = config.name.clone();
         tokio::task::spawn_local(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
               log::warn!("[{}] stderr: {}", agent_name, line);
            }
         });
      }

      let pi_session = PiRpcSession::new(
         self.route_key.clone(),
         app_handle.clone(),
         stdin,
         stdout,
         workspace_path.clone(),
         initial_session_id.clone(),
      );
      let (permission_sender, mut permission_receiver) = mpsc::channel::<PermissionResponse>(8);
      let pi_permission_session = pi_session.clone();
      tokio::task::spawn_local(async move {
         while let Some(response) = permission_receiver.recv().await {
            if let Err(error) = pi_permission_session
               .respond_to_permission(
                  response.request_id,
                  response.approved,
                  response.cancelled,
                  response.value,
               )
               .await
            {
               log::warn!("Failed to send pi permission response: {}", error);
            }
         }
      });

      if let Err(error) = pi_session
         .fetch_and_emit_commands(
            &self.route_key,
            initial_session_id.as_deref().unwrap_or("pi"),
            &app_handle,
         )
         .await
      {
         log::warn!("Failed to fetch pi commands: {}", error);
      }

      let _ = app_handle.emit(
         "acp-event",
         AcpEvent::RuntimeStateUpdate {
            route_key: self.route_key.clone(),
            session_id: runtime_state.session_id.clone(),
            runtime_state: runtime_state.clone(),
         },
      );

      if let Some(current_mode_id) = session_mode_state.current_mode_id.clone() {
         let _ = app_handle.emit(
            "acp-event",
            AcpEvent::SessionModeUpdate {
               route_key: self.route_key.clone(),
               session_id: initial_session_id
                  .clone()
                  .unwrap_or_else(|| format!("pi:{}", self.route_key)),
               mode_state: SessionModeState {
                  current_mode_id: Some(current_mode_id),
                  available_modes: session_mode_state.available_modes.clone(),
               },
            },
         );
      }

      self.connection = None;
      self.session_id = initial_session_id.clone().map(acp::SessionId::new);
      self.pending_bootstrap = bootstrap.filter(|context| !context.conversation_history.is_empty());
      self.pi_session = Some(pi_session);
      self.process = Some(child);
      self.io_handle = None;
      self.client = None;
      self.agent_id = Some(agent_id.clone());
      self.app_handle = Some(app_handle);

      Ok((
         AcpAgentStatus {
            agent_id,
            running: true,
            session_active: true,
            initialized: true,
            session_id: initial_session_id,
         },
         permission_sender,
      ))
   }

   async fn initialize(
      &mut self,
      agent_id: String,
      workspace_path: Option<String>,
      session_id: Option<String>,
      fresh_session: bool,
      bootstrap: Option<AcpBootstrapContext>,
      config: AgentConfig,
      app_handle: AppHandle,
      terminal_manager: Arc<TerminalManager>,
   ) -> Result<(AcpAgentStatus, mpsc::Sender<PermissionResponse>)> {
      // Stop any existing agent first
      self.stop().await?;

      if agent_id == "pi" {
         return self
            .initialize_pi(
               agent_id,
               workspace_path,
               session_id,
               fresh_session,
               config,
               bootstrap,
               app_handle,
            )
            .await;
      }

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
         self.route_key.clone(),
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

      if !fresh_session && let Some(existing_session_id) = session_id.clone() {
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
               route_key: self.route_key.clone(),
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
      self.pending_bootstrap = bootstrap.filter(|context| !context.conversation_history.is_empty());
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

      if let Some(pi_session) = self.pi_session.clone() {
         let prompt = Self::format_bootstrap_prompt(prompt, self.pending_bootstrap.take());
         let app_handle = self
            .app_handle
            .as_ref()
            .context("No app handle available")?
            .clone();
         let route_key = self.route_key.clone();
         tokio::task::spawn_local(async move {
            if let Err(error) = pi_session
               .send_command(Self::build_pi_prompt_command(&prompt))
               .await
            {
               log::error!("Failed to send pi prompt: {}", error);
               let _ = app_handle.emit(
                  "acp-event",
                  AcpEvent::Error {
                     route_key,
                     session_id: None,
                     error: format!("Failed to send Pi prompt: {}", error),
                  },
               );
            }
         });
         return Ok(());
      }

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
      let route_key = self.route_key.clone();
      let prompt = Self::format_bootstrap_prompt(prompt, self.pending_bootstrap.take());

      tokio::task::spawn_local(async move {
         let prompt_route_key = route_key.clone();
         if let Err(err) = Self::run_prompt(
            connection,
            session_id.clone(),
            app_handle.clone(),
            prompt_route_key,
            prompt,
         )
         .await
         {
            log::error!("Failed to run ACP prompt: {}", err);
            let _ = app_handle.emit(
               "acp-event",
               AcpEvent::Error {
                  route_key,
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
      route_key: String,
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
            route_key,
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

      if let Some(pi_session) = self.pi_session.clone() {
         pi_session
            .send_command(json!({ "type": "interrupt" }))
            .await?;
         return Ok(());
      }

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

      if self.pi_session.is_some() {
         log::info!(
            "Ignoring pi mode change request for unsupported mode '{}'",
            mode_id
         );
         return Ok(());
      }

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
      self.pending_bootstrap = None;
      self.pi_session = None;
      self.client = None;
      self.agent_id = None;
      self.app_handle = None;

      Ok(())
   }

   fn get_status(&self) -> AcpAgentStatus {
      match &self.agent_id {
         Some(agent_id) => {
            let pi_session_id = self
               .pi_session
               .as_ref()
               .and_then(|session| session.current_session_id.try_lock().ok())
               .and_then(|session_id| session_id.clone());

            AcpAgentStatus {
               agent_id: agent_id.clone(),
               running: true,
               session_active: self.session_id.is_some() || self.pi_session.is_some(),
               initialized: self.connection.is_some() || self.pi_session.is_some(),
               session_id: pi_session_id
                  .or_else(|| self.session_id.as_ref().map(ToString::to_string)),
            }
         }
         None => AcpAgentStatus::default(),
      }
   }
}

/// Manages ACP agent connections via a dedicated worker thread
#[derive(Clone)]
pub struct AcpAgentBridge {
   app_handle: AppHandle,
   registry: AgentRegistry,
   route_workers: Arc<Mutex<HashMap<String, AcpRouteWorkerHandle>>>,
   terminal_manager: Arc<TerminalManager>,
}

impl AcpAgentBridge {
   pub fn new(app_handle: AppHandle, terminal_manager: Arc<TerminalManager>) -> Self {
      let mut registry = AgentRegistry::new();
      registry.detect_installed();

      Self {
         app_handle,
         registry,
         route_workers: Arc::new(Mutex::new(HashMap::new())),
         terminal_manager,
      }
   }

   fn normalize_route_key(route_key: Option<&str>) -> String {
      route_key.unwrap_or(DEFAULT_ACP_ROUTE_KEY).to_string()
   }

   fn spawn_route_worker(route_key: String) -> AcpRouteWorkerHandle {
      let (command_tx, command_rx) = mpsc::channel::<AcpCommand>(32);
      let status = Arc::new(Mutex::new(AcpAgentStatus::default()));
      let permission_tx = Arc::new(Mutex::new(None));
      let status_clone = status.clone();
      let route_key_clone = route_key.clone();

      thread::spawn(move || {
         let rt = Runtime::new().expect("Failed to create Tokio runtime for ACP worker");
         let local = LocalSet::new();

         local.block_on(&rt, async move {
            Self::run_worker(route_key_clone, command_rx, status_clone).await;
         });
      });

      AcpRouteWorkerHandle {
         command_tx,
         status,
         permission_tx,
      }
   }

   async fn get_or_create_route_worker(&self, route_key: &str) -> AcpRouteWorkerHandle {
      let mut route_workers = self.route_workers.lock().await;
      route_workers
         .entry(route_key.to_string())
         .or_insert_with(|| Self::spawn_route_worker(route_key.to_string()))
         .clone()
   }

   async fn get_route_worker(&self, route_key: &str) -> Option<AcpRouteWorkerHandle> {
      self.route_workers.lock().await.get(route_key).cloned()
   }

   async fn run_worker(
      route_key: String,
      mut command_rx: mpsc::Receiver<AcpCommand>,
      status: Arc<Mutex<AcpAgentStatus>>,
   ) {
      let mut worker = AcpWorker::new(route_key);
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
                     fresh_session,
                     bootstrap,
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
                           fresh_session,
                           bootstrap,
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
      route_key: &str,
      agent_id: &str,
      workspace_path: Option<String>,
      session_id: Option<String>,
      fresh_session: bool,
      bootstrap: Option<AcpBootstrapContext>,
   ) -> Result<AcpAgentStatus> {
      let route_key = Self::normalize_route_key(Some(route_key));
      let config = self
         .registry
         .get(agent_id)
         .context("Agent not found")?
         .clone();
      let worker_handle = self.get_or_create_route_worker(&route_key).await;

      let (response_tx, response_rx) = oneshot::channel();

      worker_handle
         .command_tx
         .send(AcpCommand::Initialize {
            agent_id: agent_id.to_string(),
            workspace_path,
            session_id,
            fresh_session,
            bootstrap,
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
         let mut tx = worker_handle.permission_tx.lock().await;
         *tx = Some(permission_sender);
      }

      // Emit status change
      self.emit_status_change(&route_key, &status);

      Ok(status)
   }

   /// Send a prompt to the active agent
   pub async fn send_prompt(&self, route_key: &str, prompt: &str) -> Result<()> {
      let route_key = Self::normalize_route_key(Some(route_key));
      let worker_handle = self
         .get_route_worker(&route_key)
         .await
         .context("ACP route not found")?;
      let (response_tx, response_rx) = oneshot::channel();

      worker_handle
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
      route_key: &str,
      request_id: String,
      approved: bool,
      cancelled: bool,
      value: Option<String>,
   ) -> Result<()> {
      let route_key = Self::normalize_route_key(Some(route_key));
      let Some(worker_handle) = self.get_route_worker(&route_key).await else {
         return Ok(());
      };
      let tx = worker_handle.permission_tx.lock().await;
      if let Some(ref sender) = *tx {
         sender
            .send(PermissionResponse {
               request_id,
               approved,
               cancelled,
               value,
            })
            .await
            .ok();
      }
      Ok(())
   }

   /// Stop the active agent
   pub async fn stop_agent(&self, route_key: &str) -> Result<()> {
      let route_key = Self::normalize_route_key(Some(route_key));
      let Some(worker_handle) = self.get_route_worker(&route_key).await else {
         self.emit_status_change(&route_key, &AcpAgentStatus::default());
         return Ok(());
      };

      // Get current session ID before stopping
      let current_status = worker_handle.status.lock().await.clone();
      let session_id = if current_status.running {
         current_status.session_id.clone()
      } else {
         None
      };

      let (response_tx, response_rx) = oneshot::channel();

      worker_handle
         .command_tx
         .send(AcpCommand::Stop { response_tx })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")??;

      // Clear permission sender
      {
         let mut tx = worker_handle.permission_tx.lock().await;
         *tx = None;
      }

      self.route_workers.lock().await.remove(&route_key);

      // Emit SessionComplete before StatusChanged
      if let Some(sid) = session_id {
         let _ = self.app_handle.emit(
            "acp-event",
            AcpEvent::SessionComplete {
               route_key: route_key.clone(),
               session_id: sid,
            },
         );
      }

      // Emit status change
      self.emit_status_change(&route_key, &AcpAgentStatus::default());

      Ok(())
   }

   /// Get current agent status
   pub async fn get_status(&self, route_key: &str) -> AcpAgentStatus {
      let route_key = Self::normalize_route_key(Some(route_key));
      match self.get_route_worker(&route_key).await {
         Some(worker_handle) => worker_handle.status.lock().await.clone(),
         None => AcpAgentStatus::default(),
      }
   }

   /// Set session mode for the active agent
   pub async fn set_session_mode(&self, route_key: &str, mode_id: &str) -> Result<()> {
      let route_key = Self::normalize_route_key(Some(route_key));
      let worker_handle = self
         .get_route_worker(&route_key)
         .await
         .context("ACP route not found")?;
      let (response_tx, response_rx) = oneshot::channel();

      worker_handle
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
   pub async fn cancel_prompt(&self, route_key: &str) -> Result<()> {
      let route_key = Self::normalize_route_key(Some(route_key));
      let Some(worker_handle) = self.get_route_worker(&route_key).await else {
         return Ok(());
      };
      let (response_tx, response_rx) = oneshot::channel();

      worker_handle
         .command_tx
         .send(AcpCommand::CancelPrompt { response_tx })
         .await
         .context("Failed to send command to ACP worker")?;

      response_rx.await.context("Worker disconnected")?
   }

   fn emit_status_change(&self, route_key: &str, status: &AcpAgentStatus) {
      let _ = self.app_handle.emit(
         "acp-event",
         AcpEvent::StatusChanged {
            route_key: route_key.to_string(),
            status: status.clone(),
         },
      );
   }
}

#[cfg(test)]
mod tests {
   use super::{AcpWorker, PiRpcSession, PiWorkspaceSessionInfo};
   use serde_json::json;
   use std::{
      env, fs,
      path::PathBuf,
      sync::{LazyLock, Mutex},
   };
   use tokio::sync::{Mutex as AsyncMutex, oneshot};

   static PI_ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

   #[test]
   fn pi_session_dir_name_matches_workspace_key_format() {
      let dir_name = AcpWorker::pi_session_dir_name(&PathBuf::from("/home/fsos/Developer/athas"));
      assert_eq!(dir_name, "--home-fsos-Developer-athas--");
   }

   #[test]
   fn read_pi_workspace_session_parses_session_header() {
      let temp_dir = tempfile::tempdir().unwrap();
      let session_path = temp_dir.path().join("session.jsonl");
      fs::write(
         &session_path,
         "{\"type\":\"session\",\"id\":\"sess-123\"}\n{\"type\":\"message\"}\n",
      )
      .unwrap();

      let session = AcpWorker::read_pi_workspace_session(&session_path).unwrap();
      assert_eq!(
         session,
         PiWorkspaceSessionInfo {
            id: "sess-123".to_string(),
            path: session_path,
         }
      );
   }

   #[test]
   fn build_pi_prompt_command_uses_message_field() {
      assert_eq!(
         AcpWorker::build_pi_prompt_command("hello"),
         json!({
            "type": "prompt",
            "message": "hello",
         })
      );
   }

   #[test]
   fn pi_agent_root_prefers_explicit_agent_dir_env() {
      let _guard = PI_ENV_LOCK.lock().unwrap();
      let original = env::var_os("PI_CODING_AGENT_DIR");
      unsafe {
         env::set_var("PI_CODING_AGENT_DIR", "/tmp/custom-pi-agent");
      }

      let root = AcpWorker::pi_agent_root();

      match original {
         Some(value) => unsafe {
            env::set_var("PI_CODING_AGENT_DIR", value);
         },
         None => unsafe {
            env::remove_var("PI_CODING_AGENT_DIR");
         },
      }

      assert_eq!(root, Some(PathBuf::from("/tmp/custom-pi-agent")));
   }

   #[test]
   fn build_pi_launch_args_applies_runtime_state() {
      let runtime_state = super::AcpRuntimeState {
         agent_id: "pi".to_string(),
         source: Some("pi-local".to_string()),
         session_id: Some("session-1".to_string()),
         session_path: Some("/tmp/session.jsonl".to_string()),
         workspace_path: Some("/tmp/workspace".to_string()),
         provider: Some("droid".to_string()),
         model_id: Some("gpt-5.4-mini".to_string()),
         thinking_level: Some("medium".to_string()),
         behavior: Some("orchestrator".to_string()),
      };

      assert_eq!(
         AcpWorker::build_pi_launch_args(
            &["--mode".to_string(), "rpc".to_string()],
            &runtime_state,
            false
         ),
         vec![
            "--mode".to_string(),
            "rpc".to_string(),
            "--session".to_string(),
            "/tmp/session.jsonl".to_string(),
            "--provider".to_string(),
            "droid".to_string(),
            "--model".to_string(),
            "gpt-5.4-mini".to_string(),
            "--thinking".to_string(),
            "medium".to_string(),
         ]
      );
   }

   #[test]
   fn repair_pi_local_runtime_files_rewrites_conflicting_state() {
      let temp_dir = tempfile::tempdir().unwrap();
      let agent_root = temp_dir.path();

      fs::write(
         agent_root.join("settings.json"),
         serde_json::to_string_pretty(&json!({
            "default_provider": "openai-codex",
            "default_model": "gpt-5.4",
            "default_thinking_level": "high",
            "defaultProvider": "droid",
            "defaultModel": "gpt-5.4-mini",
            "defaultThinkingLevel": "medium",
            "shell_path": "/bin/bash",
         }))
         .unwrap(),
      )
      .unwrap();
      fs::write(
         agent_root.join("reasoning-state.json"),
         serde_json::to_string_pretty(&json!({
            "requested": {
               "provider": "droid",
               "modelId": "gpt-5.4-mini",
               "family": "gpt-5.4-mini",
               "thinkingLevel": "medium",
            },
            "effective": {
               "provider": "droid",
               "modelId": "gpt-5.4-mini",
               "family": "gpt-5.4-mini",
               "thinkingLevel": "medium",
            },
            "display": {
               "label": "gpt-5.4-mini/medium",
               "mode": "raw-family",
               "rawPinned": true,
            },
            "normalization": {
               "kind": "none",
            },
         }))
         .unwrap(),
      )
      .unwrap();
      fs::write(
         agent_root.join("behavior-mode-state.json"),
         serde_json::to_string_pretty(&json!({
            "version": 1,
            "currentBehavior": "orchestrator",
         }))
         .unwrap(),
      )
      .unwrap();

      AcpWorker::repair_pi_local_runtime_files(agent_root).unwrap();

      let settings = AcpWorker::read_json_file(&agent_root.join("settings.json")).unwrap();
      assert_eq!(settings["default_provider"], json!("openai-codex"));
      assert_eq!(settings["defaultProvider"], json!("openai-codex"));
      assert_eq!(settings["default_model"], json!("gpt-5.4"));
      assert_eq!(settings["defaultModel"], json!("gpt-5.4"));
      assert_eq!(settings["default_thinking_level"], json!("medium"));
      assert_eq!(settings["defaultThinkingLevel"], json!("medium"));
      assert_eq!(settings["shell_path"], json!("/bin/bash"));

      let reasoning = AcpWorker::read_json_file(&agent_root.join("reasoning-state.json")).unwrap();
      assert_eq!(reasoning["requested"]["provider"], json!("openai-codex"));
      assert_eq!(reasoning["requested"]["modelId"], json!("gpt-5.4"));
      assert_eq!(reasoning["requested"]["thinkingLevel"], json!("medium"));
      assert_eq!(reasoning["effective"]["provider"], json!("openai-codex"));
      assert_eq!(reasoning["effective"]["modelId"], json!("gpt-5.4"));
      assert_eq!(reasoning["effective"]["thinkingLevel"], json!("medium"));
      assert_eq!(reasoning["display"]["label"], json!("gpt-5.4/medium"));

      let behavior =
         AcpWorker::read_json_file(&agent_root.join("behavior-mode-state.json")).unwrap();
      assert!(behavior.get("currentBehavior").is_none());
   }

   #[test]
   fn repair_pi_local_runtime_files_creates_missing_runtime_files() {
      let temp_dir = tempfile::tempdir().unwrap();
      let agent_root = temp_dir.path();

      AcpWorker::repair_pi_local_runtime_files(agent_root).unwrap();

      let settings = AcpWorker::read_json_file(&agent_root.join("settings.json")).unwrap();
      assert_eq!(settings["defaultProvider"], json!("openai-codex"));
      assert_eq!(settings["defaultModel"], json!("gpt-5.4"));
      assert_eq!(settings["defaultThinkingLevel"], json!("medium"));

      let reasoning = AcpWorker::read_json_file(&agent_root.join("reasoning-state.json")).unwrap();
      assert_eq!(reasoning["effective"]["provider"], json!("openai-codex"));
      assert_eq!(reasoning["effective"]["modelId"], json!("gpt-5.4"));
      assert_eq!(reasoning["effective"]["thinkingLevel"], json!("medium"));

      assert!(!agent_root.join("behavior-mode-state.json").exists());
   }

   #[test]
   fn load_pi_runtime_state_repairs_and_reads_canonical_profile() {
      let _guard = PI_ENV_LOCK.lock().unwrap();
      let temp_dir = tempfile::tempdir().unwrap();
      let agent_root = temp_dir.path();
      let original = env::var_os("PI_CODING_AGENT_DIR");

      fs::write(
         agent_root.join("settings.json"),
         serde_json::to_string_pretty(&json!({
            "defaultProvider": "droid",
            "defaultModel": "gpt-5.4-mini",
            "defaultThinkingLevel": "medium",
         }))
         .unwrap(),
      )
      .unwrap();
      fs::write(
         agent_root.join("reasoning-state.json"),
         serde_json::to_string_pretty(&json!({
            "effective": {
               "provider": "droid",
               "modelId": "gpt-5.4-mini",
               "thinkingLevel": "medium",
            }
         }))
         .unwrap(),
      )
      .unwrap();
      fs::write(
         agent_root.join("behavior-mode-state.json"),
         serde_json::to_string_pretty(&json!({
            "currentBehavior": "orchestrator",
         }))
         .unwrap(),
      )
      .unwrap();

      unsafe {
         env::set_var("PI_CODING_AGENT_DIR", agent_root);
      }

      let runtime_state = AcpWorker::load_pi_runtime_state(None, None, "harness:harness", false);

      match original {
         Some(value) => unsafe {
            env::set_var("PI_CODING_AGENT_DIR", value);
         },
         None => unsafe {
            env::remove_var("PI_CODING_AGENT_DIR");
         },
      }

      assert_eq!(runtime_state.provider.as_deref(), Some("openai-codex"));
      assert_eq!(runtime_state.model_id.as_deref(), Some("gpt-5.4"));
      assert_eq!(runtime_state.thinking_level.as_deref(), Some("medium"));
      assert_eq!(runtime_state.behavior, None);
   }

   #[test]
   fn parse_pi_thought_tool_events_extracts_read_tool_markers() {
      assert_eq!(
         AcpWorker::parse_pi_thought_tool_events(
            "[Read] {\"file_path\":\"/tmp/Cargo.toml\"}\n[tool-result] ok\n"
         ),
         vec![super::ParsedPiThoughtToolEvent {
            tool_name: "read".to_string(),
            input: json!({ "file_path": "/tmp/Cargo.toml" }),
            output: json!("ok"),
            success: true,
         }]
      );
   }

   #[test]
   fn parse_pi_thought_tool_events_marks_error_results_failed() {
      assert_eq!(
         AcpWorker::parse_pi_thought_tool_events(
            "[Bash] {\"command\":\"exit 1\"}\n[tool-result] error: command failed\n"
         ),
         vec![super::ParsedPiThoughtToolEvent {
            tool_name: "bash".to_string(),
            input: json!({ "command": "exit 1" }),
            output: json!("error: command failed"),
            success: false,
         }]
      );
   }

   #[tokio::test]
   async fn fail_response_waiters_notifies_all_pending_requests() {
      let response_waiters = std::sync::Arc::new(AsyncMutex::new(std::collections::HashMap::<
         String,
         oneshot::Sender<anyhow::Result<serde_json::Value>>,
      >::new()));
      let (first_tx, first_rx) = oneshot::channel();
      let (second_tx, second_rx) = oneshot::channel();

      {
         let mut waiters = response_waiters.lock().await;
         waiters.insert("first".to_string(), first_tx);
         waiters.insert("second".to_string(), second_tx);
      }

      PiRpcSession::fail_response_waiters(
         &response_waiters,
         "Pi RPC stream ended before responding".to_string(),
      )
      .await;

      let first_error = first_rx.await.unwrap().unwrap_err().to_string();
      let second_error = second_rx.await.unwrap().unwrap_err().to_string();

      assert!(first_error.contains("Pi RPC stream ended before responding"));
      assert!(second_error.contains("Pi RPC stream ended before responding"));
      assert!(response_waiters.lock().await.is_empty());
   }

   #[tokio::test]
   async fn get_closed_error_returns_recorded_stream_failure() {
      let closed_error = std::sync::Arc::new(AsyncMutex::new(Some(
         "Pi RPC stream ended before responding".to_string(),
      )));

      assert_eq!(
         PiRpcSession::get_closed_error(&closed_error).await,
         Some("Pi RPC stream ended before responding".to_string())
      );
   }
}
