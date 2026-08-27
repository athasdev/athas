use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, MenuItemKind, PredefinedMenuItem, WINDOW_SUBMENU_ID};
use tauri::menu::{CheckMenuItem, HELP_SUBMENU_ID, MenuBuilder, MenuItem, Submenu, SubmenuBuilder};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct ThemeData {
   pub id: String,
   pub name: String,
   pub category: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMenuState {
   pub close_folder_enabled: bool,
   pub save_enabled: bool,
   pub save_as_enabled: bool,
   pub activity_bar_visible: bool,
   pub sidebar_visible: bool,
   pub terminal_visible: bool,
   pub minimap_visible: bool,
   pub word_wrap: bool,
   pub line_numbers: bool,
   pub whitespace_visible: bool,
}

static LAST_NATIVE_MENU_STATE: LazyLock<Mutex<Option<NativeMenuState>>> =
   LazyLock::new(|| Mutex::new(None));

fn set_normal_menu_item_enabled<R: tauri::Runtime>(
   submenu: &Submenu<R>,
   id: &str,
   enabled: bool,
) -> Result<(), String> {
   if let Some(tauri::menu::MenuItemKind::MenuItem(item)) = submenu.get(id) {
      item
         .set_enabled(enabled)
         .map_err(|error| error.to_string())?;
   }
   Ok(())
}

fn set_normal_menu_item_text<R: tauri::Runtime>(
   submenu: &Submenu<R>,
   id: &str,
   text: &str,
) -> Result<(), String> {
   if let Some(tauri::menu::MenuItemKind::MenuItem(item)) = submenu.get(id) {
      item.set_text(text).map_err(|error| error.to_string())?;
   }
   Ok(())
}

fn set_check_menu_item<R: tauri::Runtime>(
   submenu: &Submenu<R>,
   id: &str,
   checked: bool,
) -> Result<(), String> {
   if let Some(tauri::menu::MenuItemKind::Check(item)) = submenu.get(id) {
      item
         .set_checked(checked)
         .map_err(|error| error.to_string())?;
   }
   Ok(())
}

fn apply_native_menu_state(
   app: &crate::app_runtime::AppHandle,
   state: &NativeMenuState,
) -> Result<(), String> {
   let Some(menu) = app.menu() else {
      return Ok(());
   };

   if let Some(tauri::menu::MenuItemKind::Submenu(file_menu)) = menu.get("file_menu") {
      set_normal_menu_item_enabled(&file_menu, "close_folder", state.close_folder_enabled)?;
      set_normal_menu_item_enabled(&file_menu, "save", state.save_enabled)?;
      set_normal_menu_item_enabled(&file_menu, "save_as", state.save_as_enabled)?;
   }

   if let Some(tauri::menu::MenuItemKind::Submenu(view_menu)) = menu.get("view_menu") {
      set_normal_menu_item_text(
         &view_menu,
         "toggle_activity_sidebar",
         if state.activity_bar_visible {
            "Hide Activity Bar"
         } else {
            "Show Activity Bar"
         },
      )?;
      set_normal_menu_item_text(
         &view_menu,
         "toggle_sidebar",
         if state.sidebar_visible {
            "Hide Sidebar"
         } else {
            "Show Sidebar"
         },
      )?;
      set_normal_menu_item_text(
         &view_menu,
         "toggle_terminal",
         if state.terminal_visible {
            "Hide Terminal"
         } else {
            "Show Terminal"
         },
      )?;
      set_check_menu_item(&view_menu, "command_toggle_minimap", state.minimap_visible)?;
      set_check_menu_item(&view_menu, "command_toggle_word_wrap", state.word_wrap)?;
      set_check_menu_item(
         &view_menu,
         "command_toggle_line_numbers",
         state.line_numbers,
      )?;
      set_check_menu_item(
         &view_menu,
         "command_toggle_render_whitespace",
         state.whitespace_visible,
      )?;
   }

   Ok(())
}

#[tauri::command]
pub fn sync_native_menu_state(
   app: crate::app_runtime::AppHandle,
   state: NativeMenuState,
) -> Result<(), String> {
   *LAST_NATIVE_MENU_STATE
      .lock()
      .map_err(|_| "Native menu state lock poisoned".to_string())? = Some(state.clone());
   apply_native_menu_state(&app, &state)
}

#[tauri::command]
pub async fn rebuild_menu_themes(
   app: crate::app_runtime::AppHandle,
   themes: Vec<ThemeData>,
) -> Result<(), String> {
   // Only rebuild menu if native menu bar is enabled
   if app.menu().is_some() {
      let new_menu = create_menu_with_themes(&app, Some(themes))
         .map_err(|e| format!("Failed to create menu: {}", e))?;
      app.set_menu(new_menu)
         .map_err(|e| format!("Failed to set menu: {}", e))?;
      if let Some(state) = LAST_NATIVE_MENU_STATE
         .lock()
         .map_err(|_| "Native menu state lock poisoned".to_string())?
         .clone()
      {
         apply_native_menu_state(&app, &state)?;
      }
   } else {
      log::info!("Native menu bar is disabled, skipping menu rebuild");
   }
   Ok(())
}

#[tauri::command]
pub async fn toggle_menu_bar(
   app: crate::app_runtime::AppHandle,
   toggle: Option<bool>,
) -> Result<(), String> {
   #[cfg(any(target_os = "windows", target_os = "linux"))]
   {
      let _ = toggle;

      if app.menu().is_some() {
         app.remove_menu()
            .map_err(|e| format!("Failed to hide menu: {}", e))?;
      }

      if let Ok(store) = app.store("settings.json") {
         store.set("nativeMenuBar", false);
         let _ = store.save();
      }

      log::info!("Native menu bar is disabled on this platform");
      Ok(())
   }

   #[cfg(not(any(target_os = "windows", target_os = "linux")))]
   {
      let is_menu_present = app.menu().is_some();
      let should_show_menu = match toggle {
         Some(t) => t,
         None => !is_menu_present,
      };

      if should_show_menu {
         // Show menu by recreating it
         let new_menu = create_menu_with_themes(&app, None)
            .map_err(|e| format!("Failed to create menu: {}", e))?;
         app.set_menu(new_menu)
            .map_err(|e| format!("Failed to show menu: {}", e))?;
         log::info!("Menu bar shown via command");

         // Update the store to persist the setting
         if let Ok(store) = app.store("settings.json") {
            store.set("nativeMenuBar", true);
            let _ = store.save();
         }
      } else {
         // Hide menu by setting it to None
         app.remove_menu()
            .map_err(|e| format!("Failed to hide menu: {}", e))?;
         log::info!("Menu bar hidden via command");

         // Update the store to persist the setting
         if let Ok(store) = app.store("settings.json") {
            store.set("nativeMenuBar", false);
            let _ = store.save();
         }
      }
      Ok(())
   }
}

fn build_theme_submenu<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
   themes: Option<Vec<ThemeData>>,
) -> Result<Submenu<R>, tauri::Error> {
   let mut theme_builder = SubmenuBuilder::new(app, "Theme");

   if let Some(theme_list) = themes {
      // Add all themes without grouping
      for theme in &theme_list {
         theme_builder = theme_builder.text(&theme.id, &theme.name);
      }
   } else {
      // Fallback to hardcoded themes if none provided
      theme_builder = theme_builder
         .text("one-light", "One Light")
         .text("one-dark", "One Dark")
   }

   theme_builder.build()
}

