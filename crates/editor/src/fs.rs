//! File access behind a trait, so a web build can read and write through a remote backend.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::SystemTime,
};

use anyhow::{Context as _, Result};

/// Files larger than this open as a message instead of text.
pub const MAX_FILE_SIZE: u64 = 64 * 1024 * 1024;

/// What a load found.
pub enum Loaded {
    Text { text: String, modified: Option<SystemTime> },
    Binary,
    TooLarge(u64),
}

pub trait FileBackend: Send + Sync {
    fn load(&self, path: &Path) -> Result<Loaded>;
    /// Writes `text` so a crash never leaves a half-written file.
    fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>>;
    /// Writes `text` only while the file still holds `expected` (`writeText` with
    /// `expectedContent`), so a change made on disk since is not overwritten.
    fn save_checked(&self, path: &Path, text: &str, _expected: &str) -> Result<Option<SystemTime>> {
        self.save(path, text)
    }
    fn modified(&self, path: &Path) -> Option<SystemTime>;
    /// Files on this machine, which local language servers can read.
    fn is_local(&self) -> bool {
        false
    }
    /// Whether language servers can read these files: local ones, or a workspace server's, whose
    /// servers run beside them.
    fn reaches_language_servers(&self) -> bool {
        self.is_local()
    }
    /// Text that can be read but not edited (a local history snapshot).
    fn read_only(&self) -> bool {
        false
    }
}

/// The local disk.
pub struct LocalFs;

impl FileBackend for LocalFs {
    fn is_local(&self) -> bool {
        true
    }

    fn load(&self, path: &Path) -> Result<Loaded> {
        let metadata = std::fs::metadata(path).with_context(|| format!("reading {}", path.display()))?;
        if metadata.len() > MAX_FILE_SIZE {
            return Ok(Loaded::TooLarge(metadata.len()));
        }
        let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
        Ok(decode(bytes, metadata.modified().ok()))
    }

    /// Replaces the text atomically through `athas_project`'s writer (`write_local_file`): a
    /// symlink is written through, a byte order mark and the file's permissions are kept, and a
    /// read-only file is refused.
    fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>> {
        #[cfg(not(target_family = "wasm"))]
        athas_project::local_fs::write_text(path, text.to_string()).map_err(|error| anyhow::anyhow!("saving {}: {error}", path.display()))?;
        #[cfg(target_family = "wasm")]
        std::fs::write(path, text).with_context(|| format!("saving {}", path.display()))?;
        Ok(self.modified(path))
    }

    #[cfg(not(target_family = "wasm"))]
    fn save_checked(&self, path: &Path, text: &str, expected: &str) -> Result<Option<SystemTime>> {
        let digest = athas_project::local_fs::ExpectedFileDigest::of(expected);
        athas_project::local_fs::write_text_checked(path, Some(digest), text.to_string())
            .map_err(|error| anyhow::anyhow!("saving {}: {error}", path.display()))?;
        Ok(self.modified(path))
    }

    fn modified(&self, path: &Path) -> Option<SystemTime> {
        std::fs::metadata(path).and_then(|metadata| metadata.modified()).ok()
    }
}

/// Where `file.newDocument` documents live: `markdown-document://<id>/Untitled Document`.
pub const UNTITLED_SCHEME: &str = "markdown-document://";

/// A path for a new untitled markdown document.
pub fn new_untitled_path() -> PathBuf {
    let id = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|elapsed| elapsed.as_nanos()).unwrap_or_default();
    PathBuf::from(format!("{UNTITLED_SCHEME}{id:x}/Untitled Document"))
}

pub fn is_untitled(path: &Path) -> bool {
    path.to_string_lossy().starts_with(UNTITLED_SCHEME)
}

/// Untitled documents: their text is kept in memory for as long as the app runs, until Save As
/// writes them to disk.
pub struct UntitledFs;

static UNTITLED: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<PathBuf, String>>> = std::sync::LazyLock::new(Default::default);

impl FileBackend for UntitledFs {
    fn load(&self, path: &Path) -> Result<Loaded> {
        let text = UNTITLED.lock().map(|documents| documents.get(path).cloned()).unwrap_or_default().unwrap_or_default();
        Ok(Loaded::Text { text, modified: None })
    }

    fn save(&self, path: &Path, text: &str) -> Result<Option<SystemTime>> {
        if let Ok(mut documents) = UNTITLED.lock() {
            documents.insert(path.to_path_buf(), text.to_string());
        }
        Ok(None)
    }

    fn modified(&self, _: &Path) -> Option<SystemTime> {
        None
    }
}

/// Where read-only snapshots live: `local-history://<id>/<file name> (<date>)`, so the tab reads
/// as the original's `openBuffer(…, snapshotName, content, …, isVirtual)`.
pub const SNAPSHOT_SCHEME: &str = "local-history://";

static SNAPSHOTS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<PathBuf, (PathBuf, String)>>> = std::sync::LazyLock::new(Default::default);

/// Registers `text` as a read-only document for `file` and returns the path to open it at.
pub fn register_snapshot(id: &str, title: &str, file: &Path, text: String) -> PathBuf {
    let path = PathBuf::from(format!("{SNAPSHOT_SCHEME}{id}/{}", title.replace('/', "∕")));
    if let Ok(mut snapshots) = SNAPSHOTS.lock() {
        snapshots.insert(path.clone(), (file.to_path_buf(), text));
    }
    path
}

