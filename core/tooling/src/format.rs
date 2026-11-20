//! Runs extension-declared formatters, and a few built-in fallbacks, over editor content.

use crate::{
   exec_guard::{validate_exec_args, validate_exec_command, validate_exec_env},
   extension_command::build_extension_command,
   process_io::{ProcessError, run_process},
};
use athas_runtime::process::configure_background_command;
use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   process::{Command, Stdio},
   time::Duration,
};

/// How long a formatter may run before it is killed and the content is left unformatted.
const FORMATTER_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct FormatRequest {
   pub content: String,
   pub language: String,
   pub formatter: String,
   pub formatter_config: Option<FormatterConfig>,
   pub file_path: Option<String>,
   pub workspace_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FormatterConfig {
   pub command: String,
   pub args: Option<Vec<String>>,
   pub env: Option<HashMap<String, String>>,
   pub input_method: Option<String>,
   pub output_method: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct FormatResponse {
   pub formatted_content: String,
   pub success: bool,
   pub error: Option<String>,
}

impl FormatResponse {
   fn formatted(formatted_content: String) -> Self {
      Self {
         formatted_content,
         success: true,
         error: None,
      }
   }

   /// Leaves `content` unchanged and reports why.
   fn failed(content: &str, error: String) -> Self {
      Self {
         formatted_content: content.to_string(),
         success: false,
         error: Some(error),
      }
   }
}

/// Formats the request's content with its extension-provided formatter, or with one of the
/// built-in fallbacks when no formatter config is given. Formatter failures are reported in the
/// response; only invalid requests are errors.
pub fn format_code(request: &FormatRequest) -> Result<FormatResponse, String> {
   if let Some(config) = &request.formatter_config {
      return format_with_config(
         &request.content,
         config,
         request.file_path.as_deref(),
         request.workspace_folder.as_deref(),
      );
   }

   if request.formatter == "eslint" {
      return Ok(FormatResponse::failed(
         &request.content,
         "ESLint formatting requires file-based operation (not yet implemented)".to_string(),
      ));
   }

   let (command, command_name, display_name) =
      builtin_formatter_command(&request.formatter, &request.language)
         .ok_or_else(|| format!("Unsupported formatter: {}", request.formatter))?;
   Ok(run_stdin_formatter(
      command,
      &request.content,
      command_name,
      display_name,
      FORMATTER_TIMEOUT,
   ))
}

fn format_with_config(
   content: &str,
   config: &FormatterConfig,
   file_path: Option<&str>,
   workspace_folder: Option<&str>,
) -> Result<FormatResponse, String> {
   // Defense-in-depth: reject obviously unsafe extension-supplied exec configs
   // before the template variables get a chance to be substituted.
   validate_exec_command(&config.command)
      .map_err(|e| format!("Invalid formatter config: {}", e))?;
   if let Some(args) = config.args.as_deref() {
      validate_exec_args(args).map_err(|e| format!("Invalid formatter config: {}", e))?;
   }
   if let Some(env) = &config.env {
      validate_exec_env(env).map_err(|e| format!("Invalid formatter config: {}", e))?;
   }

   let command = build_extension_command(
      &config.command,
      config.args.as_deref(),
      config.env.as_ref(),
      file_path,
      workspace_folder,
   );
   run_configured_formatter(command, content, config, file_path, FORMATTER_TIMEOUT)
}

/// Runs an extension formatter. Content goes in on stdin and comes back on stdout unless the
/// config says the formatter reads or rewrites the file itself.
fn run_configured_formatter(
   mut command: Command,
   content: &str,
   config: &FormatterConfig,
   file_path: Option<&str>,
   timeout: Duration,
) -> Result<FormatResponse, String> {
   let use_stdin = config.input_method.as_deref().unwrap_or("stdin") == "stdin";
   let use_stdout = config.output_method.as_deref().unwrap_or("stdout") == "stdout";
   let command_name = command.get_program().to_string_lossy().into_owned();

   if use_stdin {
      command.stdin(Stdio::piped());
   }
   if use_stdout {
      command.stdout(Stdio::piped());
   }
   command.stderr(Stdio::piped());

   let output = match run_process(command, use_stdin.then_some(content), timeout) {
      Ok(output) => output,
      Err(ProcessError::Spawn(e)) => {
         return Ok(FormatResponse::failed(
            content,
            format!("Formatter not available: {} - {}", command_name, e),
         ));
      }
      Err(ProcessError::WriteStdin(_)) => {
         return Ok(FormatResponse::failed(
            content,
            "Failed to write to formatter stdin".to_string(),
         ));
      }
      Err(ProcessError::Wait(e)) => {
         return Ok(FormatResponse::failed(
            content,
            format!("Failed to run formatter: {}", e),
         ));
      }
      Err(ProcessError::TimedOut) => {
         return Ok(FormatResponse::failed(
            content,
            format!("Formatter timed out after {}s", timeout.as_secs_f32()),
         ));
      }
   };

   if !output.status.success() {
      return Ok(FormatResponse::failed(
         content,
         format!(
            "Formatter error: {}",
            String::from_utf8_lossy(&output.stderr)
         ),
      ));
   }

   let formatted = if use_stdout {
      String::from_utf8_lossy(&output.stdout).into_owned()
   } else {
      // The formatter rewrote the file in place, so the file now holds the result.
      let file_path = file_path.ok_or("file_path required for file output method")?;
      std::fs::read_to_string(file_path).unwrap_or_else(|_| content.to_string())
   };
   Ok(FormatResponse::formatted(formatted))
}

/// The built-in stdin/stdout formatters used when no extension formatter is configured, as the
/// command plus the names its errors are reported under.
fn builtin_formatter_command(
   formatter: &str,
   language: &str,
) -> Option<(Command, &'static str, &'static str)> {
   let (program, command_name, display_name, args) = match formatter {
      "prettier" => (
         "npx",
         "prettier",
         "Prettier",
         vec![
            "prettier".to_string(),
            "--parser".to_string(),
            prettier_parser(language).to_string(),
            "--stdin-filepath".to_string(),
            format!("temp.{}", file_extension(language)),
         ],
      ),
      "rustfmt" => (
         "rustfmt",
         "rustfmt",
         "rustfmt",
         vec!["--emit".to_string(), "stdout".to_string()],
      ),
      "gofmt" => ("gofmt", "gofmt", "gofmt", Vec::new()),
      _ => return None,
   };

   let mut command = Command::new(program);
   configure_background_command(&mut command);
   command.args(args);
   Some((command, command_name, display_name))
}

fn run_stdin_formatter(
   mut command: Command,
   content: &str,
   command_name: &str,
   display_name: &str,
   timeout: Duration,
) -> FormatResponse {
   command
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());
   let output = match run_process(command, Some(content), timeout) {
      Ok(output) => output,
      Err(ProcessError::Spawn(error)) => {
         return FormatResponse::failed(content, format!("{display_name} not available: {error}"));
      }
      Err(ProcessError::WriteStdin(error)) => {
         return FormatResponse::failed(
            content,
            format!("Failed to write to {command_name} stdin: {error}"),
         );
      }
      Err(ProcessError::Wait(error)) => {
         return FormatResponse::failed(content, format!("Failed to run {command_name}: {error}"));
      }
      Err(ProcessError::TimedOut) => {
         return FormatResponse::failed(
            content,
            format!("{display_name} timed out after {}s", timeout.as_secs_f32()),
         );
      }
   };

   if output.status.success() {
      FormatResponse::formatted(String::from_utf8_lossy(&output.stdout).into_owned())
   } else {
      FormatResponse::failed(
         content,
         format!(
            "{display_name} error: {}",
            String::from_utf8_lossy(&output.stderr)
         ),
      )
   }
}

fn prettier_parser(language: &str) -> &'static str {
   match language {
      "javascript" | "js" => "babel",
      "typescript" | "ts" => "typescript",
      "json" => "json",
      "html" => "html",
      "css" => "css",
      "markdown" | "md" => "markdown",
      _ => "babel",
   }
}

fn file_extension(language: &str) -> &'static str {
   match language {
      "javascript" | "js" => "js",
      "typescript" | "ts" => "ts",
      "json" => "json",
      "html" => "html",
      "css" => "css",
      "markdown" | "md" => "md",
      "rust" | "rs" => "rs",
      "go" => "go",
      "python" | "py" => "py",
      "java" => "java",
      "c" => "c",
      "cpp" | "c++" => "cpp",
      _ => "txt",
   }
}

#[cfg(test)]
mod tests;
