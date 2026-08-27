use super::{
   exec_guard::{validate_exec_command, validate_exec_env},
   extension_command::build_extension_command,
};
use athas_runtime::process::configure_background_command;
use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   io::Write,
   process::{Command, Stdio},
};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct FormatRequest {
   pub content: String,
   pub language: String,
   pub formatter: String,
   pub formatter_config: Option<FormatterConfig>,
   pub file_path: Option<String>,
   pub workspace_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatterConfig {
   pub command: String,
   pub args: Option<Vec<String>>,
   pub env: Option<HashMap<String, String>>,
   pub input_method: Option<String>,
   pub output_method: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FormatResponse {
   pub formatted_content: String,
   pub success: bool,
   pub error: Option<String>,
}

/// Format code content using the specified formatter
#[command]
pub async fn format_code(request: FormatRequest) -> Result<FormatResponse, String> {
   // If formatter config is provided, use generic formatter
   if let Some(config) = &request.formatter_config {
      return format_with_generic(
         &request.content,
         config,
         request.file_path.as_deref(),
         request.workspace_folder.as_deref(),
      )
      .await;
   }

   // Otherwise, fall back to hardcoded formatters
   match request.formatter.as_str() {
      "prettier" => format_with_prettier(&request.content, &request.language).await,
      "rustfmt" => format_with_rustfmt(&request.content).await,
      "gofmt" => format_with_gofmt(&request.content).await,
      "eslint" => format_with_eslint(&request.content).await,
      _ => Err(format!("Unsupported formatter: {}", request.formatter)),
   }
}

/// Format code using generic formatter configuration from extension
async fn format_with_generic(
   content: &str,
   config: &FormatterConfig,
   file_path: Option<&str>,
   workspace_folder: Option<&str>,
) -> Result<FormatResponse, String> {
   // Defense-in-depth: reject obviously unsafe extension-supplied exec configs
   // before the template variables get a chance to be substituted.
   validate_exec_command(&config.command)
      .map_err(|e| format!("Invalid formatter config: {}", e))?;
   if let Some(env) = &config.env {
      validate_exec_env(env).map_err(|e| format!("Invalid formatter config: {}", e))?;
   }

   // Determine input/output methods (default to stdin/stdout)
   let input_method = config.input_method.as_deref().unwrap_or("stdin");
   let output_method = config.output_method.as_deref().unwrap_or("stdout");

   // Build command
   let mut cmd = build_extension_command(
      &config.command,
      config.args.as_deref(),
      config.env.as_ref(),
      file_path,
      workspace_folder,
   );
   let command_name = cmd.get_program().to_string_lossy().into_owned();

   // Configure stdin/stdout
   if input_method == "stdin" {
      cmd.stdin(Stdio::piped());
   }
   if output_method == "stdout" {
      cmd.stdout(Stdio::piped());
   }
   cmd.stderr(Stdio::piped());

   // Spawn the formatter process
   match cmd.spawn() {
      Ok(mut child) => {
         // Write content to stdin if using stdin input
         if input_method == "stdin"
            && let Some(mut stdin) = child.stdin.take()
            && stdin.write_all(content.as_bytes()).is_err()
         {
            return Ok(FormatResponse {
               formatted_content: content.to_string(),
               success: false,
               error: Some("Failed to write to formatter stdin".to_string()),
            });
         }

         // Wait for the process to complete
         match child.wait_with_output() {
            Ok(output) => {
               if output.status.success() {
                  let formatted = if output_method == "stdout" {
                     String::from_utf8_lossy(&output.stdout).to_string()
                  } else {
                     // For file output, read the file (TODO: implement file-based formatting)
                     content.to_string()
                  };

                  Ok(FormatResponse {
                     formatted_content: formatted,
                     success: true,
                     error: None,
                  })
               } else {
                  let error_msg = String::from_utf8_lossy(&output.stderr);
                  Ok(FormatResponse {
                     formatted_content: content.to_string(),
                     success: false,
                     error: Some(format!("Formatter error: {}", error_msg)),
                  })
               }
            }
            Err(e) => Ok(FormatResponse {
               formatted_content: content.to_string(),
               success: false,
               error: Some(format!("Failed to run formatter: {}", e)),
            }),
         }
      }
      Err(e) => Ok(FormatResponse {
         formatted_content: content.to_string(),
         success: false,
         error: Some(format!("Formatter not available: {} - {}", command_name, e)),
      }),
   }
}

/// Format code using Prettier
async fn format_with_prettier(content: &str, language: &str) -> Result<FormatResponse, String> {
   // Determine the parser based on language
   let parser = match language {
      "javascript" | "js" => "babel",
      "typescript" | "ts" => "typescript",
      "json" => "json",
      "html" => "html",
      "css" => "css",
      "markdown" | "md" => "markdown",
      _ => "babel", // Default fallback
   };

   let mut cmd = Command::new("npx");
   configure_background_command(&mut cmd);
   cmd.args([
      "prettier",
      "--parser",
      parser,
      "--stdin-filepath",
      &format!("temp.{}", get_file_extension(language)),
   ])
   .stdin(std::process::Stdio::piped())
   .stdout(std::process::Stdio::piped())
   .stderr(std::process::Stdio::piped());

   Ok(run_stdin_formatter(cmd, content, "prettier", "Prettier"))
}

/// Format Rust code using rustfmt
async fn format_with_rustfmt(content: &str) -> Result<FormatResponse, String> {
   let mut cmd = Command::new("rustfmt");
   configure_background_command(&mut cmd);
   cmd.args(["--emit", "stdout"])
      .stdin(std::process::Stdio::piped())
      .stdout(std::process::Stdio::piped())
      .stderr(std::process::Stdio::piped());

   Ok(run_stdin_formatter(cmd, content, "rustfmt", "rustfmt"))
}

/// Format Go code using gofmt
async fn format_with_gofmt(content: &str) -> Result<FormatResponse, String> {
   let mut cmd = Command::new("gofmt");
   configure_background_command(&mut cmd);
   cmd.stdin(std::process::Stdio::piped())
      .stdout(std::process::Stdio::piped())
      .stderr(std::process::Stdio::piped());

   Ok(run_stdin_formatter(cmd, content, "gofmt", "gofmt"))
}

fn run_stdin_formatter(
   mut command: Command,
   content: &str,
   command_name: &str,
   display_name: &str,
) -> FormatResponse {
   let mut child = match command.spawn() {
      Ok(child) => child,
      Err(error) => {
         return FormatResponse {
            formatted_content: content.to_string(),
            success: false,
            error: Some(format!("{display_name} not available: {error}")),
         };
      }
   };

   if let Some(mut stdin) = child.stdin.take()
      && let Err(error) = stdin.write_all(content.as_bytes())
   {
      return FormatResponse {
         formatted_content: content.to_string(),
         success: false,
         error: Some(format!("Failed to write to {command_name} stdin: {error}")),
      };
   }

   let output = match child.wait_with_output() {
      Ok(output) => output,
      Err(error) => {
         return FormatResponse {
            formatted_content: content.to_string(),
            success: false,
            error: Some(format!("Failed to run {command_name}: {error}")),
         };
      }
   };

   if output.status.success() {
      FormatResponse {
         formatted_content: String::from_utf8_lossy(&output.stdout).to_string(),
         success: true,
         error: None,
      }
   } else {
      FormatResponse {
         formatted_content: content.to_string(),
         success: false,
         error: Some(format!(
            "{display_name} error: {}",
            String::from_utf8_lossy(&output.stderr)
         )),
      }
   }
}

/// Format code using ESLint with --fix
async fn format_with_eslint(content: &str) -> Result<FormatResponse, String> {
   // ESLint requires a file, so we'll use a temporary approach
   // For now, just return the original content with a message
   Ok(FormatResponse {
      formatted_content: content.to_string(),
      success: false,
      error: Some(
         "ESLint formatting requires file-based operation (not yet implemented)".to_string(),
      ),
   })
}

/// Get file extension for a given language
fn get_file_extension(language: &str) -> &str {
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
