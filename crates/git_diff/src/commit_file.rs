//! A file as it was at a commit, opened read-only in the editor (`openCommitFileBuffer`).

use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

use anyhow::{Result, anyhow};
use editor::{FileBackend, Loaded};

use crate::{git, target::short_hash};

/// Reads one file at one commit and refuses to save it.
pub struct CommitFile {
    pub repo: PathBuf,
    pub commit: String,
    pub path: String,
}

impl FileBackend for CommitFile {
    fn load(&self, _: &Path) -> Result<Loaded> {
        match git::file_at_commit(&self.repo, &self.commit, &self.path) {
            Ok(text) => Ok(Loaded::Text { text, modified: None }),
            Err(error) if error.to_string().contains("not valid UTF-8") => Ok(Loaded::Binary),
            Err(error) => Err(error),
        }
    }

    fn save(&self, _: &Path, _: &str) -> Result<Option<SystemTime>> {
        Err(anyhow!("{} at {} is read-only.", self.path, short_hash(&self.commit)))
    }

    fn modified(&self, _: &Path) -> Option<SystemTime> {
        None
    }
}

/// The tab title: `name (abc1234)`.
pub fn title(commit: &str, path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    format!("{name} ({})", short_hash(commit))
}
