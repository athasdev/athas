// Domain-organized command modules
pub mod ai;
pub mod app_logs;
pub mod app_update;
pub mod database;
pub mod development;
pub mod editor;
pub mod project;
pub mod ui;
pub mod version_control;

// Standalone modules (not domain-specific)
pub mod extensions;
pub mod fuzzy;
pub mod ipc_streams;

// Re-export all commands from domain modules
pub use ai::*;
pub use app_logs::*;
pub use app_update::*;
pub use database::*;
pub use development::*;
pub use editor::*;
// Re-export standalone modules
pub use extensions::*;
pub use fuzzy::*;
pub use ipc_streams::*;
pub use project::*;
pub use ui::*;
pub use version_control::*;
