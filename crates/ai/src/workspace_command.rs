use serde::Serialize;
use std::{
   collections::HashMap,
   path::Path,
   process::Stdio,
   sync::{LazyLock, Mutex},
   time::{Duration, Instant},
};
use tokio::{
   io::{AsyncRead, AsyncReadExt},
   process::Command,
};
use tokio_util::sync::CancellationToken;

static COMMANDS: LazyLock<Mutex<HashMap<String, (CancellationToken, Instant)>>> =
   LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommandOutput {
   pub stdout: String,
   pub stderr: String,
   pub exit_code: Option<i32>,
   pub cancelled: bool,
   pub timed_out: bool,
}

pub fn cancel_workspace_command(id: &str) {
   let Ok(mut commands) = COMMANDS.lock() else {
      return;
   };
   commands.retain(|_, (_, started)| started.elapsed() < Duration::from_secs(120));
   if let Some((token, _)) = commands.get(id) {
      token.cancel();
   } else if commands.len() < 64 {
      let token = CancellationToken::new();
      token.cancel();
      commands.insert(id.to_string(), (token, Instant::now()));
   }
}

struct CommandLease(String);
impl Drop for CommandLease {
   fn drop(&mut self) {
      if let Ok(mut commands) = COMMANDS.lock() {
         commands.remove(&self.0);
      }
   }
}

struct ProcessGroup(u32);
impl Drop for ProcessGroup {
   fn drop(&mut self) {
      #[cfg(unix)]
      if self.0 > 0 && self.0 <= libc::pid_t::MAX as u32 {
         unsafe {
            libc::kill(-(self.0 as libc::pid_t), libc::SIGKILL);
         }
      }
      #[cfg(windows)]
      {
         use std::os::windows::process::CommandExt;
         let _ = std::process::Command::new("taskkill")
            .args(["/PID", &self.0.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .status();
      }
   }
}

async fn read_output(mut pipe: impl AsyncRead + Unpin) -> String {
   let mut result = Vec::new();
   let mut buffer = [0_u8; 4096];
   while let Ok(count) = pipe.read(&mut buffer).await {
      if count == 0 {
         break;
      }
      let take = count.min(12000_usize.saturating_sub(result.len()));
      result.extend_from_slice(&buffer[..take]);
   }
   String::from_utf8_lossy(&result).into_owned()
}

async fn finish_output(mut task: tokio::task::JoinHandle<String>) -> String {
   match tokio::time::timeout(Duration::from_secs(2), &mut task).await {
      Ok(output) => output.unwrap_or_default(),
      Err(_) => {
         task.abort();
         "Output capture ended because a detached process kept the pipe open.".into()
      }
   }
}

pub async fn run_workspace_command(
   root: &str,
   command: &str,
   id: &str,
) -> Result<WorkspaceCommandOutput, String> {
   if command.trim().is_empty() || command.len() > 8000 || id.len() > 100 || id.is_empty() {
      return Err("Invalid command request.".into());
   }
   let token = {
      let mut commands = COMMANDS.lock().map_err(|e| e.to_string())?;
      commands.retain(|_, (_, started)| started.elapsed() < Duration::from_secs(120));
      if let Some((token, _)) = commands.get(id) {
         if token.is_cancelled() {
            commands.remove(id);
            return Err("Command cancelled.".into());
         }
         return Err("Command already running.".into());
      }
      if commands.len() >= 4 {
         return Err("Too many active commands.".into());
      }
      let token = CancellationToken::new();
      commands.insert(id.to_string(), (token.clone(), Instant::now()));
      token
   };
   let lease = CommandLease(id.to_string());
   let root = std::fs::canonicalize(Path::new(root)).map_err(|e| e.to_string())?;
   if !root.is_dir() {
      return Err("Choose a workspace directory.".into());
   }
   #[cfg(unix)]
   let mut process = {
      let mut process = Command::new("/bin/sh");
      process.args(["-c", command]);
      process.process_group(0);
      process
   };
   #[cfg(windows)]
   let mut process = {
      let mut process = Command::new("cmd.exe");
      process.args(["/D", "/S", "/C", command]);
      process.creation_flags(0x08000200);
      process
   };
   process
      .current_dir(root)
      .stdin(Stdio::null())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .kill_on_drop(true);
   if token.is_cancelled() {
      return Err("Command cancelled.".into());
   }
   let mut child = process.spawn().map_err(|e| e.to_string())?;
   let group = ProcessGroup(child.id().ok_or("Missing command process")?);
   let stdout = tokio::spawn(read_output(child.stdout.take().ok_or("Missing stdout")?));
   let stderr = tokio::spawn(read_output(child.stderr.take().ok_or("Missing stderr")?));
   let mut cancelled = false;
   let mut timed_out = false;
   let status = tokio::select! {
      result = child.wait() => result.ok(),
      () = token.cancelled() => { cancelled = true; None },
      () = tokio::time::sleep(Duration::from_secs(60)) => { timed_out = true; None },
   };
   drop(group);
   if status.is_none() {
      let _ = child.kill().await;
      let _ = child.wait().await;
   }
   let (stdout, stderr) = tokio::join!(finish_output(stdout), finish_output(stderr));
   drop(lease);
   Ok(WorkspaceCommandOutput {
      stdout,
      stderr,
      exit_code: status.and_then(|value| value.code()),
      cancelled,
      timed_out,
   })
}

#[cfg(all(test, unix))]
mod tests {
   use super::*;
   #[tokio::test]
   async fn returns_command_output_and_exit_status() {
      let root = tempfile::tempdir().unwrap();
      let result = run_workspace_command(
         root.path().to_str().unwrap(),
         "printf output; printf problem >&2; exit 7",
         "command-output-test",
      )
      .await
      .unwrap();
      assert_eq!(result.stdout, "output");
      assert_eq!(result.stderr, "problem");
      assert_eq!(result.exit_code, Some(7));
   }
   #[tokio::test]
   async fn cancellation_stops_a_command_and_its_children() {
      let root = tempfile::tempdir().unwrap();
      let path = root.path().to_string_lossy().to_string();
      let task = tokio::spawn(async move {
         run_workspace_command(&path, "sleep 30 & wait", "command-cancel-test").await
      });
      tokio::time::sleep(Duration::from_millis(100)).await;
      cancel_workspace_command("command-cancel-test");
      let result = tokio::time::timeout(Duration::from_secs(2), task)
         .await
         .unwrap()
         .unwrap()
         .unwrap();
      assert!(result.cancelled);
   }
}
