//! Claude Code's editor integration (`/ide`): a localhost WebSocket server speaking MCP, advertised
//! to `claude` by a lock file under `~/.claude/ide`, so Claude Code in a terminal sees the current
//! selection, opens files, reads diagnostics, and proposes edits as diffs to accept or reject here.
//! Runs while the "Claude Code Editor Integration" setting is on.
//!
//! The server, auth and MCP protocol are the old app's `crates/claude-ide`; this crate is its
//! frontend, ported from `integrations/claude-code/services/claude-ide-*.ts` and
//! `src-tauri/src/claude_ide.rs`.
//!
//! # Integrating (crates/workbench)
//!
//! - Start-up: [`init`], then [`set_bridge`] with the workbench's view of its editors.
//! - Centre views: a `TabItem::Resource` of a kind in [`RESOURCE_KINDS`] opens with
//!   [`open_resource_with_focus`].
//! - Terminals: add [`terminal_env`] to a new shell's environment so `claude` finds Athas.

mod diff_view;
#[cfg(not(target_family = "wasm"))]
mod service;
pub mod tools;

#[cfg(all(test, not(target_family = "wasm")))]
mod tests;

use std::{
    path::{Path, PathBuf},
    rc::Rc,
};

use gpui::{AnyView, App, AppContext as _, Focusable as _, Global, Window};

pub use diff_view::ClaudeDiffView;
pub use tools::{IdeDiagnostic, OpenEditor};

pub const RESOURCE_KIND: &str = "claude-diff";
pub const RESOURCE_KINDS: &[&str] = &[RESOURCE_KIND];

/// The active editor's selection (the caret when nothing is selected), zero-based.
#[derive(Clone, Debug, PartialEq)]
pub struct Selection {
    pub path: PathBuf,
    pub text: String,
    pub start: (u32, u32),
    pub end: (u32, u32),
}

/// What the integration needs from the window in front.
pub trait EditorBridge {
    fn selection(&self, cx: &App) -> Option<Selection>;
    fn open_editors(&self, cx: &App) -> Vec<OpenEditor>;
    /// An open editor's text.
    fn editor_text(&self, path: &Path, cx: &App) -> Option<String>;
    /// Saves an open file; `None` when it is not open.
    fn save(&self, path: &Path, cx: &mut App) -> Option<bool>;
    /// Closes the file tab named `name` (its label or path).
    fn close_tab(&self, name: &str, cx: &mut App);
    /// Closes the tool tab `(kind, id)`.
    fn close_resource(&self, kind: &str, id: &str, cx: &mut App);
    /// Every local folder open in the windows, primary roots first.
    fn workspace_folders(&self, cx: &App) -> Vec<PathBuf>;
}

pub(crate) struct Bridge(pub Rc<dyn EditorBridge>);

impl Global for Bridge {}

pub fn set_bridge(bridge: Rc<dyn EditorBridge>, cx: &mut App) {
    cx.set_global(Bridge(bridge));
}

pub(crate) fn bridge(cx: &App) -> Option<Rc<dyn EditorBridge>> {
    cx.try_global::<Bridge>().map(|bridge| bridge.0.clone())
}

/// Starts the server when the setting is on, and follows the setting.
pub fn init(cx: &mut App) {
    #[cfg(not(target_family = "wasm"))]
    service::init(cx);
    #[cfg(target_family = "wasm")]
    let _ = cx;
}

/// The variables a new terminal needs so `claude` connects to Athas, while the server runs.
pub fn terminal_env(cx: &App) -> Vec<(String, String)> {
    #[cfg(not(target_family = "wasm"))]
    {
        service::terminal_env(cx)
    }
    #[cfg(target_family = "wasm")]
    {
        let _ = cx;
        Vec::new()
    }
}

/// Sends the active editor's selection, or its file, to Claude Code as an @-mention.
pub fn send_selection(cx: &mut App) -> Result<(), String> {
    #[cfg(not(target_family = "wasm"))]
    {
        service::send_selection(cx)
    }
    #[cfg(target_family = "wasm")]
    {
        let _ = cx;
        Err("Claude Code runs in the desktop app".into())
    }
}

/// Whether the server runs and Claude Code is connected.
pub fn status(cx: &App) -> (bool, bool) {
    #[cfg(not(target_family = "wasm"))]
    {
        service::status(cx)
    }
    #[cfg(target_family = "wasm")]
    {
        let _ = cx;
        (false, false)
    }
}

/// Shows a proposed change as `openDiff` does and calls `respond` with Claude's answer; for
/// previews and tests.
pub fn propose(request: tools::DiffRequest, old_text: String, respond: impl FnOnce(Vec<String>) + 'static, cx: &mut App) {
    diff_view::add(diff_view::PendingDiff { request, old_text, respond: Box::new(respond) }, cx);
}

pub fn open_resource_with_focus(kind: &str, id: &str, window: &mut Window, cx: &mut App) -> Option<(AnyView, gpui::FocusHandle)> {
    if kind != RESOURCE_KIND {
        return None;
    }
    let view = cx.new(|cx| ClaudeDiffView::new(id.to_string(), window, cx));
    let focus = view.focus_handle(cx);
    Some((view.into(), focus))
}
