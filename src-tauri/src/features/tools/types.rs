use serde::{Deserialize, Serialize};
use std::fmt;

/// Status of a tool installation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ToolStatus {
   /// Tool is not installed
   NotInstalled,
   /// Tool is installed and ready to use
   Installed,
   /// Tool is currently being installed
   Installing,
   /// Installation failed
   Failed(String),
}

/// Runtime environment required to run a tool
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ToolRuntime {
   /// JavaScript runtime (Bun preferred, Node fallback)
   Bun,
   Node,
   /// Python runtime
   Python,
   /// Go runtime
   Go,
   /// Rust/Cargo
   Rust,
   /// Direct binary download (no runtime needed)
   Binary,
}

/// Configuration for a language tool (LSP, formatter, linter)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfig {
   /// Tool name (e.g., "pyright", "black", "eslint")
   pub name: String,
   /// Runtime to use for running the tool
   pub runtime: ToolRuntime,
   /// Package name (for npm/pip/cargo)
   #[serde(default)]
   pub package: Option<String>,
   /// Direct download URL (for binary tools)
   #[serde(default)]
   pub download_url: Option<String>,
   /// Command line arguments
   #[serde(default)]
   pub args: Vec<String>,
   /// Environment variables to set
   #[serde(default)]
   pub env: std::collections::HashMap<String, String>,
}

/// Tool types that can be installed
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ToolType {
   Lsp,
   Formatter,
   Linter,
}

/// Status of all tools for a language
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageToolStatus {
   pub language_id: String,
   pub lsp: Option<ToolStatus>,
   pub formatter: Option<ToolStatus>,
   pub linter: Option<ToolStatus>,
}

impl LanguageToolStatus {
   pub fn new(language_id: &str) -> Self {
      Self {
         language_id: language_id.to_string(),
         lsp: None,
         formatter: None,
         linter: None,
      }
   }
}

/// Errors that can occur during tool operations
#[derive(Debug)]
pub enum ToolError {
   /// Tool not found after installation
   NotFound(String),
   /// Installation failed
   InstallationFailed(String),
   /// Runtime not available
   RuntimeNotAvailable(String),
   /// Download failed
   DownloadFailed(String),
   /// Execution failed
   ExecutionFailed(String),
   /// IO error
   IoError(std::io::Error),
   /// Configuration error
   ConfigError(String),
}

impl fmt::Display for ToolError {
   fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
      match self {
         ToolError::NotFound(name) => write!(f, "Tool '{}' not found", name),
         ToolError::InstallationFailed(msg) => write!(f, "Installation failed: {}", msg),
         ToolError::RuntimeNotAvailable(rt) => write!(f, "Runtime '{}' not available", rt),
         ToolError::DownloadFailed(msg) => write!(f, "Download failed: {}", msg),
         ToolError::ExecutionFailed(msg) => write!(f, "Execution failed: {}", msg),
         ToolError::IoError(e) => write!(f, "IO error: {}", e),
         ToolError::ConfigError(msg) => write!(f, "Configuration error: {}", msg),
      }
   }
}

impl std::error::Error for ToolError {}

impl From<std::io::Error> for ToolError {
   fn from(err: std::io::Error) -> Self {
      ToolError::IoError(err)
   }
}

impl From<ToolError> for String {
   fn from(err: ToolError) -> Self {
      err.to_string()
   }
}
