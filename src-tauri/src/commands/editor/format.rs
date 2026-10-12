use athas_tooling::{FormatRequest, FormatResponse};
use tauri::command;

/// Format code content using the specified formatter
#[command]
#[specta::specta]
pub async fn format_code(request: FormatRequest) -> Result<FormatResponse, String> {
   athas_tooling::format_code(&request)
}
