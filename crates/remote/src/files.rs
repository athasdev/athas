//! Opening and saving editor files over SFTP. A save writes a temporary file beside the target,
//! gives it the target's permissions, and renames it over the target, so a dropped connection
//! never leaves half a file (`mutate_sftp` in Athas's `file_ops.rs`). Servers whose rename will not
//! overwrite get `posix-rename@openssh.com`. A connection without SFTP reads with `cat` and writes
//! through the shell mutation script, which stages and renames the same way.

use std::{
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Result, anyhow, bail};
use athas_project::shell_file_mutations::TextExpectation;
use ssh2::{ErrorCode, FileStat, FileType, OpenFlags, OpenType, RenameFlags, Session, Sftp};

use crate::{
    fs::{connection, lstat, read_bytes, remote_path, shell},
    path::RemotePath,
    shell_files,
};

/// Files larger than this open as a message instead of text (the editor's limit).
pub const MAX_FILE_SIZE: u64 = 64 * 1024 * 1024;

/// What a load found; mirrors the editor's `Loaded`.
#[derive(Debug, PartialEq, Eq)]
pub enum Contents {
    Text { text: String, modified: Option<SystemTime> },
    Binary,
    TooLarge(u64),
}

/// Text, unless the bytes look binary (a NUL early on, or not UTF-8). A BOM is dropped.
pub fn decode(bytes: Vec<u8>, modified: Option<SystemTime>) -> Contents {
    if bytes[..bytes.len().min(8 * 1024)].contains(&0) {
        return Contents::Binary;
    }
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").map(<[u8]>::to_vec).unwrap_or(bytes);
    match String::from_utf8(bytes) {
        Ok(text) => Contents::Text { text, modified },
        Err(_) => Contents::Binary,
    }
}

fn shell_mtime(seconds: u64) -> Option<SystemTime> {
    (seconds > 0).then(|| UNIX_EPOCH + Duration::from_secs(seconds))
}

fn mtime(stat: &FileStat) -> Option<SystemTime> {
    stat.mtime.map(|seconds| UNIX_EPOCH + Duration::from_secs(seconds))
}

/// Editor file access on another machine; the `editor` feature turns any of these into the
/// editor's `FileBackend`.
pub trait FileAccess: Send + Sync {
    fn load(&self, path: &Path) -> Result<Contents>;
    /// Writes `text` so a dropped connection never leaves a half-written file.
    fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>>;
    /// Writes `text` only while the file still holds `expected` (a byte order mark aside), so a
    /// change made there since it was read is not overwritten. Backends that can compare and
    /// write in one step on the other machine override this.
    fn save_checked(&self, path: &Path, text: &str, expected: &str) -> Result<Option<SystemTime>> {
        let unchanged = match self.load(path) {
            Ok(Contents::Text { text: current, .. }) => current == expected || current.strip_prefix('\u{feff}') == Some(expected),
            _ => false,
        };
        if !unchanged {
            anyhow::bail!("saving {}: {FILE_CHANGED}", path.display());
        }
        self.save(path, text)
    }
    fn modified(&self, path: &Path) -> Option<SystemTime>;
}

/// Why a checked save refused to write.
pub const FILE_CHANGED: &str = "The file changed while preparing the update. Read it again before editing.";

/// The editor's file access for `remote://` paths.
#[derive(Default)]
pub struct RemoteFiles;

impl FileAccess for RemoteFiles {
    fn load(&self, path: &Path) -> Result<Contents> {
        let file = remote_path(path)?;
        let connection = connection(&file)?;
        if !connection.uses_sftp() {
            let run = shell(&connection);
            let stat = shell_files::stat(&run, &file.path)?.ok_or_else(|| anyhow!("reading {}: no such file", file.path))?;
            if stat.is_dir {
                bail!("{} is a folder", file.path);
            }
            if stat.size > MAX_FILE_SIZE {
                return Ok(Contents::TooLarge(stat.size));
            }
            return Ok(decode(shell_files::read(&run, &file.path, MAX_FILE_SIZE + 1)?, shell_mtime(stat.mtime)));
        }
        connection.with_session(|_, sftp| {
            let stat = sftp.stat(Path::new(&file.path)).map_err(|error| anyhow!("reading {}: {error}", file.path))?;
            if stat.is_dir() {
                bail!("{} is a folder", file.path);
            }
            let size = stat.size.unwrap_or(0);
            if size > MAX_FILE_SIZE {
                return Ok(Contents::TooLarge(size));
            }
            Ok(decode(read_bytes(sftp, &file.path, MAX_FILE_SIZE + 1)?, mtime(&stat)))
        })
    }

    fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>> {
        let file = remote_path(path)?;
        let connection = connection(&file)?;
        if !connection.uses_sftp() {
            let run = shell(&connection);
            shell_files::mutate(&run, &file.path, TextExpectation::Any, Some(text))?;
            return Ok(shell_files::stat(&run, &file.path).ok().flatten().and_then(|stat| shell_mtime(stat.mtime)));
        }
        connection.with_session(|session, sftp| {
            save_atomically(session, sftp, &file, text.as_bytes())?;
            Ok(sftp.stat(Path::new(&file.path)).ok().as_ref().and_then(mtime))
        })
    }

    fn modified(&self, path: &Path) -> Option<SystemTime> {
        let file = remote_path(path).ok()?;
        let connection = connection(&file).ok()?;
        if !connection.uses_sftp() {
            return shell_files::stat(&shell(&connection), &file.path).ok().flatten().and_then(|stat| shell_mtime(stat.mtime));
        }
        connection
            .with_session(|_, sftp| Ok(sftp.stat(Path::new(&file.path))?))
            .ok()
            .as_ref()
            .and_then(mtime)
    }
}

fn temporary_name(parent: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |duration| duration.as_nanos());
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}/.athas-save-{nanos:x}-{count}", parent.trim_end_matches('/'))
}

fn permissions(perm: Option<u32>) -> FileStat {
    FileStat { size: None, uid: None, gid: None, perm, atime: None, mtime: None }
}

fn save_atomically(session: &Session, sftp: &Sftp, file: &RemotePath, bytes: &[u8]) -> Result<()> {
    let existing = lstat(sftp, &file.path)?;
    // Saving through a symlink writes the file it points at.
    let target = if existing.as_ref().is_some_and(|stat| stat.file_type() == FileType::Symlink) {
        sftp.realpath(Path::new(&file.path))?.to_string_lossy().into_owned()
    } else {
        file.path.clone()
    };
    let existing = lstat(sftp, &target)?;
    if existing.as_ref().is_some_and(|stat| !stat.is_file()) {
        bail!("{target} is not a regular file");
    }
    if existing.as_ref().and_then(|stat| stat.perm).is_some_and(|mode| mode & 0o222 == 0) {
        bail!("{target} is read-only");
    }
    let parent = RemotePath::new("", &target).parent().map_or_else(|| "/".to_string(), |parent| parent.path);
    let temporary = temporary_name(&parent);
    let mut created = false;
    let result = (|| -> Result<()> {
        let mut handle = sftp
            .open_mode(Path::new(&temporary), OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUSIVE, 0o600, OpenType::File)
            .map_err(|error| anyhow!("saving {target}: {error}"))?;
        created = true;
        handle.write_all(bytes)?;
        handle.fsync().ok();
        handle.close()?;
        let mode = existing.as_ref().and_then(|stat| stat.perm).map(|mode| mode & 0o7777).unwrap_or(0o644);
        sftp.setstat(Path::new(&temporary), permissions(Some(mode)))?;
        let flags = RenameFlags::ATOMIC | RenameFlags::NATIVE | RenameFlags::OVERWRITE;
        match sftp.rename(Path::new(&temporary), Path::new(&target), Some(flags)) {
            Ok(()) => Ok(()),
            // SFTP v3 servers refuse to rename over an existing file (failure or unsupported).
            Err(error) if existing.is_some() && matches!(error.code(), ErrorCode::SFTP(4 | 8)) => {
                crate::sftp_atomic_rename::overwrite_file_atomically(session, Path::new(&temporary), Path::new(&target))
            }
            Err(error) => Err(anyhow!("saving {target}: {error}")),
        }
    })();
    if created && result.is_err() {
        sftp.unlink(Path::new(&temporary)).ok();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_text_and_binary() {
        assert_eq!(decode(b"hi".to_vec(), None), Contents::Text { text: "hi".into(), modified: None });
        assert_eq!(decode(b"\xEF\xBB\xBFhi".to_vec(), None), Contents::Text { text: "hi".into(), modified: None });
        assert_eq!(decode(vec![0x89, b'P', 0], None), Contents::Binary);
        assert_eq!(decode(vec![0xff, 0xfe], None), Contents::Binary);
    }

    #[test]
    fn temporary_names_stay_beside_the_target_and_differ() {
        let first = temporary_name("/srv/app/");
        assert!(first.starts_with("/srv/app/.athas-save-"));
        assert_ne!(first, temporary_name("/srv/app"));
        assert!(temporary_name("/").starts_with("/.athas-save-"));
    }
}
