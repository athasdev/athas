use athas_runtime::notebook::{NotebookKernel, NotebookRunResult};

#[tauri::command]
#[specta::specta]
pub async fn notebook_run_python_cell(
   code: String,
   cwd: Option<String>,
   setup_code: Option<String>,
) -> Result<NotebookRunResult, String> {
   NotebookKernel::default()
      .run_python_cell(code, cwd, setup_code)
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_run_r_cell(
   code: String,
   cwd: Option<String>,
   setup_code: Option<String>,
) -> Result<NotebookRunResult, String> {
   NotebookKernel::default()
      .run_r_cell(code, cwd, setup_code)
      .await
}
