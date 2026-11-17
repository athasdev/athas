//! Quick open in SSH and WSL roots (`getAllProjectFiles` in `file-system.store.ts`): the file
//! index only sees local folders, so these roots are walked through their own file system, kept
//! for five minutes, and fuzzy matched here.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use crate::fuzzy_match;

/// A root's files (absolute paths), or `None` when the root is on this machine.
pub type RemoteFileLister = Arc<dyn Fn(&Path) -> Option<Vec<PathBuf>> + Send + Sync>;

static LISTER: OnceLock<RemoteFileLister> = OnceLock::new();
static CACHE: OnceLock<Mutex<HashMap<PathBuf, (Instant, Arc<Vec<PathBuf>>)>>> = OnceLock::new();

const CACHE_FOR: Duration = Duration::from_secs(5 * 60);

/// How quick open lists the files of a root on another machine; the workbench sets it.
pub fn set_remote_file_lister(lister: RemoteFileLister) {
    let _ = LISTER.set(lister);
}

pub(crate) fn is_remote_root(root: &Path) -> bool {
    let root = root.to_string_lossy();
    root.starts_with("remote://") || root.starts_with("wsl://")
}

const IGNORED_DIRECTORIES: [&str; 15] =
    ["node_modules", ".git", ".next", ".cache", "dist", "build", ".turbo", "coverage", ".vscode", ".idea", "__pycache__", ".pytest_cache", "target", "out", ".DS_Store"];
const IGNORED_FILES: [&str; 9] =
    [".DS_Store", "Thumbs.db", ".gitignore", ".gitattributes", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "Cargo.lock"];
const IGNORED_EXTENSIONS: [&str; 5] = [".map", ".log", ".lock", ".min.js", ".min.css"];

/// `shouldIgnoreSearchEntry`: folders and files quick open never lists.
pub fn ignored_entry(name: &str, is_dir: bool) -> bool {
    if is_dir {
        return IGNORED_DIRECTORIES.contains(&name);
    }
    IGNORED_FILES.contains(&name) || IGNORED_EXTENSIONS.iter().any(|extension| name.ends_with(extension))
}

fn files_of(root: &Path) -> Arc<Vec<PathBuf>> {
    let cache = CACHE.get_or_init(Default::default);
    if let Some((listed, files)) = cache.lock().ok().and_then(|cache| cache.get(root).cloned())
        && listed.elapsed() < CACHE_FOR
    {
        return files;
    }
    let Some(files) = LISTER.get().and_then(|lister| lister(root)) else { return Arc::default() };
    let files = Arc::new(files);
    if let Ok(mut cache) = cache.lock() {
        cache.insert(root.to_path_buf(), (Instant::now(), files.clone()));
    }
    files
}

/// A file listed under `root`: its absolute path, name and path relative to the root.
pub(crate) struct RemoteHit {
    pub path: String,
    pub name: String,
    pub relative_path: String,
    pub score: i64,
}

/// The files of `roots` matching `query` (all of them, up to `limit`, for an empty query).
pub(crate) fn search(roots: &[&Path], query: &str, limit: usize) -> Vec<RemoteHit> {
    let mut hits = Vec::new();
    for root in roots {
        for path in files_of(root).iter() {
            let relative_path = path.strip_prefix(root).unwrap_or(path).to_string_lossy().trim_start_matches('/').to_string();
            let score = if query.trim().is_empty() {
                0
            } else {
                match fuzzy_match(query, &relative_path) {
                    Some(matched) => matched.score,
                    None => continue,
                }
            };
            let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            hits.push(RemoteHit { path: path.to_string_lossy().into_owned(), name, relative_path, score });
        }
    }
    if !query.trim().is_empty() {
        hits.sort_by(|a, b| b.score.cmp(&a.score));
    }
    hits.truncate(limit);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_and_matches_remote_roots() {
        set_remote_file_lister(Arc::new(|root: &Path| {
            is_remote_root(root).then(|| ["src/main.rs", "src/lib.rs", "README.md"].iter().map(|file| root.join(file)).collect())
        }));
        let root = Path::new("remote://box/srv/app");
        assert!(is_remote_root(root) && !is_remote_root(Path::new("/srv/app")));
        let all = search(&[root], "", 2);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].relative_path, "src/main.rs");
        let hits = search(&[root], "lib", 10);
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].name.as_str(), hits[0].path.as_str()), ("lib.rs", "remote://box/srv/app/src/lib.rs"));
    }

    #[test]
    fn ignores_what_the_original_ignores() {
        assert!(ignored_entry("node_modules", true));
        assert!(!ignored_entry("node_modules", false));
        assert!(ignored_entry("Cargo.lock", false));
        assert!(ignored_entry("app.min.js", false));
        assert!(!ignored_entry("main.rs", false));
    }
}
