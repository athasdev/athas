//! Stdio MCP servers run for the built-in agent. The frontend speaks MCP itself; this module
//! only starts the server process, writes JSON-RPC lines to its stdin and hands every stdout line
//! back. Environment values come from secure storage and are never logged.

use crate::acp::{McpServerConfig, mcp_servers::McpTransportKind};
use serde::Serialize;
use std::{
   collections::{HashMap, VecDeque},
   path::{Path, PathBuf},
   process::Stdio,
   sync::{Arc, LazyLock},
};
use tokio::{
   io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
   process::{ChildStdin, Command},
   sync::Mutex,
};
use tokio_util::sync::CancellationToken;

/// At most this many stdio servers run for the built-in agent at once.
const MAX_PROCESSES: usize = 32;
/// Stderr lines kept to explain a server that exits early.
const STDERR_LINES: usize = 20;
/// A single JSON-RPC message larger than this is dropped instead of forwarded.
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum McpStdioEvent {
   /// One line the server wrote to stdout, normally a JSON-RPC message.
   Message { line: String },
   /// The server exited or was stopped; `stderr` holds its last lines.
   Closed { code: Option<i32>, stderr: String },
}

pub type McpStdioListener = Arc<dyn Fn(McpStdioEvent) + Send + Sync>;

struct Process {
   stdin: Arc<Mutex<ChildStdin>>,
   stop: CancellationToken,
}

static PROCESSES: LazyLock<std::sync::Mutex<HashMap<String, Process>>> =
   LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

fn valid_id(id: &str) -> bool {
   !id.is_empty()
      && id.len() <= 128
      && id
         .chars()
         .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':')
}

/// A bare command such as `npx` is looked up the way ACP agents resolve it, since an app launched
/// from the Dock does not inherit the shell's PATH.
fn resolve_command(command: &str) -> PathBuf {
   if Path::new(command).is_absolute() || command.contains(['/', '\\']) {
      return PathBuf::from(command);
   }
   crate::executable_path::find_executable(command).unwrap_or_else(|| PathBuf::from(command))
}

fn build_command(config: &McpServerConfig, cwd: Option<&Path>) -> Result<Command, String> {
   if config.setting.transport != McpTransportKind::Stdio {
      return Err("Only stdio MCP servers run as a process.".into());
   }
   let mut command = Command::new(resolve_command(config.setting.command.trim()));
   command
      .args(&config.setting.args)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .kill_on_drop(true);
   #[cfg(unix)]
   command.process_group(0);
   #[cfg(windows)]
   command.creation_flags(0x08000000);
   if let Some(shell_path) = crate::executable_path::user_shell_path() {
      let current = std::env::var("PATH").unwrap_or_default();
      command.env("PATH", format!("{current}:{shell_path}"));
   }
   for entry in &config.secrets.env {
      let name = entry.name.trim();
      if !name.is_empty() {
         command.env(name, &entry.value);
      }
   }
   if let Some(cwd) = cwd.filter(|path| path.is_dir()) {
      command.current_dir(cwd);
   }
   Ok(command)
}

fn kill_process_group(pid: Option<u32>) {
   let Some(pid) = pid else { return };
   #[cfg(unix)]
   if pid > 0 && pid <= libc::pid_t::MAX as u32 {
      unsafe {
         libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
      }
   }
   #[cfg(windows)]
   {
      use std::os::windows::process::CommandExt;
      let _ = std::process::Command::new("taskkill")
         .args(["/PID", &pid.to_string(), "/T", "/F"])
         .creation_flags(0x08000000)
         .status();
   }
}

/// Starts `config` under `id` and reports its output to `listener` until it exits or
/// [`stop_mcp_stdio`] is called.
pub async fn start_mcp_stdio(
   id: &str,
   config: &McpServerConfig,
   cwd: Option<&Path>,
   listener: McpStdioListener,
) -> Result<(), String> {
   if !valid_id(id) {
      return Err("Invalid MCP process id.".into());
   }
   {
      let processes = PROCESSES.lock().map_err(|e| e.to_string())?;
      if processes.contains_key(id) {
         return Err("This MCP process is already running.".into());
      }
      if processes.len() >= MAX_PROCESSES {
         return Err("Too many MCP servers are running.".into());
      }
   }
   let mut child = build_command(config, cwd)?
      .spawn()
      .map_err(|error| format!("Could not start {}: {error}", config.setting.command.trim()))?;
   let pid = child.id();
   let stdin = child.stdin.take().ok_or("Missing stdin")?;
   let stdout = child.stdout.take().ok_or("Missing stdout")?;
   let stderr = child.stderr.take().ok_or("Missing stderr")?;
   let stop = CancellationToken::new();
   PROCESSES.lock().map_err(|e| e.to_string())?.insert(
      id.to_string(),
      Process {
         stdin: Arc::new(Mutex::new(stdin)),
         stop: stop.clone(),
      },
   );

   let recent_stderr = Arc::new(Mutex::new(VecDeque::new()));
   let stderr_lines = recent_stderr.clone();
   tokio::spawn(async move {
      let mut lines = BufReader::new(stderr).lines();
      while let Ok(Some(line)) = lines.next_line().await {
         let mut recent = stderr_lines.lock().await;
         recent.push_back(line);
         if recent.len() > STDERR_LINES {
            recent.pop_front();
         }
      }
   });

   let stdout_listener = listener.clone();
   let reader = tokio::spawn(async move {
      let mut lines = BufReader::new(stdout).lines();
      while let Ok(Some(line)) = lines.next_line().await {
         if line.trim().is_empty() || line.len() > MAX_LINE_BYTES {
            continue;
         }
         stdout_listener(McpStdioEvent::Message { line });
      }
   });

   let id = id.to_string();
   tokio::spawn(async move {
      let code = tokio::select! {
         status = child.wait() => status.ok().and_then(|status| status.code()),
         () = stop.cancelled() => None,
      };
      kill_process_group(pid);
      let _ = child.kill().await;
      let _ = child.wait().await;
      // Deliver what the server wrote before it exited ahead of the close.
      let _ = tokio::time::timeout(std::time::Duration::from_secs(1), reader).await;
      if let Ok(mut processes) = PROCESSES.lock() {
         processes.remove(&id);
      }
      let stderr = recent_stderr
         .lock()
         .await
         .iter()
         .cloned()
         .collect::<Vec<_>>()
         .join("\n");
      listener(McpStdioEvent::Closed { code, stderr });
   });
   Ok(())
}

