use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};

#[tauri::command]
pub async fn toggle_menu_bar(app: tauri::AppHandle, toggle: Option<bool>) -> Result<(), String> {
   let is_menu_present = app.menu().is_some();
   let should_show_menu = match toggle {
      Some(t) => t,
      None => is_menu_present,
   };

   if should_show_menu {
      // Hide menu by setting it to None
      app.remove_menu()
         .map_err(|e| format!("Failed to hide menu: {}", e))?;
      log::info!("Menu bar hidden via command");
   } else {
      // Show menu by recreating it
      let new_menu = create_menu(&app).map_err(|e| format!("Failed to create menu: {}", e))?;
      app.set_menu(new_menu)
         .map_err(|e| format!("Failed to show menu: {}", e))?;
      log::info!("Menu bar shown via command");
   }
   Ok(())
}

pub fn create_menu<R: tauri::Runtime>(
   app: &tauri::AppHandle<R>,
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

   // Theme submenu
   let theme_menu = SubmenuBuilder::new(app, "Theme")
      .text("theme_auto", "Auto")
      .separator()
      .text("theme_light", "Light")
      .text("theme_dark", "Dark")
      .text("theme_midnight", "Midnight")
      .separator()
      .text("theme_catppuccin_mocha", "Catppuccin Mocha")
      .text("theme_tokyo_night", "Tokyo Night")
      .text("theme_dracula", "Dracula")
      .text("theme_nord", "Nord")
      .build()?;

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
