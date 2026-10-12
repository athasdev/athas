//! Runs notebook cells in fresh Python and R processes.

use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   ffi::OsString,
   fs,
   path::Path,
   process::{ExitStatus, Stdio},
   time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command, time};

const NOTEBOOK_CELL_TIMEOUT: Duration = Duration::from_secs(120);

/// Executes the setup code silently, then the cell, and prints one JSON object with the cell's
/// output and rich display data (see [`PythonCellRunnerResult`]).
const PYTHON_CELL_RUNNER: &str = include_str!("notebook/python_cell_runner.py");

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotebookRunResult {
   stdout: String,
   stderr: String,
   status: Option<i32>,
   timed_out: bool,
   display_data: Vec<PythonDisplayData>,
}

#[derive(Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonDisplayData {
   output_type: Option<String>,
   data: HashMap<String, serde_json::Value>,
   metadata: HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonCellRunnerResult {
   stdout: String,
   stderr: String,
   status: Option<i32>,
   display_data: Vec<PythonDisplayData>,
}

/// The interpreters cells run with, and how long a cell may take.
#[derive(Debug, Clone)]
pub struct NotebookKernel {
   python: OsString,
   rscript: OsString,
   timeout: Duration,
}

impl Default for NotebookKernel {
   fn default() -> Self {
      Self {
         python: "python3".into(),
         rscript: "Rscript".into(),
         timeout: NOTEBOOK_CELL_TIMEOUT,
      }
   }
}

enum CellProcess {
   Finished {
      status: ExitStatus,
      stdout: Vec<u8>,
      stderr: Vec<u8>,
   },
   TimedOut,
}

impl NotebookKernel {
   #[cfg(test)]
   fn with_programs(python: impl Into<OsString>, rscript: impl Into<OsString>) -> Self {
      Self {
         python: python.into(),
         rscript: rscript.into(),
         timeout: NOTEBOOK_CELL_TIMEOUT,
      }
   }

   #[cfg(test)]
   fn with_timeout(mut self, timeout: Duration) -> Self {
      self.timeout = timeout;
      self
   }

   /// Runs `setup_code` (its output discarded) and then `code` in one fresh `python3` process in
   /// `cwd`, collecting stdout, stderr, the last expression's value, and displayed figures.
   pub async fn run_python_cell(
      &self,
      code: String,
      cwd: Option<String>,
      setup_code: Option<String>,
   ) -> Result<NotebookRunResult, String> {
      let mut command = Command::new(&self.python);
      command
         .arg("-c")
         .arg(PYTHON_CELL_RUNNER)
         .arg(setup_code.unwrap_or_default())
         .arg(code);
      set_working_dir(&mut command, cwd);
      let child = command
         .spawn_piped()
         .map_err(|error| format!("Failed to start python3: {error}"))?;

      match self.wait(child, "Python", "python").await? {
         CellProcess::Finished {
            status,
            stdout,
            stderr,
         } => Ok(python_cell_result(status, &stdout, &stderr)),
         CellProcess::TimedOut => Ok(timed_out(format!(
            "Cell execution timed out after {} seconds.",
            self.timeout.as_secs()
         ))),
      }
   }

   /// Runs `setup_code` quietly and then `code` with `Rscript --vanilla` in one shared
   /// environment, in `cwd`.
   pub async fn run_r_cell(
      &self,
      code: String,
      cwd: Option<String>,
      setup_code: Option<String>,
   ) -> Result<NotebookRunResult, String> {
      let scripts = tempfile::Builder::new()
         .prefix("athas-r-cell-")
         .tempdir()
         .map_err(|error| format!("Failed to create R script directory: {error}"))?;
      let setup_path = scripts.path().join("setup.R");
      let code_path = scripts.path().join("cell.R");
      let runner_path = scripts.path().join("runner.R");
      fs::write(&setup_path, setup_code.unwrap_or_default())
         .map_err(|error| format!("Failed to write R setup script: {error}"))?;
      fs::write(&code_path, code)
         .map_err(|error| format!("Failed to write R cell script: {error}"))?;
      fs::write(&runner_path, r_runner_script(&setup_path, &code_path))
         .map_err(|error| format!("Failed to write R runner script: {error}"))?;

      let mut command = Command::new(&self.rscript);
      command.arg("--vanilla").arg(&runner_path);
      set_working_dir(&mut command, cwd);
      let child = command
         .spawn_piped()
         .map_err(|error| format!("Failed to start Rscript: {error}"))?;

      match self.wait(child, "R", "R").await? {
         CellProcess::Finished {
            status,
            stdout,
            stderr,
         } => Ok(NotebookRunResult {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            status: status.code(),
            timed_out: false,
            display_data: Vec::new(),
         }),
         CellProcess::TimedOut => Ok(timed_out(format!(
            "R cell execution timed out after {} seconds.",
            self.timeout.as_secs()
         ))),
      }
   }

