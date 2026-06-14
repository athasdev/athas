use serde::{Deserialize, Serialize};
use std::{
   fs,
   path::PathBuf,
   process::{self, Stdio},
   time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{io::AsyncReadExt, process::Command, time};

const NOTEBOOK_CELL_TIMEOUT_SECS: u64 = 120;
const PYTHON_CELL_RUNNER: &str = r#"
import ast
import contextlib
import base64
import io
import json
import sys
import traceback

setup_code = sys.argv[1] if len(sys.argv) > 1 else ""
cell_code = sys.argv[2] if len(sys.argv) > 2 else ""
namespace = {}
display_data = []

def encode_bytes(value):
    return base64.b64encode(value).decode("ascii")

def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2)

def normalize_mime_value(mime, value):
    if value is None:
        return None
    if isinstance(value, bytes):
        return encode_bytes(value)
    if isinstance(value, bytearray):
        return encode_bytes(bytes(value))
    if isinstance(value, (list, tuple)) and mime.startswith("text/"):
        return "".join(str(item) for item in value)
    if isinstance(value, (dict, list, tuple, int, float, bool)):
        return json_text(value)
    return str(value)

def normalize_bundle(bundle):
    metadata = {}
    data = bundle
    if isinstance(bundle, tuple):
        data = bundle[0]
        if len(bundle) > 1 and isinstance(bundle[1], dict):
            metadata = bundle[1]
    if not isinstance(data, dict):
        return None

    normalized = {}
    for mime, value in data.items():
        normalized_value = normalize_mime_value(mime, value)
        if normalized_value is not None:
            normalized[str(mime)] = normalized_value
    if not normalized:
        return None
    return {"data": normalized, "metadata": metadata}

def object_mime_bundle(value):
    if value is None:
        return None

    if hasattr(value, "_repr_mimebundle_"):
        try:
            bundle = normalize_bundle(value._repr_mimebundle_())
            if bundle:
                return bundle
        except Exception:
            pass

    data = {}
    metadata = {}
    repr_methods = [
        ("text/html", "_repr_html_"),
        ("text/markdown", "_repr_markdown_"),
        ("image/svg+xml", "_repr_svg_"),
        ("image/png", "_repr_png_"),
        ("image/jpeg", "_repr_jpeg_"),
        ("text/latex", "_repr_latex_"),
        ("application/json", "_repr_json_"),
    ]
    for mime, method_name in repr_methods:
        method = getattr(value, method_name, None)
        if not method:
            continue
        try:
            result = method()
            if isinstance(result, tuple):
                result, result_metadata = result
                if isinstance(result_metadata, dict):
                    metadata[mime] = result_metadata
            normalized_value = normalize_mime_value(mime, result)
            if normalized_value is not None:
                data[mime] = normalized_value
        except Exception:
            pass

    if isinstance(value, (dict, list, tuple, int, float, bool)):
        data.setdefault("application/json", json_text(value))

    data.setdefault("text/plain", repr(value))
    return {"data": data, "metadata": metadata}

def append_display(value, output_type):
    bundle = object_mime_bundle(value)
    if not bundle:
        return
    display_data.append({
        "outputType": output_type,
        "data": bundle["data"],
        "metadata": bundle["metadata"],
    })

def display(*objects, **kwargs):
    for value in objects:
        append_display(value, "display_data")

try:
    import IPython.display as ipython_display
    ipython_display.display = display
except Exception:
    pass

namespace["display"] = display

def run_code(code, capture, capture_result=False):
    if not code.strip():
        return
    with contextlib.redirect_stdout(capture["stdout"]), contextlib.redirect_stderr(capture["stderr"]):
        if not capture_result:
            exec(code, namespace, namespace)
            return

        tree = ast.parse(code, mode="exec")
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            body = ast.Module(body=tree.body[:-1], type_ignores=[])
            expr = ast.Expression(tree.body[-1].value)
            exec(compile(body, "<athas-cell>", "exec"), namespace, namespace)
            result = eval(compile(expr, "<athas-cell>", "eval"), namespace, namespace)
            if result is not None:
                append_display(result, "execute_result")
        else:
            exec(compile(tree, "<athas-cell>", "exec"), namespace, namespace)

setup_capture = {"stdout": io.StringIO(), "stderr": io.StringIO()}
cell_capture = {"stdout": io.StringIO(), "stderr": io.StringIO()}

def close_matplotlib_figures():
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return
    plt.close("all")

def collect_matplotlib_figures():
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return

    for number in plt.get_fignums():
        figure = plt.figure(number)
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", bbox_inches="tight")
        display_data.append({
            "outputType": "display_data",
            "data": {
                "image/png": base64.b64encode(buffer.getvalue()).decode("ascii"),
                "text/plain": f"<Figure size {figure.get_size_inches()[0]}x{figure.get_size_inches()[1]}>",
            },
            "metadata": {},
        })

