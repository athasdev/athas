//! Folders opened before (`recent-folders.store.ts`, `utils/recent-folders.ts`): pinned ones first,
//! then the most recent, with the icon each was given and whether it is still on disk.

use serde::{Deserialize, Serialize};

use crate::project_name;

/// Unpinned folders kept; pinned ones are always kept.
pub const MAX_RECENT_PROJECTS: usize = 12;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened: u64,
    #[serde(default)]
    pub pinned: bool,
    /// The folder was gone the last time Athas tried to open it.
    #[serde(default)]
    pub missing: bool,
    #[serde(default)]
    pub custom_icon: Option<String>,
    /// The editor a folder was imported from (`vscode`, `zed`, …).
    #[serde(default)]
    pub import_source_id: Option<String>,
    #[serde(default)]
    pub import_source_name: Option<String>,
}

/// A folder another editor reported, to add to the recent list.
#[derive(Clone, Debug, PartialEq)]
pub struct RecentImport {
    pub path: String,
    pub source_id: Option<String>,
    pub source_name: Option<String>,
}

/// Pinned folders first, then the newest; at most [`MAX_RECENT_PROJECTS`] unpinned.
pub fn limit_recents(mut recents: Vec<RecentProject>) -> Vec<RecentProject> {
    recents.sort_by(|left, right| right.pinned.cmp(&left.pinned).then(right.last_opened.cmp(&left.last_opened)));
    let mut unpinned = 0;
    recents.retain(|recent| {
        if recent.pinned {
            return true;
        }
        unpinned += 1;
        unpinned <= MAX_RECENT_PROJECTS
    });
    recents
}

/// Puts `path` at the front as opened at `at`, keeping what was known about it.
pub fn upsert_recent(recents: &[RecentProject], path: &str, at: u64, metadata: RecentMetadata) -> Vec<RecentProject> {
    let existing = recents.iter().find(|recent| recent.path == path);
    let next = RecentProject {
        path: path.to_string(),
        name: existing.map_or_else(|| project_name(path), |recent| recent.name.clone()),
        last_opened: at,
        pinned: existing.is_some_and(|recent| recent.pinned),
        missing: metadata.missing.unwrap_or(false),
        custom_icon: metadata.custom_icon.or_else(|| existing.and_then(|recent| recent.custom_icon.clone())),
        import_source_id: metadata.import_source_id.or_else(|| existing.and_then(|recent| recent.import_source_id.clone())),
        import_source_name: metadata
            .import_source_name
            .or_else(|| existing.and_then(|recent| recent.import_source_name.clone())),
    };
    let mut all = vec![next];
    all.extend(recents.iter().filter(|recent| recent.path != path).cloned());
    limit_recents(all)
}

#[derive(Clone, Debug, Default)]
pub struct RecentMetadata {
    pub missing: Option<bool>,
    pub custom_icon: Option<String>,
    pub import_source_id: Option<String>,
    pub import_source_name: Option<String>,
}

/// Each path once, in the order given.
pub fn unique_imports(imports: Vec<RecentImport>) -> Vec<RecentImport> {
    let mut seen = std::collections::HashSet::new();
    imports.into_iter().filter(|import| seen.insert(import.path.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recent(path: &str, at: u64, pinned: bool) -> RecentProject {
        RecentProject { path: path.into(), name: project_name(path), last_opened: at, pinned, ..Default::default() }
    }

    #[test]
    fn pinned_first_and_unpinned_limited() {
        let mut recents: Vec<RecentProject> = (0..20).map(|index| recent(&format!("/p{index}"), index, false)).collect();
        recents.push(recent("/pinned", 0, true));
        let limited = limit_recents(recents);
        assert_eq!(limited[0].path, "/pinned");
        assert_eq!(limited[1].path, "/p19");
        assert_eq!(limited.len(), MAX_RECENT_PROJECTS + 1);
    }

    #[test]
    fn upsert_keeps_pin_name_and_icon() {
        let mut existing = recent("/a", 1, true);
        existing.name = "Renamed".into();
        existing.custom_icon = Some("emoji:🚀".into());
        existing.missing = true;
        let next = upsert_recent(&[existing, recent("/b", 5, false)], "/a", 10, RecentMetadata::default());
        assert_eq!(next[0].path, "/a");
        assert!(next[0].pinned);
        assert!(!next[0].missing);
        assert_eq!(next[0].name, "Renamed");
        assert_eq!(next[0].custom_icon.as_deref(), Some("emoji:🚀"));
    }
}
