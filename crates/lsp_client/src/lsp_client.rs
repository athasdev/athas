//! Language servers for the editor (`crates/lsp` and the LSP parts of `crates/tooling` in Athas):
//! JSON-RPC over stdio, one server per language and project started on demand, document sync,
//! and the diagnostics they publish.

#![recursion_limit = "256"]

mod diagnostics;
mod edit;
mod manager;
mod registry;
mod rpc;
mod server;
mod store;
mod symbols;
mod text;
pub mod uri;

#[cfg(test)]
mod generate;
#[cfg(test)]
mod tests;

use std::path::PathBuf;

pub use diagnostics::{Counts, Diagnostic, DiagnosticsStore, Severity};
pub use edit::{FileOperation, apply_on_disk, operations as workspace_edit_operations};
pub use lsp_types as lsp;
pub use manager::{Document, Launcher, OpenError, ProcessLauncher, ServerKey, ServerManager};
pub use registry::{Launch, LanguageEntry, SearchPaths, ServerEntry, language_for_path, resolve as resolve_server, root_for, server as server_entry};
pub use rpc::RpcError;
pub use server::{EventSink, LanguageServer, MessageWriter, ServerEvent, ServerId, ServerMessage};
pub use store::{LspStore, LspStoreEvent, Progress, init, init_with, on_missing_server};
pub use symbols::{WorkspaceSymbol, flatten_workspace_symbols, symbol_kind_label, workspace_symbols};
pub use text::{TextChange, apply_text_edits, offset_to_position, offsets_to_range, position_to_offset, range_to_offsets, text_edits_to_offsets};

/// A place in a file, as go to definition, references and the panels report it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct FileLocation {
    pub path: PathBuf,
    pub range: lsp::Range,
}

impl FileLocation {
    pub fn from_lsp(location: &lsp::Location) -> Option<Self> {
        Some(Self { path: uri::to_path(&location.uri)?, range: location.range })
    }

    /// The 1-based line, as `Editor::go_to_line` takes it.
    pub fn line(&self) -> usize {
        self.range.start.line as usize + 1
    }

    /// The 1-based column (UTF-16 units, which match characters outside the astral planes).
    pub fn column(&self) -> usize {
        self.range.start.character as usize + 1
    }
}
