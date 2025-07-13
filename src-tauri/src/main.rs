// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::{Emitter, Manager};

mod claude_bridge;
mod commands;
mod file_watcher;
mod logger;
mod lsp;
mod menu;
mod ssh;
mod terminal;
use claude_bridge::init_claude_bridge;
use commands::*;
use file_watcher::FileWatcher;
use lsp::{
    LSPState, list_lsp_servers, lsp_completion, lsp_did_change, lsp_did_close, lsp_did_open,
    lsp_hover, start_lsp_server, stop_lsp_server,
};
use ssh::{
    ssh_connect, ssh_disconnect, ssh_execute_command, ssh_list_directory, ssh_read_file,
    ssh_write_file,
};
use terminal::TerminalManager;

fn main() {
    tauri::Builder::default()
        .plugin(logger::init(log::LevelFilter::Info))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;

            log::info!("Starting app ☺️!");

            // Set up the file watcher
            app.manage(Arc::new(FileWatcher::new(app.handle().clone())));

            // Set up Claude bridge
            app.manage(init_claude_bridge(app.handle()));

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};
                let window = app.get_webview_window("main").unwrap();

                // Apply vibrancy effect for macOS
                apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(12.0))
                    .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
            }

            app.on_menu_event(move |_app_handle: &tauri::AppHandle, event| {
                if let Some(window) = _app_handle.get_webview_window("main") {
                    match event.id().0.as_str() {
                        "quit" => {
                            println!("Quit menu item clicked");
                            std::process::exit(0);
                        }
                        "quit_app" => {
                            println!("Quit app menu item triggered");
                            std::process::exit(0);
                        }
                        "new_file" => {
                            let _ = window.emit("menu_new_file", ());
                        }
                        "open_folder" => {
                            let _ = window.emit("menu_open_folder", ());
                        }
                        "save" => {
                            let _ = window.emit("menu_save", ());
                        }
                        "save_as" => {
                            let _ = window.emit("menu_save_as", ());
                        }
                        "close_tab" => {
                            println!("Close tab menu item triggered");
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
                        "toggle_vim" => {
                            let _ = window.emit("menu_toggle_vim", ());
                        }
                        "go_to_file" => {
                            let _ = window.emit("menu_go_to_file", ());
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
                        "about" => {
                            // Native About dialog is handled automatically by macOS
                        }
                        "help" => {
                            let _ = window.emit("menu_help", ());
                        }
                        // Theme menu items
                        theme_id if theme_id.starts_with("theme_") => {
                            if let Some(theme) = theme_id.strip_prefix("theme_") {
                                let _ = window.emit("menu_theme_change", theme);
                            }
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .manage(LSPState::new())
        .manage(Arc::new(TerminalManager::new()))
        .invoke_handler(tauri::generate_handler![
            // File system commands
            read_directory_custom,
            read_file_custom,
            write_file_custom,
            create_directory_custom,
            delete_path_custom,
            // Database commands
            get_sqlite_tables,
            query_sqlite,
            // Git commands
            git_status,
            git_add,
            git_reset,
            git_commit,
            git_add_all,
            git_reset_all,
            git_log,
            git_diff_file,
            git_commit_diff,
            git_branches,
            git_checkout,
            git_create_branch,
            git_delete_branch,
            // GitHub commands
            store_github_token,
            get_github_token,
            remove_github_token,
            // Window commands
            create_remote_window,
            // File watcher commands
            start_watching,
            stop_watching,
            // LSP commands
            start_lsp_server,
            stop_lsp_server,
            lsp_did_open,
            lsp_did_change,
            lsp_did_close,
            lsp_completion,
            lsp_hover,
            list_lsp_servers,
            // Terminal commands
            create_terminal_connection,
            send_terminal_data,
            resize_terminal,
            close_terminal_connection,
            send_terminal_ctrl_c,
            send_terminal_ctrl_d,
            get_available_terminal_types,
            // SSH commands
            ssh_connect,
            ssh_disconnect,
            ssh_list_directory,
            ssh_read_file,
            ssh_write_file,
            ssh_execute_command,
            // Claude commands
            start_claude_code,
            stop_claude_code,
            send_claude_input,
            get_claude_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
