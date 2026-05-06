use crate::{
   app_runtime::AthasRuntime,
   commands::{self, FffSearchState, FileClipboard, ThemeCache},
   file_events::TauriFileChangeEmitter,
   menu,
   terminal::ManagedTerminalManager as TerminalManager,
};
use athas_ai::AcpAgentBridge;
use athas_debugger::DebugManager;
use athas_lsp::LspManager;
use athas_project::FileWatcher;
use log::{debug, info};
use std::{path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_os::platform;
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

pub fn configure_app(app: &mut tauri::App<AthasRuntime>) -> Result<(), Box<dyn std::error::Error>> {
   configure_menu(app)?;
   register_managed_state(app);
   emit_cli_open_requests(app);
   configure_initial_window(app);

   #[cfg(all(unix, not(target_os = "macos")))]
   commands::development::cli::auto_fix_cli_on_startup();

   app.on_menu_event(handle_menu_event);

   Ok(())
}

fn configure_menu(app: &mut tauri::App<AthasRuntime>) -> Result<(), Box<dyn std::error::Error>> {
   let store = app.store("settings.json")?;

   #[cfg(target_os = "windows")]
   {
      store.set("nativeMenuBar", false);
      let _ = store.save();
      return Ok(());
   }

   #[cfg(not(target_os = "windows"))]
   {
      let native_menu_bar = store
         .get("nativeMenuBar")
         .and_then(|v| v.as_bool())
         .unwrap_or_else(|| {
            let default = platform() == "macos";
            store.set("nativeMenuBar", default);
            default
         });

      if native_menu_bar {
         let menu = menu::create_menu(app.handle())?;
         app.set_menu(menu)?;
      }
   }

   Ok(())
}

fn register_managed_state(app: &mut tauri::App<AthasRuntime>) {
   log::info!("Starting app!");

   app.manage(Arc::new(FileWatcher::new(Arc::new(
      TauriFileChangeEmitter::new(app.handle().clone()),
   ))));

   let terminal_manager = Arc::new(TerminalManager::new());
   app.manage(terminal_manager.clone());

   let acp_bridge = Arc::new(Mutex::new(AcpAgentBridge::new(
      app.handle().clone(),
      terminal_manager,
   )));
   app.manage(acp_bridge);

   app.manage(LspManager::new(app.handle().clone()));
   app.manage(DebugManager::new(app.handle().clone()));
   app.manage(ThemeCache::new(std::collections::HashMap::new()));
   app.manage(FileClipboard::new(None));
   app.manage(FffSearchState::new());
}

fn emit_cli_open_requests(app: &tauri::App<AthasRuntime>) {
   let cwd = std::env::current_dir().unwrap_or_default();
   let args: Vec<String> = std::env::args().collect();
   let open_requests = commands::development::cli_args::parse_cli_argv(&args, &cwd);

   if open_requests.is_empty() {
      return;
   }

   let app_handle = app.handle().clone();
   tauri::async_runtime::spawn(async move {
      tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
      emit_cli_requests_to_frontend(&app_handle, open_requests);
   });
}

pub fn handle_single_instance_open(
   app_handle: &tauri::AppHandle<AthasRuntime>,
   args: Vec<String>,
   cwd: String,
) {
   let cwd = PathBuf::from(cwd);
   let open_requests = commands::development::cli_args::parse_cli_argv(&args, &cwd);
   let app_handle = app_handle.clone();

   tauri::async_runtime::spawn(async move {
      focus_active_window(&app_handle);

      if open_requests.is_empty() {
         return;
      }

      emit_cli_requests_to_frontend(&app_handle, open_requests);
   });
}

fn emit_cli_requests_to_frontend(
   app_handle: &tauri::AppHandle<AthasRuntime>,
   open_requests: Vec<commands::development::cli_args::CliRequest>,
) {
   for req in open_requests {
      if let Err(e) = app_handle.emit("cli_open_request", &req) {
         log::error!("Failed to emit cli_open_request: {}", e);
      }
   }
}

fn configure_initial_window(app: &tauri::App<AthasRuntime>) {
   if let Some(window) = app.get_webview_window("main") {
      commands::ui::window::configure_app_window(&window);
   }
}

fn get_active_webview_window(
   app: &tauri::AppHandle<AthasRuntime>,
) -> Option<tauri::WebviewWindow<AthasRuntime>> {
   app.get_focused_window()
      .and_then(|window| app.get_webview_window(window.label()))
      .or_else(|| app.get_webview_window("main"))
      .or_else(|| app.webview_windows().into_values().next())
}

fn focus_active_window(app: &tauri::AppHandle<AthasRuntime>) {
   if let Some(window) = get_active_webview_window(app) {
      let _ = window.unminimize();
      let _ = window.show();
      let _ = window.set_focus();
   }
}

fn command_id_for_menu_event(event_id: &str) -> Option<&'static str> {
   match event_id {
      "command_new_tab" => Some("workbench.newTab"),
      "command_reopen_closed_tab" => Some("file.reopenClosed"),
      "command_close_all_tabs" => Some("file.closeAll"),
      "command_local_history" => Some("file.localHistory"),
      "command_format_document" => Some("editor.formatDocument"),
      "command_duplicate_line" => Some("editor.duplicateLine"),
      "command_delete_line" => Some("editor.deleteLine"),
      "command_move_line_up" => Some("editor.moveLineUp"),
      "command_move_line_down" => Some("editor.moveLineDown"),
      "command_global_search" => Some("workbench.showGlobalSearch"),
      "command_diagnostics" => Some("workbench.toggleDiagnostics"),
      "command_file_explorer" => Some("workbench.showFileExplorer"),
      "command_source_control" => Some("workbench.showSourceControl"),
      "command_github" => Some("workbench.showGitHub"),
      "command_debugger" => Some("workbench.showDebugger"),
      "command_toggle_sidebar_position" => Some("workbench.toggleSidebarPosition"),
      "command_toggle_minimap" => Some("workbench.toggleMinimap"),
      "command_zoom_in" => Some("workbench.zoomIn"),
      "command_zoom_out" => Some("workbench.zoomOut"),
      "command_zoom_reset" => Some("workbench.zoomReset"),
      "command_keyboard_shortcuts" => Some("workbench.openKeyboardShortcuts"),
      "command_help_keyboard_shortcuts" => Some("workbench.openKeyboardShortcuts"),
      "command_go_back" => Some("navigation.goBack"),
      "command_go_forward" => Some("navigation.goForward"),
      "command_go_to_definition" => Some("editor.goToDefinition"),
      "command_go_to_references" => Some("editor.goToReferences"),
      "command_rename_symbol" => Some("editor.renameSymbol"),
      "command_new_terminal" => Some("terminal.new"),
      "command_split_terminal" => Some("terminal.split"),
      "command_close_terminal" => Some("terminal.close"),
      "command_start_debugging" => Some("debug.start"),
      "command_stop_debugging" => Some("debug.stop"),
      "command_toggle_breakpoint" => Some("debug.toggleBreakpoint"),
      "command_new_agent" => Some("workbench.agentLauncher"),
      "command_inline_edit" => Some("editor.inlineEdit"),
      "command_connect_database" => Some("database.connect"),
      _ => None,
   }
}

