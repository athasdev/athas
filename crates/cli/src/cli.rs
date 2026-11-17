//! The `athas` terminal command: its arguments, the local socket it hands them to a running
//! Athas over, the `--wait` markers, and installing the command into `~/.local/bin`.

pub mod args;
pub mod install;
pub mod launch;
pub mod protocol;
pub mod transport;
pub mod wait;

pub use args::{CliRequest, HELP_TEXT, ParsedCli, parse_cli, parse_cli_argv};

/// The folder this build's data lives in (`dev.athas.gpui` for development builds).
pub const APP_ID: &str = paths::APP_ID;

/// The bundle identifier `open -b` finds this build by (`com.code.athas` when shipped).
pub const BUNDLE_ID: &str = paths::BUNDLE_ID;

/// `<data dir>/<APP_ID>`, where settings, the workspace and the socket live.
pub fn data_dir() -> Option<std::path::PathBuf> {
    paths::data_dir()
}