try:
    run_code(setup_code, setup_capture)
    display_data.clear()
    close_matplotlib_figures()
    run_code(cell_code, cell_capture, capture_result=True)
    collect_matplotlib_figures()
    status = 0
except Exception:
    status = 1
    cell_capture["stderr"].write(traceback.format_exc())

print(json.dumps({
    "stdout": cell_capture["stdout"].getvalue(),
    "stderr": cell_capture["stderr"].getvalue(),
    "status": status,
    "displayData": display_data,
}))
"#;

fn temp_script_path(label: &str, extension: &str) -> PathBuf {
   let nanos = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_nanos())
      .unwrap_or_default();
   std::env::temp_dir().join(format!(
      "athas-{label}-{}-{nanos}.{extension}",
      process::id()
   ))
}

fn r_string_literal(value: &str) -> String {
   value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookRunResult {
   stdout: String,
   stderr: String,
   status: Option<i32>,
   timed_out: bool,
   display_data: Vec<PythonDisplayData>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonDisplayData {
   output_type: Option<String>,
   data: std::collections::HashMap<String, serde_json::Value>,
   metadata: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonCellRunnerResult {
   stdout: String,
   stderr: String,
   status: Option<i32>,
   display_data: Vec<PythonDisplayData>,
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
               display_data: result.display_data,
            });
         }

         Ok(NotebookRunResult {
            stdout: stdout_text,
            stderr: String::from_utf8_lossy(&stderr).to_string(),
            status: status.code(),
            timed_out: false,
            display_data: Vec::new(),
         })
      }
      Err(_) => {
         let _ = child.kill().await;
         let _ = child.wait().await;
         stdout_task.abort();
         stderr_task.abort();
         Ok(NotebookRunResult {
            stdout: String::new(),
            stderr: format!("Cell execution timed out after {NOTEBOOK_CELL_TIMEOUT_SECS} seconds."),
            status: None,
            timed_out: true,
            display_data: Vec::new(),
         })
      }
   }
}

#[tauri::command]
pub async fn notebook_run_r_cell(
   code: String,
   cwd: Option<String>,
   setup_code: Option<String>,
) -> Result<NotebookRunResult, String> {
   let setup_path = temp_script_path("r-setup", "R");
   let code_path = temp_script_path("r-cell", "R");
   let runner_path = temp_script_path("r-runner", "R");

   fs::write(&setup_path, setup_code.unwrap_or_default())
      .map_err(|error| format!("Failed to write R setup script: {error}"))?;
   fs::write(&code_path, code)
      .map_err(|error| format!("Failed to write R cell script: {error}"))?;

   let runner = format!(
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
   );
   fs::write(&runner_path, runner)
      .map_err(|error| format!("Failed to write R runner script: {error}"))?;

   let mut command = Command::new("Rscript");
   command
      .arg("--vanilla")
      .arg(&runner_path)
      .stdin(Stdio::null())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

   if let Some(cwd) = cwd {
      if !cwd.trim().is_empty() {
         command.current_dir(PathBuf::from(cwd));
      }
   }

   let mut child = match command.spawn() {
      Ok(child) => child,
      Err(error) => {
         let _ = fs::remove_file(&setup_path);
         let _ = fs::remove_file(&code_path);
         let _ = fs::remove_file(&runner_path);
         return Err(format!("Failed to start Rscript: {error}"));
      }
   };

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

   let result = match time::timeout(
      Duration::from_secs(NOTEBOOK_CELL_TIMEOUT_SECS),
      child.wait(),
   )
   .await
   {
      Ok(status_result) => {
         let status = status_result.map_err(|error| format!("R execution failed: {error}"))?;
         let stdout = stdout_task
            .await
            .map_err(|error| format!("Failed to read R stdout: {error}"))?;
         let stderr = stderr_task
            .await
            .map_err(|error| format!("Failed to read R stderr: {error}"))?;
         Ok(NotebookRunResult {
            stdout: String::from_utf8_lossy(&stdout).to_string(),
            stderr: String::from_utf8_lossy(&stderr).to_string(),
            status: status.code(),
            timed_out: false,
            display_data: Vec::new(),
         })
      }
      Err(_) => {
         let _ = child.kill().await;
         let _ = child.wait().await;
         stdout_task.abort();
         stderr_task.abort();
         Ok(NotebookRunResult {
            stdout: String::new(),
            stderr: format!(
               "R cell execution timed out after {NOTEBOOK_CELL_TIMEOUT_SECS} seconds."
            ),
            status: None,
            timed_out: true,
            display_data: Vec::new(),
         })
      }
   };

   let _ = fs::remove_file(&setup_path);
   let _ = fs::remove_file(&code_path);
   let _ = fs::remove_file(&runner_path);
   result
}