fn handle_menu_event(app_handle: &tauri::AppHandle<AthasRuntime>, event: tauri::menu::MenuEvent) {
   match event.id().0.as_str() {
      "new_window" => {
         let app_handle = app_handle.clone();
         std::thread::spawn(move || {
            if let Err(error) = commands::ui::window::create_app_window_internal(&app_handle, None)
            {
               log::error!("Failed to create app window from menu: {}", error);
            }
         });
      }
      event_id => {
         if let Some(window) = get_active_webview_window(app_handle) {
            match event_id {
               "quit" => {
                  info!("Quit menu item clicked");
                  let _ = window.emit("menu_quit_app", ());
               }
               "quit_app" => {
                  info!("Quit app menu item triggered");
                  let _ = window.emit("menu_quit_app", ());
               }
               "new_file" => {
                  let _ = window.emit("menu_new_file", ());
               }
               "open_folder" => {
                  let _ = window.emit("menu_open_folder", ());
               }
               "close_folder" => {
                  let _ = window.emit("menu_close_folder", ());
               }
               "save" => {
                  let _ = window.emit("menu_save", ());
               }
               "save_as" => {
                  let _ = window.emit("menu_save_as", ());
               }
               "close_tab" => {
                  debug!("Close tab menu item triggered");
                  let _ = window.emit("menu_close_tab", ());
               }
               "undo" => {
                  let _ = window.emit("menu_undo", ());
               }
               "redo" => {
                  let _ = window.emit("menu_redo", ());
               }
               "find" => {
                  let _ = window.emit("menu_find", ());
               }
               "find_replace" => {
                  let _ = window.emit("menu_find_replace", ());
               }
               "toggle_comment" => {
                  let _ = window.emit("menu_toggle_comment", ());
               }
               "command_palette" => {
                  let _ = window.emit("menu_command_palette", ());
               }
               "toggle_sidebar" => {
                  let _ = window.emit("menu_toggle_sidebar", ());
               }
               "toggle_terminal" => {
                  let _ = window.emit("menu_toggle_terminal", ());
               }
               "toggle_ai_chat" => {
                  let _ = window.emit("menu_toggle_ai_chat", ());
               }
               "split_editor" => {
                  let _ = window.emit("menu_split_editor", ());
               }
               "toggle_menu_bar" => {
                  let current_menu = app_handle.menu();
                  if current_menu.is_some() {
                     if let Err(e) = app_handle.remove_menu() {
                        log::error!("Failed to hide menu: {}", e);
                     } else {
                        if let Ok(store) = app_handle.store("settings.json") {
                           store.set("nativeMenuBar", false);
                           let _ = store.save();
                        }
                        log::info!("Menu bar hidden");
                     }
                  } else {
                     match menu::create_menu(app_handle) {
                        Ok(new_menu) => {
                           if let Err(e) = app_handle.set_menu(new_menu) {
                              log::error!("Failed to show menu: {}", e);
                           } else {
                              if let Ok(store) = app_handle.store("settings.json") {
                                 store.set("nativeMenuBar", true);
                                 let _ = store.save();
                              }
                              log::info!("Menu bar shown");
                           }
                        }
                        Err(e) => {
                           log::error!("Failed to create menu: {}", e);
                        }
                     }
                  }
               }
               "toggle_vim" => {
                  let _ = window.emit("menu_toggle_vim", ());
               }
               "quick_open" => {
                  let _ = window.emit("menu_quick_open", ());
               }
               "go_to_line" => {
                  let _ = window.emit("menu_go_to_line", ());
               }
               "next_tab" => {
                  let _ = window.emit("menu_next_tab", ());
               }
               "prev_tab" => {
                  let _ = window.emit("menu_prev_tab", ());
               }
               command_event_id if command_id_for_menu_event(command_event_id).is_some() => {
                  let command_id = command_id_for_menu_event(command_event_id).unwrap();
                  let _ = window.emit("menu_execute_command", command_id);
               }
               "documentation" => {
                  let _ = window.emit("menu_documentation", ());
               }
               "changelog" => {
                  let _ = window.emit("menu_changelog", ());
               }
               "whats_new" => {
                  let _ = window.emit("menu_whats_new", ());
               }
               "report_bug" => {
                  let _ = window.emit("menu_report_bug", ());
               }
               "request_feature" => {
                  let _ = window.emit("menu_request_feature", ());
               }
               "check_updates" => {
                  let _ = window.emit("menu_check_updates", ());
               }
               "open_settings" => {
                  let _ = window.emit("menu_open_settings", ());
               }
               "open_extensions" => {
                  let _ = window.emit("menu_open_extensions", ());
               }
               "minimize_window" => {
                  if let Err(e) = window.minimize() {
                     log::error!("Failed to minimize window: {}", e);
                  }
               }
               "maximize_window" => {
                  if let Err(e) = window.maximize() {
                     log::error!("Failed to maximize window: {}", e);
                  }
               }
               "toggle_fullscreen" => {
                  let is_fullscreen = window.is_fullscreen().unwrap_or(false);
                  if let Err(e) = window.set_fullscreen(!is_fullscreen) {
                     log::error!("Failed to toggle fullscreen: {}", e);
                  }
               }
               theme_id if theme_id.contains('-') => {
                  let _ = window.emit("menu_theme_change", theme_id);
               }
               _ => {}
            }
         }
      }
   }
}

pub(crate) fn shutdown_background_services(app_handle: &tauri::AppHandle<AthasRuntime>) {
   if let Some(acp_bridge) = app_handle.try_state::<Arc<Mutex<AcpAgentBridge>>>() {
      let acp_bridge = acp_bridge.inner().clone();
      tauri::async_runtime::block_on(async move {
         let bridge = acp_bridge.lock().await;
         if let Err(error) = bridge.stop_agent().await {
            log::debug!("ACP shutdown returned error: {}", error);
         }
      });
   }

   if let Some(lsp_manager) = app_handle.try_state::<LspManager>() {
      lsp_manager.shutdown();
   }

   if let Some(terminal_manager) = app_handle.try_state::<Arc<TerminalManager>>() {
      terminal_manager.close_all();
   }
}
