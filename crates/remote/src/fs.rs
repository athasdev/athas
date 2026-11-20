//! The file tree's [`file_tree::Fs`] over SFTP, for `remote://` paths (`file_ops.rs` in Athas).
//! Moves, copies and recursive deletes run as shell commands over exec, as the old app ran them;
//! listing, reading and creating go through SFTP, or through shell commands for a connection
//! without SFTP access ([`crate::shell_files`]). A remote host has no trash, so moving to the
//! trash deletes, as the old app's delete did. Watching polls the folders the tree has listed.

use std::{
    any::Any,
    collections::{HashMap, HashSet},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::{Result, anyhow, bail};
use file_tree::{Changes, DirEntry, Fs};
use ssh2::{ErrorCode, FileStat, FileType, OpenFlags, OpenType, Sftp};

use crate::{
    manager::{Connection, manager},
    path::{RemotePath, shell_quote},
    session::ExecOutput,
    shell_files,
};

/// How often a watch re-lists the folders the tree has open.
pub const POLL_INTERVAL: Duration = Duration::from_secs(3);
/// At most this many folders are re-listed per poll.
const MAX_POLLED_FOLDERS: usize = 256;

pub(crate) fn remote_path(path: &Path) -> Result<RemotePath> {
    RemotePath::from_path(path).ok_or_else(|| anyhow!("{} is not a remote path", path.display()))
}

pub(crate) fn connection(path: &RemotePath) -> Result<Arc<Connection>> {
    manager().get_or_connect(&path.connection_id)
}

pub(crate) fn is_not_found(error: &ssh2::Error) -> bool {
    error.code() == ErrorCode::SFTP(2)
}

/// `lstat`, with a missing file as `None`.
pub(crate) fn lstat(sftp: &Sftp, path: &str) -> Result<Option<FileStat>> {
    match sftp.lstat(Path::new(path)) {
        Ok(stat) => Ok(Some(stat)),
        Err(error) if is_not_found(&error) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn read_bytes(sftp: &Sftp, path: &str, limit: u64) -> Result<Vec<u8>> {
    let file = sftp.open(Path::new(path)).map_err(|error| anyhow!("reading {path}: {error}"))?;
    let mut bytes = Vec::new();
    file.take(limit).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Runs commands on `connection`, for [`shell_files`].
pub(crate) fn shell(connection: &Connection) -> impl Fn(&str, Option<&[u8]>) -> Result<ExecOutput> + '_ {
    move |command, stdin| connection.exec(command, stdin)
}

/// One folder's entries, by name: whether each is a folder, its size and its mtime.
type Snapshot = HashMap<String, (bool, u64, u64)>;

/// A listed entry, from SFTP or the shell listing.
struct Listed {
    name: String,
    is_dir: bool,
    is_symlink: bool,
    size: u64,
    mtime: u64,
}

fn list_sftp(sftp: &Sftp, directory: &RemotePath) -> Result<Vec<(String, FileStat)>> {
    let entries = sftp
        .readdir(Path::new(&directory.path))
        .map_err(|error| anyhow!("reading {}: {error}", directory.path))?;
    Ok(entries
        .into_iter()
        .filter_map(|(path, stat)| {
            // SFTP joins with the local separator; only the name is kept.
            let name = path.to_string_lossy().rsplit(['/', '\\']).next()?.to_string();
            (name != "." && name != ".." && !name.is_empty()).then_some((name, stat))
        })
        .collect())
}

fn list(connection: &Connection, directory: &RemotePath) -> Result<Vec<Listed>> {
    if !connection.uses_sftp() {
        return Ok(shell_files::list(&shell(connection), &directory.path)?
            .into_iter()
            .map(|entry| Listed { name: entry.name, is_dir: entry.is_dir, is_symlink: entry.is_symlink, size: entry.size, mtime: 0 })
            .collect());
    }
    let entries = connection.with_session(|_, sftp| list_sftp(sftp, directory))?;
    Ok(entries
        .into_iter()
        .map(|(name, stat)| Listed {
            is_dir: stat.is_dir(),
            is_symlink: stat.file_type() == FileType::Symlink,
            size: stat.size.unwrap_or(0),
            mtime: stat.mtime.unwrap_or(0),
            name,
        })
        .collect())
}

fn snapshot(entries: &[Listed]) -> Snapshot {
    entries.iter().map(|entry| (entry.name.clone(), (entry.is_dir, entry.size, entry.mtime))).collect()
}

/// What changed between two listings of `directory`: the paths of added, removed and changed
/// entries.
fn diff(directory: &RemotePath, before: &Snapshot, after: &Snapshot) -> Vec<PathBuf> {
    let mut changed: Vec<PathBuf> = after
        .iter()
        .filter(|(name, entry)| before.get(*name) != Some(entry))
        .chain(before.iter().filter(|(name, _)| !after.contains_key(*name)))
        .map(|(name, _)| directory.join(name).to_path_buf())
        .collect();
    changed.sort();
    changed.dedup();
    changed
}

/// The SFTP file system. One instance serves every connection; paths say which.
#[derive(Default)]
pub struct RemoteFs {
    /// The folders listed so far, with what they held, for the watcher to compare.
    listed: Arc<Mutex<HashMap<RemotePath, Snapshot>>>,
}

impl RemoteFs {
    pub fn new() -> Self {
        Self::default()
    }

    fn sh(&self, path: &RemotePath, script: &str, arguments: &[&str]) -> Result<()> {
        let mut command = format!("sh -c {} athas", shell_quote(script));
        for argument in arguments {
            command.push(' ');
            command.push_str(&shell_quote(argument));
        }
        connection(path)?.exec(&command, None)?.into_result().map(|_| ())
    }
}

/// Fails when the target exists, unless it is the source itself (a case-only rename on a
/// case-insensitive file system), then makes the parent and moves.
const MOVE_SCRIPT: &str = r#"if { [ -e "$2" ] || [ -L "$2" ]; } && ! [ "$1" -ef "$2" ]; then echo "$2 already exists" >&2; exit 1; fi; mkdir -p "$(dirname "$2")" && mv -- "$1" "$2""#;
const COPY_SCRIPT: &str = r#"if [ -e "$2" ] || [ -L "$2" ]; then echo "$2 already exists" >&2; exit 1; fi; mkdir -p "$(dirname "$2")" && cp -R -- "$1" "$2""#;
const MKDIR_SCRIPT: &str = r#"if [ -e "$1" ] || [ -L "$1" ]; then echo "$1 already exists" >&2; exit 1; fi; mkdir -p -- "$1""#;
const REMOVE_SCRIPT: &str = r#"rm -rf -- "$1""#;

impl Fs for RemoteFs {
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
        let directory = remote_path(path)?;
        let entries = list(&*connection(&directory)?, &directory)?;
        self.listed.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(directory.clone(), snapshot(&entries));
        Ok(entries
            .into_iter()
            .map(|entry| DirEntry { path: directory.join(&entry.name).to_path_buf(), name: entry.name, is_dir: entry.is_dir, is_symlink: entry.is_symlink })
            .collect())
    }

    fn read_to_string(&self, path: &Path) -> Result<String> {
        let file = remote_path(path)?;
        let connection = connection(&file)?;
        let bytes = if connection.uses_sftp() {
            connection.with_session(|_, sftp| read_bytes(sftp, &file.path, editor_limit()))?
        } else {
            shell_files::read(&shell(&connection), &file.path, editor_limit())?
        };
        Ok(String::from_utf8(bytes)?)
    }

    fn is_dir(&self, path: &Path) -> bool {
        let Ok(path) = remote_path(path) else { return false };
        connection(&path)
            .and_then(|connection| {
                if connection.uses_sftp() {
                    connection.with_session(|_, sftp| Ok(sftp.stat(Path::new(&path.path))?.is_dir()))
                } else {
                    Ok(shell_files::stat(&shell(&connection), &path.path)?.is_some_and(|stat| stat.is_dir))
                }
            })
            .unwrap_or(false)
    }

    fn exists(&self, path: &Path) -> bool {
        let Ok(path) = remote_path(path) else { return false };
        connection(&path)
            .and_then(|connection| {
                if connection.uses_sftp() {
                    Ok(connection.with_session(|_, sftp| lstat(sftp, &path.path))?.is_some())
                } else {
                    Ok(shell_files::stat(&shell(&connection), &path.path)?.is_some())
                }
            })
            .unwrap_or(false)
    }

    fn create_file(&self, path: &Path) -> Result<()> {
        let file = remote_path(path)?;
        let connection = connection(&file)?;
        if !connection.uses_sftp() {
            return shell_files::create_file(&shell(&connection), &file.path);
        }
        connection.with_session(|_, sftp| {
            sftp.open_mode(Path::new(&file.path), OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUSIVE, 0o644, OpenType::File)
                .map_err(|error| anyhow!("creating {}: {error}", file.path))?;
            Ok(())
        })
    }

    fn create_dir(&self, path: &Path) -> Result<()> {
        let directory = remote_path(path)?;
        self.sh(&directory, MKDIR_SCRIPT, &[&directory.path])
    }

    fn rename(&self, from: &Path, to: &Path) -> Result<()> {
        self.move_path(from, to)
    }

    fn move_path(&self, from: &Path, to: &Path) -> Result<()> {
        let (from, to) = (remote_path(from)?, remote_path(to)?);
        if from.connection_id != to.connection_id {
            bail!("Moving between two remote connections is not supported");
        }
        self.sh(&from, MOVE_SCRIPT, &[&from.path, &to.path])
    }

    fn copy(&self, from: &Path, to: &Path) -> Result<()> {
        let (from, to) = (remote_path(from)?, remote_path(to)?);
        if from.connection_id != to.connection_id {
            bail!("Copying between two remote connections is not supported");
        }
        self.sh(&from, COPY_SCRIPT, &[&from.path, &to.path])
    }

    fn trash(&self, path: &Path) -> Result<()> {
        self.remove(path)
    }

    fn remove(&self, path: &Path) -> Result<()> {
        let target = remote_path(path)?;
        if target.path == "/" {
            bail!("Refusing to delete /");
        }
        self.sh(&target, REMOVE_SCRIPT, &[&target.path])
    }

    fn watch(&self, root: &Path, on_change: Box<dyn Fn(Changes) + Send + Sync>) -> Result<Box<dyn Any>> {
        let root = remote_path(root)?;
        let stop = Arc::new(AtomicBool::new(false));
        let listed = self.listed.clone();
        let stopped = stop.clone();
        std::thread::Builder::new().name("remote-watch".into()).spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                std::thread::sleep(POLL_INTERVAL);
                if stopped.load(Ordering::Relaxed) {
                    break;
                }
                let folders: Vec<(RemotePath, Snapshot)> = listed
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .iter()
                    .filter(|(folder, _)| folder.connection_id == root.connection_id && is_within(&folder.path, &root.path))
                    .take(MAX_POLLED_FOLDERS)
                    .map(|(folder, snapshot)| (folder.clone(), snapshot.clone()))
                    .collect();
                // Skip a poll while disconnected rather than reconnecting from the background.
                let Some(connection) = manager().get(&root.connection_id) else { continue };
                let mut changes = Changes::default();
                let mut gone = HashSet::new();
                for (folder, before) in folders {
                    match list(&connection, &folder) {
                        Ok(entries) => {
                            let after = snapshot(&entries);
                            let changed = diff(&folder, &before, &after);
                            if !changed.is_empty() {
                                changes.paths.extend(changed);
                                listed.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(folder, after);
                            }
                        }
                        Err(_) => {
                            changes.paths.push(folder.to_path_buf());
                            gone.insert(folder);
                        }
                    }
                }
                if !gone.is_empty() {
                    listed.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).retain(|folder, _| !gone.contains(folder));
                }
                if !changes.paths.is_empty() {
                    on_change(changes);
                }
            }
        })?;
        Ok(Box::new(WatchGuard(stop)))
    }
}

