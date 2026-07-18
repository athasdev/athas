use athas_wsl::{WslDistribution, WslFileEntry, WslSymlinkInfo};
use tauri::command;

#[command]
pub fn wsl_list_distributions() -> Result<Vec<WslDistribution>, String> {
   athas_wsl::list_distributions()
}

#[command]
pub fn wsl_get_home_dir(distro: String) -> Result<String, String> {
   athas_wsl::home_dir(&distro)
}

#[command]
pub fn wsl_read_directory(distro: String, path: String) -> Result<Vec<WslFileEntry>, String> {
   athas_wsl::read_directory(&distro, &path)
}

#[command]
pub fn wsl_read_file(distro: String, file_path: String) -> Result<String, String> {
   athas_wsl::read_file(&distro, &file_path)
}

#[command]
pub fn wsl_read_file_bytes(distro: String, file_path: String) -> Result<Vec<u8>, String> {
   athas_wsl::read_file_bytes(&distro, &file_path)
}

#[command]
pub fn wsl_write_file(distro: String, file_path: String, content: String) -> Result<(), String> {
   athas_wsl::write_file(&distro, &file_path, content.as_bytes())
}

#[command]
pub fn wsl_create_file(distro: String, file_path: String) -> Result<(), String> {
   athas_wsl::create_file(&distro, &file_path)
}

#[command]
pub fn wsl_create_directory(distro: String, directory_path: String) -> Result<(), String> {
   athas_wsl::create_directory(&distro, &directory_path)
}

#[command]
pub fn wsl_delete_path(
   distro: String,
   target_path: String,
   is_directory: bool,
) -> Result<(), String> {
   athas_wsl::delete_path(&distro, &target_path, is_directory)
}

#[command]
pub fn wsl_rename_path(
   distro: String,
   source_path: String,
   target_path: String,
) -> Result<(), String> {
   athas_wsl::rename_path(&distro, &source_path, &target_path)
}

#[command]
pub fn wsl_copy_path(
   distro: String,
   source_path: String,
   target_path: String,
   is_directory: bool,
) -> Result<(), String> {
   athas_wsl::copy_path(&distro, &source_path, &target_path, is_directory)
}

#[command]
pub fn wsl_get_symlink_info(distro: String, path: String) -> Result<WslSymlinkInfo, String> {
   athas_wsl::symlink_info(&distro, &path)
}

#[command]
pub fn wsl_resolve_windows_path(path: String) -> Result<String, String> {
   athas_wsl::resolve_windows_path(&path)
}
