//! The server's repository for the git panel. The server runs the git command line in the
//! workspace folder, so the repository's root is the workspace's.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Result;
use git_panel::{
    Checkout, Commit, DiffStat, Discover, FileStatus, GitRepository, RemoteOp, Stash, StashAction, StatusEntry, WorkingTree,
};
use serde_json::{Value, json};
use web_protocol::git::{self as protocol, BranchList, CommitEntry, StashEntry};

use crate::{Transport, failed};

pub struct RemoteGit {
    root: PathBuf,
    transport: Arc<dyn Transport>,
}

/// The git panel's discovery: the workspace's repository for paths inside it, when it is one.
pub fn discover(root: PathBuf, transport: Arc<dyn Transport>) -> Discover {
    Arc::new(move |path: &Path| {
        if !path.starts_with(&root) || transport.call("git.status", json!({})).is_err() {
            return None;
        }
        Some(Arc::new(RemoteGit { root: root.clone(), transport: transport.clone() }) as Arc<dyn GitRepository>)
    })
}

impl RemoteGit {
    pub fn new(root: PathBuf, transport: Arc<dyn Transport>) -> Self {
        Self { root, transport }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.transport.call(method, params).map_err(failed)
    }

    fn get<T: serde::de::DeserializeOwned>(&self, method: &str, params: Value) -> Result<T> {
        Ok(serde_json::from_value(self.call(method, params)?)?)
    }

    fn run(&self, method: &str, params: Value) -> Result<()> {
        self.call(method, params).map(|_| ())
    }
}

fn file_status(status: protocol::FileStatus) -> FileStatus {
    match status {
        protocol::FileStatus::Modified => FileStatus::Modified,
        protocol::FileStatus::Added => FileStatus::Added,
        protocol::FileStatus::Deleted => FileStatus::Deleted,
        protocol::FileStatus::Renamed => FileStatus::Renamed,
        protocol::FileStatus::Untracked => FileStatus::Untracked,
    }
}

impl GitRepository for RemoteGit {
    fn root(&self) -> &Path {
        &self.root
    }

    fn status(&self) -> Result<WorkingTree> {
        let status: protocol::Status = self.get("git.status", json!({}))?;
        let stats: Vec<protocol::DiffStat> = serde_json::from_value(self.call("git.diffStats", json!({}))?["stats"].take())?;
        Ok(WorkingTree {
            branch: status.branch,
            head: status.head,
            ahead: status.ahead as usize,
            behind: status.behind as usize,
            files: status
                .files
                .into_iter()
                .map(|file| StatusEntry { path: file.path, status: file_status(file.status), staged: file.staged })
                .collect(),
            stats: stats
                .into_iter()
                .map(|stat| DiffStat { path: stat.path, staged: stat.staged, additions: stat.additions, deletions: stat.deletions })
                .collect(),
        })
    }

    fn branches(&self) -> Result<Vec<String>> {
        Ok(self.get::<BranchList>("git.branches", json!({}))?.local)
    }

    fn log(&self, skip: usize, limit: usize) -> Result<Vec<Commit>> {
        let commits: Vec<CommitEntry> = serde_json::from_value(self.call("git.log", json!({ "skip": skip, "limit": limit.clamp(1, 1000) }))?["commits"].take())?;
        Ok(commits
            .into_iter()
            .map(|commit| Commit { date: commit.date.chars().take(10).collect(), hash: commit.hash, summary: commit.message, author: commit.author, email: commit.email, description: None })
            .collect())
    }

    fn stashes(&self) -> Result<Vec<Stash>> {
        let stashes: Vec<StashEntry> = serde_json::from_value(self.call("git.stashes", json!({}))?["stashes"].take())?;
        Ok(stashes.into_iter().map(|stash| Stash { index: stash.index, message: stash.message, date: stash.date }).collect())
    }

    fn set_staged(&self, paths: &[String], staged: bool) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        self.run(if staged { "git.add" } else { "git.reset" }, json!({ "paths": paths }))
    }

    fn discard(&self, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        self.run("git.discard", json!({ "paths": paths }))
    }

    fn discard_all(&self) -> Result<()> {
        self.run("git.discard", json!({ "all": true }))
    }

    fn commit(&self, message: &str) -> Result<()> {
        self.commit_signed(message, false)
    }

    fn commit_signed(&self, message: &str, sign_off: bool) -> Result<()> {
        self.run("git.commit", json!({ "message": message, "signOff": sign_off }))
    }

    fn checkout(&self, branch: &str) -> Result<Checkout> {
        match self.transport.call("git.checkout", json!({ "branch": branch })) {
            Ok(_) => Ok(Checkout::Switched),
            Err(error) if error.code == "git_failed" => Ok(Checkout::Blocked(error.message)),
            Err(error) => Err(failed(error)),
        }
    }

    fn create_branch(&self, name: &str, from: Option<&str>) -> Result<()> {
        self.run("git.checkout", json!({ "branch": name, "create": true, "from": from }))
    }

    fn delete_branch(&self, name: &str) -> Result<()> {
        self.run("git.deleteBranch", json!({ "branch": name }))
    }

    fn stash(&self, message: Option<&str>, paths: Option<Vec<String>>) -> Result<()> {
        self.run("git.stash", json!({ "message": message, "paths": paths.filter(|paths| !paths.is_empty()) }))
    }

    fn stash_action(&self, action: StashAction, index: usize) -> Result<()> {
        let action = match action {
            StashAction::Apply => "apply",
            StashAction::Pop => "pop",
            StashAction::Drop => "drop",
        };
        self.run("git.stashAction", json!({ "action": action, "index": index }))
    }

    fn remote(&self, op: RemoteOp, pull_rebase: bool) -> Result<()> {
        match op {
            RemoteOp::Fetch => self.run("git.fetch", json!({})),
            RemoteOp::Pull => self.run("git.pull", json!({ "rebase": pull_rebase })),
            RemoteOp::Push => self.run("git.push", json!({})),
        }
    }
}
