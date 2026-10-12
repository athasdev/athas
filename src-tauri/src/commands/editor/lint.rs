use athas_tooling::{LintRequest, LintResponse};
use tauri::command;

/// Lint code content using the specified linter
///
/// The linter configuration must be provided by the frontend via the extension registry.
/// This ensures all linters are extension-driven and no hardcoded linters exist.
#[command]
#[specta::specta]
pub async fn lint_code(request: LintRequest) -> Result<LintResponse, String> {
   Ok(athas_tooling::lint_code(&request))
}
