use athas_project::ide_recents::{IdeRecentProject, importable_ide_projects};
use tauri::command;

#[command]
#[specta::specta]
pub fn get_importable_ide_projects() -> Result<Vec<IdeRecentProject>, String> {
   Ok(importable_ide_projects())
}
