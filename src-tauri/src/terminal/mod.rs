pub mod config;
pub mod connection;
pub mod manager;
pub mod shell;

// Re-export public types
pub use config::TerminalConfig;
pub use manager::TerminalManager;
pub use shell::get_shells;
// Tauri commands
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn create_terminal(
   config: TerminalConfig,
   app_handle: AppHandle,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<String, String> {
   terminal_manager
      .create_terminal(config, app_handle)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_write(
   id: String,
   data: String,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .write_to_terminal(&id, &data)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_resize(
   id: String,
   rows: u16,
   cols: u16,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .resize_terminal(&id, rows, cols)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_terminal(
   id: String,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .close_terminal(&id)
      .map_err(|e| e.to_string())
}
