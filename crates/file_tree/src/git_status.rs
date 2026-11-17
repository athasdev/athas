//! Git status colors on tree rows (`lib/file-tree-git-status.ts`): a file shows its own status, a
//! folder the strongest status inside it.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GitStatusKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

/// One changed path, relative to the repository root; a path ending in `/` is a whole folder
/// (an untracked one).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitFileStatus {
    pub path: String,
    pub kind: GitStatusKind,
    pub staged: bool,
}

/// How a row's label is colored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GitDecoration {
    Modified,
    ModifiedStaged,
    Added,
    Deleted,
    Untracked,
    Renamed,
}

impl GitDecoration {
    fn of(file: &GitFileStatus) -> Self {
        match file.kind {
            GitStatusKind::Modified if file.staged => GitDecoration::ModifiedStaged,
            GitStatusKind::Modified => GitDecoration::Modified,
            GitStatusKind::Added => GitDecoration::Added,
            GitStatusKind::Deleted => GitDecoration::Deleted,
            GitStatusKind::Untracked => GitDecoration::Untracked,
            GitStatusKind::Renamed => GitDecoration::Renamed,
        }
    }

    pub fn color(self, colors: &theme::ThemeColors) -> gpui::Hsla {
        match self {
            GitDecoration::Modified => colors.git_modified,
            GitDecoration::ModifiedStaged => colors.git_modified_staged,
            GitDecoration::Added => colors.git_added,
            GitDecoration::Deleted => colors.git_deleted,
            GitDecoration::Untracked => colors.git_untracked,
            GitDecoration::Renamed => colors.git_renamed,
        }
    }
}

fn priority(file: &GitFileStatus) -> u8 {
    let base = match file.kind {
        GitStatusKind::Deleted => 50,
        GitStatusKind::Modified => 40,
        GitStatusKind::Renamed => 30,
        GitStatusKind::Added => 20,
        GitStatusKind::Untracked => 10,
    };
    if file.kind == GitStatusKind::Modified && file.staged { base + 1 } else { base }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct GitStatusLookup {
    repo_root: PathBuf,
    files: HashMap<String, GitDecoration>,
    directories: HashMap<String, GitDecoration>,
    whole_directories: HashMap<String, GitDecoration>,
}

impl GitStatusLookup {
    pub fn new(repo_root: PathBuf, statuses: &[GitFileStatus]) -> Self {
        let mut lookup = Self { repo_root, ..Self::default() };
        let mut priorities: HashMap<String, u8> = HashMap::new();
        for file in statuses {
            let decoration = GitDecoration::of(file);
            if file.path.ends_with('/') {
                lookup.whole_directories.insert(file.path.trim_end_matches('/').to_string(), decoration);
            } else {
                lookup.files.insert(file.path.clone(), decoration);
            }
            let segments: Vec<&str> = file.path.split('/').collect();
            let mut current = String::new();
            for segment in &segments[..segments.len().saturating_sub(1)] {
                if !current.is_empty() {
                    current.push('/');
                }
                current.push_str(segment);
                let next = priority(file);
                if priorities.get(&current).is_none_or(|&existing| next > existing) {
                    lookup.directories.insert(current.clone(), decoration);
                    priorities.insert(current.clone(), next);
                }
            }
        }
        lookup
    }

    pub fn decoration(&self, path: &Path, is_dir: bool) -> Option<GitDecoration> {
        let relative = path.strip_prefix(&self.repo_root).ok()?.to_string_lossy().replace('\\', "/");
        if relative.is_empty() {
            return None;
        }
        if let Some(decoration) = self.files.get(&relative) {
            return Some(*decoration);
        }
        if !self.whole_directories.is_empty() {
            let mut index = relative.find('/');
            while let Some(separator) = index {
                if let Some(decoration) = self.whole_directories.get(&relative[..separator]) {
                    return Some(*decoration);
                }
                index = relative[separator + 1..].find('/').map(|next| separator + 1 + next);
            }
        }
        if is_dir {
            return self.whole_directories.get(&relative).or_else(|| self.directories.get(&relative)).copied();
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(path: &str, kind: GitStatusKind, staged: bool) -> GitFileStatus {
        GitFileStatus { path: path.into(), kind, staged }
    }

    #[test]
    fn files_folders_and_whole_folders_get_decorations() {
        let lookup = GitStatusLookup::new(
            "/r".into(),
            &[
                status("src/a.rs", GitStatusKind::Added, true),
                status("src/deep/b.rs", GitStatusKind::Modified, true),
                status("src/c.rs", GitStatusKind::Deleted, false),
                status("new/", GitStatusKind::Untracked, false),
            ],
        );
        assert_eq!(lookup.decoration(Path::new("/r/src/a.rs"), false), Some(GitDecoration::Added));
        assert_eq!(lookup.decoration(Path::new("/r/src"), true), Some(GitDecoration::Deleted));
        assert_eq!(lookup.decoration(Path::new("/r/src/deep"), true), Some(GitDecoration::ModifiedStaged));
        assert_eq!(lookup.decoration(Path::new("/r/new"), true), Some(GitDecoration::Untracked));
        assert_eq!(lookup.decoration(Path::new("/r/new/x/y.rs"), false), Some(GitDecoration::Untracked));
        assert_eq!(lookup.decoration(Path::new("/r/other.rs"), false), None);
        assert_eq!(lookup.decoration(Path::new("/r"), true), None);
        assert_eq!(lookup.decoration(Path::new("/elsewhere/src/a.rs"), false), None);
    }
}
