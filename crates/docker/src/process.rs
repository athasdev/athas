use crate::Docker;
use std::{path::Path, process::Stdio};
use tokio::{io::AsyncWriteExt, process::Command};

pub(crate) fn format_docker_launch_error(error: std::io::Error) -> String {
   if error.kind() == std::io::ErrorKind::NotFound {
      "Docker CLI was not found. Install Docker Desktop or make sure `docker` is available in PATH."
         .to_string()
   } else {
      format!("Failed to launch Docker CLI: {}", error)
   }
}

impl Docker {
   pub(crate) fn command(&self) -> Command {
      Command::new(&self.program)
   }

   pub(crate) async fn run(&self, args: &[&str]) -> Result<String, String> {
      let output = self
         .command()
         .args(args)
         .output()
         .await
         .map_err(format_docker_launch_error)?;

      docker_output_result(output)
   }

   pub(crate) async fn run_in(&self, args: &[String], cwd: &Path) -> Result<String, String> {
      let output = self
         .command()
         .args(args)
         .current_dir(cwd)
         .output()
         .await
         .map_err(format_docker_launch_error)?;

      docker_output_result(output)
   }

   pub(crate) async fn run_owned(&self, args: &[String]) -> Result<String, String> {
      let output = self
         .command()
         .args(args)
         .output()
         .await
         .map_err(format_docker_launch_error)?;

      docker_output_result(output)
   }

   pub(crate) async fn run_with_stdin(
      &self,
      args: &[String],
      stdin: String,
   ) -> Result<String, String> {
      let mut child = self
         .command()
         .args(args)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped())
         .spawn()
         .map_err(format_docker_launch_error)?;

      if let Some(mut child_stdin) = child.stdin.take() {
         child_stdin
            .write_all(stdin.as_bytes())
            .await
            .map_err(|error| format!("Failed to write Docker command input: {}", error))?;
      }

      let output = child
         .wait_with_output()
         .await
         .map_err(|error| format!("Docker command task failed: {}", error))?;

      docker_output_result(output)
   }

   pub(crate) async fn run_bytes(&self, args: &[String]) -> Result<Vec<u8>, String> {
      let output = self
         .command()
         .args(args)
         .output()
         .await
         .map_err(format_docker_launch_error)?;

      if output.status.success() {
         return Ok(output.stdout);
      }

      Err(docker_command_error(&output))
   }
}

fn docker_output_result(output: std::process::Output) -> Result<String, String> {
   if output.status.success() {
      return String::from_utf8(output.stdout)
         .map_err(|error| format!("Docker returned non-UTF-8 output: {}", error));
   }

   Err(docker_command_error(&output))
}

fn docker_command_error(output: &std::process::Output) -> String {
   let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
   let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
   let detail = if !stderr.is_empty() { stderr } else { stdout };

   if detail.is_empty() {
      format!("Docker command failed with status {}", output.status)
   } else {
      detail
   }
}
