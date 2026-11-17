//! The diff, commit and blame views' repository: the server's, read with the git command line
//! there and parsed here.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Result;
use git_diff::{
    BlameLine, DiffTarget,
    git::{ChangedFile, CommitDetails, HunkAction, Person},
    model::{FileDiff, FileStatus, Hunk, hunk_patch},
    remote::{RemoteRepository, parse_blame, parse_patch},
};
use serde_json::{Value, json};

use crate::{Transport, failed};

pub struct RemoteDiffs {
    root: PathBuf,
    transport: Arc<dyn Transport>,
}

impl RemoteDiffs {
    pub fn new(root: PathBuf, transport: Arc<dyn Transport>) -> Self {
        Self { root, transport }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.transport.call(method, params).map_err(failed)
    }

    fn whole_file(&self, file: &FileDiff, action: HunkAction) -> Result<()> {
        let method = match action {
            HunkAction::Stage => "git.add",
            HunkAction::Unstage => "git.reset",
            HunkAction::Discard if file.status == FileStatus::Added => anyhow::bail!("An untracked file has no committed version to go back to"),
            HunkAction::Discard => "git.discard",
        };
        self.call(method, json!({ "paths": [file.path] })).map(drop)
    }
}

fn person(value: &Value) -> Person {
    Person {
        name: value["name"].as_str().unwrap_or_default().to_string(),
        email: value["email"].as_str().unwrap_or_default().to_string(),
        time: value["time"].as_i64().unwrap_or(0),
        offset_minutes: value["offsetMinutes"].as_i64().unwrap_or(0) as i32,
    }
}

impl RemoteRepository for RemoteDiffs {
    fn root(&self) -> &Path {
        &self.root
    }

    fn load(&self, target: &DiffTarget) -> Result<Vec<FileDiff>> {
        let answer = self.call("git.patch", json!({ "target": target.format() }))?;
        Ok(parse_patch(answer["patch"].as_str().unwrap_or_default()))
    }

    fn apply_hunk(&self, file: &FileDiff, hunk: &Hunk, action: HunkAction) -> Result<()> {
        if file.status != FileStatus::Modified {
            return self.whole_file(file, action);
        }
        let reverse = action != HunkAction::Stage;
        let patch = hunk_patch(&file.path, hunk, reverse);
        self.call("git.apply", json!({ "patch": patch, "cached": action != HunkAction::Discard }))
            .map(drop)
            .map_err(|error| anyhow::anyhow!("Failed to {} hunk: {error}", action.label()))
    }

    fn set_file_staged(&self, file: &FileDiff, staged: bool) -> Result<()> {
        self.whole_file(file, if staged { HunkAction::Stage } else { HunkAction::Unstage })
    }

    fn commit_details(&self, rev: &str) -> Result<CommitDetails> {
        let info = self.call("git.commitInfo", json!({ "rev": rev }))?;
        let message = info["message"].as_str().unwrap_or_default();
        let (summary, body) = match message.split_once('\n') {
            Some((summary, body)) => (summary.trim().to_string(), body.trim().to_string()),
            None => (message.trim().to_string(), String::new()),
        };
        let files = info["files"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|file| ChangedFile {
                path: file["path"].as_str().unwrap_or_default().to_string(),
                old_path: file["oldPath"].as_str().map(str::to_string),
                status: match file["status"].as_str() {
                    Some("added") => FileStatus::Added,
                    Some("deleted") => FileStatus::Deleted,
                    Some("renamed") => FileStatus::Renamed,
                    _ => FileStatus::Modified,
                },
                additions: file["additions"].as_u64().unwrap_or(0) as usize,
                deletions: file["deletions"].as_u64().unwrap_or(0) as usize,
                binary: file["binary"].as_bool().unwrap_or(false),
            })
            .collect();
        Ok(CommitDetails {
            hash: info["hash"].as_str().unwrap_or_default().to_string(),
            summary,
            body,
            author: person(&info["author"]),
            committer: person(&info["committer"]),
            parents: info["parents"].as_array().into_iter().flatten().filter_map(|parent| parent.as_str().map(str::to_string)).collect(),
            files,
        })
    }

    fn blame(&self, path: &str, content: Option<&str>) -> Result<Vec<BlameLine>> {
        let answer = self.call("git.blame", json!({ "path": path, "content": content }))?;
        Ok(parse_blame(answer["porcelain"].as_str().unwrap_or_default()))
    }

    fn file_at_commit(&self, commit: &str, path: &str) -> Result<String> {
        let answer = self.call("git.show", json!({ "path": path, "rev": commit }))?;
        let bytes = web_protocol::from_base64(&answer["content"]).map_err(failed)?;
        String::from_utf8(bytes).map_err(|_| anyhow::anyhow!("File is not valid UTF-8 at {commit}: {path}"))
    }
}