   /// Waits for the cell while draining both pipes, killing it after the timeout.
   async fn wait(
      &self,
      mut child: tokio::process::Child,
      label: &str,
      stream_label: &str,
   ) -> Result<CellProcess, String> {
      let stdout_task = tokio::spawn(read_all(child.stdout.take()));
      let stderr_task = tokio::spawn(read_all(child.stderr.take()));

      match time::timeout(self.timeout, child.wait()).await {
         Ok(status) => {
            let status = status.map_err(|error| format!("{label} execution failed: {error}"))?;
            let stdout = stdout_task
               .await
               .map_err(|error| format!("Failed to read {stream_label} stdout: {error}"))?;
            let stderr = stderr_task
               .await
               .map_err(|error| format!("Failed to read {stream_label} stderr: {error}"))?;
            Ok(CellProcess::Finished {
               status,
               stdout,
               stderr,
            })
         }
         Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            stdout_task.abort();
            stderr_task.abort();
            Ok(CellProcess::TimedOut)
         }
      }
   }
}

trait SpawnPiped {
   fn spawn_piped(&mut self) -> std::io::Result<tokio::process::Child>;
}

impl SpawnPiped for Command {
   fn spawn_piped(&mut self) -> std::io::Result<tokio::process::Child> {
      self
         .stdin(Stdio::null())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped())
         .spawn()
   }
}

fn set_working_dir(command: &mut Command, cwd: Option<String>) {
   if let Some(cwd) = cwd.filter(|cwd| !cwd.trim().is_empty()) {
      command.current_dir(cwd);
   }
}

async fn read_all(stream: Option<impl tokio::io::AsyncRead + Unpin>) -> Vec<u8> {
   let mut bytes = Vec::new();
   if let Some(mut stream) = stream {
      let _ = stream.read_to_end(&mut bytes).await;
   }
   bytes
}

/// Uses the runner's JSON report when the process produced one, falling back to the raw output
/// when Python failed before the runner could report (for example on a syntax error in it).
fn python_cell_result(status: ExitStatus, stdout: &[u8], stderr: &[u8]) -> NotebookRunResult {
   let stdout_text = String::from_utf8_lossy(stdout).into_owned();
   let stderr_text = || String::from_utf8_lossy(stderr).into_owned();
   if let Ok(result) = serde_json::from_str::<PythonCellRunnerResult>(stdout_text.trim()) {
      return NotebookRunResult {
         stdout: result.stdout,
         stderr: if result.stderr.is_empty() {
            stderr_text()
         } else {
            result.stderr
         },
         status: result.status,
         timed_out: false,
         display_data: result.display_data,
      };
   }

   NotebookRunResult {
      stdout: stdout_text,
      stderr: stderr_text(),
      status: status.code(),
      timed_out: false,
      display_data: Vec::new(),
   }
}

fn timed_out(stderr: String) -> NotebookRunResult {
   NotebookRunResult {
      stdout: String::new(),
      stderr,
      status: None,
      timed_out: true,
      display_data: Vec::new(),
   }
}

fn r_string_literal(value: &str) -> String {
   value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn r_runner_script(setup_path: &Path, code_path: &Path) -> String {
   format!(
      r#"
cell_env <- new.env(parent = globalenv())
run_file <- function(path, quiet) {{
  if (!file.exists(path) || file.info(path)$size == 0) {{
    return(invisible(NULL))
  }}
  if (quiet) {{
    invisible(capture.output(sys.source(path, envir = cell_env), type = "output"))
  }} else {{
    sys.source(path, envir = cell_env)
  }}
}}
run_file("{}", TRUE)
run_file("{}", FALSE)
"#,
      r_string_literal(&setup_path.to_string_lossy()),
      r_string_literal(&code_path.to_string_lossy()),
   )
}

#[cfg(test)]
mod tests;
