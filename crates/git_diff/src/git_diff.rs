//! Git diffs, commits and blame as centre views (`features/git/components/diff` and the commit
//! and blame views of Athas).
//!
//! The workbench opens them as resource tabs: [`RESOURCE_KINDS`] names the kinds and
//! [`open_resource`] builds the view for a tab. Other tools ask for one with
//! `workbench_api::open_resource(cx, kind, id, title)`, building the id with [`diff_id`],
//! [`commit_id`], [`blame_id`] or [`file_at_commit_id`].

pub mod avatar;
mod blame;
mod blame_view;
mod commit_file;
mod commit_view;
mod diff_view;
pub mod highlight;
pub mod git;
mod line_diff;
pub mod model;
pub mod remote;
mod selection;
mod target;
mod widgets;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    rc::Rc,
};

use gpui::{AnyElement, AnyView, App, AppContext, FocusHandle, Focusable, Global, Window};

pub use blame::{BlameCommit, BlameLine, blame_buffer, blame_lines};
pub use blame_view::BlameView;
pub use commit_view::CommitView;
pub use diff_view::DiffView;
pub use target::{DiffTarget, Scope};

/// A diff: the id is [`diff_id`].
pub const DIFF_KIND: &str = "git-diff";
/// A commit's details: the id is [`commit_id`].
pub const COMMIT_KIND: &str = "git-commit";
/// A file's blame: the id is [`blame_id`].
pub const BLAME_KIND: &str = "git-blame";

/// A file as it was at a commit, read-only: the id is [`file_at_commit_id`].
pub const FILE_AT_COMMIT_KIND: &str = "git-file-at-commit";

pub const RESOURCE_KINDS: &[&str] = &[DIFF_KIND, COMMIT_KIND, BLAME_KIND, FILE_AT_COMMIT_KIND];

/// Draws controls above a multi-file diff, such as a proposal's Accept and Reject.
pub type DiffBanner = Rc<dyn Fn(&DiffTarget, &mut Window, &mut App) -> AnyElement>;

#[derive(Default)]
struct DiffBanners(HashMap<String, DiffBanner>);

impl Global for DiffBanners {}

/// Shows `banner` above the diffs whose commit (or, for two files, title) is `kind`
/// (`registerDiffBanner`): features that open their own diffs add controls without the view
/// knowing them.
pub fn register_diff_banner(cx: &mut App, kind: impl Into<String>, banner: DiffBanner) {
    cx.default_global::<DiffBanners>().0.insert(kind.into(), banner);
}

fn banner_kind(target: &DiffTarget) -> Option<&str> {
    match target {
        DiffTarget::Commit { commit } => Some(commit),
        DiffTarget::Files { title, .. } | DiffTarget::FileSet { title, .. } => Some(title),
        _ => None,
    }
}

pub(crate) fn diff_banner(target: &DiffTarget, cx: &App) -> Option<DiffBanner> {
    let banners = cx.try_global::<DiffBanners>()?;
    banners.0.get(banner_kind(target)?).cloned()
}

/// Binds the views' keys. The views call it themselves; calling it at start-up is harmless.
pub fn init(cx: &mut App) {
    diff_view::init(cx);
}

/// The id of a diff tab. `repo` is the repository root when it may differ from the project's.
pub fn diff_id(repo: Option<&Path>, target: &DiffTarget) -> String {
    target::with_repo(repo, &target.format())
}

/// The id of a commit tab.
pub fn commit_id(repo: Option<&Path>, commit: &str) -> String {
    target::with_repo(repo, commit)
}

/// The id of a blame tab; `path` is relative to the repository root.
pub fn blame_id(repo: Option<&Path>, path: &str) -> String {
    target::with_repo(repo, path)
}

/// The id of a file-at-a-commit tab; `path` is relative to the repository root.
pub fn file_at_commit_id(repo: Option<&Path>, commit: &str, path: &str) -> String {
    target::with_repo(repo, &format!("{commit}:{path}"))
}

/// Asks the workbench for `path` as it was at `commit` (`openCommitFileBuffer`).
pub fn open_file_at_commit(cx: &mut App, repo: Option<&Path>, commit: &str, path: &str) {
    workbench_api::open_resource(cx, FILE_AT_COMMIT_KIND, &file_at_commit_id(repo, commit, path), &commit_file::title(commit, path));
}

/// One file of an in-memory diff: its path (shown as given, relative paths read best), the text
/// before and the text after. An empty side reads as the file being added or deleted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryFile {
    pub path: std::path::PathBuf,
    pub old: String,
    pub new: String,
}

