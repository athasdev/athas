use crate::terminal::{TerminalConfig, TerminalManager};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn create_terminal_connection(
    config: TerminalConfig,
    terminal_manager: State<'_, Arc<TerminalManager>>,
    app_handle: AppHandle,
) -> Result<String, String> {
    terminal_manager
        .create_connection(config, app_handle)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_terminal_data(
    connection_id: String,
    data: String,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .send_data(&connection_id, &data)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_terminal(
    connection_id: String,
    lines: u16,
    cols: u16,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .resize_terminal(&connection_id, lines, cols)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_terminal_connection(
    connection_id: String,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .close_connection(&connection_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_terminal_ctrl_c(
    connection_id: String,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .send_data(&connection_id, "\x03") // Ctrl+C
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_terminal_ctrl_d(
    connection_id: String,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .send_data(&connection_id, "\x04") // Ctrl+D
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_available_terminal_types() -> Vec<String> {
    #[cfg(target_os = "windows")]
    let mut types = vec!["local".to_string(), "ssh".to_string()];
    #[cfg(not(target_os = "windows"))]
    let types = vec!["local".to_string(), "ssh".to_string()];

    #[cfg(target_os = "windows")]
    {
        // Check for Git Bash
        let git_bash_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
            "C:\\Git\\bin\\bash.exe",
        ];

        for path in &git_bash_paths {
            if std::path::Path::new(path).exists() {
                types.push("git-bash".to_string());
                break;
            }
        }

        // Check for WSL
        if std::process::Command::new("wsl")
            .arg("--status")
            .output()
            .is_ok()
        {
            types.push("wsl".to_string());
        }
    }

    types
}
