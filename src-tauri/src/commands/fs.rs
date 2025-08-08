use std::{fs, path::Path};
use tauri::command;
use walkdir::WalkDir;

#[command]
pub fn rename_file(source_path: String, target_path: String) -> Result<(), String> {
   let source = Path::new(&source_path);
   let target = Path::new(&target_path);

   if !source.exists() {
      return Err("Source path does not exist".to_string());
   }

   if target.exists() {
      return Err("Target path already exists".to_string());
   }

   fs::rename(source, target).map_err(|e| format!("Failed to rename file: {}", e))?;

   Ok(())
}

#[command]
pub fn move_file(source_path: String, target_path: String) -> Result<(), String> {
   let source = Path::new(&source_path);
   let target = Path::new(&target_path);

   // Validate source exists
   if !source.exists() {
      return Err("Source path does not exist".to_string());
   }

   // Validate target doesn't exist
   if target.exists() {
      return Err("Target path already exists".to_string());
   }

   // Ensure target directory exists
   if let Some(parent) = target.parent()
      && !parent.exists()
   {
      return Err("Target directory does not exist".to_string());
   }

   // Check if source is a directory
   if source.is_dir() {
      // Prevent moving a directory into itself
      if target.starts_with(source) {
         return Err("Cannot move a directory into itself".to_string());
      }
   }

   // Try to rename (fast for same filesystem)
   match fs::rename(source, target) {
      Ok(()) => Ok(()),
      Err(rename_err) => {
         // If rename fails, we need different strategies for files vs directories
         if source.is_file() {
            // For files, try copy + delete
            match fs::copy(source, target) {
               Ok(_) => match fs::remove_file(source) {
                  Ok(()) => Ok(()),
                  Err(del_err) => Err(format!(
                     "File copied but failed to delete source: {}",
                     del_err
                  )),
               },
               Err(copy_err) => Err(format!(
                  "Failed to move file: {} (rename: {}, copy: {})",
                  rename_err, rename_err, copy_err
               )),
            }
         } else if source.is_dir() {
            // For directories, we need to recursively copy and then remove
            copy_dir_all(source, target)?;
            remove_dir_all(source)?;
            Ok(())
         } else {
            Err("Source is neither a file nor a directory".to_string())
         }
      }
   }
}

// Helper function to recursively copy a directory
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
   // Create the destination directory
   fs::create_dir_all(dst).map_err(|e| format!("Failed to create directory: {}", e))?;

   // Walk through all entries in the source directory
   for entry in WalkDir::new(src).min_depth(1) {
      let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
      let src_path = entry.path();

      // Calculate the relative path and create the destination path
      let relative_path = src_path
         .strip_prefix(src)
         .map_err(|e| format!("Failed to get relative path: {}", e))?;
      let dst_path = dst.join(relative_path);

      if entry.file_type().is_dir() {
         // Create directory
         fs::create_dir_all(&dst_path).map_err(|e| format!("Failed to create directory: {}", e))?;
      } else {
         // Copy file
         fs::copy(src_path, &dst_path).map_err(|e| format!("Failed to copy file: {}", e))?;
      }
   }

   Ok(())
}

// Helper function to recursively remove a directory
fn remove_dir_all(path: &Path) -> Result<(), String> {
   fs::remove_dir_all(path).map_err(|e| format!("Failed to remove directory: {}", e))
}
