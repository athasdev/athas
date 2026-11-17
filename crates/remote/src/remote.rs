//! Remote development over SSH (`features/remote` and `crates/remote` in Athas): saved connections,
//! `~/.ssh/config` hosts, host key trust, key/agent/password authentication, and the backends the
//! file tree, editor, git panel and terminal use for `remote://<connection-id>/<path>` projects.
//!
//! Every factory below returns `None` for a local path, so a caller tries it first and falls back
//! to its local backend:
//!
//! - file tree: `remote::fs_for(path).unwrap_or_else(file_tree::local)` with `FileTree::with_fs`
//! - editor: [`RemoteFiles`] (with the `editor` feature, `remote::file_backend_for`)
//! - git panel: [`RemoteGit::discover`] (with the `git_panel` feature, `remote::repository_for`)
//! - terminal: [`RemotePty::spawn`] (with the `terminal_view` feature, the terminal's `Pty`)
//!
//! Backends block; call them off the UI thread, as the local ones are.

pub mod connections;
mod connections_view;
pub mod files;
pub mod fs;
pub mod git;
pub mod known_hosts;
pub mod manager;
pub mod path;
pub mod pty;
pub mod seams;
pub mod session;
mod secret_input;
pub mod shell_files;
mod sftp_atomic_rename;
pub mod ssh_config;

use std::{
    path::Path,
    sync::{Arc, OnceLock},
};

pub use connections::{Access, SavedConnection};
pub use connections_view::{ConnectionsEvent, ConnectionsView};
pub use files::{Contents, FileAccess, RemoteFiles};
pub use fs::RemoteFs;
pub use git::{GitRunner, RemoteGit};
pub use known_hosts::HostKeyChallenge;
pub use manager::{Connection, ConnectionManager, RemoteConnections, manager};
pub use path::{RemotePath, is_remote};
pub use pty::{PtySize, RemotePty};
pub use session::PasswordRequired;

#[cfg(feature = "editor")]
pub use seams::editor_adapter::{EditorFiles, editor_backend, file_backend_for};
#[cfg(feature = "git_panel")]
pub use seams::git_adapter::repository_for;
#[cfg(feature = "terminal_view")]
pub use seams::terminal_adapter::spawn_pty;

/// Makes the connection manager a global.
pub fn init(cx: &mut gpui::App) {
    cx.set_global(RemoteConnections(manager().clone()));
}

/// The SFTP file system for a `remote://` path; `None` for a local one. One instance serves
/// every remote project, so watches see what every tree listed.
pub fn fs_for(path: &str) -> Option<Arc<dyn file_tree::Fs>> {
    static FS: OnceLock<Arc<RemoteFs>> = OnceLock::new();
    is_remote(path).then(|| FS.get_or_init(|| Arc::new(RemoteFs::new())).clone() as Arc<dyn file_tree::Fs>)
}

/// The editor's file access for a `remote://` path; `None` for a local one.
pub fn files_for(path: &str) -> Option<Arc<dyn FileAccess>> {
    is_remote(path).then(|| Arc::new(RemoteFiles) as Arc<dyn FileAccess>)
}

/// The repository containing a `remote://` path (blocking: it asks the server). `None` for a local
/// path, or when the folder is not in a repository or the server cannot be reached.
pub fn git_for(path: &Path) -> Option<RemoteGit> {
    RemotePath::from_path(path)?;
    RemoteGit::discover(path)
}

/// A name for a project row or title: `connection:/path`.
pub fn display_path(path: &str) -> Option<String> {
    let remote = RemotePath::parse(path)?;
    let name = connections::load_default()
        .into_iter()
        .find(|connection| connection.id == remote.connection_id)
        .map_or_else(|| remote.connection_id.clone(), |connection| connection.name);
    Some(remote.display(&name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn factories_skip_local_paths() {
        assert!(fs_for("/Users/me/app").is_none());
        assert!(files_for("C:\\code").is_none());
        assert!(git_for(Path::new("/tmp")).is_none());
        assert!(fs_for("remote://box/srv").is_some());
        assert!(files_for("remote://box/srv/a.rs").is_some());
        assert!(display_path("/tmp").is_none());
    }
}
