//! Files opened from quick open, ranked by frecency and kept between launches
//! (`recent-files.store.ts`).

use std::path::{Path, PathBuf};

use gpui::{App, Global};
use serde::{Deserialize, Serialize};

/// Files remembered at most (`MAX_RECENT_FILES`).
const MAX_RECENT_FILES: usize = 50;
/// Recent files listed before any query (`MAX_RECENT_FILES_NO_QUERY`).
pub(crate) const MAX_RECENT_FILES_NO_QUERY: usize = 10;

const DAY_MS: f64 = 24. * 60. * 60. * 1000.;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    /// When it was last opened, in milliseconds since the epoch.
    pub last_accessed: u64,
    pub access_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub external: bool,
}

impl RecentFile {
    fn frecency(&self, now: u64) -> f64 {
        util::frecency_score(self.access_count, now.saturating_sub(self.last_accessed) as f64 / DAY_MS)
    }
}

#[derive(Default)]
pub struct RecentFiles {
    files: Vec<RecentFile>,
    path: Option<PathBuf>,
}

impl Global for RecentFiles {}

impl RecentFiles {
    pub fn load(path: Option<PathBuf>) -> Self {
        let files = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Vec<RecentFile>>(&text).ok())
            .unwrap_or_default();
        Self { files, path }
    }

    /// Counts another opening of `path` (`addOrUpdateRecentFile`).
    pub fn record(&mut self, path: &Path, workspace: Option<&Path>, now: u64) {
        let key = path.to_string_lossy().into_owned();
        let workspace = workspace.map(|workspace| workspace.to_string_lossy().into_owned());
        match self.files.iter_mut().find(|file| file.path == key) {
            Some(file) => {
                file.last_accessed = now;
                file.access_count += 1;
                if workspace.is_some() {
                    file.workspace_path = workspace;
                }
                file.external = false;
            }
            None => self.files.push(RecentFile {
                name: path.file_name().map_or_else(|| key.clone(), |name| name.to_string_lossy().into_owned()),
                path: key,
                last_accessed: now,
                access_count: 1,
                workspace_path: workspace,
                external: false,
            }),
        }
        if self.files.len() > MAX_RECENT_FILES {
            self.files.sort_by(|a, b| b.frecency(now).total_cmp(&a.frecency(now)));
            self.files.truncate(MAX_RECENT_FILES);
        }
        self.save();
    }

    /// The files, highest frecency first (`getRecentFilesOrderedByFrecency`).
    pub fn ordered(&self, now: u64) -> Vec<RecentFile> {
        let mut files = self.files.clone();
        files.sort_by(|a, b| b.frecency(now).total_cmp(&a.frecency(now)));
        files
    }

    /// The recent files of the workspace with `roots`, highest frecency first
    /// (`filterQuickOpenRecentFiles`).
    pub fn in_workspace(&self, roots: &[PathBuf], now: u64) -> Vec<PathBuf> {
        self.ordered(now)
            .into_iter()
            .filter(|file| {
                roots.is_empty()
                    || roots.iter().any(|root| {
                        file.workspace_path.as_deref() == Some(root.to_string_lossy().as_ref()) || Path::new(&file.path).starts_with(root)
                    })
            })
            .map(|file| PathBuf::from(file.path))
            .collect()
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        if let Ok(json) = serde_json::to_string(&self.files) {
            std::fs::write(path, json).ok();
        }
    }
}

#[cfg(not(target_family = "wasm"))]
pub fn recent_files_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("recent-files.json"))
}

#[cfg(target_family = "wasm")]
pub fn recent_files_path() -> Option<PathBuf> {
    None
}

/// Whether a recent file is still on disk; remote ones are kept.
pub(crate) fn still_there(path: &Path) -> bool {
    #[cfg(not(target_family = "wasm"))]
    return crate::remote_files::is_remote_root(path) || path.is_file();
    #[cfg(target_family = "wasm")]
    {
        let _ = path;
        true
    }
}

pub(crate) fn now_ms() -> u64 {
    web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map_or(0, |duration| duration.as_millis() as u64)
}

pub(crate) fn recent_files(cx: &mut App) -> &mut RecentFiles {
    if !cx.has_global::<RecentFiles>() {
        cx.set_global(RecentFiles::load(recent_files_path()));
    }
    cx.global_mut::<RecentFiles>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_rank_by_frecency_and_persist() {
        let dir = std::env::temp_dir().join(format!("athas-recent-files-{}", std::process::id()));
        let file = dir.join("recent-files.json");
        let now = 1_700_000_000_000;
        let mut recent = RecentFiles::load(Some(file.clone()));
        recent.record(Path::new("/p/a.rs"), Some(Path::new("/p")), now - 30 * DAY_MS as u64);
        recent.record(Path::new("/p/b.rs"), Some(Path::new("/p")), now);
        recent.record(Path::new("/q/c.rs"), Some(Path::new("/q")), now);
        recent.record(Path::new("/q/c.rs"), Some(Path::new("/q")), now);
        let ordered: Vec<String> = recent.ordered(now).into_iter().map(|file| file.path).collect();
        assert_eq!(ordered, ["/q/c.rs", "/p/b.rs", "/p/a.rs"]);
        assert_eq!(recent.in_workspace(&[PathBuf::from("/p")], now), [PathBuf::from("/p/b.rs"), PathBuf::from("/p/a.rs")]);

        let reloaded = RecentFiles::load(Some(file));
        assert_eq!(reloaded.ordered(now), recent.ordered(now));
        for index in 0..MAX_RECENT_FILES + 5 {
            recent.record(Path::new(&format!("/p/{index}.rs")), None, now);
        }
        assert_eq!(recent.files.len(), MAX_RECENT_FILES);
        std::fs::remove_dir_all(dir).ok();
    }
}
