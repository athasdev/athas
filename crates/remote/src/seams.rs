//! The remote backends behind the editor's, git panel's and terminal's own traits. Those traits
//! are private to their crates today, so each adapter is behind a feature the workbench turns on
//! once the crate exports what it names (see the crate's integration notes). Tests compile the
//! adapters against exact copies of the traits, so they stay correct until then.
//!
//! What each feature needs from its crate:
//! - `editor`: `pub use fs::Loaded` beside `FileBackend` in `editor.rs`.
//! - `git_panel`: `pub use repository::{GitRepository, WorkingTree, StatusEntry, FileStatus,
//!   DiffStat, Commit, Stash, Checkout, StashAction, RemoteOp}`, and a way to hand the panel a
//!   repository (its discovery calls `repository::discover` today).
//! - `terminal_view`: `pub use pty::{Pty, PtySize, PtyIo}` (made `pub`), and a way to start a
//!   terminal on a given `Pty` instead of `pty::spawn`.

#[cfg(feature = "editor")]
use editor as editor_api;
#[cfg(feature = "git_panel")]
use git_panel as git_api;
#[cfg(feature = "terminal_view")]
use terminal_view as terminal_api;

#[cfg(any(feature = "editor", test))]
pub mod editor_adapter {
    use std::{path::Path, sync::Arc, time::SystemTime};

    use anyhow::Result;

    use super::editor_api::{FileBackend, Loaded};
    use crate::{Contents, RemoteFiles, files::FileAccess, is_remote};

    /// Any [`FileAccess`] as the editor's `FileBackend`.
    pub struct EditorFiles(pub Arc<dyn FileAccess>);

    impl FileBackend for EditorFiles {
        fn load(&self, path: &Path) -> Result<Loaded> {
            Ok(match self.0.load(path)? {
                Contents::Text { text, modified } => Loaded::Text { text, modified },
                Contents::Binary => Loaded::Binary,
                Contents::TooLarge(size) => Loaded::TooLarge(size),
            })
        }

        fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>> {
            self.0.save(path, text)
        }

        /// Writes only while the server's file still holds `expected` (a byte order mark aside),
        /// so a change made there since it was read is not overwritten.
        fn save_checked(&self, path: &Path, text: &str, expected: &str) -> Result<Option<SystemTime>> {
            self.0.save_checked(path, text, expected)
        }

        fn modified(&self, path: &Path) -> Option<SystemTime> {
            self.0.modified(path)
        }
    }

    pub fn editor_backend(access: Arc<dyn FileAccess>) -> Arc<dyn FileBackend> {
        Arc::new(EditorFiles(access))
    }

    /// For `Editor::open_with`: the remote backend for a `remote://` path, `None` otherwise.
    pub fn file_backend_for(path: &str) -> Option<Arc<dyn FileBackend>> {
        is_remote(path).then(|| editor_backend(Arc::new(RemoteFiles)))
    }
}

#[cfg(any(feature = "git_panel", test))]
pub mod git_adapter {
    use std::{path::Path, sync::Arc};

    use anyhow::Result;

    use super::git_api as api;
    use crate::git::{self, RemoteGit};

    fn status(status: git::FileStatus) -> api::FileStatus {
        match status {
            git::FileStatus::Modified => api::FileStatus::Modified,
            git::FileStatus::Added => api::FileStatus::Added,
            git::FileStatus::Deleted => api::FileStatus::Deleted,
            git::FileStatus::Renamed => api::FileStatus::Renamed,
            git::FileStatus::Untracked => api::FileStatus::Untracked,
        }
    }

    impl api::GitRepository for RemoteGit {
        fn root(&self) -> &Path {
            RemoteGit::root(self)
        }

        fn status(&self) -> Result<api::WorkingTree> {
            let tree = RemoteGit::status(self)?;
            Ok(api::WorkingTree {
                branch: tree.branch,
                head: tree.head,
                ahead: tree.ahead,
                behind: tree.behind,
                files: tree
                    .files
                    .into_iter()
                    .map(|file| api::StatusEntry { path: file.path, status: status(file.status), staged: file.staged })
                    .collect(),
                stats: tree
                    .stats
                    .into_iter()
                    .map(|stat| api::DiffStat {
                        path: stat.path,
                        staged: stat.staged,
                        additions: stat.additions,
                        deletions: stat.deletions,
                    })
                    .collect(),
            })
        }

        fn branches(&self) -> Result<Vec<String>> {
            RemoteGit::branches(self)
        }

        fn log(&self, skip: usize, limit: usize) -> Result<Vec<api::Commit>> {
            Ok(RemoteGit::log(self, skip, limit)?
                .into_iter()
                .map(|commit| api::Commit { hash: commit.hash, summary: commit.summary, author: commit.author, email: String::new(), date: commit.date, description: None })
                .collect())
        }

