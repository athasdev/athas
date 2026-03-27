use crate::features::ai::acp::types::AcpEvent;
use crate::features::ai::acp::{AcpAgentStatus, AcpBootstrapContext};
use crate::features::ai::{PiNativeSessionInfo, PiNativeTranscriptMessage};
use crate::features::runtime::{RuntimeManager, RuntimeType};
use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{Mutex, oneshot};

struct HostProcess {
   pid: Option<u32>,
   stdin: ChildStdin,
}

#[derive(Clone)]
pub struct PiNativeBridge {
   app_handle: AppHandle,
   process: Arc<Mutex<Option<HostProcess>>>,
   pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
   next_request_id: Arc<AtomicU64>,
}

impl PiNativeBridge {
   pub fn new(app_handle: AppHandle) -> Self {
      Self {
         app_handle,
         process: Arc::new(Mutex::new(None)),
         pending: Arc::new(Mutex::new(HashMap::new())),
         next_request_id: Arc::new(AtomicU64::new(1)),
      }
   }

   pub async fn start_session(
      &self,
      route_key: &str,
      workspace_path: Option<String>,
      session_path: Option<String>,
      bootstrap: Option<AcpBootstrapContext>,
   ) -> Result<AcpAgentStatus> {
      let params = json!({
         "routeKey": route_key,
         "workspacePath": workspace_path,
         "sessionPath": session_path,
         "bootstrap": bootstrap,
         "agentDir": self.get_agent_dir()?,
      });

      let value = self.send_request("startSession", params).await?;
      serde_json::from_value(value).context("failed to decode pi-native status")
   }

   pub async fn send_prompt(&self, route_key: &str, prompt: &str) -> Result<()> {
      self
         .send_request(
            "sendPrompt",
            json!({
               "routeKey": route_key,
               "prompt": prompt,
            }),
         )
         .await?;
      Ok(())
   }

   pub async fn get_status(&self, route_key: &str) -> Result<AcpAgentStatus> {
      let value = self
         .send_request("getStatus", json!({ "routeKey": route_key }))
         .await?;
      serde_json::from_value(value).context("failed to decode pi-native status")
   }

   pub async fn list_sessions(
      &self,
      workspace_path: Option<String>,
   ) -> Result<Vec<PiNativeSessionInfo>> {
      let params = json!({
         "workspacePath": workspace_path,
         "agentDir": self.get_agent_dir()?,
      });

      let value = self.send_request("listSessions", params).await?;
      serde_json::from_value(value).context("failed to decode pi-native sessions")
   }

   pub async fn get_session_transcript(
      &self,
      session_path: String,
   ) -> Result<Vec<PiNativeTranscriptMessage>> {
      let value = self
         .send_request(
            "getSessionTranscript",
            json!({ "sessionPath": session_path }),
         )
         .await?;
      serde_json::from_value(value).context("failed to decode pi-native transcript")
   }

   pub async fn cancel_prompt(&self, route_key: &str) -> Result<()> {
      self
         .send_request("cancelPrompt", json!({ "routeKey": route_key }))
         .await?;
      Ok(())
   }

   pub async fn respond_permission(
      &self,
      route_key: &str,
      request_id: &str,
      approved: bool,
      cancelled: bool,
      value: Option<String>,
   ) -> Result<()> {
      self
         .send_request(
            "respondPermission",
            json!({
               "routeKey": route_key,
               "requestId": request_id,
               "approved": approved,
               "cancelled": cancelled,
               "value": value,
            }),
         )
         .await?;
      Ok(())
   }

   pub async fn stop_session(&self, route_key: &str) -> Result<AcpAgentStatus> {
      let value = self
         .send_request("stopSession", json!({ "routeKey": route_key }))
         .await?;
      serde_json::from_value(value).context("failed to decode pi-native status")
   }

   async fn send_request(&self, method: &str, params: Value) -> Result<Value> {
      self.ensure_host_started().await?;

      let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
      let (tx, rx) = oneshot::channel();
      self.pending.lock().await.insert(request_id, tx);

      let line = serde_json::to_string(&json!({
         "id": request_id,
         "method": method,
         "params": params,
      }))?;

      {
         let mut process_guard = self.process.lock().await;
         let process = process_guard
            .as_mut()
            .ok_or_else(|| anyhow!("Pi native host is not running"))?;
         if let Err(error) = process.stdin.write_all(line.as_bytes()).await {
            self.pending.lock().await.remove(&request_id);
            return Err(error).context("failed to write pi-native request");
         }
         if let Err(error) = process.stdin.write_all(b"\n").await {
            self.pending.lock().await.remove(&request_id);
            return Err(error).context("failed to terminate pi-native request");
         }
         if let Err(error) = process.stdin.flush().await {
            self.pending.lock().await.remove(&request_id);
            return Err(error).context("failed to flush pi-native request");
         }
      }

      match rx.await {
         Ok(Ok(value)) => Ok(value),
         Ok(Err(error)) => Err(anyhow!(error)),
         Err(_) => Err(anyhow!("Pi native host dropped the response channel")),
      }
   }

