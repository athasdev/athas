use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command, time};

const NOTEBOOK_CELL_TIMEOUT_SECS: u64 = 20;
const PYTHON_CELL_RUNNER: &str = r#"
import contextlib
import io
import json
import sys
import traceback

setup_code = sys.argv[1] if len(sys.argv) > 1 else ""
cell_code = sys.argv[2] if len(sys.argv) > 2 else ""
namespace = {}

def run_code(code, capture):
    if not code.strip():
        return
    with contextlib.redirect_stdout(capture["stdout"]), contextlib.redirect_stderr(capture["stderr"]):
        exec(code, namespace, namespace)

setup_capture = {"stdout": io.StringIO(), "stderr": io.StringIO()}
cell_capture = {"stdout": io.StringIO(), "stderr": io.StringIO()}

try:
    run_code(setup_code, setup_capture)
    run_code(cell_code, cell_capture)
    status = 0
except Exception:
    status = 1
    cell_capture["stderr"].write(traceback.format_exc())

print(json.dumps({
    "stdout": cell_capture["stdout"].getvalue(),
    "stderr": cell_capture["stderr"].getvalue(),
    "status": status,
}))
"#;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookRunResult {
   stdout: String,
   stderr: String,
   status: Option<i32>,
   timed_out: bool,
}

#[derive(Deserialize)]
struct PythonCellRunnerResult {
   stdout: String,
   stderr: String,
   status: Option<i32>,
}

#[tauri::command]
pub async fn notebook_run_python_cell(
   code: String,
   cwd: Option<String>,
   setup_code: Option<String>,
) -> Result<NotebookRunResult, String> {
   let mut command = Command::new("python3");
   command
      .arg("-c")
      .arg(PYTHON_CELL_RUNNER)
      .arg(setup_code.unwrap_or_default())
      .arg(code)
      .stdin(Stdio::null())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

   if let Some(cwd) = cwd {
      if !cwd.trim().is_empty() {
         command.current_dir(PathBuf::from(cwd));
      }
   }

   let mut child = command
      .spawn()
      .map_err(|error| format!("Failed to start python3: {error}"))?;

   let mut stdout = child.stdout.take();
   let mut stderr = child.stderr.take();
   let stdout_task = tokio::spawn(async move {
      let mut bytes = Vec::new();
      if let Some(ref mut stream) = stdout {
         let _ = stream.read_to_end(&mut bytes).await;
      }
      bytes
   });
   let stderr_task = tokio::spawn(async move {
      let mut bytes = Vec::new();
      if let Some(ref mut stream) = stderr {
         let _ = stream.read_to_end(&mut bytes).await;
      }
      bytes
   });

   match time::timeout(
      Duration::from_secs(NOTEBOOK_CELL_TIMEOUT_SECS),
      child.wait(),
   )
   .await
   {
      Ok(status_result) => {
         let status = status_result.map_err(|error| format!("Python execution failed: {error}"))?;
         let stdout = stdout_task
            .await
            .map_err(|error| format!("Failed to read python stdout: {error}"))?;
         let stderr = stderr_task
            .await
            .map_err(|error| format!("Failed to read python stderr: {error}"))?;
         let stdout_text = String::from_utf8_lossy(&stdout).to_string();
         if let Ok(result) = serde_json::from_str::<PythonCellRunnerResult>(stdout_text.trim()) {
            return Ok(NotebookRunResult {
               stdout: result.stdout,
               stderr: if result.stderr.is_empty() {
                  String::from_utf8_lossy(&stderr).to_string()
               } else {
                  result.stderr
               },
               status: result.status,
               timed_out: false,
            });
         }

         Ok(NotebookRunResult {
            stdout: stdout_text,
            stderr: String::from_utf8_lossy(&stderr).to_string(),
            status: status.code(),
            timed_out: false,
         })
      }
      Err(_) => {
         let _ = child.kill().await;
         let _ = child.wait().await;
         let stdout = stdout_task.await.unwrap_or_default();
         let stderr = stderr_task.await.unwrap_or_default();
         let mut stderr_text = String::from_utf8_lossy(&stderr).to_string();
         if stderr_text.trim().is_empty() {
            stderr_text = "Cell execution timed out after 20 seconds.".to_string();
         }
         Ok(NotebookRunResult {
            stdout: String::from_utf8_lossy(&stdout).to_string(),
            stderr: stderr_text,
            status: None,
            timed_out: true,
         })
      }
   }
}
