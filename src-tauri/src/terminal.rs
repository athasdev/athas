use crate::app_runtime::AppHandle;
use athas_terminal::{
   TerminalConfig, TerminalEvent, TerminalEventHandler, TerminalInput, TerminalManager,
   TerminalSize, shell::Shell,
};
use std::sync::Arc;
use tauri::{State, ipc::Channel};

#[tauri::command]
pub async fn create_terminal(
   mut config: TerminalConfig,
   on_event: Channel<TerminalEvent>,
   app_handle: AppHandle,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<String, String> {
   config.term_program_version = Some(app_handle.package_info().version.to_string());
   let event_handler: TerminalEventHandler = Arc::new(move |_, event| on_event.send(event).is_ok());
   terminal_manager
      .create_terminal(config, event_handler)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_write(
   id: String,
   input: TerminalInput,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .write_to_terminal(&id, input)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_resize(
   id: String,
   size: TerminalSize,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .resize_terminal(&id, size)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_set_paused(
   id: String,
   paused: bool,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .set_terminal_paused(&id, paused)
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

#[tauri::command]
pub fn list_shells() -> Vec<Shell> {
   athas_terminal::get_shells()
}

pub use athas_terminal::TerminalManager as ManagedTerminalManager;
