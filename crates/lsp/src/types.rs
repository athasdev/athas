use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LspError {
   pub message: String,
   #[serde(skip_serializing_if = "Option::is_none")]
   pub code: Option<String>,
}

impl LspError {
   pub fn new(message: impl Into<String>) -> Self {
      Self {
         message: message.into(),
         code: None,
      }
   }

   pub fn with_code(code: impl Into<String>, message: impl Into<String>) -> Self {
      Self {
         message: message.into(),
         code: Some(code.into()),
      }
   }
}

impl From<anyhow::Error> for LspError {
   fn from(err: anyhow::Error) -> Self {
      let message = err.to_string();
      let lower = message.to_lowercase();
      let code = if lower.contains("could not resolve an installed binary")
         || lower.contains("binary not found")
         || lower.contains("failed to spawn lsp server")
         || lower.contains("no such file or directory")
      {
         Some("tool_not_found".to_string())
      } else if lower.contains("not executable") || lower.contains("permission denied") {
         Some("tool_not_executable".to_string())
      } else if lower.contains("failed to initialize")
         || lower.contains("invalid workspace path")
         || lower.contains("no lsp server found")
      {
         Some("initialization_failed".to_string())
      } else {
         None
      };

      Self { message, code }
   }
}

pub type LspResult<T> = Result<T, LspError>;
