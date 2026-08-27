#[cfg(not(target_os = "linux"))]
use crate::menu;
use crate::{
   app_runtime::AthasRuntime,
   commands::{self, FffSearchState, FileClipboard, ThemeCache},
   file_events::TauriFileChangeEmitter,
   terminal::{FrontendTerminalSessions, ManagedTerminalManager as TerminalManager},
};
use athas_ai::{AcpAgentBridge, CodexAppServer};
use athas_debugger::DebugManager;
use athas_lsp::LspManager;
use athas_project::FileWatcher;
use log::{debug, info};
use serde::Serialize;
use std::{path::PathBuf, sync::Arc, time::Instant};
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri_plugin_os::platform;
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

pub fn configure_app(app: &mut tauri::App<AthasRuntime>) -> Result<(), Box<dyn std::error::Error>> {
   app.state::<commands::ui::StartupTiming>()
      .record("native:setup:start");
   #[cfg(all(target_os = "linux", feature = "linux"))]
   create_initial_linux_window(app)?;
   configure_menu(app)?;
   #[cfg(target_os = "macos")]
   if let Err(error) = crate::bootstrap::macos::install_dock_menu(app.handle()) {
      log::warn!("Failed to install macOS Dock menu: {error}");
   } else {
      log::info!("macOS Dock menu installed");
   }
   #[cfg(target_os = "macos")]
   if let Err(error) = crate::bootstrap::macos::install_accessibility_observer(app.handle()) {
      log::warn!("Failed to observe macOS accessibility display options: {error}");
   }
   #[cfg(target_os = "macos")]
   if let Err(error) = crate::bootstrap::macos::install_native_choice_sheet_handler() {
      log::warn!("Failed to install macOS native sheet handler: {error}");
   }
   #[cfg(target_os = "macos")]
   if let Err(error) = crate::bootstrap::macos::install_spotlight_activity_handler(app.handle()) {
      log::warn!("Failed to install macOS Spotlight activity handler: {error}");
   }
   #[cfg(target_os = "macos")]
   if let Err(error) = crate::bootstrap::macos::install_services_provider(app.handle()) {
      log::warn!("Failed to install macOS Services provider: {error}");
   }
   register_managed_state(app);
   emit_cli_open_requests(app);
   configure_initial_window(app);

   #[cfg(all(unix, not(target_os = "macos")))]
   commands::development::cli::auto_fix_cli_on_startup();

   app.on_menu_event(handle_menu_event);
   app.state::<commands::ui::StartupTiming>()
      .record("native:setup:complete");

   Ok(())
}

#[cfg(all(target_os = "linux", feature = "linux"))]
fn create_initial_linux_window(
   app: &tauri::App<AthasRuntime>,
) -> Result<(), Box<dyn std::error::Error>> {
   let config = app
      .config()
      .app
      .windows
      .iter()
      .find(|window| window.label == "main")
      .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "main window config"))?;

   tauri::WebviewWindowBuilder::from_config(app.handle(), config)?
      .browser_runtime_style(tauri_runtime_cef::RuntimeStyle::Alloy)
      .build()?;

   Ok(())
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn configure_menu(app: &mut tauri::App<AthasRuntime>) -> Result<(), Box<dyn std::error::Error>> {
   let store = app.store("settings.json")?;
   store.set("nativeMenuBar", false);
   let _ = store.save();
   Ok(())
}

#[cfg(target_os = "macos")]
fn configure_menu(app: &mut tauri::App<AthasRuntime>) -> Result<(), Box<dyn std::error::Error>> {
   let store = app.store("settings.json")?;
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

   Ok(())
}

fn register_managed_state(app: &mut tauri::App<AthasRuntime>) {
   log::info!("Starting app!");

   app.manage(Arc::new(FileWatcher::new(Arc::new(
      TauriFileChangeEmitter::new(app.handle().clone()),
   ))));

   let terminal_manager = Arc::new(TerminalManager::new());
   app.manage(terminal_manager.clone());
   app.manage(FrontendTerminalSessions::default());

   let acp_bridge = Arc::new(Mutex::new(AcpAgentBridge::new(
      app.handle().clone(),
      terminal_manager,
   )));
   app.manage(acp_bridge);
   app.manage(CodexAppServer::new(app.handle().clone()));

   app.manage(LspManager::new(app.handle().clone()));
   app.manage(DebugManager::new(app.handle().clone()));
   app.manage(ThemeCache::new(std::collections::HashMap::new()));
   app.manage(FileClipboard::new(None));
   app.manage(FffSearchState::new());
   app.manage(commands::development::docker::DockerLogStreams::default());
   app.manage(commands::development::cli_args::PendingCliOpenRequests::default());
}

