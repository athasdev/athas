use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct FormatRequest {
   pub content: String,
   pub language: String,
   pub formatter: String,
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
   let FormatRequest {
      content,
      language,
      formatter,
   } = request;

   match formatter.as_str() {
      "prettier" => format_with_prettier(&content, &language).await,
      "rustfmt" => format_with_rustfmt(&content).await,
      "gofmt" => format_with_gofmt(&content).await,
      "eslint" => format_with_eslint(&content).await,
      _ => Err(format!("Unsupported formatter: {}", formatter)),
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
