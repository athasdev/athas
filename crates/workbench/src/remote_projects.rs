//! Projects on a server (`remote://<connection>/<path>`) or in a WSL distribution
//! (`wsl://<distro>/<path>`): the backends their file tree, editors, git panel and terminals use
//! instead of the local ones, and their names. Each returns `None` for a local project. In the web
//! build every project is on the workspace server the page was served by ([`WebBackend`]).

use std::{path::Path, sync::Arc};
#[cfg(target_family = "wasm")]
use std::{path::PathBuf, sync::OnceLock};

use editor::FileBackend;
use git_panel::Discover;
use gpui::App;
use terminal_view::TerminalStarter;

/// What the web build's project runs on: the workspace server's files, git and terminals.
#[cfg(target_family = "wasm")]
pub struct WebBackend {
    /// The project's folder on the server; paths under it go to the server.
    pub root: PathBuf,
    pub fs: Arc<dyn file_tree::Fs>,
    pub files: Arc<dyn FileBackend>,
    pub git: Discover,
    pub terminal: Arc<dyn Fn(&Path) -> Option<terminal_view::TerminalStart> + Send + Sync>,
}

#[cfg(target_family = "wasm")]
static WEB_BACKEND: OnceLock<WebBackend> = OnceLock::new();

/// Installs the web build's backend, before the workbench opens.
#[cfg(target_family = "wasm")]
pub fn set_web_backend(backend: WebBackend) {
    let _ = WEB_BACKEND.set(backend);
}

#[cfg(target_family = "wasm")]
fn web_backend(path: &Path) -> Option<&'static WebBackend> {
    WEB_BACKEND.get().filter(|backend| path.starts_with(&backend.root))
}

pub(crate) fn init(cx: &mut App) {
    #[cfg(not(target_family = "wasm"))]
    remote::init(cx);
    #[cfg(target_family = "wasm")]
    let _ = cx;
}

pub(crate) fn is_remote_or_wsl(path: &str) -> bool {
    #[cfg(not(target_family = "wasm"))]
    {
        remote::is_remote(path) || wsl::is_wsl(path)
    }
    #[cfg(target_family = "wasm")]
    {
        let _ = path;
        false
    }
}

/// `connection:/path` or `distro:/path`.
pub(crate) fn display_name(path: &str) -> Option<String> {
    #[cfg(not(target_family = "wasm"))]
    {
        remote::display_path(path).or_else(|| wsl::display(path))
    }
    #[cfg(target_family = "wasm")]
    {
        let _ = path;
        None
    }
}

pub(crate) fn file_tree_fs(root: &Path) -> Option<Arc<dyn file_tree::Fs>> {
    #[cfg(not(target_family = "wasm"))]
    {
        let path = root.to_str()?;
        remote::fs_for(path).or_else(|| wsl::fs_for(path))
    }
    #[cfg(target_family = "wasm")]
    {
        web_backend(root).map(|backend| backend.fs.clone())
    }
}

pub(crate) fn file_backend(path: &Path) -> Option<Arc<dyn FileBackend>> {
    #[cfg(not(target_family = "wasm"))]
    {
        let path = path.to_str()?;
        remote::file_backend_for(path).or_else(|| wsl::files_for(path).map(remote::editor_backend))
    }
    #[cfg(target_family = "wasm")]
    {
        web_backend(path).map(|backend| backend.files.clone())
    }
}

pub(crate) fn git_discovery(root: &Path) -> Option<Discover> {
    #[cfg(not(target_family = "wasm"))]
    {
        let path = root.to_str()?;
        if remote::is_remote(path) {
            return Some(Arc::new(remote::repository_for));
        }
        wsl::is_wsl(path).then(|| {
            Arc::new(|path: &Path| wsl::git_for(path).map(|git| Arc::new(git) as Arc<dyn git_panel::GitRepository>)) as Discover
        })
    }
    #[cfg(target_family = "wasm")]
    {
        web_backend(root).map(|backend| backend.git.clone())
    }
}

/// Remote projects get a shell on their server; WSL projects run `wsl.exe` on the local PTY.
pub(crate) fn terminal_starter() -> TerminalStarter {
    std::rc::Rc::new(|cwd: &Path| {
        #[cfg(not(target_family = "wasm"))]
        {
            use terminal_view::TerminalStart;
            let path = cwd.to_str()?;
            if remote::is_remote(path) {
                let cwd = cwd.to_path_buf();
                return Some(TerminalStart::Pty {
                    name: "ssh".into(),
                    spawn: Box::new(move |size, io| remote::spawn_pty(&cwd, size, io)),
                });
            }
            let (program, args) = wsl::terminal_command(path)?;
            Some(TerminalStart::Program { program, args })
        }
        #[cfg(target_family = "wasm")]
        {
            (web_backend(cwd)?.terminal)(cwd)
        }
    })
}

