//! The project's files on the server, for the file tree (`file_tree::Fs`) and the editor
//! (`editor::FileBackend`).

use std::{
    any::Any,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context as _, Result, anyhow};
use editor::{FileBackend, Loaded};
use file_tree::{Changes, DirEntry, Fs};
use serde_json::{Value, json};
use web_protocol::{MAX_FILE_BYTES, from_base64, to_base64};

use crate::{Events, Transport, failed, relative};

pub struct RemoteFs {
    root: PathBuf,
    transport: Arc<dyn Transport>,
    events: Arc<Events>,
}

struct Stat {
    is_dir: bool,
    size: u64,
    modified: SystemTime,
}

impl RemoteFs {
    pub fn new(root: PathBuf, transport: Arc<dyn Transport>, events: Arc<Events>) -> Arc<Self> {
        Arc::new(Self { root, transport, events })
    }

    fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.transport.call(method, params).map_err(failed)
    }

    fn path(&self, path: &Path) -> Result<String> {
        relative(&self.root, path)
    }

    fn stat(&self, path: &Path) -> Result<Stat> {
        let stat = self.call("fs.stat", json!({ "path": self.path(path)? }))?;
        Ok(Stat {
            is_dir: stat["type"] == "directory",
            size: stat["size"].as_u64().unwrap_or(0),
            modified: UNIX_EPOCH + Duration::from_millis(stat["mtime"].as_u64().unwrap_or(0)),
        })
    }

    fn read(&self, path: &Path) -> Result<Vec<u8>> {
        let read = self.call("fs.read", json!({ "path": self.path(path)? }))?;
        from_base64(&read["content"]).map_err(failed)
    }

    fn rename_to(&self, from: &Path, to: &Path) -> Result<()> {
        self.call("fs.rename", json!({ "from": self.path(from)?, "to": self.path(to)? })).map(|_| ())
    }

    fn remove_path(&self, path: &Path) -> Result<()> {
        self.call("fs.remove", json!({ "path": self.path(path)?, "recursive": true })).map(|_| ())
    }
}

impl Fs for RemoteFs {
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
        let listing = self.call("fs.readdir", json!({ "path": self.path(path)? }))?;
        let entries = listing["entries"].as_array().ok_or_else(|| anyhow!("the server sent no entries"))?;
        Ok(entries
            .iter()
            .filter_map(|entry| {
                let name = entry["name"].as_str()?.to_string();
                Some(DirEntry {
                    path: path.join(&name),
                    is_dir: entry["type"] == "directory",
                    is_symlink: entry["type"] == "symlink",
                    name,
                })
            })
            .collect())
    }

    fn read_to_string(&self, path: &Path) -> Result<String> {
        String::from_utf8(self.read(path)?).with_context(|| format!("{} is not text", path.display()))
    }

    fn is_dir(&self, path: &Path) -> bool {
        self.stat(path).is_ok_and(|stat| stat.is_dir)
    }

    fn exists(&self, path: &Path) -> bool {
        self.path(path)
            .and_then(|path| self.call("fs.exists", json!({ "path": path })))
            .is_ok_and(|exists| exists["exists"] == true)
    }

    fn create_file(&self, path: &Path) -> Result<()> {
        self.call("fs.createFile", json!({ "path": self.path(path)? })).map(|_| ())
    }

    fn create_dir(&self, path: &Path) -> Result<()> {
        self.call("fs.mkdir", json!({ "path": self.path(path)?, "recursive": true })).map(|_| ())
    }

    fn rename(&self, from: &Path, to: &Path) -> Result<()> {
        self.rename_to(from, to)
    }

    fn move_path(&self, from: &Path, to: &Path) -> Result<()> {
        self.rename_to(from, to)
    }

    fn copy(&self, from: &Path, to: &Path) -> Result<()> {
        self.call("fs.copy", json!({ "from": self.path(from)?, "to": self.path(to)? })).map(|_| ())
    }

    /// The server has no trash; deleting there is final.
    fn trash(&self, path: &Path) -> Result<()> {
        self.remove_path(path)
    }

    fn remove(&self, path: &Path) -> Result<()> {
        self.remove_path(path)
    }

    fn watch(&self, root: &Path, on_change: Box<dyn Fn(Changes) + Send + Sync>) -> Result<Box<dyn Any + Send>> {
        let root = root.to_path_buf();
        let guard = self.events.watch(Box::new(move |changes: Changes| {
            let paths: Vec<PathBuf> = changes.paths.into_iter().filter(|path| path.starts_with(&root)).collect();
            if !paths.is_empty() || changes.rescan {
                on_change(Changes { paths, rescan: changes.rescan });
            }
        }));
        Ok(Box::new(guard))
    }
}

impl FileBackend for RemoteFs {
    fn reaches_language_servers(&self) -> bool {
        true
    }

    fn load(&self, path: &Path) -> Result<Loaded> {
        let stat = self.stat(path)?;
        if stat.size > MAX_FILE_BYTES {
            return Ok(Loaded::TooLarge(stat.size));
        }
        Ok(decode(self.read(path)?, Some(stat.modified)))
    }

    fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>> {
        self.call("fs.write", json!({ "path": self.path(path)?, "content": to_base64(text.as_bytes()) }))?;
        Ok(self.modified(path))
    }

    fn modified(&self, path: &Path) -> Option<SystemTime> {
        self.stat(path).ok().map(|stat| stat.modified)
    }
}

/// Text, unless the bytes look binary (a NUL early on, or not UTF-8), as the editor decides.
fn decode(bytes: Vec<u8>, modified: Option<SystemTime>) -> Loaded {
    if bytes[..bytes.len().min(8 * 1024)].contains(&0) {
        return Loaded::Binary;
    }
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").map(<[u8]>::to_vec).unwrap_or(bytes);
    match String::from_utf8(bytes) {
        Ok(text) => Loaded::Text { text, modified },
        Err(_) => Loaded::Binary,
    }
}
