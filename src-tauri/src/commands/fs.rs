use std::fs;
use std::path::Path;
use tauri::command;
use walkdir::WalkDir;

#[derive(serde::Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[command]
pub fn read_directory_custom(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err("Directory does not exist".to_string());
    }

    if !dir_path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut entries = Vec::new();

    match fs::read_dir(dir_path) {
        Ok(dir_entries) => {
            for entry in dir_entries {
                match entry {
                    Ok(entry) => {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        let file_path = entry.path().to_string_lossy().to_string();
                        let is_directory = entry.path().is_dir();

                        entries.push(FileEntry {
                            name: file_name,
                            path: file_path,
                            is_dir: is_directory,
                        });
                    }
                    Err(e) => {
                        log::error!("Error reading entry: {e}");
                    }
                }
            }
        }
        Err(e) => {
            return Err(format!("Failed to read directory: {e}"));
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[command]
pub fn read_file_custom(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    if !file_path.is_file() {
        return Err("Path is not a file".to_string());
    }

    match fs::read_to_string(file_path) {
        Ok(content) => Ok(content),
        Err(e) => Err(format!("Failed to read file: {e}")),
    }
}

#[command]
pub fn write_file_custom(path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Path must not be empty".to_string());
    }

    let file_path = Path::new(&path);

    match fs::write(file_path, content) {
        Ok(()) => Ok(()),
        Err(e) => Err(format!("Failed to write file: {e}")),
    }
}

#[command]
pub fn create_directory_custom(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Path must not be empty".to_string());
    }

    let dir_path = Path::new(&path);

    match fs::create_dir_all(dir_path) {
        Ok(()) => Ok(()),
        Err(e) => Err(format!("Failed to create directory: {e}")),
    }
}

#[command]
pub fn delete_path_custom(path: String) -> Result<(), String> {
    let target_path = Path::new(&path);

    if !target_path.exists() {
        return Err("Path does not exist".to_string());
    }

    if target_path.is_dir() {
        match fs::remove_dir_all(target_path) {
            Ok(()) => Ok(()),
            Err(e) => Err(format!("Failed to delete directory: {e}")),
        }
    } else {
        match fs::remove_file(target_path) {
            Ok(()) => Ok(()),
            Err(e) => Err(format!("Failed to delete file: {e}")),
        }
    }
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
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            return Err("Target directory does not exist".to_string());
        }
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
            fs::create_dir_all(&dst_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
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

#[command]
pub fn copy_external_file(
    source_path: String,
    target_dir: String,
    file_name: String,
) -> Result<(), String> {
    let source = Path::new(&source_path);
    let target_dir_path = Path::new(&target_dir);

    // Sanitize file name to prevent path traversal
    if file_name.contains("..") || file_name.contains("/") || file_name.contains("\\") {
        return Err("Invalid file name".to_string());
    }

    let target = target_dir_path.join(&file_name);

    // Validate source file
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    if !source.is_file() {
        return Err("Source path is not a file".to_string());
    }

    // Validate target directory
    if !target_dir_path.exists() {
        return Err("Target directory does not exist".to_string());
    }

    if !target_dir_path.is_dir() {
        return Err("Target path is not a directory".to_string());
    }

    // Check if target already exists
    if target.exists() {
        return Err(format!(
            "File {} already exists in target directory",
            file_name
        ));
    }

    // Perform the copy
    match fs::copy(source, target) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to copy file: {}", e)),
    }
}