        fn stashes(&self) -> Result<Vec<api::Stash>> {
            Ok(RemoteGit::stashes(self)?
                .into_iter()
                .map(|stash| api::Stash { index: stash.index, message: stash.message, date: stash.date })
                .collect())
        }

        fn set_staged(&self, paths: &[String], staged: bool) -> Result<()> {
            RemoteGit::set_staged(self, paths, staged)
        }

        fn discard(&self, paths: &[String]) -> Result<()> {
            RemoteGit::discard(self, paths)
        }

        fn discard_all(&self) -> Result<()> {
            RemoteGit::discard_all(self)
        }

        fn commit(&self, message: &str) -> Result<()> {
            RemoteGit::commit(self, message)
        }

        fn checkout(&self, branch: &str) -> Result<api::Checkout> {
            Ok(match RemoteGit::checkout(self, branch)? {
                git::Checkout::Switched => api::Checkout::Switched,
                git::Checkout::Blocked(message) => api::Checkout::Blocked(message),
            })
        }

        fn create_branch(&self, name: &str, from: Option<&str>) -> Result<()> {
            RemoteGit::create_branch(self, name, from)
        }

        fn delete_branch(&self, name: &str) -> Result<()> {
            RemoteGit::delete_branch(self, name)
        }

        fn stash(&self, message: Option<&str>, paths: Option<Vec<String>>) -> Result<()> {
            RemoteGit::stash(self, message, paths)
        }

        fn stash_action(&self, action: api::StashAction, index: usize) -> Result<()> {
            let action = match action {
                api::StashAction::Apply => git::StashAction::Apply,
                api::StashAction::Pop => git::StashAction::Pop,
                api::StashAction::Drop => git::StashAction::Drop,
            };
            RemoteGit::stash_action(self, action, index)
        }

        fn remote(&self, op: api::RemoteOp, pull_rebase: bool) -> Result<()> {
            let op = match op {
                api::RemoteOp::Fetch => git::RemoteOp::Fetch,
                api::RemoteOp::Pull => git::RemoteOp::Pull,
                api::RemoteOp::Push => git::RemoteOp::Push,
            };
            RemoteGit::remote(self, op, pull_rebase)
        }
    }

    /// For the git panel's discovery: the remote repository for a `remote://` path (blocking).
    pub fn repository_for(path: &Path) -> Option<Arc<dyn api::GitRepository>> {
        crate::git_for(path).map(|repository| Arc::new(repository) as Arc<dyn api::GitRepository>)
    }
}

#[cfg(any(feature = "terminal_view", test))]
pub mod terminal_adapter {
    use std::path::Path;

    use anyhow::Result;

    use super::terminal_api as api;
    use crate::{PtySize, RemotePty};

    fn size(size: api::PtySize) -> PtySize {
        PtySize { rows: size.rows, cols: size.cols, cell_width: size.cell_width, cell_height: size.cell_height }
    }

    impl api::Pty for RemotePty {
        fn resize(&self, new_size: api::PtySize) {
            RemotePty::resize(self, size(new_size));
        }

        fn foreground_process_name(&self) -> Option<String> {
            RemotePty::foreground_process_name(self)
        }
    }

    /// For the terminal's `pty::spawn`: a remote shell when `cwd` is a `remote://` path.
    pub fn spawn_pty(cwd: &Path, pty_size: api::PtySize, io: api::PtyIo) -> Result<Box<dyn api::Pty>> {
        let api::PtyIo { input, output, exited } = io;
        let exited = Box::new(move |status: crate::pty::ExitStatus| exited(api::ExitStatus { code: status.code, signal: status.signal }));
        Ok(Box::new(RemotePty::spawn(cwd, size(pty_size), input, output, exited)?))
    }
}

/// Copies of the editor's `fs.rs` items the adapter names.
#[cfg(all(test, not(feature = "editor")))]
pub mod editor_api {
    use std::{path::Path, time::SystemTime};

    use anyhow::Result;

    pub enum Loaded {
        Text { text: String, modified: Option<SystemTime> },
        Binary,
        TooLarge(u64),
    }

    pub trait FileBackend: Send + Sync {
        fn load(&self, path: &Path) -> Result<Loaded>;
        fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>>;
        fn save_checked(&self, path: &Path, text: &str, _expected: &str) -> Result<Option<SystemTime>> {
            self.save(path, text)
        }
        fn modified(&self, path: &Path) -> Option<SystemTime>;
        fn is_local(&self) -> bool {
            false
        }
    }
}

/// Copies of the git panel's `repository.rs` items the adapter names.
#[cfg(all(test, not(feature = "git_panel")))]
pub mod git_api {
    use std::path::Path;

    use anyhow::Result;

    pub enum FileStatus {
        Modified,
        Added,
        Deleted,
        Renamed,
        Untracked,
    }

    pub struct StatusEntry {
        pub path: String,
        pub status: FileStatus,
        pub staged: bool,
    }