fn emit_cli_open_requests(app: &tauri::App<AthasRuntime>) {
   let cwd = std::env::current_dir().unwrap_or_default();
   let args: Vec<String> = std::env::args().collect();
   let open_requests = commands::development::cli_args::parse_cli_argv(&args, &cwd);

   if open_requests.is_empty() {
      return;
   }

   log::info!(
      "Queued {} CLI open request(s) for frontend",
      open_requests.len()
   );
   app.state::<commands::development::cli_args::PendingCliOpenRequests>()
      .push_all(open_requests);
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

      queue_cli_requests(&app_handle, open_requests);
   });
}

fn queue_cli_requests(
   app_handle: &tauri::AppHandle<AthasRuntime>,
   open_requests: Vec<commands::development::cli_args::CliRequest>,
) {
   if open_requests.is_empty() {
      return;
   }

   let request_count = open_requests.len();
   app_handle
      .state::<commands::development::cli_args::PendingCliOpenRequests>()
      .push_all(open_requests);

   if let Err(error) = app_handle.emit("cli_open_requests_pending", ()) {
      log::error!("Failed to signal pending open requests: {error}");
   } else {
      log::info!("Queued {request_count} open request(s) for frontend");
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

#[cfg(target_os = "macos")]
pub fn handle_reopen(app: &tauri::AppHandle<AthasRuntime>, has_visible_windows: bool) {
   if get_active_webview_window(app).is_some() {
      log::info!("[macos:reopen] focusing existing window visible={has_visible_windows}");
      focus_active_window(app);
      return;
   }

   log::info!("[macos:reopen] creating window visible={has_visible_windows}");
   if let Err(error) = commands::ui::window::create_app_window_internal(app, None) {
      log::error!("Failed to create window after macOS reopen event: {error}");
   }
}

#[cfg(target_os = "macos")]
pub fn handle_opened_urls(app: &tauri::AppHandle<AthasRuntime>, urls: &[tauri::Url]) {
   let open_requests = commands::development::cli_args::parse_opened_urls(urls);
   if open_requests.is_empty() {
      return;
   }

   for request in &open_requests {
      if let commands::development::cli_args::CliRequest::Path { path, .. } = request
         && let Err(error) =
            crate::bootstrap::macos::note_recent_document(PathBuf::from(path).as_path())
      {
         log::warn!("Failed to register macOS recent document: {error}");
      }
   }

   if get_active_webview_window(app).is_none()
      && let Err(error) = commands::ui::window::create_app_window_internal(app, None)
   {
      log::error!("Failed to create window for macOS open event: {error}");
      return;
   }

   focus_active_window(app);
   queue_cli_requests(app, open_requests);

   if let Err(error) = menu::refresh_open_recent_submenu(app) {
      log::warn!("Failed to refresh macOS Open Recent menu: {error}");
   }
}

#[cfg(target_os = "macos")]
fn open_recent_document(app: &tauri::AppHandle<AthasRuntime>, index: usize) {
   let Ok(paths) = crate::bootstrap::macos::recent_documents() else {
      return;
   };
   let Some(path) = paths.get(index) else {
      return;
   };
   let Some(request) = commands::development::cli_args::parse_open_arg(
      path.to_string_lossy().as_ref(),
      PathBuf::from("/").as_path(),
   ) else {
      return;
   };

   focus_active_window(app);
   queue_cli_requests(app, vec![request.into()]);
}

fn command_id_for_menu_event(event_id: &str) -> Option<&'static str> {
   match event_id {
      "command_new_tab" => Some("workbench.newTab"),
      "command_reopen_closed_tab" => Some("file.reopenClosed"),
      "command_close_all_tabs" => Some("file.closeAll"),
      "command_close_other_tabs" => Some("file.closeOthers"),
      "command_close_saved_tabs" => Some("file.closeSaved"),
      "command_close_tabs_to_left" => Some("file.closeTabsToLeft"),
      "command_close_tabs_to_right" => Some("file.closeTabsToRight"),
      "command_save_all" => Some("file.saveAll"),
      "command_revert_file" => Some("file.revert"),
      "command_local_history" => Some("file.localHistory"),
      "command_format_document" => Some("editor.formatDocument"),
      "command_format_selection" => Some("editor.formatSelection"),
      "command_quick_fix" => Some("editor.quickFix"),
      "command_show_hover" => Some("editor.showHover"),
      "command_trigger_parameter_hints" => Some("editor.triggerParameterHints"),
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
      "command_toggle_minimap" => Some("workbench.toggleMinimap"),
      "command_toggle_word_wrap" => Some("editor.toggleWordWrap"),
      "command_toggle_line_numbers" => Some("editor.toggleLineNumbers"),
      "command_toggle_render_whitespace" => Some("editor.toggleRenderWhitespace"),
      "command_zoom_in" => Some("workbench.zoomIn"),
      "command_zoom_out" => Some("workbench.zoomOut"),
      "command_zoom_reset" => Some("workbench.zoomReset"),
      "command_keyboard_shortcuts" => Some("workbench.openKeyboardShortcuts"),
      "command_help_keyboard_shortcuts" => Some("workbench.openKeyboardShortcuts"),
      "command_go_back" => Some("navigation.goBack"),
      "command_go_forward" => Some("navigation.goForward"),
      "command_go_to_definition" => Some("editor.goToDefinition"),
      "command_go_to_implementation" => Some("editor.goToImplementation"),
      "command_go_to_type_definition" => Some("editor.goToTypeDefinition"),
      "command_go_to_references" => Some("editor.goToReferences"),
      "command_rename_symbol" => Some("editor.renameSymbol"),
      "command_new_terminal" => Some("terminal.new"),
      "command_split_terminal" => Some("terminal.split"),
      "command_split_terminal_down" => Some("terminal.splitDown"),
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

fn emit_menu_event<P>(window: &tauri::WebviewWindow<AthasRuntime>, event: &str, payload: P)
where
   P: Serialize + Clone,
{
   let _ = window.emit_to(window.label(), event, payload);
}

fn perform_macos_window_tab_action(window: &tauri::WebviewWindow<AthasRuntime>, action: &str) {
   #[cfg(target_os = "macos")]
   match window.ns_window() {
      Ok(ns_window) => {
         if let Err(error) = crate::bootstrap::macos::perform_window_tab_action(ns_window, action) {
            log::error!("Failed to perform macOS window tab action: {error}");
         }
      }
      Err(error) => log::error!("Failed to access macOS window: {error}"),
   }

   #[cfg(not(target_os = "macos"))]
   let _ = (window, action);
}

fn handle_menu_event(app_handle: &tauri::AppHandle<AthasRuntime>, event: tauri::menu::MenuEvent) {
   let event_id = event.id().0.as_str();

   #[cfg(target_os = "macos")]
   if event_id == "clear_recent_documents" {
      if let Err(error) = crate::bootstrap::macos::clear_recent_documents() {
         log::error!("Failed to clear macOS recent documents: {error}");
      } else if let Err(error) = menu::refresh_open_recent_submenu(app_handle) {
         log::error!("Failed to refresh macOS Open Recent menu: {error}");
      }
      return;
   }

   #[cfg(target_os = "macos")]
   if let Some(index) = event_id
      .strip_prefix("open_recent:")
      .and_then(|index| index.parse::<usize>().ok())
   {
      open_recent_document(app_handle, index);
      return;
   }

   match event_id {
      "new_window" => {
         let received_at = Instant::now();
         log::info!("[window-open:menu] new_window:received");
         match commands::ui::window::create_app_window_internal(app_handle, None) {
            Ok(label) => log::info!(
               "[window-open:{label}] menu:create:end totalMs={}",
               received_at.elapsed().as_millis()
            ),
            Err(error) => {
               log::error!(
                  "[window-open:menu] new_window:error totalMs={} error={}",
                  received_at.elapsed().as_millis(),
                  error
               );
            }
         }
      }
      event_id => {
         if let Some(window) = get_active_webview_window(app_handle) {
            match event_id {
               "quit" => {
                  info!("Quit menu item clicked");
                  emit_menu_event(&window, "menu_quit_app", ());
               }
               "quit_app" => {
                  info!("Quit app menu item triggered");
                  emit_menu_event(&window, "menu_quit_app", ());
               }
               "new_file" => {
                  emit_menu_event(&window, "menu_new_file", ());
               }
               "open_folder" => {
                  emit_menu_event(&window, "menu_open_folder", ());
               }
               "close_folder" => {
                  emit_menu_event(&window, "menu_close_folder", ());
               }
               "save" => {
                  emit_menu_event(&window, "menu_save", ());
               }
               "save_as" => {
                  emit_menu_event(&window, "menu_save_as", ());
               }
               "close_tab" => {
                  debug!("Close tab menu item triggered");
                  emit_menu_event(&window, "menu_close_tab", ());
               }
               "close_window" => {
                  debug!("Close window menu item triggered");
                  emit_menu_event(&window, "menu_close_window", ());
               }
               "undo" => {
                  emit_menu_event(&window, "menu_undo", ());
               }
               "redo" => {
                  emit_menu_event(&window, "menu_redo", ());
               }
               "select_all" => {
                  emit_menu_event(&window, "menu_select_all", ());
               }
               "find" => {
                  emit_menu_event(&window, "menu_find", ());
               }
               "find_replace" => {
                  emit_menu_event(&window, "menu_find_replace", ());
               }
               "toggle_comment" => {
                  emit_menu_event(&window, "menu_toggle_comment", ());
               }
               "command_palette" => {
                  emit_menu_event(&window, "menu_command_palette", ());
               }
               "toggle_activity_sidebar" => {
                  emit_menu_event(&window, "menu_toggle_activity_sidebar", ());
               }
               "toggle_sidebar" => {
                  emit_menu_event(&window, "menu_toggle_sidebar", ());
               }
               "toggle_terminal" => {
                  emit_menu_event(&window, "menu_toggle_terminal", ());
               }
               "open_github_notifications" => {
                  emit_menu_event(&window, "menu_open_github_notifications", ());
               }
               "split_editor" => {
                  emit_menu_event(&window, "menu_split_editor", ());
               }
               "toggle_menu_bar" => {
                  #[cfg(target_os = "linux")]
                  {
                     if let Ok(store) = app_handle.store("settings.json") {
                        store.set("nativeMenuBar", false);
                        let _ = store.save();
                     }
                     log::info!("Native menu bar is disabled on Linux");
                  }

                  #[cfg(not(target_os = "linux"))]
                  {
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
               }
               "toggle_vim" => {
                  emit_menu_event(&window, "menu_toggle_vim", ());
               }
               "quick_open" => {
                  emit_menu_event(&window, "menu_quick_open", ());
               }
               "next_tab" => {
                  emit_menu_event(&window, "menu_next_tab", ());
               }
               "show_previous_window_tab" => {
                  perform_macos_window_tab_action(&window, "previous");
               }
               "show_next_window_tab" => {
                  perform_macos_window_tab_action(&window, "next");
               }
               "move_window_tab" => {
                  perform_macos_window_tab_action(&window, "move");
               }
               "merge_all_windows" => {
                  perform_macos_window_tab_action(&window, "merge");
               }
               "prev_tab" => {
                  emit_menu_event(&window, "menu_prev_tab", ());
               }
               command_event_id if command_id_for_menu_event(command_event_id).is_some() => {
                  let command_id = command_id_for_menu_event(command_event_id).unwrap();
                  emit_menu_event(&window, "menu_execute_command", command_id);
               }
               "open_web_inspector" => {
                  #[cfg(any(debug_assertions, feature = "devtools"))]
                  {
                     if window.is_devtools_open() {
                        window.close_devtools();
                     }
                     window.open_devtools();
                  }
               }
               "documentation" => {
                  emit_menu_event(&window, "menu_documentation", ());
               }
               "changelog" => {
                  emit_menu_event(&window, "menu_changelog", ());
               }
               "whats_new" => {
                  emit_menu_event(&window, "menu_whats_new", ());
               }
               "report_bug" => {
                  emit_menu_event(&window, "menu_report_bug", ());
               }
               "request_feature" => {
                  emit_menu_event(&window, "menu_request_feature", ());
               }
               "check_updates" => {
                  emit_menu_event(&window, "menu_check_updates", ());
               }
               "open_settings" => {
                  emit_menu_event(&window, "menu_open_settings", ());
               }
               "open_extensions" => {
                  emit_menu_event(&window, "menu_open_extensions", ());
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
                  emit_menu_event(&window, "menu_theme_change", theme_id);
               }
               _ => {}
            }
         }
      }
   }
}

pub(crate) fn shutdown_background_services(app_handle: &tauri::AppHandle<AthasRuntime>) {
   if let Some(codex) = app_handle.try_state::<CodexAppServer>() {
      let codex = codex.inner().clone();
      tauri::async_runtime::block_on(async move {
         codex.stop().await;
      });
   }

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
