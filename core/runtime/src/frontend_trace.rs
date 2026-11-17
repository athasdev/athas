//! Formats trace events the webview reports so they read well in the app log.

use serde_json::Value;
use std::{
   fs::OpenOptions,
   io::{self, Write},
   path::Path,
   time::{SystemTime, UNIX_EPOCH},
};

/// Scope of the file-open benchmark events, which debug builds also record as JSON lines.
pub const FILE_OPEN_BENCHMARK_SCOPE: &str = "bench:file-open";

/// Maps a frontend log level to a log level, treating anything unknown as info.
pub fn trace_level(level: &str) -> log::Level {
   match level {
      "debug" => log::Level::Debug,
      "warn" => log::Level::Warn,
      "error" => log::Level::Error,
      _ => log::Level::Info,
   }
}

/// Formats a frontend trace event as `[frontend:<scope>] <message> <payload>`. Benchmark scopes
/// (`bench:*`) summarize their timings and phases; other payloads print as `key=value` pairs.
pub fn format_trace_line(scope: &str, message: &str, payload: Option<&Value>) -> String {
   let payload = if scope.starts_with("bench:") {
      format_benchmark_payload(payload)
   } else {
      format_payload(payload)
   };
   format!("[frontend:{}] {}{}", scope, message, payload)
}

/// Appends a file-open benchmark event to the JSON-lines file at `path`.
pub fn append_file_open_benchmark(
   path: &Path,
   level: &str,
   message: &str,
   payload: Option<&Value>,
) -> io::Result<()> {
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
   let mut file = OpenOptions::new().create(true).append(true).open(path)?;
   writeln!(file, "{}", record)
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

#[cfg(test)]
mod tests;
