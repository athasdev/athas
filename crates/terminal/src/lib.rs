pub mod config;
pub mod connection;
pub mod manager;
pub mod protocol;
pub mod shell;

pub use config::TerminalConfig;
pub use manager::TerminalManager;
pub use protocol::{
   TerminalEvent, TerminalEventHandler, TerminalInput, TerminalReaderControl, TerminalSize,
};
pub use shell::get_shells;