/// Lets project search reach SSH and WSL roots through their command runners.
#[cfg(not(target_family = "wasm"))]
pub(crate) fn register_remote_search() {
    git_panel::set_remote_init(Box::new(|folder: &Path, branch: Option<String>| {
        let path = folder.to_str()?;
        if remote::is_remote(path) {
            return Some(remote::RemoteGit::init(folder, branch.as_deref()));
        }
        let wsl_folder = wsl::parse(path)?;
        let runner = wsl::WslGitRunner { distro: wsl_folder.distro.clone() };
        Some(remote::RemoteGit::init_with(&runner, &wsl_folder.linux_path, branch.as_deref()))
    }));
    palette::set_remote_file_lister(Arc::new(|root: &Path| {
        let fs = file_tree_fs(root).filter(|_| root.to_str().is_some_and(is_remote_or_wsl))?;
        Some(list_files(fs.as_ref(), root))
    }));
    search_panel::set_remote_shells(|root| {
        let path = root.to_str()?;
        if let Some(remote) = remote::RemotePath::parse(path) {
            return Some(Arc::new(SshShell(remote)) as Arc<dyn search_panel::RemoteShell>);
        }
        let folder = wsl::parse(path)?;
        cfg!(windows).then(|| Arc::new(WslShell(folder)) as Arc<dyn search_panel::RemoteShell>)
    });
}

/// Every file under `root` quick open lists, walking folders depth first and skipping the ones
/// it ignores; a folder that cannot be read is skipped, as the original's scan does.
#[cfg(not(target_family = "wasm"))]
pub(crate) fn list_files(fs: &dyn file_tree::Fs, root: &Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    let mut folders = vec![root.to_path_buf()];
    let mut visited = std::collections::HashSet::new();
    while let Some(folder) = folders.pop() {
        if !visited.insert(folder.clone()) {
            continue;
        }
        let Ok(entries) = fs.read_dir(&folder) else { continue };
        for entry in entries.into_iter().rev() {
            if palette::quick_open_ignored(&entry.name, entry.is_dir) {
                continue;
            }
            if entry.is_dir {
                folders.push(entry.path);
            } else {
                files.push(entry.path);
            }
        }
    }
    files
}

#[cfg(not(target_family = "wasm"))]
fn read_text(files: Option<Arc<dyn remote::FileAccess>>, path: &Path) -> Option<String> {
    match files?.load(path).ok()? {
        remote::Contents::Text { text, .. } => Some(text),
        _ => None,
    }
}

#[cfg(not(target_family = "wasm"))]
fn write_text(files: Option<Arc<dyn remote::FileAccess>>, path: &Path, text: &str) -> anyhow::Result<()> {
    let files = files.ok_or_else(|| anyhow::anyhow!("{} is not reachable", path.display()))?;
    files.save(path, text).map(|_| ())
}

#[cfg(not(target_family = "wasm"))]
struct SshShell(remote::RemotePath);

#[cfg(not(target_family = "wasm"))]
impl search_panel::RemoteShell for SshShell {
    fn directory(&self) -> &str {
        &self.0.path
    }

    fn run(&self, script: &str) -> anyhow::Result<Vec<u8>> {
        let output = remote::manager().get_or_connect(&self.0.connection_id)?.exec(script, None)?;
        if output.status != 0 {
            anyhow::bail!("{}", String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(output.stdout)
    }

    fn read(&self, path: &Path) -> Option<String> {
        read_text(remote::files_for(path.to_str()?), path)
    }

    fn write(&self, path: &Path, text: &str) -> anyhow::Result<()> {
        write_text(remote::files_for(path.to_str().unwrap_or_default()), path, text)
    }
}

#[cfg(not(target_family = "wasm"))]
struct WslShell(wsl::path::WslPath);

#[cfg(not(target_family = "wasm"))]
impl search_panel::RemoteShell for WslShell {
    fn directory(&self) -> &str {
        &self.0.linux_path
    }

    fn run(&self, script: &str) -> anyhow::Result<Vec<u8>> {
        wsl::run(&self.0.distro, &["sh", "-c", script], None)
    }

    fn read(&self, path: &Path) -> Option<String> {
        read_text(wsl::files_for(path.to_str()?), path)
    }

    fn write(&self, path: &Path, text: &str) -> anyhow::Result<()> {
        write_text(wsl::files_for(path.to_str().unwrap_or_default()), path, text)
    }
}

#[cfg(all(test, not(target_family = "wasm")))]
mod tests {
    use super::*;

    #[test]
    fn lists_files_without_ignored_folders() {
        let dir = std::env::temp_dir().join(format!("athas-quick-open-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("src/nested")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        std::fs::write(dir.join("src/nested/a.rs"), "").unwrap();
        std::fs::write(dir.join("src/b.rs"), "").unwrap();
        std::fs::write(dir.join("Cargo.lock"), "").unwrap();
        std::fs::write(dir.join("node_modules/pkg/index.js"), "").unwrap();
        let mut files: Vec<String> = list_files(file_tree::local_fs().as_ref(), &dir)
            .into_iter()
            .map(|path| path.strip_prefix(&dir).unwrap().to_string_lossy().into_owned())
            .collect();
        files.sort();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(files, ["src/b.rs", "src/nested/a.rs"]);
    }
}