pub fn is_snapshot(path: &Path) -> bool {
    path.to_string_lossy().starts_with(SNAPSHOT_SCHEME)
}

/// The file a snapshot was taken of, which picks its language.
pub fn snapshot_source(path: &Path) -> Option<PathBuf> {
    SNAPSHOTS.lock().ok()?.get(path).map(|(file, _)| file.clone())
}

pub struct SnapshotFs;

impl FileBackend for SnapshotFs {
    fn load(&self, path: &Path) -> Result<Loaded> {
        let text = SNAPSHOTS.lock().ok().and_then(|snapshots| snapshots.get(path).map(|(_, text)| text.clone()));
        let text = text.ok_or_else(|| anyhow::anyhow!("This snapshot is no longer available"))?;
        Ok(Loaded::Text { text, modified: None })
    }

    fn save(&self, path: &Path, _: &str) -> Result<Option<SystemTime>> {
        anyhow::bail!("{} is a read-only snapshot", path.display())
    }

    fn modified(&self, _: &Path) -> Option<SystemTime> {
        None
    }

    fn read_only(&self) -> bool {
        true
    }
}

/// Text, unless the bytes look binary (`isBinaryContent`): a NUL early on, or more than 30% of
/// the first 8 KB neither printable ASCII, common whitespace nor a likely UTF-8 lead byte. Text is
/// decoded as UTF-8 with invalid bytes replaced and the byte order mark dropped, as the
/// webview's `TextDecoder` does.
pub fn decode(bytes: Vec<u8>, modified: Option<SystemTime>) -> Loaded {
    if looks_binary(&bytes) {
        return Loaded::Binary;
    }
    let text = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    let text = match std::str::from_utf8(text) {
        Ok(text) => text.to_string(),
        Err(_) => String::from_utf8_lossy(text).into_owned(),
    };
    Loaded::Text { text, modified }
}

fn looks_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(8 * 1024)];
    if sample.is_empty() {
        return false;
    }
    if sample.contains(&0) {
        return true;
    }
    let suspicious = sample
        .iter()
        .filter(|&&byte| !((0x20..=0x7e).contains(&byte) || matches!(byte, 0x09 | 0x0a | 0x0c | 0x0d) || byte >= 0xc2))
        .count();
    suspicious as f64 / sample.len() as f64 > 0.3
}

pub fn local() -> Arc<dyn FileBackend> {
    Arc::new(LocalFs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_load_read_only_under_their_title() {
        let path = register_snapshot("abc", "main.rs (Nov 12, 3:04 PM)", Path::new("/p/src/main.rs"), "fn main() {}".into());
        assert_eq!(path, PathBuf::from("local-history://abc/main.rs (Nov 12, 3:04 PM)"));
        assert!(is_snapshot(&path) && !is_snapshot(Path::new("/p/src/main.rs")));
        assert_eq!(snapshot_source(&path), Some(PathBuf::from("/p/src/main.rs")));
        assert!(matches!(SnapshotFs.load(&path).unwrap(), Loaded::Text { text, .. } if text == "fn main() {}"));
        assert!(SnapshotFs.read_only() && SnapshotFs.save(&path, "x").is_err());
        assert!(SnapshotFs.load(Path::new("local-history://gone/x")).is_err());
    }

    #[test]
    fn binary_detection() {
        assert!(matches!(decode(b"hello".to_vec(), None), Loaded::Text { .. }));
        assert!(matches!(decode(vec![0x89, b'P', b'N', b'G', 0, 0], None), Loaded::Binary));
        assert!(matches!(decode(vec![0x01, 0x02, 0x03, b'a'], None), Loaded::Binary));
        let Loaded::Text { text, .. } = decode(b"\xEF\xBB\xBFcaf\xe9 ok".to_vec(), None) else { panic!("not text") };
        assert_eq!(text, "caf\u{fffd} ok");
    }

    #[cfg(unix)]
    #[test]
    fn saves_through_symlinks_keep_the_bom_and_refuse_read_only_files() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target.txt");
        std::fs::write(&target, "\u{feff}old").unwrap();
        let link = directory.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        LocalFs.save(&link, "new").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "\u{feff}new");

        let mut permissions = std::fs::metadata(&target).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&target, permissions).unwrap();
        let error = LocalFs.save(&target, "changed").unwrap_err();
        assert!(error.to_string().contains("read-only"));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "\u{feff}new");
    }

    #[test]
    fn saves_atomically_and_reloads() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("file.txt");
        LocalFs.save(&path, "one\r\ntwo").unwrap();
        let Loaded::Text { text, .. } = LocalFs.load(&path).unwrap() else { panic!("not text") };
        assert_eq!(text, "one\r\ntwo");
    }

    #[test]
    fn checked_saves_refuse_a_file_changed_on_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("file.txt");
        std::fs::write(&path, "\u{feff}loaded").unwrap();
        LocalFs.save_checked(&path, "edited", "loaded").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "\u{feff}edited");

        std::fs::write(&path, "change").unwrap();
        let error = LocalFs.save_checked(&path, "mine", "edited").unwrap_err();
        assert!(error.to_string().contains("changed"), "{error}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "change");
    }
}
