//! What a diff tab shows, and the compact id the workbench keeps for it.
//!
//! Ids, with an optional `<repository root>|` in front when the repository is not the project's:
//!
//! | Target | Id |
//! |---|---|
//! | Unstaged changes of a file | `w:<path>` |
//! | Staged changes of a file | `s:<path>` |
//! | A file in a commit, against the commit's first parent | `c:<hash>:<path>` |
//! | A whole commit | `c:<hash>` |
//! | A stash entry | `t:<index>` |
//! | Two refs compared | `r:<base>..<target>` |
//! | Every tracked change (all, staged or unstaged) | `a:<scope>` |
//! | Two files on disk, such as local history snapshots | `f:<title>\n<path>\n<old file>\n<new file>` |
//!
//! Paths are relative to the repository root, with `/` separators. Ref names cannot hold `..`,
//! and commit hashes cannot hold `:`, so every id splits one way.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum DiffTarget {
    /// The working tree against the index.
    Working { path: String },
    /// The index against HEAD.
    Staged { path: String },
    /// One file of a commit against the commit's first parent.
    CommitFile { commit: String, path: String },
    /// Every file of a commit against its first parent.
    Commit { commit: String },
    /// A stash entry against the commit it was made on, untracked files included.
    Stash { index: usize },
    /// What changed from `base` to `target`.
    Compare { base: String, target: String },
    /// Every tracked file with changes, staged and unstaged apart.
    WorkingTree { scope: Scope },
    /// Two files outside git, named `path` and titled `title` (local history comparisons).
    Files { title: String, path: String, old: String, new: String },
    /// Several files held in memory (an agent step's edits), registered with
    /// [`crate::register_file_set`] under `key` and titled `title`.
    FileSet { key: String, title: String },
}

/// Which working tree changes a [`DiffTarget::WorkingTree`] diff shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Scope {
    All,
    Staged,
    Unstaged,
}

impl Scope {
    pub fn key(self) -> &'static str {
        match self {
            Scope::All => "all",
            Scope::Staged => "staged",
            Scope::Unstaged => "unstaged",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "all" => Scope::All,
            "staged" => Scope::Staged,
            "unstaged" => Scope::Unstaged,
            _ => return None,
        })
    }

    pub fn includes(self, staged: bool) -> bool {
        match self {
            Scope::All => true,
            Scope::Staged => staged,
            Scope::Unstaged => !staged,
        }
    }

    /// The tab title (`WORKING_TREE_TITLES`).
    pub fn title(self) -> &'static str {
        match self {
            Scope::All => "Uncommitted Changes",
            Scope::Staged => "Staged Changes",
            Scope::Unstaged => "Unstaged Changes",
        }
    }

    /// What there is none of when the diff would be empty (`WORKING_TREE_EMPTY_LABELS`).
    pub fn empty_label(self) -> &'static str {
        match self {
            Scope::All => "tracked changes",
            Scope::Staged => "staged changes",
            Scope::Unstaged => "unstaged tracked changes",
        }
    }
}

impl DiffTarget {
    /// Whether hunks can be staged, unstaged or discarded from this diff.
    pub fn is_editable(&self) -> bool {
        matches!(self, DiffTarget::Working { .. } | DiffTarget::Staged { .. } | DiffTarget::WorkingTree { .. })
    }

    /// The one file the diff is about, if it is about one.
    pub fn path(&self) -> Option<&str> {
        match self {
            DiffTarget::Working { path } | DiffTarget::Staged { path } | DiffTarget::CommitFile { path, .. } => Some(path),
            _ => None,
        }
    }

