use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder};

pub fn create_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<tauri::menu::Menu<R>, tauri::Error> {
    // App menu (macOS style - first menu with app name)
    let app_menu = SubmenuBuilder::new(app, "Athas")
        .about(Some(AboutMetadata {
            name: Some("Athas".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&MenuItem::with_id(
            app,
            "quit_app",
            "Quit Athas",
            true,
            Some("CmdOrCtrl+Q"),
        )?)
        .build()?;

    // File menu with cross-platform keyboard shortcuts
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
        .text("toggle_vim", "Toggle Vim Mode")
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

    // Window menu (macOS convention)
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    // Help menu
    let help_menu = SubmenuBuilder::new(app, "Help")
        .text("help", "Help")
        .build()?;

    // Main menu - include app menu first for macOS convention
    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &go_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}
