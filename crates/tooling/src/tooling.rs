//! Language servers, formatters and linters that language extensions declare: installing them
//! (package managers, binary downloads), finding them, and running formatters and linters
//! (`crates/tooling` in Athas, without Tauri). Tools install under `<data dir>/tools` and the
//! runtimes that install them under `<data dir>/runtimes`, the layout the old app used.
//!
//! The functions are async and need a tokio reactor; [`spawn`] runs them on the crate's own
//! runtime so any executor can await the result.

mod exec_guard;
mod extension_command;
mod format;
mod installer;
mod language_tools;
mod lint;
mod lsp_launch;
mod managed_install;
mod notebook;
mod platform;
mod process_io;
mod progress;
mod registry;
mod runtime;
mod types;

pub use exec_guard::{validate_exec_args, validate_exec_command, validate_exec_env};
pub use extension_command::build_extension_command;
pub use format::{FormatRequest, FormatResponse, FormatterConfig, format_code};
pub use installer::ToolInstaller;
pub use language_tools::{available_tools, install_language_tools, install_tool, java_debug_bundle_path, language_tool_status, tool_path};
pub use lint::{Diagnostic, LintRequest, LintResponse, LinterConfig, lint_code};
pub use lsp_launch::{LspLaunch, resolve_lsp_launch};
pub use managed_install::remove_managed_install;
pub use notebook::{run_python_cell, run_r_cell};
pub use progress::with_progress;
pub use registry::ToolRegistry;
pub use runtime::spawn;
pub use types::{LanguageToolConfigSet, LanguageToolStatus, ToolConfig, ToolError, ToolRuntime, ToolStatus, ToolType};

/// The folder tools and runtimes install into: `<data dir>/dev.athas.gpui`.
pub fn default_data_dir() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID))
}