    pub fn format(&self) -> String {
        match self {
            DiffTarget::Working { path } => format!("w:{path}"),
            DiffTarget::Staged { path } => format!("s:{path}"),
            DiffTarget::CommitFile { commit, path } => format!("c:{commit}:{path}"),
            DiffTarget::Commit { commit } => format!("c:{commit}"),
            DiffTarget::Stash { index } => format!("t:{index}"),
            DiffTarget::Compare { base, target } => format!("r:{base}..{target}"),
            DiffTarget::WorkingTree { scope } => format!("a:{}", scope.key()),
            DiffTarget::Files { title, path, old, new } => format!("f:{title}\n{path}\n{old}\n{new}"),
            DiffTarget::FileSet { key, title } => format!("m:{key}\n{title}"),
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        let (kind, rest) = id.split_once(':')?;
        let nonempty = |text: &str| (!text.is_empty()).then(|| text.to_string());
        Some(match kind {
            "w" => DiffTarget::Working { path: nonempty(rest)? },
            "s" => DiffTarget::Staged { path: nonempty(rest)? },
            "c" => match rest.split_once(':') {
                Some((commit, path)) => DiffTarget::CommitFile { commit: nonempty(commit)?, path: nonempty(path)? },
                None => DiffTarget::Commit { commit: nonempty(rest)? },
            },
            "t" => DiffTarget::Stash { index: rest.parse().ok()? },
            "r" => {
                let (base, target) = rest.split_once("..")?;
                DiffTarget::Compare { base: nonempty(base)?, target: nonempty(target)? }
            }
            "a" => DiffTarget::WorkingTree { scope: Scope::parse(rest)? },
            "f" => {
                let mut parts = rest.split('\n');
                let (title, path, old, new) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
                DiffTarget::Files { title: title.to_string(), path: nonempty(path)?, old: nonempty(old)?, new: nonempty(new)? }
            }
            "m" => {
                let (key, title) = rest.split_once('\n')?;
                DiffTarget::FileSet { key: nonempty(key)?, title: title.to_string() }
            }
            _ => return None,
        })
    }

    /// The tab title, as Athas names diff buffers.
    pub fn title(&self) -> String {
        let name = |path: &str| path.rsplit('/').next().unwrap_or(path).to_string();
        match self {
            DiffTarget::Working { path } => format!("{} (Changes)", name(path)),
            DiffTarget::Staged { path } => format!("{} (Staged)", name(path)),
            DiffTarget::CommitFile { commit, path } => format!("{} @ {}", name(path), short_hash(commit)),
            DiffTarget::Commit { commit } => format!("Commit {}", short_hash(commit)),
            DiffTarget::Stash { index } => format!("stash@{{{index}}}"),
            DiffTarget::Compare { base, target } => format!("{}..{}", short_ref(base), short_ref(target)),
            DiffTarget::WorkingTree { scope } => scope.title().to_string(),
            DiffTarget::Files { title, .. } | DiffTarget::FileSet { title, .. } => title.clone(),
        }
    }
}

pub fn short_hash(hash: &str) -> &str {
    &hash[..hash.len().min(7)]
}

/// A full commit hash shortened; branch and tag names as they are.
fn short_ref(name: &str) -> &str {
    if name.len() == 40 && name.bytes().all(|byte| byte.is_ascii_hexdigit()) { short_hash(name) } else { name }
}

/// An id with the repository it belongs to: `<root>|<rest>` or just `<rest>`.
pub fn with_repo(repo: Option<&Path>, rest: &str) -> String {
    match repo {
        Some(repo) => format!("{}|{rest}", repo.to_string_lossy()),
        None => rest.to_string(),
    }
}

/// Splits off the repository root an id names, if any.
pub fn split_repo(id: &str) -> (Option<PathBuf>, &str) {
    match id.split_once('|') {
        Some((repo, rest)) if Path::new(repo).has_root() => (Some(PathBuf::from(repo)), rest),
        _ => (None, id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_target() {
        let targets = [
            DiffTarget::Working { path: "src/main.rs".into() },
            DiffTarget::Staged { path: "dir with space/a:b.txt".into() },
            DiffTarget::CommitFile { commit: "0123456789abcdef0123456789abcdef01234567".into(), path: "a/b:c.rs".into() },
            DiffTarget::Commit { commit: "0123456".into() },
            DiffTarget::Stash { index: 3 },
            DiffTarget::Compare { base: "v1.0.0".into(), target: "feature/x".into() },
            DiffTarget::WorkingTree { scope: Scope::All },
            DiffTarget::WorkingTree { scope: Scope::Staged },
            DiffTarget::WorkingTree { scope: Scope::Unstaged },
            DiffTarget::Files { title: "a.rs: Earlier vs Current".into(), path: "/p/a.rs".into(), old: "/h/1-abc".into(), new: "/p/a.rs".into() },
            DiffTarget::FileSet { key: "step-1".into(), title: "Agent step: 2 files".into() },
        ];
        for target in targets {
            assert_eq!(DiffTarget::parse(&target.format()), Some(target.clone()), "{}", target.format());
        }
    }

    #[test]
    fn rejects_malformed_ids() {
        for id in ["", "w:", "x:path", "t:one", "r:main", "r:..main", "c:", "nonsense", "a:", "a:some"] {
            assert_eq!(DiffTarget::parse(id), None, "{id}");
        }
    }

    #[test]
    fn names_tabs() {
        assert_eq!(DiffTarget::Working { path: "src/lib.rs".into() }.title(), "lib.rs (Changes)");
        assert_eq!(DiffTarget::Staged { path: "lib.rs".into() }.title(), "lib.rs (Staged)");
        assert_eq!(DiffTarget::Commit { commit: "0123456789abcdef0123456789abcdef01234567".into() }.title(), "Commit 0123456");
        assert_eq!(DiffTarget::Stash { index: 0 }.title(), "stash@{0}");
        assert_eq!(DiffTarget::Compare { base: "v1".into(), target: "HEAD".into() }.title(), "v1..HEAD");
        assert_eq!(DiffTarget::WorkingTree { scope: Scope::Staged }.title(), "Staged Changes");
    }

    #[test]
    fn carries_the_repository() {
        let id = with_repo(Some(Path::new("/work/repo")), "w:a.rs");
        assert_eq!(id, "/work/repo|w:a.rs");
        assert_eq!(split_repo(&id), (Some(PathBuf::from("/work/repo")), "w:a.rs"));
        assert_eq!(split_repo("w:a|b.rs"), (None, "w:a|b.rs"));
        assert_eq!(with_repo(None, "c:abc"), "c:abc");
    }
}