#[cfg(target_os = "macos")]
fn build_app_submenu<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
) -> Result<Submenu<R>, tauri::Error> {
   let package_info = app.package_info();
   let config = app.config();
   let about_metadata = AboutMetadata {
      name: Some(package_info.name.clone()),
      version: Some(package_info.version.to_string()),
      copyright: config.bundle.copyright.clone(),
      authors: config
         .bundle
         .publisher
         .clone()
         .map(|publisher| vec![publisher]),
      ..Default::default()
   };

   SubmenuBuilder::new(app, "Athas")
      .about_with_text("About Athas", Some(about_metadata))
      .separator()
      .item(&MenuItem::with_id(
         app,
         "open_settings",
         "Settings...",
         true,
         Some("Cmd+,"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "check_updates",
         "Check for Updates...",
         true,
         None::<String>,
      )?)
      .separator()
      .services()
      .separator()
      .hide_with_text("Hide Athas")
      .hide_others()
      .show_all()
      .separator()
      .item(&MenuItem::with_id(
         app,
         "quit_app",
         "Quit Athas",
         true,
         Some("Cmd+Q"),
      )?)
      .build()
}

#[cfg(target_os = "macos")]
fn recent_document_title(path: &std::path::Path) -> String {
   path
      .file_name()
      .and_then(|name| name.to_str())
      .filter(|name| !name.is_empty())
      .map(str::to_string)
      .unwrap_or_else(|| path.display().to_string())
}

#[cfg(target_os = "macos")]
fn build_open_recent_submenu<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
) -> Result<Submenu<R>, tauri::Error> {
   let paths = crate::bootstrap::macos::recent_documents().unwrap_or_else(|error| {
      log::warn!("Failed to read macOS recent documents: {error}");
      Vec::new()
   });
   let mut builder = SubmenuBuilder::with_id(app, "open_recent", "Open Recent");

   if paths.is_empty() {
      builder = builder.item(&MenuItem::with_id(
         app,
         "no_recent_documents",
         "No Recent Projects",
         false,
         None::<String>,
      )?);
   } else {
      for (index, path) in paths.iter().enumerate() {
         builder = builder.text(format!("open_recent:{index}"), recent_document_title(path));
      }
      builder = builder
         .separator()
         .text("clear_recent_documents", "Clear Menu");
   }

   builder.build()
}