/// Writes one JSON-RPC message, newline-delimited as MCP's stdio transport requires.
pub async fn send_mcp_stdio(id: &str, message: &str) -> Result<(), String> {
   if message.contains('\n') {
      return Err("MCP messages must not contain newlines.".into());
   }
   let stdin = PROCESSES
      .lock()
      .map_err(|e| e.to_string())?
      .get(id)
      .map(|process| process.stdin.clone())
      .ok_or("The MCP server is not running.")?;
   let mut stdin = stdin.lock().await;
   stdin
      .write_all(format!("{message}\n").as_bytes())
      .await
      .map_err(|error| format!("Could not write to the MCP server: {error}"))?;
   stdin.flush().await.map_err(|error| error.to_string())
}

/// Stops the server; the listener then receives `Closed`. Unknown ids are ignored.
pub fn stop_mcp_stdio(id: &str) {
   if let Ok(processes) = PROCESSES.lock()
      && let Some(process) = processes.get(id)
   {
      process.stop.cancel();
   }
}

#[cfg(all(test, unix))]
mod tests {
   use super::*;
   use crate::acp::{McpServerSecrets, McpServerSetting, mcp_servers::McpNameValue};
   use std::time::Duration;
   use tokio::sync::mpsc;

   fn config(command: &str, args: &[&str], env: &[(&str, &str)]) -> McpServerConfig {
      McpServerConfig::from_setting(
         McpServerSetting {
            id: "test".into(),
            name: "test".into(),
            enabled: true,
            transport: McpTransportKind::Stdio,
            command: command.into(),
            args: args.iter().map(ToString::to_string).collect(),
            url: String::new(),
         },
         McpServerSecrets {
            env: env
               .iter()
               .map(|(name, value)| McpNameValue {
                  name: name.to_string(),
                  value: value.to_string(),
               })
               .collect(),
            headers: Vec::new(),
         },
      )
      .unwrap()
   }

   fn channel() -> (McpStdioListener, mpsc::UnboundedReceiver<McpStdioEvent>) {
      let (sender, receiver) = mpsc::unbounded_channel();
      (
         Arc::new(move |event| {
            let _ = sender.send(event);
         }),
         receiver,
      )
   }

   async fn next(receiver: &mut mpsc::UnboundedReceiver<McpStdioEvent>) -> McpStdioEvent {
      tokio::time::timeout(Duration::from_secs(5), receiver.recv())
         .await
         .expect("event in time")
         .expect("event")
   }

   #[tokio::test]
   async fn relays_lines_both_ways_and_stops() {
      let (listener, mut events) = channel();
      let server = config("/bin/cat", &[], &[]);
      start_mcp_stdio("relay", &server, None, listener)
         .await
         .unwrap();

      send_mcp_stdio("relay", r#"{"jsonrpc":"2.0","id":1}"#)
         .await
         .unwrap();
      assert_eq!(
         next(&mut events).await,
         McpStdioEvent::Message {
            line: r#"{"jsonrpc":"2.0","id":1}"#.into()
         }
      );
      assert!(send_mcp_stdio("relay", "a\nb").await.is_err());

      stop_mcp_stdio("relay");
      assert!(matches!(
         next(&mut events).await,
         McpStdioEvent::Closed { code: None, .. }
      ));
      assert!(send_mcp_stdio("relay", "{}").await.is_err());
   }

   #[tokio::test]
   async fn passes_secret_environment_and_reports_exit() {
      let (listener, mut events) = channel();
      let server = config(
         "/bin/sh",
         &["-c", "echo \"$MCP_TOKEN\"; echo oops >&2; exit 3"],
         &[("MCP_TOKEN", "secret-value")],
      );
      start_mcp_stdio("env", &server, None, listener)
         .await
         .unwrap();

      assert_eq!(
         next(&mut events).await,
         McpStdioEvent::Message {
            line: "secret-value".into()
         }
      );
      match next(&mut events).await {
         McpStdioEvent::Closed { code, stderr } => {
            assert_eq!(code, Some(3));
            assert!(stderr.contains("oops"));
         }
         other => panic!("unexpected event {other:?}"),
      }
   }

   #[tokio::test]
   async fn rejects_bad_ids_and_missing_commands() {
      let (listener, _events) = channel();
      let server = config("/definitely/not/here", &[], &[]);
      assert!(
         start_mcp_stdio("../x", &server, None, listener.clone())
            .await
            .is_err()
      );
      assert!(
         start_mcp_stdio("missing", &server, None, listener)
            .await
            .is_err()
      );
   }
}
