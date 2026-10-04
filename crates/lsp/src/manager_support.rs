use anyhow::{Result, anyhow};
use lsp_types::{ExecuteCommandParams, TextDocumentIdentifier, Url};

pub(super) fn text_document_identifier(file_path: &str) -> Result<TextDocumentIdentifier> {
   Ok(TextDocumentIdentifier {
      uri: Url::from_file_path(file_path).map_err(|_| anyhow!("Invalid file path"))?,
   })
}

pub(super) fn is_unsupported_method(error: &anyhow::Error, method: &str) -> bool {
   let message = error.to_string();
   message.contains("-32601")
      || message.contains("Method not found")
      || message.contains(&format!("Unhandled method {}", method))
}

pub(super) fn execute_command_params(
   command: String,
   arguments: Vec<serde_json::Value>,
) -> ExecuteCommandParams {
   ExecuteCommandParams {
      command,
      arguments,
      work_done_progress_params: Default::default(),
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn converts_absolute_file_paths_to_file_uris() {
      let temp = tempfile::tempdir().unwrap();
      let path = temp.path().join("dir with space").join("main.rs");

      let identifier = text_document_identifier(path.to_str().unwrap()).unwrap();

      assert_eq!(identifier.uri.scheme(), "file");
      assert!(
         identifier
            .uri
            .path()
            .ends_with("/dir%20with%20space/main.rs")
      );
      assert_eq!(identifier.uri.to_file_path().unwrap(), path);
   }

   #[test]
   fn rejects_relative_file_paths() {
      assert!(text_document_identifier("relative/main.rs").is_err());
   }

   #[test]
   fn recognizes_unsupported_method_errors() {
      let method = "textDocument/inlayHint";
      for message in [
         "LSP error: Object {\"code\": Number(-32601)}",
         "Method not found",
         "Unhandled method textDocument/inlayHint",
      ] {
         assert!(
            is_unsupported_method(&anyhow!(message), method),
            "{message}"
         );
      }
      assert!(!is_unsupported_method(
         &anyhow!("Unhandled method textDocument/hover"),
         method
      ));
      assert!(!is_unsupported_method(
         &anyhow!("Request cancelled"),
         method
      ));
   }
}
