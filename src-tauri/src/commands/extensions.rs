use sha2::{Digest, Sha256};
use std::{
   env,
   fs::{self, File},
   io::Write,
   path::{Path, PathBuf},
};
use tauri::command;

#[command]
pub async fn download_extension(
   url: String,
   extension_id: String,
   checksum: String,
) -> Result<String, String> {
   // Get extensions directory
   let extensions_dir = get_extensions_dir()?;
   let download_dir = extensions_dir.join("downloads");

   // Create downloads directory if it doesn't exist
   fs::create_dir_all(&download_dir)
      .map_err(|e| format!("Failed to create downloads directory: {}", e))?;

   // Download the file
   let response = reqwest::get(&url)
      .await
      .map_err(|e| format!("Failed to download extension: {}", e))?;

   if !response.status().is_success() {
      return Err(format!(
         "Failed to download extension: HTTP {}",
         response.status()
      ));
   }

   let bytes = response
      .bytes()
      .await
      .map_err(|e| format!("Failed to read response: {}", e))?;

   // Verify checksum
   let mut hasher = Sha256::new();
   hasher.update(&bytes);
   let result = hasher.finalize();
   let computed_checksum = format!("{:x}", result);

   if computed_checksum != checksum {
      return Err(format!(
         "Checksum mismatch: expected {}, got {}",
         checksum, computed_checksum
      ));
   }

   // Save to downloads directory
   let file_path = download_dir.join(format!("{}.wasm", extension_id));
   let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;

   file
      .write_all(&bytes)
      .map_err(|e| format!("Failed to write file: {}", e))?;

   Ok(file_path
      .to_str()
      .ok_or("Failed to convert path to string")?
      .to_string())
}

#[command]
pub fn install_extension(extension_id: String, package_path: String) -> Result<(), String> {
   // Get extensions directory
   let extensions_dir = get_extensions_dir()?;
   let installed_dir = extensions_dir.join("installed");

   // Create installed directory if it doesn't exist
   fs::create_dir_all(&installed_dir)
      .map_err(|e| format!("Failed to create installed directory: {}", e))?;

   // Create extension directory
   let extension_dir = installed_dir.join(&extension_id);
   fs::create_dir_all(&extension_dir)
      .map_err(|e| format!("Failed to create extension directory: {}", e))?;

   // Copy WASM file to installed directory
   let source_path = Path::new(&package_path);
   let target_path = extension_dir.join("extension.wasm");

   fs::copy(source_path, &target_path)
      .map_err(|e| format!("Failed to copy extension file: {}", e))?;

   // Clean up download
   fs::remove_file(source_path).ok();

   Ok(())
}

#[command]
pub fn uninstall_extension(extension_id: String) -> Result<(), String> {
   // Get extensions directory
   let extensions_dir = get_extensions_dir()?;
   let installed_dir = extensions_dir.join("installed");
   let extension_dir = installed_dir.join(&extension_id);

   // Check if extension exists
   if !extension_dir.exists() {
      return Err(format!("Extension {} is not installed", extension_id));
   }

   // Remove extension directory
   fs::remove_dir_all(&extension_dir)
      .map_err(|e| format!("Failed to remove extension directory: {}", e))?;

   Ok(())
}

#[command]
pub fn get_installed_extensions() -> Result<Vec<String>, String> {
   // Get extensions directory
   let extensions_dir = get_extensions_dir()?;
   let installed_dir = extensions_dir.join("installed");

   // Create installed directory if it doesn't exist
   if !installed_dir.exists() {
      return Ok(Vec::new());
   }

   // Read directory entries
   let entries = fs::read_dir(&installed_dir)
      .map_err(|e| format!("Failed to read installed directory: {}", e))?;

   let mut extensions = Vec::new();

   for entry in entries {
      let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
      let path = entry.path();

      if path.is_dir() {
         if let Some(name) = path.file_name() {
            if let Some(name_str) = name.to_str() {
               extensions.push(name_str.to_string());
            }
         }
      }
   }

   Ok(extensions)
}

fn get_extensions_dir() -> Result<PathBuf, String> {
   // Get app data directory
   let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
   let app_data_dir = home_dir.join(".athas");

   // Create app data directory if it doesn't exist
   fs::create_dir_all(&app_data_dir)
      .map_err(|e| format!("Failed to create app data directory: {}", e))?;

   // Create extensions directory
   let extensions_dir = app_data_dir.join("extensions");
   fs::create_dir_all(&extensions_dir)
      .map_err(|e| format!("Failed to create extensions directory: {}", e))?;

   Ok(extensions_dir)
}

#[command]
pub fn get_bundled_extensions_path() -> Result<String, String> {
   // Get current working directory
   let mut cwd =
      env::current_dir().map_err(|e| format!("Failed to get current directory: {}", e))?;

   // If we're in src-tauri directory, go up one level to project root
   if cwd.ends_with("src-tauri") {
      cwd.pop();
   }

   // Build path to bundled extensions
   let extensions_path = cwd.join("src").join("extensions").join("bundled");

   log::info!("Bundled extensions path: {:?}", extensions_path);

   Ok(extensions_path
      .to_str()
      .ok_or("Failed to convert path to string")?
      .to_string())
}
