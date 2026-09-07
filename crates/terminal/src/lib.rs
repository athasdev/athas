pub mod config;
pub mod connection;
pub mod manager;
pub mod protocol;
pub mod shell;
pub mod shell_integration;

pub use config::TerminalConfig;
pub use manager::TerminalManager;
pub use protocol::{
   TerminalEvent, TerminalEventHandler, TerminalInput, TerminalReaderControl, TerminalSize,
};
pub use shell::get_shells;
pub use shell_integration::ensure_shell_integration_dir;
