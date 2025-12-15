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

   // Determine input/output methods (default to stdin/stdout)
   let input_method = config.input_method.as_deref().unwrap_or("stdin");
   let output_method = config.output_method.as_deref().unwrap_or("stdout");

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
   if output_method == "stdout" {
      cmd.stdout(Stdio::piped());
   }
   cmd.stderr(Stdio::piped());

   // Spawn the formatter process
   match cmd.spawn() {
      Ok(mut child) => {
         // Write content to stdin if using stdin input
         if input_method == "stdin" {
            if let Some(mut stdin) = child.stdin.take() {
               if let Err(e) = stdin.write_all(content.as_bytes()) {
                  return Ok(FormatResponse {
                     formatted_content: content.to_string(),
                     success: false,
                     error: Some(format!("Failed to write to formatter stdin: {}", e)),
                  });
               }
            }
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
         error: Some(format!("Formatter not available: {} - {}", command, e)),
      }),
   }
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

   match cmd.spawn() {
      Ok(mut child) => {
         // Write content to stdin
         if let Some(stdin) = child.stdin.take() {
            use std::io::Write;
            let mut stdin = stdin;
            if let Err(e) = stdin.write_all(content.as_bytes()) {
               return Ok(FormatResponse {
                  formatted_content: content.to_string(),
                  success: false,
                  error: Some(format!("Failed to write to prettier stdin: {}", e)),
               });
            }
         }

         // Wait for the process to complete
         match child.wait_with_output() {
            Ok(output) => {
               if output.status.success() {
                  let formatted = String::from_utf8_lossy(&output.stdout);
                  Ok(FormatResponse {
                     formatted_content: formatted.to_string(),
                     success: true,
                     error: None,
                  })
               } else {
                  let error_msg = String::from_utf8_lossy(&output.stderr);
                  Ok(FormatResponse {
                     formatted_content: content.to_string(),
                     success: false,
                     error: Some(format!("Prettier error: {}", error_msg)),
                  })
               }
            }
            Err(e) => Ok(FormatResponse {
               formatted_content: content.to_string(),
               success: false,
               error: Some(format!("Failed to run prettier: {}", e)),
            }),
         }
      }
      Err(e) => {
         // Prettier not available, return original content
         Ok(FormatResponse {
            formatted_content: content.to_string(),
            success: false,
            error: Some(format!("Prettier not available: {}", e)),
         })
      }
   }
}

/// Format Rust code using rustfmt
async fn format_with_rustfmt(content: &str) -> Result<FormatResponse, String> {
   let mut cmd = Command::new("rustfmt");
   cmd.args(["--emit", "stdout"])
      .stdin(std::process::Stdio::piped())
      .stdout(std::process::Stdio::piped())
      .stderr(std::process::Stdio::piped());

   match cmd.spawn() {
      Ok(mut child) => {
         // Write content to stdin
         if let Some(stdin) = child.stdin.take() {
            use std::io::Write;
            let mut stdin = stdin;
            if let Err(e) = stdin.write_all(content.as_bytes()) {
               return Ok(FormatResponse {
                  formatted_content: content.to_string(),
                  success: false,
                  error: Some(format!("Failed to write to rustfmt stdin: {}", e)),
               });
            }
         }

         match child.wait_with_output() {
            Ok(output) => {
               if output.status.success() {
                  let formatted = String::from_utf8_lossy(&output.stdout);
                  Ok(FormatResponse {
                     formatted_content: formatted.to_string(),
                     success: true,
                     error: None,
                  })
               } else {
                  let error_msg = String::from_utf8_lossy(&output.stderr);
                  Ok(FormatResponse {
                     formatted_content: content.to_string(),
                     success: false,
                     error: Some(format!("rustfmt error: {}", error_msg)),
                  })
               }
            }
            Err(e) => Ok(FormatResponse {
               formatted_content: content.to_string(),
               success: false,
               error: Some(format!("Failed to run rustfmt: {}", e)),
            }),
         }
      }
      Err(e) => Ok(FormatResponse {
         formatted_content: content.to_string(),
         success: false,
         error: Some(format!("rustfmt not available: {}", e)),
      }),
   }
}

/// Format Go code using gofmt
async fn format_with_gofmt(content: &str) -> Result<FormatResponse, String> {
   let mut cmd = Command::new("gofmt");
   cmd.stdin(std::process::Stdio::piped())
      .stdout(std::process::Stdio::piped())
      .stderr(std::process::Stdio::piped());

   match cmd.spawn() {
      Ok(mut child) => {
         // Write content to stdin
         if let Some(stdin) = child.stdin.take() {
            use std::io::Write;
            let mut stdin = stdin;
            if let Err(e) = stdin.write_all(content.as_bytes()) {
               return Ok(FormatResponse {
                  formatted_content: content.to_string(),
                  success: false,
                  error: Some(format!("Failed to write to gofmt stdin: {}", e)),
               });
            }
         }

         match child.wait_with_output() {
            Ok(output) => {
               if output.status.success() {
                  let formatted = String::from_utf8_lossy(&output.stdout);
                  Ok(FormatResponse {
                     formatted_content: formatted.to_string(),
                     success: true,
                     error: None,
                  })
               } else {
                  let error_msg = String::from_utf8_lossy(&output.stderr);
                  Ok(FormatResponse {
                     formatted_content: content.to_string(),
                     success: false,
                     error: Some(format!("gofmt error: {}", error_msg)),
                  })
               }
            }
            Err(e) => Ok(FormatResponse {
               formatted_content: content.to_string(),
               success: false,
               error: Some(format!("Failed to run gofmt: {}", e)),
            }),
         }
      }
      Err(e) => Ok(FormatResponse {
         formatted_content: content.to_string(),
         success: false,
         error: Some(format!("gofmt not available: {}", e)),
      }),
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