#[cfg(target_os = "macos")]
pub fn refresh_open_recent_submenu(
   app: &tauri::AppHandle<crate::app_runtime::AthasRuntime>,
) -> Result<(), String> {
   let Some(menu) = app.menu() else {
      return Ok(());
   };
   let Some(MenuItemKind::Submenu(file_menu)) = menu.get("file_menu") else {
      return Ok(());
   };
   let Some(MenuItemKind::Submenu(open_recent)) = file_menu.get("open_recent") else {
      return Ok(());
   };

   while open_recent
      .remove_at(0)
      .map_err(|error| error.to_string())?
      .is_some()
   {}

   let paths = crate::bootstrap::macos::recent_documents()?;
   if paths.is_empty() {
      let item = MenuItem::with_id(
         app,
         "no_recent_documents",
         "No Recent Projects",
         false,
         None::<String>,
      )
      .map_err(|error| error.to_string())?;
      open_recent
         .append(&item)
         .map_err(|error| error.to_string())?;
   } else {
      for (index, path) in paths.iter().enumerate() {
         let item = MenuItem::with_id(
            app,
            format!("open_recent:{index}"),
            recent_document_title(path),
            true,
            None::<String>,
         )
         .map_err(|error| error.to_string())?;
         open_recent
            .append(&item)
            .map_err(|error| error.to_string())?;
      }
      let separator = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
      open_recent
         .append(&separator)
         .map_err(|error| error.to_string())?;
      let clear = MenuItem::with_id(
         app,
         "clear_recent_documents",
         "Clear Menu",
         true,
         None::<String>,
      )
      .map_err(|error| error.to_string())?;
      open_recent
         .append(&clear)
         .map_err(|error| error.to_string())?;
   }

   Ok(())
}

#[cfg(not(target_os = "linux"))]
pub fn create_menu<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
) -> Result<tauri::menu::Menu<R>, tauri::Error> {
   create_menu_with_themes(app, None)
}