static FILE_SETS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<Vec<MemoryFile>>>>> =
    std::sync::LazyLock::new(Default::default);

/// Keeps `files` for a [`DiffTarget::FileSet`] under `key` (a later call with the same key
/// replaces them) and returns the target, to open with [`open_diff`] or [`open_file_set`].
pub fn register_file_set(key: impl Into<String>, title: impl Into<String>, files: Vec<MemoryFile>) -> DiffTarget {
    let key = key.into().replace('\n', " ");
    if let Ok(mut sets) = FILE_SETS.lock() {
        sets.insert(key.clone(), std::sync::Arc::new(files));
    }
    DiffTarget::FileSet { key, title: title.into() }
}

/// The files registered under `key`.
pub fn file_set(key: &str) -> Option<std::sync::Arc<Vec<MemoryFile>>> {
    FILE_SETS.lock().ok()?.get(key).cloned()
}

/// Opens several in-memory files in one diff tab, the normal multi-file diff (sticky headers,
/// navigator, folding), read-only: `register_file_set` then [`open_diff`]. `repo` scopes the tab
/// id as other diffs; `key` names the set so opening it again focuses the same tab.
pub fn open_file_set(cx: &mut App, repo: Option<&Path>, key: &str, title: &str, files: Vec<MemoryFile>) {
    let target = register_file_set(key, title, files);
    open_diff(cx, repo, &target);
}

/// Asks the workbench for a diff tab.
pub fn open_diff(cx: &mut App, repo: Option<&Path>, target: &DiffTarget) {
    workbench_api::open_resource(cx, DIFF_KIND, &diff_id(repo, target), &target.title());
}

/// Asks the workbench for a commit tab.
pub fn open_commit(cx: &mut App, repo: Option<&Path>, commit: &str, title: Option<&str>) {
    let title = title.map_or_else(|| format!("Commit {}", target::short_hash(commit)), str::to_string);
    workbench_api::open_resource(cx, COMMIT_KIND, &commit_id(repo, commit), &title);
}

/// Asks the workbench for a blame tab.
pub fn open_blame(cx: &mut App, repo: Option<&Path>, path: &str) {
    let name = path.rsplit('/').next().unwrap_or(path);
    workbench_api::open_resource(cx, BLAME_KIND, &blame_id(repo, path), &format!("{name} (Blame)"));
}

/// The view for a resource tab of one of [`RESOURCE_KINDS`]. `project_root` is the active
/// project's folder: the repository is the one an id names, or else the one containing it.
pub fn open_resource(kind: &str, id: &str, project_root: PathBuf, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    open_resource_with_focus(kind, id, project_root, window, cx).map(|(view, _)| view)
}

/// [`open_resource`] with the view's focus handle, so the tab can take focus (the diff view's
/// hunk keys, alt-up and alt-down, work while it has it).
pub fn open_resource_with_focus(kind: &str, id: &str, project_root: PathBuf, window: &mut Window, cx: &mut App) -> Option<(AnyView, FocusHandle)> {
    let (repo, rest) = target::split_repo(id);
    let outside_git = kind == DIFF_KIND && rest.starts_with("f:");
    let repo = repo.or_else(|| git::discover(&project_root)).or_else(|| outside_git.then(|| project_root.clone()))?;
    Some(match kind {
        DIFF_KIND => {
            let target = DiffTarget::parse(rest)?;
            let view = cx.new(|cx| DiffView::new(repo, target, window, cx));
            (view.clone().into(), view.focus_handle(cx))
        }
        COMMIT_KIND if !rest.is_empty() => {
            let commit = rest.to_string();
            let view = cx.new(|cx| CommitView::new(repo, commit, window, cx));
            (view.clone().into(), view.focus_handle(cx))
        }
        BLAME_KIND if !rest.is_empty() => {
            let path = rest.to_string();
            let view = cx.new(|cx| BlameView::new(repo, path, window, cx));
            (view.clone().into(), view.focus_handle(cx))
        }
        FILE_AT_COMMIT_KIND => {
            let (commit, path) = rest.split_once(':').filter(|(commit, path)| !commit.is_empty() && !path.is_empty())?;
            let backend = commit_file::CommitFile { repo: repo.clone(), commit: commit.to_string(), path: path.to_string() };
            let view = cx.new(|cx| editor::Editor::open_with(repo.join(path), std::sync::Arc::new(backend), window, cx));
            (view.clone().into(), view.focus_handle(cx))
        }
        _ => return None,
    })
}
