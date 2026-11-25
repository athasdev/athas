//! The file tree, editor, git and terminal backends for `wsl://` paths, all through `wsl.exe`
//! (Athas's `crates/wsl` file commands). Watching polls the folders the tree has listed, since
//! change notifications do not cross into the distribution's file system.

use std::{
    any::Any,
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Result, anyhow, bail};
use file_tree::{Changes, DirEntry, Fs};
use remote::{Contents, FileAccess, GitRunner, RemoteGit, files::MAX_FILE_SIZE};

use crate::path::{WslPath, format, join, parse_path};

const POLL_INTERVAL: Duration = Duration::from_secs(3);
const MAX_POLLED_FOLDERS: usize = 256;

fn wsl_path(path: &Path) -> Result<WslPath> {
    parse_path(path).ok_or_else(|| anyhow!("{} is not a WSL path", path.display()))
}

/// Runs `program args…` inside `distro` without a shell; stdout on success, stderr as the error.
pub fn run(distro: &str, arguments: &[&str], stdin: Option<&[u8]>) -> Result<Vec<u8>> {
    if !cfg!(windows) {
        bail!("WSL is only available on Windows");
    }
    let mut command = athas_wsl::exec_command(distro);
    command
        .args(arguments)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| anyhow!("Failed to run wsl.exe: {error}"))?;
    if let Some(input) = stdin
        && let Some(mut pipe) = child.stdin.take()
    {
        pipe.write_all(input)?;
    }
    let output = child.wait_with_output()?;
    if output.status.success() {
        return Ok(output.stdout);
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    bail!(if message.is_empty() { format!("{} failed in {distro}", arguments.first().unwrap_or(&"command")) } else { message })
}

fn text_error(error: String) -> anyhow::Error {
    anyhow!(error)
}

/// One folder's entries by name: folder or not, and size.
type Snapshot = HashMap<String, (bool, u64)>;

#[derive(Default)]
pub struct WslFs {
    listed: Arc<Mutex<HashMap<String, (WslPath, Snapshot)>>>,
}

impl WslFs {
    pub fn new() -> Self {
        Self::default()
    }
}

fn list(path: &WslPath) -> Result<Vec<athas_wsl::WslFileEntry>> {
    athas_wsl::read_directory(&path.distro, &path.linux_path).map_err(text_error)
}

fn snapshot(entries: &[athas_wsl::WslFileEntry]) -> Snapshot {
    entries.iter().map(|entry| (entry.name.clone(), (entry.is_dir, entry.size))).collect()
}