   async fn ensure_host_started(&self) -> Result<()> {
      let mut process_guard = self.process.lock().await;
      if process_guard.is_some() {
         return Ok(());
      }

      let node_path = RuntimeManager::get_runtime(&self.app_handle, RuntimeType::Node).await?;
      let host_path = self.resolve_host_script_path()?;
      let current_dir = self.resolve_host_workdir()?;

      let mut command = Command::new(node_path);
      command
         .arg(host_path)
         .current_dir(current_dir)
         .stdin(std::process::Stdio::piped())
         .stdout(std::process::Stdio::piped())
         .stderr(std::process::Stdio::piped());

      let mut child = command.spawn().context("failed to spawn pi-native host")?;
      let stdin = child
         .stdin
         .take()
         .ok_or_else(|| anyhow!("failed to capture pi-native stdin"))?;
      let stdout = child
         .stdout
         .take()
         .ok_or_else(|| anyhow!("failed to capture pi-native stdout"))?;
      let stderr = child
         .stderr
         .take()
         .ok_or_else(|| anyhow!("failed to capture pi-native stderr"))?;
      let pid = child.id();

      *process_guard = Some(HostProcess { pid, stdin });
      drop(process_guard);

      self.spawn_stdout_task(stdout, pid);
      self.spawn_stderr_task(stderr, pid);

      Ok(())
   }

   fn spawn_stdout_task(&self, stdout: tokio::process::ChildStdout, pid: Option<u32>) {
      let app_handle = self.app_handle.clone();
      let pending = self.pending.clone();
      let process = self.process.clone();

      tauri::async_runtime::spawn(async move {
         let mut lines = BufReader::new(stdout).lines();
         while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
               continue;
            }

            let payload: Value = match serde_json::from_str(&line) {
               Ok(value) => value,
               Err(error) => {
                  log::warn!("Failed to parse pi-native host payload: {}", error);
                  continue;
               }
            };

            match payload.get("type").and_then(Value::as_str) {
               Some("response") => {
                  let id = payload.get("id").and_then(Value::as_u64);
                  if let Some(id) = id
                     && let Some(sender) = pending.lock().await.remove(&id)
                  {
                     let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
                     if ok {
                        let _ =
                           sender.send(Ok(payload.get("result").cloned().unwrap_or(Value::Null)));
                     } else {
                        let error = payload
                           .get("error")
                           .and_then(Value::as_str)
                           .unwrap_or("Unknown pi-native host error")
                           .to_string();
                        let _ = sender.send(Err(error));
                     }
                  }
               }
               Some("event") => {
                  if let Some(event_value) = payload.get("event").cloned() {
                     match serde_json::from_value::<AcpEvent>(event_value) {
                        Ok(event) => {
                           if let Err(error) = app_handle.emit("acp-event", &event) {
                              log::warn!("Failed to emit pi-native event: {}", error);
                           }
                        }
                        Err(error) => {
                           log::warn!("Failed to decode pi-native event: {}", error);
                        }
                     }
                  }
               }
               _ => {}
            }
         }

         Self::clear_process_if_pid_matches(&process, pid).await;
         Self::fail_pending_requests(&pending, "Pi native host stdout closed").await;
      });
   }

   fn spawn_stderr_task(&self, stderr: tokio::process::ChildStderr, pid: Option<u32>) {
      tauri::async_runtime::spawn(async move {
         let mut lines = BufReader::new(stderr).lines();
         while let Ok(Some(line)) = lines.next_line().await {
            log::warn!("pi-native[{:?}]: {}", pid, line);
         }
      });
   }

   async fn clear_process_if_pid_matches(
      process: &Arc<Mutex<Option<HostProcess>>>,
      pid: Option<u32>,
   ) {
      let mut process_guard = process.lock().await;
      let matches = process_guard.as_ref().and_then(|host| host.pid) == pid;
      if matches {
         process_guard.take();
      }
   }

   async fn fail_pending_requests(
      pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
      error: &str,
   ) {
      let mut pending_guard = pending.lock().await;
      for (_, sender) in pending_guard.drain() {
         let _ = sender.send(Err(error.to_string()));
      }
   }

   fn resolve_host_script_path(&self) -> Result<PathBuf> {
      if let Ok(resource_dir) = self.app_handle.path().resource_dir() {
         let bundled = resource_dir.join("pi-native-host").join("index.mjs");
         if bundled.exists() {
            return Ok(bundled);
         }
      }

      Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
         .join("pi-native-host")
         .join("index.mjs"))
   }

   fn resolve_host_workdir(&self) -> Result<PathBuf> {
      let workdir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
         .parent()
         .map(|path| path.to_path_buf())
         .ok_or_else(|| anyhow!("failed to resolve project root for pi-native host"))?;
      Ok(workdir)
   }

   fn get_agent_dir(&self) -> Result<String> {
      if let Ok(explicit) = std::env::var("PI_CODING_AGENT_DIR")
         && !explicit.trim().is_empty()
      {
         return Ok(explicit);
      }

      let home = dirs::home_dir().ok_or_else(|| anyhow!("failed to resolve home directory"))?;
      Ok(home.join(".pi").join("agent").to_string_lossy().to_string())
   }
}
