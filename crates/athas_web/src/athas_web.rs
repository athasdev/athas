//! Athas in the browser: the workbench compiled to wasm, drawn by GPUI's web platform into a page
//! canvas, with its project on a workspace server (`athas_server`, or a cloud workspace) reached
//! over the workspace protocol (`web_protocol`).
//!
//! The backends the workbench asks for (files, editor buffers, git, diffs and blame, search,
//! terminals, language servers, agents, GitHub, Docker) are plain Rust over a [`Transport`], so they are tested natively
//! against an in-process server. The browser's transport makes blocking calls with synchronous
//! `POST /call` requests, the way the workbench's file system and git interfaces expect, and
//! listens on the workspace socket for file changes, terminal output and language servers'
//! messages ([`Events`]).

mod agents;
pub mod cloud;
mod diffs;
mod events;
mod files;
mod git;
mod github;
mod lsp;
mod search;
mod services;
mod terminal;
pub mod transfers;
#[cfg(target_family = "wasm")]
mod web;

use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};
use serde_json::Value;
use web_protocol::CallError;

pub use agents::RemoteAgentHost;
pub use diffs::RemoteDiffs;
pub use events::Events;
pub use files::RemoteFs;
pub use git::{RemoteGit, discover};
pub use github::GitHubRelay;
pub use lsp::RemoteLauncher;
pub use search::grep;
pub use services::{ServiceRelay, preview_address};
pub use terminal::{RemotePty, send_input, spawn_terminal};

/// How the backends reach the workspace server.
pub trait Transport: Send + Sync {
    /// Runs one protocol method and waits for its answer.
    fn call(&self, method: &str, params: Value) -> Result<Value, CallError>;
    /// Runs a method whose answer nobody waits for, such as terminal input.
    fn notify(&self, method: &str, params: Value) {
        let _ = self.call(method, params);
    }
}

/// The protocol path of `path`, which must be inside `root`.
pub(crate) fn relative(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).map_err(|_| anyhow!("{} is outside the workspace", path.display()))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn absolute(root: &Path, relative: &str) -> PathBuf {
    if relative.is_empty() { root.to_path_buf() } else { root.join(relative) }
}

pub(crate) fn failed(error: CallError) -> anyhow::Error {
    anyhow!(error.message)
}

#[cfg(test)]
mod tests;
