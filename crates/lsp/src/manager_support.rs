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
