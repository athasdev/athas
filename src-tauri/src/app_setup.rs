use crate::{
   commands::{self, FffSearchState, FileClipboard, ThemeCache},
   file_events::TauriFileChangeEmitter,
   menu,
   terminal::ManagedTerminalManager as TerminalManager,
};
use athas_ai::AcpAgentBridge;
use athas_database::ConnectionManager;
use athas_debugger::DebugManager;
use athas_lsp::LspManager;
use athas_project::FileWatcher;
use log::{debug, info};
use std::sync::Arc;
use tauri::{Emitter, Manager, Wry};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_os::platform;
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

pub fn configure_app(app: &mut tauri::App<Wry>) -> Result<(), Box<dyn std::error::Error>> {
   configure_menu(app)?;
   register_managed_state(app);
   emit_cli_open_requests(app);
   configure_initial_window(app);

   #[cfg(all(unix, not(target_os = "macos")))]
   commands::development::cli::auto_fix_cli_on_startup();

   app.on_menu_event(handle_menu_event);

   Ok(())
}

fn configure_menu(app: &mut tauri::App<Wry>) -> Result<(), Box<dyn std::error::Error>> {
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

fn register_managed_state(app: &mut tauri::App<Wry>) {
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
   app.manage(Arc::new(ConnectionManager::new()));
   app.manage(FffSearchState::new());
}

fn emit_cli_open_requests(app: &tauri::App<Wry>) {
   let cwd = std::env::current_dir().unwrap_or_default();
   let args: Vec<String> = std::env::args().skip(1).collect();
   let open_requests = commands::development::cli_args::parse_cli_args(&args, &cwd);

   if open_requests.is_empty() {
      return;
   }

   let app_handle = app.handle().clone();
   tauri::async_runtime::spawn(async move {
      tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
      for req in open_requests {
         if let Err(e) = app_handle.emit("cli_open_request", &req) {
            log::error!("Failed to emit cli_open_request: {}", e);
         }
      }
   });
}

fn configure_initial_window(app: &tauri::App<Wry>) {
   if let Some(window) = app.get_webview_window("main") {
      commands::ui::window::configure_app_window(&window);
   }
}

fn get_active_webview_window(app: &tauri::AppHandle<Wry>) -> Option<tauri::WebviewWindow<Wry>> {
   app.get_focused_window()
      .and_then(|window| app.get_webview_window(window.label()))
      .or_else(|| app.get_webview_window("main"))
      .or_else(|| app.webview_windows().into_values().next())
}

fn handle_menu_event(app_handle: &tauri::AppHandle<Wry>, event: tauri::menu::MenuEvent) {
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
                  std::process::exit(0);
               }
               "quit_app" => {
                  info!("Quit app menu item triggered");
                  std::process::exit(0);
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
                        log::info!("Menu bar hidden");
                     }
                  } else {
                     match menu::create_menu(app_handle) {
                        Ok(new_menu) => {
                           if let Err(e) = app_handle.set_menu(new_menu) {
                              log::error!("Failed to show menu: {}", e);
                           } else {
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
               "about" => {}
               "help" => {
                  let _ = window.emit("menu_help", ());
               }
               "report_bug" => {
                  let _ = window.emit("menu_report_bug", ());
               }
               "about_athas" => {
                  let _ = window.emit("menu_about_athas", ());
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
