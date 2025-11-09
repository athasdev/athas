use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItem, Submenu, SubmenuBuilder};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct ThemeData {
   pub id: String,
   pub name: String,
   pub category: String,
}

#[tauri::command]
pub async fn rebuild_menu_themes(
   app: tauri::AppHandle,
   themes: Vec<ThemeData>,
) -> Result<(), String> {
   // Only rebuild menu if native menu bar is enabled
   if app.menu().is_some() {
      let new_menu = create_menu_with_themes(&app, Some(themes))
         .map_err(|e| format!("Failed to create menu: {}", e))?;
      app.set_menu(new_menu)
         .map_err(|e| format!("Failed to set menu: {}", e))?;
      log::info!("Menu rebuilt with dynamic themes");
   } else {
      log::info!("Native menu bar is disabled, skipping menu rebuild");
   }
   Ok(())
}

#[tauri::command]
pub async fn toggle_menu_bar(app: tauri::AppHandle, toggle: Option<bool>) -> Result<(), String> {
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
         let _ = store.set("nativeMenuBar", true);
         let _ = store.save();
      }
   } else {
      // Hide menu by setting it to None
      app.remove_menu()
         .map_err(|e| format!("Failed to hide menu: {}", e))?;
      log::info!("Menu bar hidden via command");

      // Update the store to persist the setting
      if let Ok(store) = app.store("settings.json") {
         let _ = store.set("nativeMenuBar", false);
         let _ = store.save();
      }
   }
   Ok(())
}

fn build_theme_submenu<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
   themes: Option<Vec<ThemeData>>,
) -> Result<Submenu<R>, tauri::Error> {
   let mut theme_builder = SubmenuBuilder::new(app, "Theme").text("auto", "Auto");

   if let Some(theme_list) = themes {
      // Add separator and all themes without grouping
      if !theme_list.is_empty() {
         theme_builder = theme_builder.separator();
         for theme in &theme_list {
            theme_builder = theme_builder.text(&theme.id, &theme.name);
         }
      }
   } else {
      // Fallback to hardcoded themes if none provided
      theme_builder = theme_builder
         .separator()
         .text("athas-light", "Athas Light")
         .text("athas-dark", "Athas Dark")
   }

   theme_builder.build()
}

pub fn create_menu<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
) -> Result<tauri::menu::Menu<R>, tauri::Error> {
   create_menu_with_themes(app, None)
}

pub fn create_menu_with_themes<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
   themes: Option<Vec<ThemeData>>,
) -> Result<tauri::menu::Menu<R>, tauri::Error> {
   // Unified File menu for all platforms - clean and consistent
   let file_menu = SubmenuBuilder::new(app, "File")
      .item(&MenuItem::with_id(
         app,
         "new_file",
         "New File",
         true,
         Some("CmdOrCtrl+N"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "open_folder",
         "Open Folder",
         true,
         Some("CmdOrCtrl+O"),
      )?)
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
      .separator()
      .item(&MenuItem::with_id(
         app,
         "close_tab",
         "Close Tab",
         true,
         Some("CmdOrCtrl+W"),
      )?)
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
      .undo()
      .redo()
      .separator()
      .cut()
      .copy()
      .paste()
      .select_all()
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
      .separator()
      .item(&MenuItem::with_id(
         app,
         "command_palette",
         "Command Palette",
         true,
         Some("CmdOrCtrl+Shift+P"),
      )?)
      .build()?;

   // Theme submenu - built dynamically from theme data
   let theme_menu = build_theme_submenu(app, themes)?;

   // View menu
   let view_menu = SubmenuBuilder::new(app, "View")
      .item(&MenuItem::with_id(
         app,
         "toggle_sidebar",
         "Toggle Sidebar",
         true,
         Some("CmdOrCtrl+B"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "toggle_terminal",
         "Toggle Terminal",
         true,
         Some("CmdOrCtrl+J"),
      )?)
      .item(&MenuItem::with_id(
         app,
         "toggle_ai_chat",
         "Toggle AI Chat",
         true,
         Some("CmdOrCtrl+R"),
      )?)
      .separator()
      .text("split_editor", "Split Editor")
      .separator()
      .item(&MenuItem::with_id(
         app,
         "toggle_menu_bar",
         "Toggle Menu Bar",
         true,
         Some("Alt+M"),
      )?)
      .separator()
      .item(&theme_menu)
      .build()?;

   // Go menu with navigation shortcuts
   let go_menu = SubmenuBuilder::new(app, "Go")
      .item(&MenuItem::with_id(
         app,
         "go_to_file",
         "Go to File",
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

   // Window menu - cross-platform window management
   let window_menu = SubmenuBuilder::new(app, "Window")
      .item(&MenuItem::with_id(
         app,
         "minimize_window",
         "Minimize",
         true,
         if cfg!(target_os = "macos") {
            Some("Cmd+M")
         } else {
            Some("Alt+F9")
         },
      )?)
      .item(&MenuItem::with_id(
         app,
         "maximize_window",
         "Maximize",
         true,
         if cfg!(target_os = "macos") {
            Some("Cmd+Option+Z")
         } else {
            Some("Alt+F10")
         },
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "quit_app",
         "Quit",
         true,
         Some("CmdOrCtrl+Q"),
      )?)
      .separator()
      .item(&MenuItem::with_id(
         app,
         "toggle_fullscreen",
         "Toggle Fullscreen",
         true,
         if cfg!(target_os = "macos") {
            Some("Cmd+Ctrl+F")
         } else {
            Some("F11")
         },
      )?)
      .build()?;

   // Help menu
   let help_menu = SubmenuBuilder::new(app, "Help")
      .text("help", "Help")
      .separator()
      .text("about_athas", "About Athas")
      .build()?;

   // Main menu - unified structure for all platforms
   MenuBuilder::new(app)
      .items(&[
         &file_menu,
         &edit_menu,
         &view_menu,
         &go_menu,
         &window_menu,
         &help_menu,
      ])
      .build()
}
