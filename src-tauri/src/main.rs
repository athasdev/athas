#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unexpected_cfgs)]

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use app_runtime::AthasRuntime;
use app_setup::{configure_app, shutdown_background_services};
use commands::*;
use terminal::{close_terminal, create_terminal, list_shells, terminal_resize, terminal_write};

mod app_runtime;
mod app_setup;
mod bootstrap;
mod commands;
mod file_events;
mod logger;
mod menu;
mod secure_storage;
mod terminal;

#[cfg_attr(all(target_os = "linux", feature = "linux"), tauri::cef_entry_point)]
fn main() {
   #[cfg(target_os = "linux")]
   if cfg!(not(feature = "linux")) && std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
      // SAFETY: Called at program start before any threads are spawned
      unsafe {
         std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
      }
   }

   #[cfg(target_os = "macos")]
   bootstrap::macos::disable_macos_autofill_heuristics();

   tauri::Builder::<AthasRuntime>::new()
      .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
         app_setup::handle_single_instance_open(app, args, cwd);
      }))
      .plugin(tauri_plugin_store::Builder::default().build())
      .plugin(tauri_plugin_clipboard_manager::init())
      .plugin(logger::init(log::LevelFilter::Info))
      .plugin(tauri_plugin_window_state::Builder::new().build())
      .plugin(tauri_plugin_fs::init())
      .plugin(tauri_plugin_dialog::init())
      .plugin(tauri_plugin_shell::init())
      .plugin(tauri_plugin_opener::init())
      .plugin(tauri_plugin_os::init())
      .plugin(tauri_plugin_http::init())
      .plugin(tauri_plugin_process::init())
      .plugin(tauri_plugin_deep_link::init())
      .plugin(tauri_plugin_updater::Builder::new().build())
      .setup(configure_app)
      .invoke_handler(tauri::generate_handler![
         // File system commands
         open_file_external,
         open_folder_dialog,
         move_file,
         rename_file,
         get_symlink_info,
         local_history_record_file,
         local_history_list_file,
         local_history_read_entry,
         local_history_delete_entry,
         local_history_rename_entry,
         // Clipboard commands
         clipboard_set,
         clipboard_get,
         clipboard_clear,
         clipboard_paste,
         // Git commands
         git_status,
         git_discover_repo,
         git_add,
         git_reset,
         git_commit,
         git_add_all,
         git_reset_all,
         git_log,
         git_diff_file,
         git_diff_file_with_content,
         git_status_diff_stats,
         git_commit_diff,
         git_ref_diff,
         git_branches,
         git_checkout,
         git_create_branch,
         git_delete_branch,
         git_discard_file_changes,
         git_discard_all_changes,
         git_push,
         git_pull,
         git_fetch,
         git_init,
         git_get_remotes,
         git_add_remote,
         git_remove_remote,
         git_get_stashes,
         git_create_stash,
         git_apply_stash,
         git_pop_stash,
         git_drop_stash,
         git_stash_diff,
         git_get_tags,
         git_create_tag,
         git_delete_tag,
         git_push_tag,
         git_delete_remote_tag,
         git_checkout_tag,
         git_get_worktrees,
         git_add_worktree,
         git_remove_worktree,
         git_prune_worktrees,
         git_stage_hunk,
         git_unstage_hunk,
         git_blame_file,
         // GitHub commands
         store_github_token,
         get_github_token,
         remove_github_token,
         github_check_auth,
         github_list_prs,
         github_list_issues,
         github_list_workflow_runs,
         github_list_workflows,
         github_list_labels,
         github_create_issue,
         github_update_issue,
         github_create_pull_request,
         github_update_pull_request,
         github_dispatch_workflow,
         github_get_current_user,
         github_checkout_pr,
         github_get_pr_details,
         github_get_pr_diff,
         github_get_pr_files,
         github_get_pr_comments,
         github_get_issue_details,
         github_get_workflow_run_details,
         github_get_workflow_job_logs,
         // AI Provider token commands
         store_ai_provider_token,
         get_ai_provider_token,
         remove_ai_provider_token,
         // Auth token commands
         store_auth_token,
         get_auth_token,
         remove_auth_token,
         // Chat history commands
         init_chat_database,
         save_chat,
         load_all_chats,
         load_chat,
         delete_chat,
         search_chats,
         get_chat_stats,
         // Window commands
         create_app_window,
         uses_native_window_chrome,
         set_macos_window_appearance,
         set_window_transparency_enabled,
         create_embedded_webview,
         close_embedded_webview,
         close_all_embedded_webviews,
         clear_embedded_webview_browsing_data,
         navigate_embedded_webview,
         resize_embedded_webview,
         set_webview_visible,
         open_webview_devtools,
         reopen_current_webview_devtools,
         set_webview_zoom,
         // File watcher commands
         start_watching,
         stop_watching,
         set_project_root,
         store_remote_credential,
         get_remote_credential,
         remove_remote_credential,
         // Terminal commands
         create_terminal,
         terminal_write,
         terminal_resize,
         close_terminal,
         list_shells,
         // execute_shell,
         // SSH commands
         ssh_connect,
         ssh_disconnect,
         ssh_disconnect_only,
         ssh_create_file,
         ssh_create_directory,
         ssh_delete_path,
         ssh_rename_path,
         ssh_copy_path,
         ssh_write_file,
         ssh_read_directory,
         ssh_read_file,
         ssh_get_connected_ids,
         create_remote_terminal,
         remote_terminal_write,
         remote_terminal_resize,
         close_remote_terminal,
         // WSL commands
         wsl_list_distributions,
         wsl_get_home_dir,
         wsl_read_directory,
         wsl_read_file,
         wsl_read_file_bytes,
         wsl_write_file,
         wsl_create_file,
         wsl_create_directory,
         wsl_delete_path,
         wsl_rename_path,
         wsl_copy_path,
         wsl_get_symlink_info,
         wsl_resolve_windows_path,
         // ACP agent commands (new)
         get_available_agents,
         install_acp_agent,
         uninstall_acp_agent,
         start_acp_agent,
         stop_acp_agent,
         send_acp_prompt,
         get_acp_status,
         respond_acp_permission,
         set_acp_session_mode,
         set_acp_session_config_option,
         list_acp_sessions,
         delete_acp_session,
         logout_acp_agent,
         cancel_acp_prompt,
         // Theme commands
         get_system_theme,
         load_toml_themes,
         load_single_toml_theme,
         get_cached_themes,
         cache_themes,
         get_temp_dir,
         write_temp_file,
         delete_temp_file,
         // Font commands
         get_system_fonts,
         get_monospace_fonts,
         validate_font,
         // Database provider sidecar commands
         run_database_provider_command,
         // Connection management
         connect_database,
         disconnect_database,
         test_connection,
         // Credentials
         store_db_credential,
         get_db_credential,
         remove_db_credential,
         save_connection,
         list_saved_connections,
         delete_saved_connection,
         // LSP commands
         lsp_start,
         lsp_stop,
         lsp_start_for_file,
         lsp_stop_for_file,
         lsp_get_completions,
         lsp_get_hover,
         lsp_get_definition,
         lsp_get_implementation,
         lsp_get_type_definition,
         lsp_get_semantic_tokens,
         lsp_get_code_lens,
         lsp_format_document,
         lsp_format_range,
         lsp_get_inlay_hints,
         lsp_get_document_symbols,
         lsp_get_signature_help,
         lsp_get_signature_trigger_characters,
         lsp_get_references,
         lsp_rename,
         lsp_prepare_rename,
         lsp_get_code_actions,
         lsp_apply_code_action,
         lsp_document_open,
         lsp_document_change,
         lsp_document_save,
         lsp_document_close,
         lsp_is_language_supported,
         // Debugger commands
         debug_start_session,
         debug_send_request,
         debug_send_raw_message,
         debug_stop_session,
         debug_list_sessions,
         // Extension commands
         download_extension,
         install_extension,
         uninstall_extension,
         get_installed_extensions,
         get_bundled_extensions_path,
         install_extension_from_url,
         uninstall_extension_new,
         list_installed_extensions_new,
         get_extension_path,
         // Fuzzy matching commands
         fuzzy_match,
         filter_completions,
         fff_set_workspace,
         fff_search_files,
         fff_scan_status,
         fff_track_access,
         // Search commands
         search_files_content,
         // EditorConfig commands
         get_editorconfig_properties,
         // Format commands
         format_code,
         // Lint commands
         lint_code,
         // Notebook commands
         notebook_run_python_cell,
         notebook_run_r_cell,
         // CLI commands
         check_cli_installed,
         install_cli_command,
         uninstall_cli_command,
         get_cli_install_command,
         get_importable_ide_projects,
         take_pending_cli_open_requests,
         // Runtime commands
         ensure_runtime,
         get_runtime_status,
         get_runtime_version,
         get_js_runtime,
         get_all_runtime_statuses,
         // Docker commands
         docker_get_inventory,
         docker_container_action,
         docker_get_container_logs,
         docker_start_container_log_stream,
         docker_stop_container_log_stream,
         docker_get_compose_project,
         docker_compose_action,
         docker_build_image,
         docker_run_image,
         docker_image_action,
         docker_prune_resources,
         docker_list_container_files,
         docker_copy_from_container,
         docker_copy_to_container,
         docker_registry_search,
         docker_registry_login,
         docker_registry_pull,
         docker_registry_push,
         docker_tag_image,
         // Tool commands
         install_language_tools,
         install_tool,
         get_language_tool_status,
         get_tool_path,
         get_available_tools,
         frontend_trace,
         // Menu commands
         menu::toggle_menu_bar,
         menu::rebuild_menu_themes,
      ])
      .build(tauri::generate_context!())
      .expect("error while building tauri application")
      .run(|app_handle, event| match event {
         tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            shutdown_background_services(app_handle);
         }
         _ => {}
      });
}
