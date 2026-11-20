//! Projects inside a WSL distribution (`features/wsl` and `crates/wsl` in Athas), named
//! `wsl://<distro>/<linux path>`. Everything runs through `wsl.exe`, so the factories return
//! `None` except on Windows; the code still builds and its path translation is tested everywhere.
//!
//! Each factory returns `None` for a non-WSL path, so callers try `remote::…_for`, then these,
//! then the local backend:
//!
//! - file tree: [`fs_for`]
//! - editor: [`files_for`], wrapped with `remote::editor_backend` (the `editor` feature)
//! - git panel: [`git_for`] (a `remote::RemoteGit` running `git` in the distribution)
//! - terminal: [`terminal_command`], a program for the local PTY

mod backend;
pub mod path;

use std::{
    path::Path,
    sync::{Arc, OnceLock},
};

pub use athas_wsl::{WslDistribution, home_dir, list_distributions};
pub use backend::{WslFiles, WslFs, WslGitRunner, discover_git, run, terminal_command};
pub use path::{display, is_wsl, linux_to_unc, parse, unc_to_wsl};

fn available(path: &str) -> bool {
    cfg!(windows) && is_wsl(path) && parse(path).is_some()
}

pub fn fs_for(path: &str) -> Option<Arc<dyn file_tree::Fs>> {
    static FS: OnceLock<Arc<WslFs>> = OnceLock::new();
    available(path).then(|| FS.get_or_init(|| Arc::new(WslFs::new())).clone() as Arc<dyn file_tree::Fs>)
}

pub fn files_for(path: &str) -> Option<Arc<dyn remote::FileAccess>> {
    available(path).then(|| Arc::new(WslFiles) as Arc<dyn remote::FileAccess>)
}

/// The repository containing a `wsl://` path (blocking: it runs `git` in the distribution).
pub fn git_for(path: &Path) -> Option<remote::RemoteGit> {
    available(path.to_str()?).then(|| discover_git(path)).flatten()
}

/// The Windows share path a `wsl://` path reveals as in File Explorer (`wsl_resolve_windows_path`);
/// `None` for any other path.
pub fn windows_path(path: &Path) -> Option<Result<std::path::PathBuf, String>> {
    let parsed = path::parse_path(path)?;
    Some(athas_wsl::resolve_windows_path(&path::format(&parsed)).map(std::path::PathBuf::from))
}

/// Lets the file tree's and the tabs' Reveal open WSL paths through their share path.
pub fn init(cx: &mut gpui::App) {
    file_tree::register_reveal_resolver(cx, windows_path);
}

/// The `wsl://` path a WSL share path (`\\wsl$\Ubuntu\…`) chosen in a native folder dialog
/// stands for, so it opens as a WSL project instead of a slow network folder.
pub fn project_path_for(chosen: &str) -> Option<String> {
    unc_to_wsl(chosen)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn factories_skip_other_paths() {
        assert!(fs_for("/home/me").is_none());
        assert!(files_for("remote://box/a").is_none());
        assert!(git_for(Path::new("C:\\code")).is_none());
        assert_eq!(fs_for("wsl://Ubuntu/home").is_some(), cfg!(windows));
        assert_eq!(project_path_for(r"\\wsl$\Ubuntu\home\me").as_deref(), Some("wsl://Ubuntu/home/me"));
        assert!(windows_path(Path::new("/home/me")).is_none());
        let share = windows_path(Path::new("wsl://Ubuntu/home/me")).and_then(Result::ok).map(|path| path.to_string_lossy().into_owned());
        assert!(share.is_some_and(|share| share.starts_with(r"\\wsl") && share.ends_with(r"\Ubuntu\home\me")));
    }
}
