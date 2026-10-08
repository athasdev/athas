pub mod client;
pub mod config;
mod document_sync;
pub mod manager;
mod manager_state;
mod manager_support;
mod semantic_tokens;
#[cfg(test)]
mod test_support;
pub mod types;
pub mod utils;

pub use document_sync::{DocumentChange, DocumentChangeBatch};
pub use manager::LspManager;
pub use types::{LspError, LspResult};
