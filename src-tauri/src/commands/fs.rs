use std::fs;
use std::path::Path;
use tauri::command;

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
    let file_path = Path::new(&path);

    match fs::write(file_path, content) {
        Ok(()) => Ok(()),
        Err(e) => Err(format!("Failed to write file: {e}")),
    }
}

#[command]
pub fn create_directory_custom(path: String) -> Result<(), String> {
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
