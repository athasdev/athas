use super::fs::FileBytes;
use athas_wsl::{WslDistribution, WslFileEntry, WslSymlinkInfo};
use std::path::Path;
use tauri::command;

#[command]
#[specta::specta]
pub fn wsl_list_distributions() -> Result<Vec<WslDistribution>, String> {
   athas_wsl::list_distributions()
}

#[command]
#[specta::specta]
pub fn wsl_get_home_dir(distro: String) -> Result<String, String> {
   athas_wsl::home_dir(&distro)
}

#[command]
#[specta::specta]
pub fn wsl_read_directory(distro: String, path: String) -> Result<Vec<WslFileEntry>, String> {
   athas_wsl::read_directory(&distro, &path)
}

/// Reads the ignore files through the distribution's `\\wsl.localhost` share. The global
/// excludes file is skipped: the one this process would find belongs to the Windows user.
#[command]
#[specta::specta]
pub async fn wsl_ignored_entry_names(
   distro: String,
   directory: String,
   workspace_root: String,
) -> Result<Vec<String>, String> {
   tauri::async_runtime::spawn_blocking(move || {
      let flavor = athas_wsl::resolve_unc_flavor(&distro);
      let directory = athas_wsl::wsl_path_to_windows_unc(&distro, &directory, flavor);
      let root = athas_wsl::wsl_path_to_windows_unc(&distro, &workspace_root, flavor);
      athas_project::ignored_entries::ignored_entry_names_without_global_excludes(
         Path::new(&root),
         Path::new(&directory),
      )
   })
   .await
   .map_err(|error| format!("Ignored entries task failed: {error}"))?
}

#[command]
#[specta::specta]
pub fn wsl_read_file(distro: String, file_path: String) -> Result<String, String> {
   athas_wsl::read_file(&distro, &file_path)
}

#[command]
#[specta::specta]
pub fn wsl_read_file_bytes(distro: String, file_path: String) -> Result<FileBytes, String> {
   athas_wsl::read_file_bytes(&distro, &file_path).map(FileBytes)
}

#[command]
#[specta::specta]
pub fn wsl_write_file(distro: String, file_path: String, content: String) -> Result<(), String> {
   athas_wsl::write_file(&distro, &file_path, content.as_bytes())
}

#[command]
#[specta::specta]
pub fn wsl_write_file_checked(
   distro: String,
   file_path: String,
   content: String,
   expected_content: Option<String>,
) -> Result<(), String> {
   athas_wsl::write_file_checked(&distro, &file_path, &content, expected_content.as_deref())
}

#[command]
#[specta::specta]
pub fn wsl_delete_file_checked(
   distro: String,
   file_path: String,
   expected_content: String,
) -> Result<(), String> {
   athas_wsl::delete_file_checked(&distro, &file_path, &expected_content)
}

#[command]
#[specta::specta]
pub fn wsl_create_file(distro: String, file_path: String) -> Result<(), String> {
   athas_wsl::create_file(&distro, &file_path)
}

#[command]
#[specta::specta]
pub fn wsl_create_directory(distro: String, directory_path: String) -> Result<(), String> {
   athas_wsl::create_directory(&distro, &directory_path)
}

#[command]
#[specta::specta]
pub fn wsl_delete_path(
   distro: String,
   target_path: String,
   is_directory: bool,
) -> Result<(), String> {
   athas_wsl::delete_path(&distro, &target_path, is_directory)
}

#[command]
#[specta::specta]
pub fn wsl_rename_path(
   distro: String,
   source_path: String,
   target_path: String,
) -> Result<(), String> {
   athas_wsl::rename_path(&distro, &source_path, &target_path)
}

#[command]
#[specta::specta]
pub fn wsl_copy_path(
   distro: String,
   source_path: String,
   target_path: String,
   is_directory: bool,
) -> Result<(), String> {
   athas_wsl::copy_path(&distro, &source_path, &target_path, is_directory)
}

#[command]
#[specta::specta]
pub fn wsl_get_symlink_info(distro: String, path: String) -> Result<WslSymlinkInfo, String> {
   athas_wsl::symlink_info(&distro, &path)
}

#[command]
#[specta::specta]
pub fn wsl_resolve_windows_path(path: String) -> Result<String, String> {
   athas_wsl::resolve_windows_path(&path)
}