struct WatchGuard(Arc<AtomicBool>);

impl Drop for WatchGuard {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

fn is_within(path: &str, root: &str) -> bool {
    root == "/" || path == root || path.strip_prefix(root).is_some_and(|rest| rest.starts_with('/'))
}

/// The folders in `directory` for the folder browser, symlinks to folders included, sorted with
/// hidden ones last.
pub fn folders(connection: &Connection, directory: &str) -> Result<Vec<String>> {
    let directory = RemotePath::new(connection.saved.id.clone(), directory);
    if !connection.uses_sftp() {
        let mut names: Vec<String> =
            shell_files::list(&shell(connection), &directory.path)?.into_iter().filter(|entry| entry.is_dir).map(|entry| entry.name).collect();
        sort_folders(&mut names);
        return Ok(names);
    }
    let mut names: Vec<String> = connection.with_session(|_, sftp| {
        Ok(list_sftp(sftp, &directory)?
            .into_iter()
            .filter(|(name, stat)| {
                stat.is_dir()
                    || (stat.file_type() == FileType::Symlink
                        && sftp.stat(Path::new(&directory.join(name).path)).is_ok_and(|target| target.is_dir()))
            })
            .map(|(name, _)| name)
            .collect())
    })?;
    sort_folders(&mut names);
    Ok(names)
}

pub fn sort_folders(names: &mut [String]) {
    names.sort_by_key(|name| (name.starts_with('.'), name.to_lowercase()));
}

/// The largest file read as text, matching the editor's limit.
pub(crate) fn editor_limit() -> u64 {
    crate::files::MAX_FILE_SIZE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diffs_listings() {
        let folder = RemotePath::new("box", "/srv");
        let before: Snapshot = [("a".to_string(), (false, 1, 1)), ("b".to_string(), (false, 1, 1))].into();
        let after: Snapshot = [("a".to_string(), (false, 2, 5)), ("c".to_string(), (true, 0, 1))].into();
        let paths: Vec<String> = diff(&folder, &before, &after).iter().map(|path| path.to_string_lossy().into_owned()).collect();
        assert_eq!(paths, ["remote://box/srv/a", "remote://box/srv/b", "remote://box/srv/c"]);
        assert!(diff(&folder, &before, &before).is_empty());
    }

    #[test]
    fn scopes_watches_to_the_root() {
        assert!(is_within("/srv/app/src", "/srv/app"));
        assert!(is_within("/srv/app", "/srv/app"));
        assert!(!is_within("/srv/application", "/srv/app"));
        assert!(is_within("/etc", "/"));
    }

    #[test]
    fn sorts_hidden_folders_last() {
        let mut names = vec![".git".to_string(), "src".into(), "Docs".into(), ".cache".into()];
        sort_folders(&mut names);
        assert_eq!(names, ["Docs", "src", ".cache", ".git"]);
    }

    #[test]
    fn refuses_local_paths() {
        let fs = RemoteFs::new();
        assert!(fs.read_dir(Path::new("/tmp")).is_err());
        assert!(!fs.exists(Path::new("/tmp")));
    }
}