fn test_exists(path: &WslPath) -> bool {
    run(&path.distro, &["sh", "-c", r#"[ -e "$1" ] || [ -L "$1" ]"#, "athas", &path.linux_path], None).is_ok()
}

impl Fs for WslFs {
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
        let folder = wsl_path(path)?;
        let entries = list(&folder)?;
        self.listed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(format(&folder), (folder.clone(), snapshot(&entries)));
        Ok(entries
            .into_iter()
            .map(|entry| DirEntry {
                path: PathBuf::from(join(&folder, &entry.name)),
                name: entry.name,
                is_dir: entry.is_dir,
                is_symlink: entry.is_symlink,
            })
            .collect())
    }

    fn read_to_string(&self, path: &Path) -> Result<String> {
        let file = wsl_path(path)?;
        athas_wsl::read_file(&file.distro, &file.linux_path).map_err(text_error)
    }

    fn is_dir(&self, path: &Path) -> bool {
        wsl_path(path)
            .ok()
            .and_then(|path| athas_wsl::symlink_info(&path.distro, &path.linux_path).ok())
            .is_some_and(|info| info.is_dir)
    }

    fn exists(&self, path: &Path) -> bool {
        wsl_path(path).is_ok_and(|path| test_exists(&path))
    }

    fn create_file(&self, path: &Path) -> Result<()> {
        let file = wsl_path(path)?;
        athas_wsl::create_file(&file.distro, &file.linux_path).map_err(text_error)
    }

    fn create_dir(&self, path: &Path) -> Result<()> {
        let folder = wsl_path(path)?;
        if test_exists(&folder) {
            bail!("{} already exists", folder.linux_path);
        }
        athas_wsl::create_directory(&folder.distro, &folder.linux_path).map_err(text_error)
    }

    fn rename(&self, from: &Path, to: &Path) -> Result<()> {
        self.move_path(from, to)
    }

    fn move_path(&self, from: &Path, to: &Path) -> Result<()> {
        let (from, to) = (wsl_path(from)?, wsl_path(to)?);
        if !from.distro.eq_ignore_ascii_case(&to.distro) {
            bail!("Moving between WSL distributions is not supported");
        }
        athas_wsl::rename_path(&from.distro, &from.linux_path, &to.linux_path).map_err(text_error)
    }

    fn copy(&self, from: &Path, to: &Path) -> Result<()> {
        let (from, to) = (wsl_path(from)?, wsl_path(to)?);
        if !from.distro.eq_ignore_ascii_case(&to.distro) {
            bail!("Copying between WSL distributions is not supported");
        }
        if test_exists(&to) {
            bail!("{} already exists", to.linux_path);
        }
        athas_wsl::copy_path(&from.distro, &from.linux_path, &to.linux_path, true).map_err(text_error)
    }

    fn trash(&self, path: &Path) -> Result<()> {
        self.remove(path)
    }

    fn remove(&self, path: &Path) -> Result<()> {
        let target = wsl_path(path)?;
        if target.linux_path == "/" {
            bail!("Refusing to delete /");
        }
        athas_wsl::delete_path(&target.distro, &target.linux_path, true).map_err(text_error)
    }

    fn watch(&self, root: &Path, on_change: Box<dyn Fn(Changes) + Send + Sync>) -> Result<Box<dyn Any + Send>> {
        let root = wsl_path(root)?;
        let stop = Arc::new(AtomicBool::new(false));
        let (stopped, listed) = (stop.clone(), self.listed.clone());
        std::thread::Builder::new().name("wsl-watch".into()).spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                std::thread::sleep(POLL_INTERVAL);
                let folders: Vec<(String, WslPath, Snapshot)> = listed
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .iter()
                    .filter(|(_, (folder, _))| folder.distro == root.distro && within(&folder.linux_path, &root.linux_path))
                    .take(MAX_POLLED_FOLDERS)
                    .map(|(key, (folder, snapshot))| (key.clone(), folder.clone(), snapshot.clone()))
                    .collect();
                let mut changes = Changes::default();
                for (key, folder, before) in folders {
                    if stopped.load(Ordering::Relaxed) {
                        return;
                    }
                    let after = list(&folder).map(|entries| snapshot(&entries)).unwrap_or_default();
                    if after != before {
                        changes.paths.extend(
                            after
                                .keys()
                                .filter(|name| after.get(*name) != before.get(*name))
                                .chain(before.keys().filter(|name| !after.contains_key(*name)))
                                .map(|name| PathBuf::from(join(&folder, name))),
                        );
                        listed.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(key, (folder, after));
                    }
                }
                if !changes.paths.is_empty() {
                    on_change(changes);
                }
            }
        })?;
        Ok(Box::new(StopOnDrop(stop)))
    }
}

struct StopOnDrop(Arc<AtomicBool>);

impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

fn within(path: &str, root: &str) -> bool {
    root == "/" || path == root || path.strip_prefix(root).is_some_and(|rest| rest.starts_with('/'))
}

/// Size and modification time: `stat -c '%s %Y'`.
fn stat(path: &WslPath) -> Result<(u64, SystemTime)> {
    let output = run(&path.distro, &["stat", "-L", "-c", "%s %Y", &path.linux_path], None)?;
    parse_stat(&String::from_utf8_lossy(&output)).ok_or_else(|| anyhow!("Unexpected stat output for {}", path.linux_path))
}

fn parse_stat(output: &str) -> Option<(u64, SystemTime)> {
    let mut fields = output.split_whitespace();
    let size = fields.next()?.parse().ok()?;
    let seconds: u64 = fields.next()?.parse().ok()?;
    Some((size, UNIX_EPOCH + Duration::from_secs(seconds)))
}

/// The editor's file access for `wsl://` paths.
pub struct WslFiles;

impl FileAccess for WslFiles {
    fn load(&self, path: &Path) -> Result<Contents> {
        let file = wsl_path(path)?;
        let (size, modified) = stat(&file)?;
        if size > MAX_FILE_SIZE {
            return Ok(Contents::TooLarge(size));
        }
        let bytes = athas_wsl::read_file_bytes(&file.distro, &file.linux_path).map_err(text_error)?;
        Ok(remote::files::decode(bytes, Some(modified)))
    }

    fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>> {
        let file = wsl_path(path)?;
        athas_wsl::write_file(&file.distro, &file.linux_path, text.as_bytes()).map_err(text_error)?;
        Ok(stat(&file).ok().map(|(_, modified)| modified))
    }

    /// Compares and writes in one script inside the distribution (`wsl_write_file_checked`), so
    /// a change made there between the check and the write is never overwritten.
    fn save_checked(&self, path: &Path, text: &str, expected: &str) -> Result<Option<SystemTime>> {
        let file = wsl_path(path)?;
        athas_wsl::write_file_checked(&file.distro, &file.linux_path, text, Some(expected)).map_err(text_error)?;
        Ok(stat(&file).ok().map(|(_, modified)| modified))
    }

    fn modified(&self, path: &Path) -> Option<SystemTime> {
        stat(&wsl_path(path).ok()?).ok().map(|(_, modified)| modified)
    }
}

/// `git` inside a distribution.
pub struct WslGitRunner {
    pub distro: String,
}

impl GitRunner for WslGitRunner {
    fn run(&self, directory: &str, arguments: &[&str], stdin: Option<&[u8]>) -> Result<String> {
        let mut command = vec!["env", "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0", "git", "-C", directory, "-c", "core.quotepath=off"];
        command.extend_from_slice(arguments);
        Ok(String::from_utf8_lossy(&run(&self.distro, &command, stdin)?).into_owned())
    }
}

/// The repository containing a `wsl://` path, if `git` is installed in the distribution.
pub fn discover_git(path: &Path) -> Option<RemoteGit> {
    let folder = parse_path(path)?;
    if !athas_wsl::git_available(&folder.distro) {
        return None;
    }
    let runner = Arc::new(WslGitRunner { distro: folder.distro.clone() });
    let top = runner.run(&folder.linux_path, &["rev-parse", "--show-toplevel"], None).ok()?;
    let root = WslPath { distro: folder.distro, linux_path: athas_wsl::normalize_linux_path(top.trim()) };
    Some(RemoteGit::with_runner(PathBuf::from(format(&root)), root.linux_path, runner))
}

/// The program a terminal runs for a `wsl://` folder: the distribution's login shell, started in
/// that folder (`wsl.exe --distribution <d> --cd <path>`). It runs on the local PTY.
pub fn terminal_command(path: &str) -> Option<(String, Vec<String>)> {
    let folder = crate::path::parse(path)?;
    Some(("wsl.exe".into(), vec!["--distribution".into(), folder.distro, "--cd".into(), folder.linux_path]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stat_output() {
        let (size, modified) = parse_stat("1234 1700000000\n").unwrap();
        assert_eq!(size, 1234);
        assert_eq!(modified, UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        assert!(parse_stat("nope").is_none());
    }

    #[test]
    fn builds_terminal_commands() {
        let (program, arguments) = terminal_command("wsl://Ubuntu/home/me/my app").unwrap();
        assert_eq!(program, "wsl.exe");
        assert_eq!(arguments, ["--distribution", "Ubuntu", "--cd", "/home/me/my app"]);
        assert!(terminal_command("/home/me").is_none());
    }

    #[test]
    fn scopes_watches() {
        assert!(within("/home/me/src", "/home/me"));
        assert!(!within("/home/meg", "/home/me"));
    }

    #[cfg(not(windows))]
    #[test]
    fn commands_fail_cleanly_off_windows() {
        assert!(run("Ubuntu", &["true"], None).unwrap_err().to_string().contains("only available on Windows"));
        let fs = WslFs::new();
        assert!(fs.read_dir(Path::new("wsl://Ubuntu/home")).is_err());
        assert!(!fs.exists(Path::new("wsl://Ubuntu/home")));
        assert!(WslFiles.load(Path::new("wsl://Ubuntu/a.txt")).is_err());
        assert!(WslFiles.save_checked(Path::new("wsl://Ubuntu/a.txt"), "new", "old").is_err());
        assert!(discover_git(Path::new("wsl://Ubuntu/home")).is_none());
    }
}