pub fn create_menu_with_themes<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
   themes: Option<Vec<ThemeData>>,
) -> Result<tauri::menu::Menu<R>, tauri::Error> {
   let close_tab_accelerator = close_tab_accelerator();

   #[cfg(target_os = "macos")]
   let open_recent_menu = build_open_recent_submenu(app)?;

   // Unified File menu for all platforms - clean and consistent
   let file_menu_builder = SubmenuBuilder::with_id(app, "file_menu", "File")
      .item(&MenuItem::with_id(
         app,
         "command_new_tab",
         "New Tab",
         true,
         Some("CmdOrCtrl+N"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "new_window",
         "New Window",
         true,
         Some("CmdOrCtrl+Shift+N"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "new_file",
         "New File",
         true,
         None::<String>,
      )?)
      .item(&MenuItem::with_id(
         app,
         "open_folder",
         "Open Folder",
         true,
         Some("CmdOrCtrl+O"),
      )?);

   #[cfg(target_os = "macos")]
   let file_menu_builder = file_menu_builder.item(&open_recent_menu);

   let file_menu_builder = file_menu_builder
      .item(&MenuItem::with_id(
         app,
         "close_folder",
         "Close Folder",
         true,
         None::<String>,
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "save",
         "Save",
         true,
         Some("CmdOrCtrl+S"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "save_as",
         "Save As...",
         true,
         Some("CmdOrCtrl+Shift+S"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_save_all",
         "Save All",
         true,
         Some("CmdOrCtrl+Option+S"),
      )?)
      .text("command_revert_file", "Revert File")
      .text("command_local_history", "Show Local History")
      .separator()
      .item(&MenuItem::with_id(
         app,
         "close_tab",
         "Close Tab",
         true,
         close_tab_accelerator,
      )?)
      .text("command_close_all_tabs", "Close All Tabs")
      .text("command_close_other_tabs", "Close Other Tabs")
      .text("command_close_saved_tabs", "Close Saved Tabs")
      .text("command_close_tabs_to_left", "Close Tabs to the Left")
      .text("command_close_tabs_to_right", "Close Tabs to the Right")
      .item(&MenuItem::with_id(
         app,
         "command_reopen_closed_tab",
         "Reopen Closed Tab",
         true,
         Some("CmdOrCtrl+Shift+T"),
      )?);

   #[cfg(target_os = "macos")]
   let file_menu = file_menu_builder.build()?;

   #[cfg(not(target_os = "macos"))]
   let file_menu = file_menu_builder
      .separator()
      .item(&MenuItem::with_id(
         app,
         "quit_app",
         "Quit",
         true,
         Some("CmdOrCtrl+Q"),
      )?)
      .build()?;

   // Edit menu with native macOS items
   let edit_menu = SubmenuBuilder::new(app, "Edit")
      .item(&MenuItem::with_id(
         app,
         "undo",
         "Undo",
         true,
         Some("CmdOrCtrl+Z"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "redo",
         "Redo",
         true,
         Some("CmdOrCtrl+Shift+Z"),
      )?)
      .separator()
      .cut()
      .copy()
      .paste()
      .item(&MenuItem::with_id(
         app,
         "select_all",
         "Select All",
         true,
         Some("CmdOrCtrl+A"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "find",
         "Find",
         true,
         Some("CmdOrCtrl+F"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "find_replace",
         "Find and Replace",
         true,
         Some("CmdOrCtrl+Option+F"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "toggle_comment",
         "Toggle Comment",
         true,
         Some("CmdOrCtrl+Slash"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_quick_fix",
         "Quick Fix",
         true,
         Some("CmdOrCtrl+."),
      )?)
      .text("command_trigger_parameter_hints", "Trigger Parameter Hints")
      .text("command_show_hover", "Show Hover")
      .separator()
      .text("command_duplicate_line", "Duplicate Line")
      .item(&MenuItem::with_id(
         app,
         "command_delete_line",
         "Delete Line",
         true,
         Some("CmdOrCtrl+Shift+K"),
      )?)
      .text("command_move_line_up", "Move Line Up")
      .text("command_move_line_down", "Move Line Down")
      .item(&MenuItem::with_id(
         app,
         "command_format_document",
         "Format Document",
         true,
         Some("Shift+Alt+F"),
      )?)
      .text("command_format_selection", "Format Selection")
      .separator()
      .item(&MenuItem::with_id(
         app,
         "command_palette",
         "Command Palette",
         true,
         command_palette_accelerator(),
      )?)
      .build()?;

   // Theme submenu - built dynamically from theme data
   let theme_menu = build_theme_submenu(app, themes)?;

   // View menu
   let view_menu = SubmenuBuilder::with_id(app, "view_menu", "View")
      .item(&MenuItem::with_id(
         app,
         "toggle_activity_sidebar",
         "Show/Hide Activity Bar",
         true,
         Some("CmdOrCtrl+B"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "toggle_sidebar",
         "Show/Hide Secondary Sidebar",
         true,
         Some("CmdOrCtrl+E"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "toggle_terminal",
         "Show/Hide Terminal",
         true,
         Some("CmdOrCtrl+J"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "open_github_notifications",
         "GitHub Notifications",
         true,
         None::<String>,
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "command_global_search",
         "Global Search",
         true,
         Some("CmdOrCtrl+Shift+F"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_diagnostics",
         "Diagnostics",
         true,
         Some("CmdOrCtrl+Shift+J"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "command_file_explorer",
         "File Explorer",
         true,
         Some("CmdOrCtrl+Shift+E"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_source_control",
         "Source Control",
         true,
         Some("CmdOrCtrl+Shift+G"),
      )?)
      .text("command_github", "GitHub")
      .text("command_debugger", "Run and Debug")
      .separator()
      .text("split_editor", "Split Editor")
      .item(&CheckMenuItem::with_id(
         app,
         "command_toggle_minimap",
         "Minimap",
         true,
         false,
         None::<String>,
      )?)
      .item(&CheckMenuItem::with_id(
         app,
         "command_toggle_word_wrap",
         "Word Wrap",
         true,
         false,
         Some("Alt+Z"),
      )?)
      .item(&CheckMenuItem::with_id(
         app,
         "command_toggle_line_numbers",
         "Line Numbers",
         true,
         true,
         None::<String>,
      )?)
      .item(&CheckMenuItem::with_id(
         app,
         "command_toggle_render_whitespace",
         "Render Whitespace",
         true,
         false,
         None::<String>,
      )?)
      .separator()
      .text("command_zoom_in", "Zoom In")
      .text("command_zoom_out", "Zoom Out")
      .text("command_zoom_reset", "Reset Zoom")
      .separator()
      .item(&theme_menu)
      .build()?;

   // Go menu with navigation shortcuts
   let go_menu = SubmenuBuilder::new(app, "Go")
      .item(&MenuItem::with_id(
         app,
         "quick_open",
         "Quick Open",
         true,
         Some("CmdOrCtrl+P"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "go_to_line",
         "Go to Line",
         true,
         Some("CmdOrCtrl+G"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "command_go_back",
         "Go Back",
         true,
         None::<String>,
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_go_forward",
         "Go Forward",
         true,
         None::<String>,
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "command_go_to_definition",
         "Go to Definition",
         true,
         Some("F12"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_go_to_implementation",
         "Go to Implementation",
         true,
         Some("CmdOrCtrl+F12"),
      )?)
      .text("command_go_to_type_definition", "Go to Type Definition")
      .item(&MenuItem::with_id(
         app,
         "command_go_to_references",
         "Go to References",
         true,
         Some("Shift+F12"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_rename_symbol",
         "Rename Symbol",
         true,
         Some("F2"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "next_tab",
         "Next Tab",
         true,
         Some("CmdOrCtrl+Option+Right"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "prev_tab",
         "Previous Tab",
         true,
         Some("CmdOrCtrl+Option+Left"),
      )?)
      .build()?;

   // Terminal menu
   let terminal_menu = SubmenuBuilder::new(app, "Terminal")
      .text("command_new_terminal", "New Terminal")
      .text("command_split_terminal", "Split Terminal Right")
      .text("command_split_terminal_down", "Split Terminal Down")
      .text("command_close_terminal", "Close Terminal")
      .build()?;

   // Run menu
   let run_menu = SubmenuBuilder::new(app, "Run")
      .item(&MenuItem::with_id(
         app,
         "command_start_debugging",
         "Start Debugging",
         true,
         Some("F5"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_stop_debugging",
         "Stop Debugging",
         true,
         Some("Shift+F5"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_toggle_breakpoint",
         "Toggle Breakpoint",
         true,
         Some("F9"),
      )?)
      .build()?;

   // Agent menu
   let ai_menu = SubmenuBuilder::new(app, "Agent")
      .item(&MenuItem::with_id(
         app,
         "toggle_ai_chat",
         "Toggle Agent",
         true,
         Some("CmdOrCtrl+R"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_new_agent",
         "New Agent",
         true,
         Some("CmdOrCtrl+Shift+Space"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "command_inline_edit",
         "Inline Edit",
         true,
         Some("CmdOrCtrl+I"),
      )?)
      .build()?;

   #[cfg(target_os = "macos")]
   let tools_menu = SubmenuBuilder::new(app, "Tools")
      .text("command_connect_database", "Connect to Database")
      .separator()
      .item(&MenuItem::with_id(
         app,
         "open_web_inspector",
         "Web Inspector",
         cfg!(any(debug_assertions, feature = "devtools")),
         Some("CmdOrCtrl+Option+I"),
      )?)
      .separator()
      .text("open_extensions", "Extensions")
      .text("command_keyboard_shortcuts", "Keyboard Shortcuts")
      .build()?;

   #[cfg(not(target_os = "macos"))]
   let tools_menu = SubmenuBuilder::new(app, "Tools")
      .text("command_connect_database", "Connect to Database")
      .separator()
      .item(&MenuItem::with_id(
         app,
         "open_web_inspector",
         "Web Inspector",
         cfg!(any(debug_assertions, feature = "devtools")),
         Some("CmdOrCtrl+Option+I"),
      )?)
      .separator()
      .text("open_settings", "Preferences")
      .text("open_extensions", "Extensions")
      .text("command_keyboard_shortcuts", "Keyboard Shortcuts")
      .build()?;

   // Window menu
   #[cfg(target_os = "macos")]
   let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
      .minimize()
      .maximize()
      .fullscreen()
      .separator()
      .item(&MenuItem::with_id(
         app,
         "close_window",
         "Close Window",
         true,
         Some("Cmd+Shift+W"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "show_previous_window_tab",
         "Show Previous Tab",
         true,
         window_tab_accelerator(),
      )?)
      .item(&MenuItem::with_id(
         app,
         "show_next_window_tab",
         "Show Next Tab",
         true,
         window_tab_accelerator(),
      )?)
      .text("move_window_tab", "Move Tab to New Window")
      .text("merge_all_windows", "Merge All Windows")
      .build()?;

   #[cfg(not(target_os = "macos"))]
   let window_menu = SubmenuBuilder::new(app, "Window")
      .item(&MenuItem::with_id(
         app,
         "minimize_window",
         "Minimize",
         true,
         Some("Alt+F9"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "maximize_window",
         "Maximize",
         true,
         Some("Alt+F10"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "toggle_menu_bar",
         "Toggle Menu Bar",
         true,
         Some("Alt+M"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "toggle_fullscreen",
         "Toggle Fullscreen",
         true,
         Some("F11"),
      )?)
      .build()?;

   let help_menu_builder = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help")
      .text("documentation", "Documentation")
      .text("command_help_keyboard_shortcuts", "Keyboard Shortcuts")
      .text("whats_new", "What's New")
      .text("changelog", "Changelog")
      .separator()
      .text("report_bug", "Report a Bug")
      .text("request_feature", "Request a Feature");

   #[cfg(target_os = "macos")]
   let help_menu = help_menu_builder.build()?;

   #[cfg(not(target_os = "macos"))]
   let help_menu = help_menu_builder
      .separator()
      .text("check_updates", "Check for Updates")
      .build()?;

   #[cfg(target_os = "macos")]
   {
      let app_menu = build_app_submenu(app)?;

      MenuBuilder::new(app)
         .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &go_menu,
            &terminal_menu,
            &run_menu,
            &ai_menu,
            &tools_menu,
            &window_menu,
            &help_menu,
         ])
         .build()
   }

   #[cfg(not(target_os = "macos"))]
   {
      MenuBuilder::new(app)
         .items(&[
            &file_menu,
            &edit_menu,
            &view_menu,
            &go_menu,
            &terminal_menu,
            &run_menu,
            &ai_menu,
            &tools_menu,
            &window_menu,
            &help_menu,
         ])
         .build()
   }
}

fn close_tab_accelerator() -> Option<&'static str> {
   #[cfg(target_os = "linux")]
   {
      None
   }

   #[cfg(not(target_os = "linux"))]
   {
      Some("CmdOrCtrl+W")
   }
}

fn command_palette_accelerator() -> Option<&'static str> {
   #[cfg(target_os = "macos")]
   {
      Some("Cmd+Shift+P")
   }

   #[cfg(not(target_os = "macos"))]
   {
      None
   }
}

#[cfg(target_os = "macos")]
fn window_tab_accelerator() -> Option<&'static str> {
   None
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
   #[test]
   fn window_tabs_leave_ctrl_tab_for_editor_navigation() {
      assert_eq!(super::window_tab_accelerator(), None);
   }
}
