use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
   use super::*;

   fn code_for(message: &str) -> Option<String> {
      LspError::from(anyhow::anyhow!(message.to_string())).code
   }

   #[test]
   fn classifies_backend_errors_into_frontend_codes() {
      assert_eq!(
         code_for("Failed to spawn LSP server: command=\"x\"").as_deref(),
         Some("tool_not_found")
      );
      assert_eq!(
         code_for("Language server binary not found at '/x'").as_deref(),
         Some("tool_not_found")
      );
      assert_eq!(
         code_for("Language server binary exists but is not executable: '/x'").as_deref(),
         Some("tool_not_executable")
      );
      assert_eq!(
         code_for("Permission denied (os error 13)").as_deref(),
         Some("tool_not_executable")
      );
      assert_eq!(
         code_for("Invalid workspace path").as_deref(),
         Some("initialization_failed")
      );
      assert_eq!(code_for("LSP server is not running"), None);
   }

   #[test]
   fn keeps_the_original_message_and_omits_empty_codes_on_the_wire() {
      let error = LspError::from(anyhow::anyhow!("Something else broke"));
      assert_eq!(error.message, "Something else broke");
      assert_eq!(
         serde_json::to_value(&error).unwrap(),
         serde_json::json!({ "message": "Something else broke" })
      );
      assert_eq!(
         serde_json::to_value(LspError::with_code("custom", "Boom")).unwrap(),
         serde_json::json!({ "message": "Boom", "code": "custom" })
      );
   }
}
