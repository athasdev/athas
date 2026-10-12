use athas_tooling::{LanguageToolConfigSet, LanguageToolStatus, ToolStatus};
use serde_json::Value;
#[cfg(debug_assertions)]
use std::{
   fs::OpenOptions,
   io::Write,
   time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

// Runs off the main thread: the benchmark log is appended to a file, and a synchronous command
// would hold up every other IPC reply, such as the file read of the next open, while it writes.
#[tauri::command(async)]
#[specta::specta]
pub fn frontend_trace(level: String, scope: String, message: String, payload: Option<Value>) {
   #[cfg(debug_assertions)]
   if scope == "bench:file-open" {
      append_file_open_benchmark(&level, &message, payload.as_ref());
   }

   let payload_str = if scope.starts_with("bench:") {
      format_benchmark_payload(payload.as_ref())
   } else {
      format_payload(payload.as_ref())
   };
   match level.as_str() {
      "debug" => log::debug!("[frontend:{}] {}{}", scope, message, payload_str),
      "warn" => log::warn!("[frontend:{}] {}{}", scope, message, payload_str),
      "error" => log::error!("[frontend:{}] {}{}", scope, message, payload_str),
      _ => log::info!("[frontend:{}] {}{}", scope, message, payload_str),
   }
}

#[cfg(debug_assertions)]
fn append_file_open_benchmark(level: &str, message: &str, payload: Option<&Value>) {
   let path = std::env::temp_dir().join("athas-file-open-benchmark.jsonl");
   let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
      return;
   };
   let timestamp_ms = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_millis())
      .unwrap_or_default();
   let record = serde_json::json!({
      "timestampMs": timestamp_ms,
      "level": level,
      "file": message,
      "payload": payload,
   });
   let _ = writeln!(file, "{}", record);
}

fn format_payload(payload: Option<&Value>) -> String {
   let Some(payload) = payload else {
      return String::new();
   };

   match payload {
      Value::Object(map) if map.is_empty() => String::new(),
      Value::Object(map) => {
         let pairs = map
            .iter()
            .map(|(key, value)| format!("{}={}", key, format_value(value)))
            .collect::<Vec<_>>()
            .join(" ");
         format!(" {}", pairs)
      }
      other => format!(" {}", format_value(other)),
   }
}

fn format_benchmark_payload(payload: Option<&Value>) -> String {
   let Some(Value::Object(map)) = payload else {
      return format_payload(payload);
   };

   let total = map
      .get("totalMs")
      .map(format_value)
      .map(|value| format!(" total={}ms", value))
      .unwrap_or_default();

   let duration = map
      .get("durationMs")
      .map(format_value)
      .map(|value| format!(" duration={}ms", value))
      .unwrap_or_default();

   let phases = match map.get("phases") {
      Some(Value::Array(items)) if !items.is_empty() => {
         let formatted = items
            .iter()
            .filter_map(|item| match item {
               Value::Object(phase) => {
                  let label = phase.get("label").and_then(Value::as_str)?;
                  let duration = phase.get("durationMs").map(format_value)?;
                  let detail = phase
                     .get("detail")
                     .and_then(|value| (!value.is_null()).then(|| format_value(value)));
                  Some(match detail {
                     Some(detail) => format!("{}={}ms({})", label, duration, detail),
                     None => format!("{}={}ms", label, duration),
                  })
               }
               _ => None,
            })
            .collect::<Vec<_>>()
            .join(" > ");
         format!(" phases={}", formatted)
      }
      _ => String::new(),
   };

   format!("{}{}{}", total, duration, phases)
}

fn format_value(value: &Value) -> String {
   match value {
      Value::Null => "null".to_string(),
      Value::Bool(boolean) => boolean.to_string(),
      Value::Number(number) => number.to_string(),
      Value::String(text) => text.clone(),
      Value::Array(items) => {
         let formatted = items.iter().map(format_value).collect::<Vec<_>>().join(",");
         format!("[{}]", formatted)
      }
      Value::Object(map) => {
         let formatted = map
            .iter()
            .map(|(key, value)| format!("{}={}", key, format_value(value)))
            .collect::<Vec<_>>()
            .join(",");
         format!("{{{}}}", formatted)
      }
   }
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