    pub struct DiffStat {
        pub path: String,
        pub staged: bool,
        pub additions: usize,
        pub deletions: usize,
    }

    pub struct WorkingTree {
        pub branch: String,
        pub head: Option<String>,
        pub ahead: usize,
        pub behind: usize,
        pub files: Vec<StatusEntry>,
        pub stats: Vec<DiffStat>,
    }

    pub struct Commit {
        pub hash: String,
        pub summary: String,
        pub author: String,
        pub email: String,
        pub date: String,
        pub description: Option<String>,
    }

    pub struct Stash {
        pub index: usize,
        pub message: String,
        pub date: String,
    }

    pub enum RemoteOp {
        Fetch,
        Pull,
        Push,
    }

    pub enum Checkout {
        Switched,
        Blocked(String),
    }

    pub enum StashAction {
        Apply,
        Pop,
        Drop,
    }

    pub trait GitRepository: Send + Sync {
        fn root(&self) -> &Path;
        fn status(&self) -> Result<WorkingTree>;
        fn branches(&self) -> Result<Vec<String>>;
        fn log(&self, skip: usize, limit: usize) -> Result<Vec<Commit>>;
        fn stashes(&self) -> Result<Vec<Stash>>;
        fn set_staged(&self, paths: &[String], staged: bool) -> Result<()>;
        fn discard(&self, paths: &[String]) -> Result<()>;
        fn discard_all(&self) -> Result<()>;
        fn commit(&self, message: &str) -> Result<()>;
        fn checkout(&self, branch: &str) -> Result<Checkout>;
        fn create_branch(&self, name: &str, from: Option<&str>) -> Result<()>;
        fn delete_branch(&self, name: &str) -> Result<()>;
        fn stash(&self, message: Option<&str>, paths: Option<Vec<String>>) -> Result<()>;
        fn stash_action(&self, action: StashAction, index: usize) -> Result<()>;
        fn remote(&self, op: RemoteOp, pull_rebase: bool) -> Result<()>;
    }
}

/// Copies of the terminal's `pty.rs` items the adapter names.
#[cfg(all(test, not(feature = "terminal_view")))]
pub mod terminal_api {
    use std::sync::mpsc::Receiver;

    pub use crate::pty::ExitStatus;

    pub struct PtySize {
        pub rows: u16,
        pub cols: u16,
        pub cell_width: u16,
        pub cell_height: u16,
    }

    pub struct PtyIo {
        pub input: Receiver<Vec<u8>>,
        pub output: crate::pty::OutputCallback,
        pub exited: Box<dyn FnOnce(crate::pty::ExitStatus) + Send>,
    }

    pub trait Pty {
        fn resize(&self, size: PtySize);
        fn foreground_process_name(&self) -> Option<String>;
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    #[test]
    fn adapters_skip_local_paths() {
        assert!(super::editor_adapter::file_backend_for("/tmp/a.rs").is_none());
        assert!(super::editor_adapter::file_backend_for("remote://box/a.rs").is_some());
        assert!(super::git_adapter::repository_for(Path::new("/tmp")).is_none());
        let (_, input) = std::sync::mpsc::channel();
        let io = super::terminal_api::PtyIo { input, output: Box::new(|_| {}), exited: Box::new(|_| {}) };
        let size = super::terminal_api::PtySize { rows: 24, cols: 80, cell_width: 8, cell_height: 16 };
        assert!(super::terminal_adapter::spawn_pty(Path::new("/tmp"), size, io).is_err());
    }
    struct MemoryFiles(std::sync::Mutex<String>);

    impl crate::files::FileAccess for MemoryFiles {
        fn load(&self, _: &Path) -> anyhow::Result<crate::Contents> {
            Ok(crate::Contents::Text { text: self.0.lock().unwrap().clone(), modified: None })
        }

        fn save(&self, _: &Path, text: &str) -> anyhow::Result<Option<std::time::SystemTime>> {
            *self.0.lock().unwrap() = text.to_string();
            Ok(None)
        }

        fn modified(&self, _: &Path) -> Option<std::time::SystemTime> {
            None
        }
    }

    #[test]
    fn checked_saves_refuse_a_remote_file_changed_since_it_was_read() {
        use super::editor_api::FileBackend as _;
        let files = std::sync::Arc::new(MemoryFiles(std::sync::Mutex::new("\u{feff}loaded".into())));
        let backend = super::editor_adapter::EditorFiles(files.clone());
        let path = Path::new("remote://box/a.rs");
        backend.save_checked(path, "edited", "loaded").unwrap();
        assert_eq!(*files.0.lock().unwrap(), "edited");
        *files.0.lock().unwrap() = "theirs".into();
        assert!(backend.save_checked(path, "mine", "edited").unwrap_err().to_string().contains("The file changed"));
        assert_eq!(*files.0.lock().unwrap(), "theirs");
    }
}
