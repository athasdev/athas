use athas_runtime::frontend_trace;
use athas_tooling::{LanguageToolConfigSet, LanguageToolStatus, ToolStatus};
use serde_json::Value;
use tauri::AppHandle;

// Runs off the main thread: the benchmark log is appended to a file, and a synchronous command
// would hold up every other IPC reply, such as the file read of the next open, while it writes.
#[tauri::command(async)]
#[specta::specta]
pub fn frontend_trace(level: String, scope: String, message: String, payload: Option<Value>) {
   #[cfg(debug_assertions)]
   if scope == frontend_trace::FILE_OPEN_BENCHMARK_SCOPE {
      let _ = frontend_trace::append_file_open_benchmark(
         &std::env::temp_dir().join("athas-file-open-benchmark.jsonl"),
         &level,
         &message,
         payload.as_ref(),
      );
   }

   log::log!(
      frontend_trace::trace_level(&level),
      "{}",
      frontend_trace::format_trace_line(&scope, &message, payload.as_ref())
   );
}

/// Install all tools for a language
#[tauri::command]
#[specta::specta]
pub async fn install_language_tools(
   app_handle: AppHandle,
   language_id: String,
   tools: Option<LanguageToolConfigSet>,
) -> Result<LanguageToolStatus, String> {
   Ok(athas_tooling::install_language_tools(&app_handle, &language_id, tools).await)
}

/// Install a specific tool type for a language
#[tauri::command]
#[specta::specta]
pub async fn install_tool(
   app_handle: AppHandle,
   language_id: String,
   tool_type: String,
   tools: Option<LanguageToolConfigSet>,
) -> Result<ToolStatus, String> {
   athas_tooling::install_tool(&app_handle, &language_id, &tool_type, tools).await
}

#[tauri::command]
#[specta::specta]
pub fn get_java_debug_bundle_path(app_handle: AppHandle) -> Result<Option<String>, String> {
   athas_tooling::java_debug_bundle_path(&app_handle)
}

/// Get the status of all tools for a language
#[tauri::command]
#[specta::specta]
pub async fn get_language_tool_status(
   app_handle: AppHandle,
   language_id: String,
   tools: Option<LanguageToolConfigSet>,
) -> Result<LanguageToolStatus, String> {
   Ok(athas_tooling::language_tool_status(
      &app_handle,
      &language_id,
      tools,
   ))
}

/// Get the path to a tool's binary
#[tauri::command]
#[specta::specta]
pub async fn get_tool_path(
   app_handle: AppHandle,
   language_id: String,
   tool_type: String,
   tools: Option<LanguageToolConfigSet>,
) -> Result<Option<String>, String> {
   athas_tooling::tool_path(&app_handle, &language_id, &tool_type, tools)
}

/// Get available tools for a language
#[tauri::command]
#[specta::specta]
pub fn get_available_tools(
   language_id: String,
   tools: Option<LanguageToolConfigSet>,
) -> Result<Vec<String>, String> {
   Ok(athas_tooling::available_tools(&language_id, tools))
}
