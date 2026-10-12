//! Runs extension-declared linters and parses their diagnostics.

use crate::{
   exec_guard::{validate_exec_args, validate_exec_command, validate_exec_env},
   extension_command::build_extension_command,
   process_io::{ProcessError, run_process},
};
use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   process::{Command, Stdio},
   time::Duration,
};

/// How long a linter may run before it is killed and the lint run is reported as failed.
const LINTER_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct LintRequest {
   pub content: String,
   pub language: String,
   pub linter: String,
   pub linter_config: Option<LinterConfig>,
   pub file_path: Option<String>,
   pub workspace_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LinterConfig {
   pub command: String,
   pub args: Option<Vec<String>>,
   pub env: Option<HashMap<String, String>>,
   pub input_method: Option<String>,
   pub diagnostic_format: Option<String>,
   pub diagnostic_pattern: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct Diagnostic {
   pub line: u32,
   pub column: u32,
   pub end_line: Option<u32>,
   pub end_column: Option<u32>,
   pub severity: String,
   pub message: String,
   pub code: Option<String>,
   pub source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct LintResponse {
   pub diagnostics: Vec<Diagnostic>,
   pub success: bool,
   pub error: Option<String>,
}

impl LintResponse {
   fn ok(diagnostics: Vec<Diagnostic>) -> Self {
      Self {
         diagnostics,
         success: true,
         error: None,
      }
   }

   fn failed(error: String) -> Self {
      Self {
         diagnostics: Vec::new(),
         success: false,
         error: Some(error),
      }
   }
}

/// Lints the request's content with its extension-provided linter. Without a linter config the
/// content is reported clean, so files without a linter extension work normally. Failures are
/// reported in the response rather than as errors.
pub fn lint_code(request: &LintRequest) -> LintResponse {
   let Some(config) = &request.linter_config else {
      return LintResponse::ok(Vec::new());
   };

   if let Err(error) = validate_linter_config(config) {
      return LintResponse::failed(format!("Invalid linter config: {}", error));
   }

   let command = build_extension_command(
      &config.command,
      config.args.as_deref(),
      config.env.as_ref(),
      request.file_path.as_deref(),
      request.workspace_folder.as_deref(),
   );
   run_linter(command, &request.content, config)
}

/// Defense-in-depth: rejects obviously unsafe extension-supplied exec configs before the template
/// variables get a chance to be substituted.
fn validate_linter_config(config: &LinterConfig) -> Result<(), String> {
   validate_exec_command(&config.command)?;
   if let Some(args) = config.args.as_deref() {
      validate_exec_args(args)?;
   }
   if let Some(env) = &config.env {
      validate_exec_env(env)?;
   }
   Ok(())
}

/// Runs the linter, feeding `content` on stdin unless the config reads the file itself, and
/// parses its stdout in the configured diagnostic format (JSON by default).
fn run_linter(command: Command, content: &str, config: &LinterConfig) -> LintResponse {
   run_linter_with_timeout(command, content, config, LINTER_TIMEOUT)
}

fn run_linter_with_timeout(
   mut command: Command,
   content: &str,
   config: &LinterConfig,
   timeout: Duration,
) -> LintResponse {
   let use_stdin = config.input_method.as_deref().unwrap_or("stdin") == "stdin";
   let command_name = command.get_program().to_string_lossy().into_owned();
   if use_stdin {
      command.stdin(Stdio::piped());
   }
   command.stdout(Stdio::piped());
   command.stderr(Stdio::piped());

   let output = match run_process(command, use_stdin.then_some(content), timeout) {
      Ok(output) => output,
      Err(ProcessError::Spawn(e)) => {
         return LintResponse::failed(format!("Linter not available: {} - {}", command_name, e));
      }
      Err(ProcessError::WriteStdin(_)) => {
         return LintResponse::failed("Failed to write to linter stdin".to_string());
      }
      Err(ProcessError::Wait(e)) => {
         return LintResponse::failed(format!("Failed to run linter: {}", e));
      }
      Err(ProcessError::TimedOut) => {
         return LintResponse::failed(format!("Linter timed out after {}s", timeout.as_secs()));
      }
   };

   // Linters exit non-zero when they find issues, so the output is parsed regardless.
   let stdout = String::from_utf8_lossy(&output.stdout);
   let stderr = String::from_utf8_lossy(&output.stderr);
   let diagnostics = match config.diagnostic_format.as_deref().unwrap_or("json") {
      "json" | "lsp" => parse_json_diagnostics(&stdout),
      "regex" => config
         .diagnostic_pattern
         .as_deref()
         .map(|pattern| parse_regex_diagnostics(&stdout, pattern))
         .unwrap_or_default(),
      _ => Vec::new(),
   };

   if diagnostics.is_empty() && !output.status.success() && !stderr.is_empty() {
      return LintResponse::failed(format!("Linter error: {}", stderr));
   }

   LintResponse::ok(diagnostics)
}

/// Parse JSON diagnostics from various linters
///
/// Supports multiple formats:
/// - ESLint/TSLint format (array with "messages")
/// - Clippy/Cargo format (single message or array of messages)
/// - Generic LSP diagnostic format
fn parse_json_diagnostics(output: &str) -> Vec<Diagnostic> {
   let mut diagnostics = vec![];

   // Try to parse as ESLint format (array with "messages")
   if let Ok(json_array) = serde_json::from_str::<Vec<serde_json::Value>>(output) {
      for item in json_array {
         // ESLint format: array of files with "messages"
         if let Some(messages) = item.get("messages").and_then(|m| m.as_array()) {
            for msg in messages {
               if let Some(diagnostic) = parse_eslint_diagnostic(msg) {
                  diagnostics.push(diagnostic);
               }
            }
         }
         // Clippy/Cargo format: direct message objects
         else if let Some(diagnostic) = parse_cargo_diagnostic(&item) {
            diagnostics.push(diagnostic);
         }
      }

      return diagnostics;
   }

   // Try to parse as single Clippy/Cargo message
   if let Ok(json_obj) = serde_json::from_str::<serde_json::Value>(output) {
      diagnostics.extend(parse_cargo_diagnostic(&json_obj));
   }

   diagnostics
}

/// Parse individual ESLint diagnostic message
fn parse_eslint_diagnostic(msg: &serde_json::Value) -> Option<Diagnostic> {
   let line = msg.get("line")?.as_u64()? as u32;
   let column = msg.get("column")?.as_u64()? as u32;
   let message = msg.get("message")?.as_str()?.to_string();
   let severity_num = msg.get("severity")?.as_u64()?;

   let severity = match severity_num {
      2 => "error",
      1 => "warning",
      _ => "info",
   }
   .to_string();

   let end_line = msg
      .get("endLine")
      .and_then(|l| l.as_u64())
      .map(|l| l as u32);
   let end_column = msg
      .get("endColumn")
      .and_then(|c| c.as_u64())
      .map(|c| c as u32);
   let code = msg
      .get("ruleId")
      .and_then(|r| r.as_str())
      .map(|s| s.to_string());

   Some(Diagnostic {
      line,
      column,
      end_line,
      end_column,
      severity,
      message,
      code,
      source: Some("eslint".to_string()),
   })
}

/// Parse individual Cargo/Clippy JSON message
fn parse_cargo_diagnostic(msg: &serde_json::Value) -> Option<Diagnostic> {
   // Cargo format has "message", "level", and "spans"
   let message_text = msg.get("message")?.as_str()?.to_string();
   let level = msg.get("level")?.as_str()?;

   // Get the first span (primary location)
   let spans = msg.get("spans")?.as_array()?;
   if spans.is_empty() {
      return None;
   }

   let span = &spans[0];
   let line = span.get("line_start")?.as_u64()? as u32;
   let column = span.get("column_start")?.as_u64()? as u32;
   let end_line = span
      .get("line_end")
      .and_then(|l| l.as_u64())
      .map(|l| l as u32);
   let end_column = span
      .get("column_end")
      .and_then(|c| c.as_u64())
      .map(|c| c as u32);

   // Map Rust severity levels
   let severity = match level {
      "error" => "error",
      "warning" => "warning",
      "note" | "help" => "info",
      _ => "info",
   }
   .to_string();

   // Extract error code if available
   let code = msg
      .get("code")
      .and_then(|c| c.get("code"))
      .and_then(|c| c.as_str())
      .map(|s| s.to_string());

   Some(Diagnostic {
      line,
      column,
      end_line,
      end_column,
      severity,
      message: message_text,
      code,
      source: Some("clippy".to_string()),
   })
}

/// Parse diagnostics using regex pattern
///
/// Pattern should contain named capture groups:
/// - `file` (optional): File path
/// - `line`: Line number (required)
/// - `column` (optional): Column number
/// - `severity`: Severity level (required)
/// - `message`: Error message (required)
/// - `code` (optional): Error code
///
/// Example pattern for GCC/Clang format:
/// `(?P<file>.+?):(?P<line>\d+):(?P<column>\d+):\s*(?P<severity>error|warning|info|hint):\s*(?
/// P<message>.+)`
fn parse_regex_diagnostics(output: &str, pattern: &str) -> Vec<Diagnostic> {
   use regex::Regex;

   let mut diagnostics = vec![];

   // Compile the regex pattern
   let re = match Regex::new(pattern) {
      Ok(r) => r,
      Err(e) => {
         log::warn!("Invalid linter diagnostic pattern: {}", e);
         return diagnostics;
      }
   };

   // Parse each line
   for line in output.lines() {
      if let Some(captures) = re.captures(line) {
         // Extract required fields
         let line_num = captures
            .name("line")
            .and_then(|m| m.as_str().parse::<u32>().ok());

         let severity = captures.name("severity").map(|m| m.as_str());
         let message = captures.name("message").map(|m| m.as_str().to_string());

         if let (Some(line_num), Some(severity), Some(message)) = (line_num, severity, message) {
            // Extract optional fields
            let column = captures
               .name("column")
               .and_then(|m| m.as_str().parse::<u32>().ok())
               .unwrap_or(1);

            let code = captures.name("code").map(|m| m.as_str().to_string());

            // Normalize severity
            let normalized_severity = match severity.to_lowercase().as_str() {
               "error" | "e" => "error",
               "warning" | "w" | "warn" => "warning",
               "info" | "i" | "note" => "info",
               "hint" | "h" => "hint",
               _ => "info",
            }
            .to_string();

            diagnostics.push(Diagnostic {
               line: line_num,
               column,
               end_line: None,
               end_column: None,
               severity: normalized_severity,
               message,
               code,
               source: None,
            });
         }
      }
   }

   diagnostics
}

#[cfg(test)]
mod tests;
