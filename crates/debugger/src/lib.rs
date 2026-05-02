use anyhow::{Context, Result, anyhow};
use athas_runtime::process::configure_background_command;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
   collections::HashMap,
   io::{BufRead, BufReader, Read, Write},
   process::{Child, Command, Stdio},
   sync::{
      Arc, Mutex,
      atomic::{AtomicU64, Ordering},
      mpsc::{Sender, channel},
   },
   thread,
};
use tauri::{AppHandle, Emitter, Runtime};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugAdapterLaunch {
   pub command: String,
   #[serde(default)]
   pub args: Vec<String>,
   pub cwd: Option<String>,
   #[serde(default)]
   pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionInfo {
   pub id: String,
   pub command: String,
   pub args: Vec<String>,
   pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugProtocolMessage {
   pub session_id: String,
   pub message: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugProcessOutput {
   pub session_id: String,
   pub stream: String,
   pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionEnded {
   pub session_id: String,
   pub reason: String,
}

struct DebugSessionHandle {
   info: DebugSessionInfo,
   stdin_tx: Sender<String>,
   child: Arc<Mutex<Child>>,
   request_counter: AtomicU64,
}

pub struct DebugManager {
   emitter: Arc<dyn Fn(&str, Value) + Send + Sync>,
   sessions: Arc<Mutex<HashMap<String, DebugSessionHandle>>>,
}

impl DebugManager {
   pub fn new<R: Runtime>(app_handle: AppHandle<R>) -> Self {
      Self {
         emitter: Arc::new(move |event, payload| {
            let _ = app_handle.emit(event, payload);
         }),
         sessions: Arc::new(Mutex::new(HashMap::new())),
      }
   }

   pub fn start_session(&self, launch: DebugAdapterLaunch) -> Result<DebugSessionInfo> {
      if launch.command.trim().is_empty() {
         return Err(anyhow!("Debug adapter command cannot be empty"));
      }

      let session_id = Uuid::new_v4().to_string();
      let mut command = Command::new(&launch.command);
      command.args(&launch.args);

      if let Some(cwd) = &launch.cwd {
         command.current_dir(cwd);
      }

      for (key, value) in &launch.env {
         command.env(key, value);
      }

      let mut child = configure_background_command(&mut command)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped())
         .spawn()
         .with_context(|| {
            format!(
               "Failed to spawn debug adapter: command={}, args={:?}",
               launch.command, launch.args
            )
         })?;

      let stdin = child
         .stdin
         .take()
         .context("Failed to get debug adapter stdin")?;
      let stdout = child
         .stdout
         .take()
         .context("Failed to get debug adapter stdout")?;
      let stderr = child
         .stderr
         .take()
         .context("Failed to get debug adapter stderr")?;

      let (stdin_tx, stdin_rx) = channel::<String>();
      let child = Arc::new(Mutex::new(child));
      let info = DebugSessionInfo {
         id: session_id.clone(),
         command: launch.command,
         args: launch.args,
         cwd: launch.cwd,
      };

      spawn_stdin_writer(stdin, stdin_rx);
      spawn_stdout_reader(Arc::clone(&self.emitter), session_id.clone(), stdout);
      spawn_stderr_reader(Arc::clone(&self.emitter), session_id.clone(), stderr);

      self
         .sessions
         .lock()
         .map_err(|_| anyhow!("Failed to lock debug sessions"))?
         .insert(
            session_id,
            DebugSessionHandle {
               info: info.clone(),
               stdin_tx,
               child: Arc::clone(&child),
               request_counter: AtomicU64::new(1),
            },
         );

      spawn_exit_watcher(
         Arc::clone(&self.emitter),
         Arc::clone(&self.sessions),
         info.id.clone(),
         child,
      );

      Ok(info)
   }

   pub fn send_request(
      &self,
      session_id: &str,
      command: String,
      arguments: Option<Value>,
   ) -> Result<u64> {
      let sessions = self
         .sessions
         .lock()
         .map_err(|_| anyhow!("Failed to lock debug sessions"))?;
      let session = sessions
         .get(session_id)
         .ok_or_else(|| anyhow!("Debug session not found"))?;
      let seq = session.request_counter.fetch_add(1, Ordering::SeqCst);
      let message = json!({
         "seq": seq,
         "type": "request",
         "command": command,
         "arguments": arguments.unwrap_or_else(|| json!({})),
      });

      session
         .stdin_tx
         .send(encode_protocol_message(&message)?)
         .map_err(|_| anyhow!("Debug adapter stdin channel is closed"))?;

      Ok(seq)
   }

   pub fn send_raw_message(&self, session_id: &str, message: Value) -> Result<()> {
      let sessions = self
         .sessions
         .lock()
         .map_err(|_| anyhow!("Failed to lock debug sessions"))?;
      let session = sessions
         .get(session_id)
         .ok_or_else(|| anyhow!("Debug session not found"))?;

      session
         .stdin_tx
         .send(encode_protocol_message(&message)?)
         .map_err(|_| anyhow!("Debug adapter stdin channel is closed"))?;

      Ok(())
   }

   pub fn stop_session(&self, session_id: &str) -> Result<()> {
      let session = self
         .sessions
         .lock()
         .map_err(|_| anyhow!("Failed to lock debug sessions"))?
         .remove(session_id)
         .ok_or_else(|| anyhow!("Debug session not found"))?;

      if let Ok(mut child) = session.child.lock() {
         let _ = child.kill();
      }

      emit_session_ended(&self.emitter, session_id, "stopped");
      Ok(())
   }

   pub fn list_sessions(&self) -> Result<Vec<DebugSessionInfo>> {
      let sessions = self
         .sessions
         .lock()
         .map_err(|_| anyhow!("Failed to lock debug sessions"))?;
      Ok(sessions
         .values()
         .map(|session| session.info.clone())
         .collect())
   }
}

fn encode_protocol_message(message: &Value) -> Result<String> {
   let content = serde_json::to_string(message)?;
   Ok(format!(
      "Content-Length: {}\r\n\r\n{}",
      content.len(),
      content
   ))
}

fn spawn_stdin_writer(
   mut stdin: std::process::ChildStdin,
   stdin_rx: std::sync::mpsc::Receiver<String>,
) {
   thread::spawn(move || {
      while let Ok(message) = stdin_rx.recv() {
         if stdin.write_all(message.as_bytes()).is_err() {
            break;
         }
         if stdin.flush().is_err() {
            break;
         }
      }
   });
}

fn spawn_stdout_reader(
   emitter: Arc<dyn Fn(&str, Value) + Send + Sync>,
   session_id: String,
   stdout: std::process::ChildStdout,
) {
   thread::spawn(move || {
      let mut reader = BufReader::new(stdout);

      loop {
         match read_protocol_message(&mut reader) {
            Ok(Some(message)) => {
               emit_payload(
                  &emitter,
                  "debugger_message",
                  DebugProtocolMessage {
                     session_id: session_id.clone(),
                     message,
                  },
               );
            }
            Ok(None) => {
               emit_session_ended(&emitter, &session_id, "adapter stdout closed");
               break;
            }
            Err(error) => {
               log::warn!("Debug adapter stdout read error: {error}");
               emit_session_ended(&emitter, &session_id, "adapter stdout read error");
               break;
            }
         }
      }
   });
}

fn spawn_stderr_reader(
   emitter: Arc<dyn Fn(&str, Value) + Send + Sync>,
   session_id: String,
   stderr: std::process::ChildStderr,
) {
   thread::spawn(move || {
      let mut reader = BufReader::new(stderr);
      let mut line = String::new();

      loop {
         line.clear();
         match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
               if !line.trim().is_empty() {
                  emit_payload(
                     &emitter,
                     "debugger_output",
                     DebugProcessOutput {
                        session_id: session_id.clone(),
                        stream: "stderr".to_string(),
                        data: line.clone(),
                     },
                  );
               }
            }
            Err(error) => {
               log::warn!("Debug adapter stderr read error: {error}");
               break;
            }
         }
      }
   });
}

fn spawn_exit_watcher(
   emitter: Arc<dyn Fn(&str, Value) + Send + Sync>,
   sessions: Arc<Mutex<HashMap<String, DebugSessionHandle>>>,
   session_id: String,
   child: Arc<Mutex<Child>>,
) {
   thread::spawn(move || {
      let reason = match child.lock() {
         Ok(mut child) => match child.wait() {
            Ok(status) => format!("adapter exited with status {status}"),
            Err(error) => format!("adapter wait failed: {error}"),
         },
         Err(_) => "adapter child lock poisoned".to_string(),
      };

      if let Ok(mut sessions) = sessions.lock() {
         sessions.remove(&session_id);
      }

      emit_session_ended(&emitter, &session_id, &reason);
   });
}

fn read_protocol_message(
   reader: &mut BufReader<std::process::ChildStdout>,
) -> Result<Option<Value>> {
   let mut content_length = None;
   let mut line = String::new();

   loop {
      line.clear();
      let bytes = reader.read_line(&mut line)?;
      if bytes == 0 {
         return Ok(None);
      }

      if line == "\r\n" || line == "\n" {
         break;
      }

      if let Some((key, value)) = line.trim_end().split_once(": ")
         && key.eq_ignore_ascii_case("Content-Length")
      {
         content_length = Some(value.parse::<usize>()?);
      }
   }

   let content_length = content_length.context("Debug adapter message missing Content-Length")?;
   let mut content = vec![0u8; content_length];
   reader.read_exact(&mut content)?;

   Ok(Some(serde_json::from_slice(&content)?))
}

fn emit_payload<S: Serialize>(
   emitter: &Arc<dyn Fn(&str, Value) + Send + Sync>,
   event: &str,
   payload: S,
) {
   if let Ok(value) = serde_json::to_value(payload) {
      emitter(event, value);
   }
}

fn emit_session_ended(
   emitter: &Arc<dyn Fn(&str, Value) + Send + Sync>,
   session_id: &str,
   reason: &str,
) {
   emit_payload(
      emitter,
      "debugger_session_ended",
      DebugSessionEnded {
         session_id: session_id.to_string(),
         reason: reason.to_string(),
      },
   );
}
