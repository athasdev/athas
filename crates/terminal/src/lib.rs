pub mod config;
pub mod connection;
pub mod manager;
pub mod shell;

pub use config::TerminalConfig;
pub use manager::TerminalManager;
pub use shell::get_shells;
