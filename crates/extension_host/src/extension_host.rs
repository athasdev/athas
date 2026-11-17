//! UI extensions: JavaScript that registers sidebar views, toolbar actions and commands, and draws
//! through a declarative view schema. On the desktop each one runs in its own QuickJS runtime; in
//! the browser in its own Web Worker. `extensions_ui` renders the views.

pub mod adapter;
#[cfg(not(target_family = "wasm"))]
pub mod engine;
pub mod generate;
pub mod generated;
pub mod host;
pub mod permissions;
pub mod services;
pub mod store;
pub mod view;
pub mod web;
#[cfg(target_family = "wasm")]
pub mod web_worker;

use std::sync::Arc;

pub use generated::{ContributionType, GeneratedExtension, GeneratedStore, HostManifest};
pub use store::{AiProvider, AiSettingsAction, Command, Dialog, SidebarView, ToolbarAction, ToolbarPosition};
pub use host::Host;
pub use permissions::Permissions;
pub use services::{AppBridge, HostServices, WorkspaceContext};
pub use store::{ExtensionState, Registration, Store};
pub use view::{Action, Node, parse_view};

/// The worker side of `runtime.js`, for hosts that load it themselves.
pub const RUNTIME_JS: &str = include_str!("runtime.js");

/// What one extension's worker may use.
#[derive(Clone, Debug)]
pub struct Limits {
    pub memory_bytes: usize,
    pub stack_bytes: usize,
    /// How long one turn of JavaScript (a message, a timer and the promise jobs they start) may
    /// run before the worker is stopped.
    pub turn_budget: std::time::Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self { memory_bytes: 64 * 1024 * 1024, stack_bytes: 1024 * 1024, turn_budget: std::time::Duration::from_secs(5) }
    }
}

/// Receives each JSON message a worker posts.
pub type WorkerSink = Arc<dyn Fn(String) + Send + Sync>;

/// A running worker the host can post JSON messages to.
pub trait WorkerTransport: Send {
    fn post(&self, message: String);
    fn terminate(&self);
}

/// Starts workers; the platform's own by default, a fake in tests.
pub trait WorkerFactory: Send + Sync {
    fn spawn(&self, name: &str, limits: Limits, sink: WorkerSink) -> anyhow::Result<Box<dyn WorkerTransport>>;
}

/// QuickJS threads on the desktop, Web Workers in the browser.
pub struct PlatformWorkers;

impl WorkerFactory for PlatformWorkers {
    fn spawn(&self, name: &str, limits: Limits, sink: WorkerSink) -> anyhow::Result<Box<dyn WorkerTransport>> {
        #[cfg(not(target_family = "wasm"))]
        return Ok(Box::new(engine::spawn(name, limits, sink)?));
        #[cfg(target_family = "wasm")]
        return Ok(Box::new(web_worker::spawn(name, limits, sink)?));
    }
}

/// What the host tells the app beyond store changes.
#[derive(Clone, Debug, PartialEq)]
pub enum HostEvent {
    /// Registrations, views or states changed.
    Changed,
    Notification { extension_id: String, title: String, description: Option<String>, tone: String, duration_ms: Option<u64> },
    Clipboard(String),
    OpenExternal(String),
    Log { extension_id: String, level: String, message: String },
    /// `editor.updateSettings`: session overrides of the editor settings.
    EditorSettings(serde_json::Value),
    /// `editor.clearSettingOverrides`.
    ClearEditorSettings,
}

#[cfg(test)]
mod tests;
