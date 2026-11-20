//! Repository access for the panel. The panel only talks to [`GitRepository`], so a remote (web)
//! backend can stand in for the local one. Every method blocks; the panel calls them off the UI
//! thread.

#[cfg(not(target_family = "wasm"))]
use std::{path::PathBuf, sync::Mutex};
use std::{path::Path, sync::Arc};

use anyhow::{Result, anyhow};
#[cfg(not(target_family = "wasm"))]
use athas_version_control as vc;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

/// One line of `git status`: a file with its change in the index or in the working tree. A file
/// changed in both appears twice.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusEntry {
    pub path: String,
    pub status: FileStatus,
    pub staged: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffStat {
    pub path: String,
    pub staged: bool,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug, Default)]
pub struct WorkingTree {
    pub branch: String,
    /// The commit HEAD points at; a change means the history needs reloading.
    pub head: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub files: Vec<StatusEntry>,
    pub stats: Vec<DiffStat>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub hash: String,
    pub summary: String,
    pub author: String,
    pub email: String,
    /// `YYYY-MM-DD`.
    pub date: String,
    /// The message after its first line, when there is one.
    pub description: Option<String>,
}

/// Files changed and lines added/removed by a commit, as the expanded history row shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CommitTotals {
    pub files: usize,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stash {
    pub index: usize,
    pub message: String,
    /// ISO 8601.
    pub date: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteOp {
    Fetch,
    Pull,
    Push,
}

impl RemoteOp {
    pub fn past_tense(self) -> &'static str {
        match self {
            RemoteOp::Fetch => "Fetched",
            RemoteOp::Pull => "Pulled",
            RemoteOp::Push => "Pushed",
        }
    }

    pub fn verb(self) -> &'static str {
        match self {
            RemoteOp::Fetch => "fetch",
            RemoteOp::Pull => "pull",
            RemoteOp::Push => "push",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Checkout {
    Switched,
    /// Uncommitted changes are in the way; the message says so.
    Blocked(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StashAction {
    Apply,
    Pop,
    Drop,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub is_current: bool,
    pub is_bare: bool,
    pub is_detached: bool,
    pub locked: bool,
    /// `git worktree prune` would remove it: its folder is gone.
    pub prunable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tag {
    pub name: String,
    pub commit: String,
    pub message: Option<String>,
    /// ISO 8601, or empty when unknown.
    pub date: String,
}

pub trait GitRepository: Send + Sync {
    /// The working tree's root; status paths are relative to it.
    fn root(&self) -> &Path;
    fn status(&self) -> Result<WorkingTree>;
    fn branches(&self) -> Result<Vec<String>>;
    fn log(&self, skip: usize, limit: usize) -> Result<Vec<Commit>>;
    fn stashes(&self) -> Result<Vec<Stash>>;
    /// What the commit changed; repositories that cannot tell leave the totals out.
    fn commit_totals(&self, _hash: &str) -> Result<CommitTotals> {
        Err(anyhow!("Commit totals are not available here"))
    }
    fn set_staged(&self, paths: &[String], staged: bool) -> Result<()>;
    fn discard(&self, paths: &[String]) -> Result<()>;
    fn discard_all(&self) -> Result<()>;
    fn commit(&self, message: &str) -> Result<()>;
    /// Commits with a `Signed-off-by` trailer when `sign_off` is set (`gitSignOffCommits`).
    fn commit_signed(&self, message: &str, _sign_off: bool) -> Result<()> {
        self.commit(message)
    }
    fn checkout(&self, branch: &str) -> Result<Checkout>;
    /// Creates the branch from `from` (HEAD when `None`) and switches to it.
    fn create_branch(&self, name: &str, from: Option<&str>) -> Result<()>;
    fn delete_branch(&self, name: &str) -> Result<()>;
    /// Stashes everything, untracked files included, or only `paths`.
    fn stash(&self, message: Option<&str>, paths: Option<Vec<String>>) -> Result<()>;
    fn stash_action(&self, action: StashAction, index: usize) -> Result<()>;
    fn remote(&self, op: RemoteOp, pull_rebase: bool) -> Result<()>;
    // Backends without worktrees, remotes or tags (a remote server's) list none and refuse to
    // change them.
    /// The main worktree first.
    fn worktrees(&self) -> Result<Vec<Worktree>> {
        Ok(Vec::new())
    }
    /// Adds a worktree at `path`, on a new branch `branch` when given, else detached at HEAD.
    fn add_worktree(&self, _path: &str, _branch: Option<&str>) -> Result<()> {
        Err(unsupported())
    }
    /// Removes a worktree; `force` removes it with uncommitted changes too.
    fn remove_worktree(&self, _path: &str, _force: bool) -> Result<()> {
        Err(unsupported())
    }
    /// Drops the records of worktrees whose folders are gone or no longer worktrees.
    fn prune_worktrees(&self) -> Result<()> {
        Err(unsupported())
    }
    fn remotes(&self) -> Result<Vec<Remote>> {
        Ok(Vec::new())
    }
    fn add_remote(&self, _name: &str, _url: &str) -> Result<()> {
        Err(unsupported())
    }
    fn remove_remote(&self, _name: &str) -> Result<()> {
        Err(unsupported())
    }
    /// Fetches one remote, or all with `None`.
    fn fetch(&self, remote: Option<&str>) -> Result<()> {
        match remote {
            None => self.remote(RemoteOp::Fetch, false),
            Some(_) => Err(unsupported()),
        }
    }
    /// Newest first.
    fn tags(&self) -> Result<Vec<Tag>> {
        Ok(Vec::new())
    }
    /// Tags HEAD; annotated when there is a message.
    fn create_tag(&self, _name: &str, _message: Option<&str>) -> Result<()> {
        Err(unsupported())
    }
    fn delete_tag(&self, _name: &str) -> Result<()> {
        Err(unsupported())
    }
    fn push_tag(&self, _name: &str, _remote: &str) -> Result<()> {
        Err(unsupported())
    }
    fn delete_remote_tag(&self, _name: &str, _remote: &str) -> Result<()> {
        Err(unsupported())
    }
    /// Detaches HEAD at the tag.
    fn checkout_tag(&self, _name: &str) -> Result<Checkout> {
        Err(unsupported())
    }
}

fn unsupported() -> anyhow::Error {
    anyhow!("Not available for this repository")
}

/// Finds the repository containing a folder (blocking); the panel calls it off the UI thread.
pub type Discover = Arc<dyn Fn(&Path) -> Option<Arc<dyn GitRepository>> + Send + Sync>;

/// How the web build finds repositories: through the workspace server.
#[cfg(target_family = "wasm")]
static WEB_DISCOVER: std::sync::OnceLock<Discover> = std::sync::OnceLock::new();

#[cfg(target_family = "wasm")]
pub fn set_discover(discover: Discover) {
    let _ = WEB_DISCOVER.set(discover);
}

#[cfg(target_family = "wasm")]
pub fn discover(path: &Path) -> Option<Arc<dyn GitRepository>> {
    WEB_DISCOVER.get()?(path)
}

#[cfg(target_family = "wasm")]
pub fn init(_: &Path, _: Option<String>) -> Result<()> {
    Err(anyhow!("Repositories are created on the workspace server"))
}

/// The repository that contains `path`, if any.
#[cfg(not(target_family = "wasm"))]
pub fn discover(path: &Path) -> Option<Arc<dyn GitRepository>> {
    let root = vc::git_discover_repo(path_string(path)).ok().flatten()?;
    Some(Arc::new(LocalRepository::new(PathBuf::from(root))))
}

/// `git init` for folders on another machine (SSH, WSL): `None` for a folder on this one.
#[cfg(not(target_family = "wasm"))]
pub type RemoteInit = Box<dyn Fn(&Path, Option<String>) -> Option<Result<()>> + Send + Sync>;

#[cfg(not(target_family = "wasm"))]
static REMOTE_INIT: std::sync::OnceLock<RemoteInit> = std::sync::OnceLock::new();

/// How Initialize Repository reaches folders on another machine; the workbench sets it.
#[cfg(not(target_family = "wasm"))]
pub fn set_remote_init(init: RemoteInit) {
    let _ = REMOTE_INIT.set(init);
}

#[cfg(not(target_family = "wasm"))]
/// `git init`, on `initial_branch` when one is named (`gitDefaultBranchName`).
pub fn init(path: &Path, initial_branch: Option<String>) -> Result<()> {
    let initial_branch = initial_branch.map(|branch| branch.trim().to_string()).filter(|branch| !branch.is_empty());
    if let Some(result) = REMOTE_INIT.get().and_then(|init| init(path, initial_branch.clone())) {
        return result;
    }
    vc::git_init(path_string(path), initial_branch).map_err(|error| anyhow!(error))
}

#[cfg(not(target_family = "wasm"))]
fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// A repository on this machine, through the old app's `version-control` crate.
#[cfg(not(target_family = "wasm"))]
pub struct LocalRepository {
    root: PathBuf,
    /// Operations that touch the index or the working tree run one at a time, so they never race
    /// for `index.lock`. Fetch and push skip it.
    lock: Mutex<()>,
}

#[cfg(not(target_family = "wasm"))]
impl LocalRepository {
    pub fn new(root: PathBuf) -> Self {
        Self { root, lock: Mutex::new(()) }
    }

    fn path(&self) -> String {
        path_string(&self.root)
    }

    fn locked<T>(&self, work: impl FnOnce(String) -> Result<T, String>) -> Result<T> {
        let _guard = self.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        work(self.path()).map_err(|error| anyhow!(error))
    }
}

#[cfg(not(target_family = "wasm"))]
fn file_status(status: vc::FileStatus) -> FileStatus {
    match status {
        vc::FileStatus::Modified => FileStatus::Modified,
        vc::FileStatus::Added => FileStatus::Added,
        vc::FileStatus::Deleted => FileStatus::Deleted,
        vc::FileStatus::Renamed => FileStatus::Renamed,
        vc::FileStatus::Untracked => FileStatus::Untracked,
    }
}

#[cfg(not(target_family = "wasm"))]
impl GitRepository for LocalRepository {
    fn root(&self) -> &Path {
        &self.root
    }

    fn status(&self) -> Result<WorkingTree> {
        let (status, stats) = self.locked(|path| {
            let status = vc::git_status(path.clone())?;
            // Stats are decoration; a repository without commits or an odd index still shows.
            let stats = vc::git_status_diff_stats(path).unwrap_or_default();
            Ok((status, stats))
        })?;
        let head = git2::Repository::open(&self.root)
            .ok()
            .and_then(|repo| repo.head().ok()?.target())
            .map(|oid| oid.to_string());
        Ok(WorkingTree {
            branch: status.branch,
            head,
            ahead: status.ahead.max(0) as usize,
            behind: status.behind.max(0) as usize,
            files: status
                .files
                .into_iter()
                .map(|file| StatusEntry { path: file.path, status: file_status(file.status), staged: file.staged })
                .collect(),
            stats: stats
                .into_iter()
                .map(|stat| DiffStat {
                    path: stat.file_path,
                    staged: stat.staged,
                    additions: stat.additions,
                    deletions: stat.deletions,
                })
                .collect(),
        })
    }

    fn branches(&self) -> Result<Vec<String>> {
        vc::git_branches(self.path()).map_err(|error| anyhow!(error))
    }

    fn log(&self, skip: usize, limit: usize) -> Result<Vec<Commit>> {
        // A repository without commits has no HEAD to walk; that is an empty history.
        let Ok(commits) = vc::git_log(self.path(), Some(limit as u32), Some(skip as u32)) else {
            return Ok(Vec::new());
        };
        Ok(commits
            .into_iter()
            .map(|commit| Commit {
                hash: commit.hash,
                summary: commit.message,
                author: commit.author,
                email: commit.email,
                date: commit.date,
                description: commit.description.filter(|description| !description.trim().is_empty()),
            })
            .collect())
    }

    fn commit_totals(&self, hash: &str) -> Result<CommitTotals> {
        let diffs = vc::git_commit_diff(self.path(), hash.to_string(), None).map_err(|error| anyhow!(error))?;
        let mut totals = CommitTotals { files: diffs.len(), ..Default::default() };
        for diff in &diffs {
            let count = |kind: vc::DiffLineType| diff.lines.iter().filter(|line| std::mem::discriminant(&line.line_type) == std::mem::discriminant(&kind)).count();
            totals.additions += diff.additions.unwrap_or_else(|| count(vc::DiffLineType::Added));
            totals.deletions += diff.deletions.unwrap_or_else(|| count(vc::DiffLineType::Removed));
        }
        Ok(totals)
    }

    fn stashes(&self) -> Result<Vec<Stash>> {
        let stashes = vc::git_get_stashes(self.path()).map_err(|error| anyhow!(error))?;
        Ok(stashes
            .into_iter()
            .map(|stash| Stash { index: stash.index, message: stash.message, date: stash.date })
            .collect())
    }

    fn set_staged(&self, paths: &[String], staged: bool) -> Result<()> {
        self.locked(|repo| {
            for path in paths {
                if staged {
                    vc::git_add(repo.clone(), path.clone())?;
                } else {
                    vc::git_reset(repo.clone(), path.clone())?;
                }
            }
            Ok(())
        })
    }

    fn discard(&self, paths: &[String]) -> Result<()> {
        self.locked(|repo| {
            for path in paths {
                vc::git_discard_file_changes(repo.clone(), path.clone())?;
            }
            Ok(())
        })
    }

    fn discard_all(&self) -> Result<()> {
        self.locked(vc::git_discard_all_changes)
    }

    fn commit(&self, message: &str) -> Result<()> {
        self.locked(|repo| vc::git_commit(repo, message.to_string(), false))
    }

    fn commit_signed(&self, message: &str, sign_off: bool) -> Result<()> {
        self.locked(|repo| vc::git_commit(repo, message.to_string(), sign_off))
    }

    fn checkout(&self, branch: &str) -> Result<Checkout> {
        let result = self.locked(|repo| vc::git_checkout(repo, branch.to_string()))?;
        Ok(if result.success { Checkout::Switched } else { Checkout::Blocked(result.message) })
    }

    fn create_branch(&self, name: &str, from: Option<&str>) -> Result<()> {
        self.locked(|repo| vc::git_create_branch(repo, name.to_string(), from.map(str::to_string)))
    }

    fn delete_branch(&self, name: &str) -> Result<()> {
        self.locked(|repo| vc::git_delete_branch(repo, name.to_string()))
    }

    fn stash(&self, message: Option<&str>, paths: Option<Vec<String>>) -> Result<()> {
        self.locked(|repo| vc::git_create_stash(repo, message.map(str::to_string), true, paths))
    }

    fn stash_action(&self, action: StashAction, index: usize) -> Result<()> {
        self.locked(|repo| match action {
            StashAction::Apply => vc::git_apply_stash(repo, index),
            StashAction::Pop => vc::git_pop_stash(repo, Some(index)),
            StashAction::Drop => vc::git_drop_stash(repo, index),
        })
    }

    fn remote(&self, op: RemoteOp, pull_rebase: bool) -> Result<()> {
        let remote = "origin".to_string();
        let result = match op {
            RemoteOp::Fetch => vc::git_fetch(self.path(), None),
            RemoteOp::Push => vc::git_push(self.path(), None, remote),
            RemoteOp::Pull => {
                let _guard = self.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                vc::git_pull(self.path(), None, remote, pull_rebase)
            }
        };
        result.map_err(|error| anyhow!(error))
    }

    fn worktrees(&self) -> Result<Vec<Worktree>> {
        let worktrees = vc::git_get_worktrees(self.path()).map_err(|error| anyhow!(error))?;
        Ok(worktrees
            .into_iter()
            .map(|worktree| Worktree {
                path: worktree.path,
                branch: worktree.branch,
                is_current: worktree.is_current,
                is_bare: worktree.is_bare,
                is_detached: worktree.is_detached,
                locked: worktree.locked_reason.is_some(),
                prunable: worktree.prunable_reason.is_some(),
            })
            .collect())
    }

    fn add_worktree(&self, path: &str, branch: Option<&str>) -> Result<()> {
        self.locked(|repo| vc::git_add_worktree(repo, path.to_string(), branch.map(str::to_string), branch.is_some()))
    }

    fn remove_worktree(&self, path: &str, force: bool) -> Result<()> {
        self.locked(|repo| vc::git_remove_worktree(repo, path.to_string(), force))
    }

    fn prune_worktrees(&self) -> Result<()> {
        self.locked(vc::git_prune_worktrees)
    }

    fn remotes(&self) -> Result<Vec<Remote>> {
        let remotes = vc::git_get_remotes(self.path()).map_err(|error| anyhow!(error))?;
        Ok(remotes.into_iter().map(|remote| Remote { name: remote.name, url: remote.url }).collect())
    }

    fn add_remote(&self, name: &str, url: &str) -> Result<()> {
        vc::git_add_remote(self.path(), name.to_string(), url.to_string()).map_err(|error| anyhow!(error))
    }

    fn remove_remote(&self, name: &str) -> Result<()> {
        vc::git_remove_remote(self.path(), name.to_string()).map_err(|error| anyhow!(error))
    }

    fn fetch(&self, remote: Option<&str>) -> Result<()> {
        vc::git_fetch(self.path(), remote.map(str::to_string)).map_err(|error| anyhow!(error))
    }

    fn tags(&self) -> Result<Vec<Tag>> {
        let tags = vc::git_get_tags(self.path()).map_err(|error| anyhow!(error))?;
        Ok(tags
            .into_iter()
            .map(|tag| Tag { name: tag.name, commit: tag.commit, message: tag.message.map(|message| message.trim().to_string()), date: tag.date })
            .collect())
    }

    fn create_tag(&self, name: &str, message: Option<&str>) -> Result<()> {
        vc::git_create_tag(self.path(), name.to_string(), message.map(str::to_string), None, false).map_err(|error| anyhow!(error))
    }

    fn delete_tag(&self, name: &str) -> Result<()> {
        vc::git_delete_tag(self.path(), name.to_string()).map_err(|error| anyhow!(error))
    }

    fn push_tag(&self, name: &str, remote: &str) -> Result<()> {
        vc::git_push_tag(self.path(), name.to_string(), remote.to_string()).map_err(|error| anyhow!(error))
    }

    fn delete_remote_tag(&self, name: &str, remote: &str) -> Result<()> {
        vc::git_delete_remote_tag(self.path(), name.to_string(), remote.to_string()).map_err(|error| anyhow!(error))
    }

    fn checkout_tag(&self, name: &str) -> Result<Checkout> {
        let result = self.locked(|repo| vc::git_checkout_tag(repo, name.to_string()))?;
        Ok(if result.success { Checkout::Switched } else { Checkout::Blocked(result.message) })
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command};

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git").args(args).current_dir(dir).status().expect("git runs");
        assert!(status.success(), "git {args:?} failed");
    }

    /// A throwaway repository with one commit, so mutations never touch a real one.
    fn scratch_repo() -> (tempfile::TempDir, Arc<dyn GitRepository>) {
        let dir = tempfile::tempdir().expect("tempdir");
        git(dir.path(), &["init", "-q", "-b", "main"]);
        git(dir.path(), &["config", "user.name", "Test"]);
        git(dir.path(), &["config", "user.email", "test@example.com"]);
        git(dir.path(), &["config", "commit.gpgsign", "false"]);
        fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        git(dir.path(), &["add", "a.txt"]);
        git(dir.path(), &["commit", "-q", "-m", "First"]);
        let repo = discover(dir.path()).expect("discovers the repository");
        (dir, repo)
    }

    #[test]
    fn discovers_nothing_outside_a_repository() {
        let dir = tempfile::tempdir().unwrap();
        assert!(discover(dir.path()).is_none());
        init(dir.path(), Some(" trunk ".into())).unwrap();
        assert!(discover(dir.path()).is_some());
        assert_eq!(fs::read_to_string(dir.path().join(".git/HEAD")).unwrap().trim(), "ref: refs/heads/trunk");
    }

    #[test]
    fn checks_out_and_deletes_tags_remotely() {
        let (dir, repo) = scratch_repo();
        repo.create_tag("v1", None).unwrap();
        fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        repo.set_staged(&["a.txt".into()], true).unwrap();
        repo.commit("Second").unwrap();
        assert_eq!(repo.checkout_tag("v1").unwrap(), Checkout::Switched);
        assert_eq!(fs::read_to_string(dir.path().join("a.txt")).unwrap(), "one\n");

        let bare = tempfile::tempdir().unwrap();
        git(bare.path(), &["init", "-q", "--bare"]);
        repo.add_remote("origin", &bare.path().to_string_lossy()).unwrap();
        repo.push_tag("v1", "origin").unwrap();
        let listed = |dir: &Path| String::from_utf8_lossy(&Command::new("git").args(["tag"]).current_dir(dir).output().unwrap().stdout).trim().to_string();
        assert_eq!(listed(bare.path()), "v1");
        repo.delete_remote_tag("v1", "origin").unwrap();
        assert_eq!(listed(bare.path()), "");
    }

    #[test]
    fn signs_off_commits_on_request() {
        let (dir, repo) = scratch_repo();
        fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        repo.set_staged(&["a.txt".into()], true).unwrap();
        repo.commit_signed("Signed", true).unwrap();
        let output = std::process::Command::new("git").args(["log", "-1", "--format=%B"]).current_dir(dir.path()).output().unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).contains("Signed-off-by:"));
    }

    #[test]
    fn stages_commits_and_discards() {
        let (dir, repo) = scratch_repo();
        fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
        fs::write(dir.path().join("b.txt"), "new\n").unwrap();

        let tree = repo.status().unwrap();
        assert_eq!(tree.branch, "main");
        assert!(tree.files.contains(&StatusEntry { path: "a.txt".into(), status: FileStatus::Modified, staged: false }));
        assert!(tree.files.contains(&StatusEntry { path: "b.txt".into(), status: FileStatus::Untracked, staged: false }));
        assert!(tree.stats.iter().any(|stat| stat.path == "a.txt" && stat.additions == 1));

        repo.set_staged(&["b.txt".into()], true).unwrap();
        let tree = repo.status().unwrap();
        assert!(tree.files.contains(&StatusEntry { path: "b.txt".into(), status: FileStatus::Added, staged: true }));

        let head_before = tree.head.clone();
        repo.commit("Add b").unwrap();
        let tree = repo.status().unwrap();
        assert_ne!(tree.head, head_before);
        assert_eq!(repo.log(0, 10).unwrap()[0].summary, "Add b");

        repo.discard(&["a.txt".into()]).unwrap();
        assert!(repo.status().unwrap().files.is_empty());
        assert_eq!(fs::read_to_string(dir.path().join("a.txt")).unwrap(), "one\n");
    }

    #[test]
    fn branches_and_stashes() {
        let (dir, repo) = scratch_repo();
        repo.create_branch("feature", None).unwrap();
        assert_eq!(repo.status().unwrap().branch, "feature");
        let mut branches = repo.branches().unwrap();
        branches.sort();
        assert_eq!(branches, vec!["feature".to_string(), "main".to_string()]);

        fs::write(dir.path().join("a.txt"), "changed\n").unwrap();
        assert!(matches!(repo.checkout("main").unwrap(), Checkout::Blocked(_)));

        repo.stash(Some("wip"), None).unwrap();
        let stashes = repo.stashes().unwrap();
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].message, "wip");
        assert_eq!(repo.checkout("main").unwrap(), Checkout::Switched);
        repo.stash_action(StashAction::Pop, 0).unwrap();
        assert!(repo.stashes().unwrap().is_empty());
        assert_eq!(fs::read_to_string(dir.path().join("a.txt")).unwrap(), "changed\n");

        repo.delete_branch("feature").unwrap();
        assert_eq!(repo.branches().unwrap(), vec!["main".to_string()]);
    }

    #[test]
    fn worktrees_remotes_and_tags() {
        let (dir, repo) = scratch_repo();
        let worktrees = repo.worktrees().unwrap();
        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].is_current);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));

        let other = tempfile::tempdir().unwrap();
        let path = other.path().join("linked");
        repo.add_worktree(&path.to_string_lossy(), Some("linked")).unwrap();
        let worktrees = repo.worktrees().unwrap();
        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[1].branch.as_deref(), Some("linked"));
        assert!(!worktrees[1].is_current);
        repo.remove_worktree(&worktrees[1].path, false).unwrap();
        assert_eq!(repo.worktrees().unwrap().len(), 1);

        assert!(repo.remotes().unwrap().is_empty());
        repo.add_remote("origin", "https://example.com/repo.git").unwrap();
        assert_eq!(repo.remotes().unwrap(), vec![Remote { name: "origin".into(), url: "https://example.com/repo.git".into() }]);
        repo.remove_remote("origin").unwrap();
        assert!(repo.remotes().unwrap().is_empty());

        repo.create_tag("v1.0.0", Some("First release")).unwrap();
        repo.create_tag("light", None).unwrap();
        let mut tags = repo.tags().unwrap();
        tags.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[1].message.as_deref(), Some("First release"));
        assert_eq!(tags[0].message, None);
        repo.delete_tag("light").unwrap();
        assert_eq!(repo.tags().unwrap().len(), 1);
        drop(dir);
    }
}
