//! Notebook cells run in fresh `python3` and `Rscript` processes (`commands/editor/notebook.rs`).
//! The result is the runner's camelCase JSON: `stdout`, `stderr`, `status`, `timedOut`, `displayData`.

use std::future::Future;

use athas_runtime::notebook::NotebookKernel;

pub fn run_python_cell(code: String, cwd: Option<String>, setup_code: Option<String>) -> impl Future<Output = Result<serde_json::Value, String>> + Send + 'static {
    crate::spawn(async move {
        let result = NotebookKernel::default().run_python_cell(code, cwd, setup_code).await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    })
}

pub fn run_r_cell(code: String, cwd: Option<String>, setup_code: Option<String>) -> impl Future<Output = Result<serde_json::Value, String>> + Send + 'static {
    crate::spawn(async move {
        let result = NotebookKernel::default().run_r_cell(code, cwd, setup_code).await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    })
}
