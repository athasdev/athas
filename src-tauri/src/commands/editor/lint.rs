use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   io::Write,
   process::{Command, Stdio},
};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct LintRequest {
   pub content: String,
   pub language: String,
   pub linter: String,
   pub linter_config: Option<LinterConfig>,
   pub file_path: Option<String>,
   pub workspace_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinterConfig {
   pub command: String,
   pub args: Option<Vec<String>>,
   pub env: Option<HashMap<String, String>>,
   pub input_method: Option<String>,
   pub diagnostic_format: Option<String>,
   pub diagnostic_pattern: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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

#[derive(Debug, Serialize, Deserialize)]
pub struct LintResponse {
   pub diagnostics: Vec<Diagnostic>,
   pub success: bool,
   pub error: Option<String>,
}

/// Lint code content using the specified linter
///
/// The linter configuration must be provided by the frontend via the extension registry.
/// This ensures all linters are extension-driven and no hardcoded linters exist.
#[command]
pub async fn lint_code(request: LintRequest) -> Result<LintResponse, String> {
   // Linter config must be provided by the frontend (from extension registry)
   if let Some(config) = &request.linter_config {
      return lint_with_generic(
         &request.content,
         config,
         request.file_path.as_deref(),
         request.workspace_folder.as_deref(),
      )
      .await;
   }

   // No linter config provided - return success with no diagnostics
   // This allows files without linter extensions to work without errors
   Ok(LintResponse {
      diagnostics: vec![],
      success: true,
      error: None,
   })
}

/// Lint code using generic linter configuration from extension
async fn lint_with_generic(
   content: &str,
   config: &LinterConfig,
   file_path: Option<&str>,
   workspace_folder: Option<&str>,
) -> Result<LintResponse, String> {
   // Substitute template variables in command and args
   let command = substitute_variables(&config.command, file_path, workspace_folder);

   let args: Vec<String> = if let Some(arg_list) = &config.args {
      arg_list
         .iter()
         .map(|arg| substitute_variables(arg, file_path, workspace_folder))
         .collect()
   } else {
      vec![]
   };

   // Determine input method (default to stdin)
   let input_method = config.input_method.as_deref().unwrap_or("stdin");

   // Build command
   let mut cmd = Command::new(&command);
   cmd.args(&args);

   // Add environment variables if specified
   if let Some(env) = &config.env {
      for (key, value) in env {
         let value = substitute_variables(value, file_path, workspace_folder);
         cmd.env(key, value);
      }
   }

   // Configure stdin/stdout
   if input_method == "stdin" {
      cmd.stdin(Stdio::piped());
   }
   cmd.stdout(Stdio::piped());
   cmd.stderr(Stdio::piped());

   // Spawn the linter process
   match cmd.spawn() {
      Ok(mut child) => {
         // Write content to stdin if using stdin input
         if input_method == "stdin"
            && let Some(mut stdin) = child.stdin.take()
            && stdin.write_all(content.as_bytes()).is_err()
         {
            return Ok(LintResponse {
               diagnostics: vec![],
               success: false,
               error: Some("Failed to write to linter stdin".to_string()),
            });
         }

         // Wait for the process to complete
         match child.wait_with_output() {
            Ok(output) => {
               // Linters may exit with non-zero status when they find issues
               // So we parse output regardless of exit status
               let stdout = String::from_utf8_lossy(&output.stdout).to_string();
               let stderr = String::from_utf8_lossy(&output.stderr).to_string();

               // Determine diagnostic format (default to json)
               let diagnostic_format = config.diagnostic_format.as_deref().unwrap_or("json");

               let diagnostics = match diagnostic_format {
                  "json" | "lsp" => parse_json_diagnostics(&stdout),
                  "regex" => {
                     if let Some(pattern) = &config.diagnostic_pattern {
                        parse_regex_diagnostics(&stdout, pattern)
                     } else {
                        vec![]
                     }
                  }
                  _ => vec![],
               };

               // If parsing failed and there was an error, report it
               if diagnostics.is_empty() && !output.status.success() && !stderr.is_empty() {
                  return Ok(LintResponse {
                     diagnostics: vec![],
                     success: false,
                     error: Some(format!("Linter error: {}", stderr)),
                  });
               }

               Ok(LintResponse {
                  diagnostics,
                  success: true,
                  error: None,
               })
            }
            Err(e) => Ok(LintResponse {
               diagnostics: vec![],
               success: false,
               error: Some(format!("Failed to run linter: {}", e)),
            }),
         }
      }
      Err(e) => Ok(LintResponse {
         diagnostics: vec![],
         success: false,
         error: Some(format!("Linter not available: {} - {}", command, e)),
      }),
   }
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
         eprintln!("Invalid regex pattern: {}", e);
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

/// Substitute template variables in a string
fn substitute_variables(
   template: &str,
   file_path: Option<&str>,
   workspace_folder: Option<&str>,
) -> String {
   let mut result = template.to_string();

   if let Some(path) = file_path {
      result = result.replace("${file}", path);
      result = result.replace(
         "${fileBasename}",
         std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path),
      );
      result = result.replace(
         "${fileBasenameNoExtension}",
         std::path::Path::new(path)
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or(path),
      );
      result = result.replace(
         "${fileDirname}",
         std::path::Path::new(path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(""),
      );
      result = result.replace(
         "${fileExtname}",
         std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default()
            .as_str(),
      );
   }

   if let Some(workspace) = workspace_folder {
      result = result.replace("${workspaceFolder}", workspace);
   }

   result
}
