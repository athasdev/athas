//! Who last changed each line of a file (`git blame`), for the Blame view and, later, the
//! editor's inline blame.
//!
//! [`blame_lines`] blames the file as it is on disk; [`blame_buffer`] blames text that may differ
//! from the disk, such as an editor's unsaved buffer. Both return one [`BlameLine`] per line of
//! that text, in order. Lines changed since the last commit have no commit. Both block, so call
//! them off the UI thread, e.g.
//!
//! ```ignore
//! let task = cx.background_spawn(async move { git_diff::blame_lines(&repo_root, Path::new("src/main.rs")) });
//! ```

#[cfg(not(target_family = "wasm"))]
use std::{collections::HashMap, path::PathBuf};
use std::{path::Path, sync::Arc};

#[cfg(not(target_family = "wasm"))]
use anyhow::Context as _;
use anyhow::Result;
#[cfg(not(target_family = "wasm"))]
use git2::{BlameOptions, Oid, Repository};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlameCommit {
    pub hash: String,
    pub author: String,
    pub email: String,
    /// Seconds since the epoch.
    pub time: i64,
    /// The first line of the message.
    pub summary: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlameLine {
    /// 1-based.
    pub line: u32,
    /// `None` for a line not committed yet.
    pub commit: Option<Arc<BlameCommit>>,
    /// Whether this line starts a run of lines from the same commit.
    pub starts_hunk: bool,
}

/// `path` relative to the repository's working tree, with `/` separators.
#[cfg(not(target_family = "wasm"))]
fn relative(repo: &Repository, path: &Path) -> Result<PathBuf> {
    if path.is_relative() {
        return Ok(path.to_path_buf());
    }
    let workdir = repo.workdir().context("the repository has no working tree")?;
    let workdir = workdir.canonicalize().unwrap_or_else(|_| workdir.to_path_buf());
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(path.strip_prefix(&workdir).context("the file is outside the repository")?.to_path_buf())
}

/// Blames the file at `path` (relative to `repo_root`, or absolute) as it is on disk.
#[cfg(not(target_family = "wasm"))]
pub fn blame_lines(repo_root: &Path, path: &Path) -> Result<Vec<BlameLine>> {
    let repo = Repository::open(repo_root)?;
    let relative = relative(&repo, path)?;
    let content = std::fs::read(repo_root.join(&relative)).with_context(|| format!("reading {}", relative.display()))?;
    blame(&repo, &relative, &content)
}

/// The web build blames on the workspace server.
#[cfg(target_family = "wasm")]
pub fn blame_lines(repo_root: &Path, path: &Path) -> Result<Vec<BlameLine>> {
    remote_blame(repo_root, path, None)
}

#[cfg(target_family = "wasm")]
pub fn blame_buffer(repo_root: &Path, path: &Path, content: &str) -> Result<Vec<BlameLine>> {
    remote_blame(repo_root, path, Some(content))
}

#[cfg(target_family = "wasm")]
fn remote_blame(repo_root: &Path, path: &Path, content: Option<&str>) -> Result<Vec<BlameLine>> {
    let remote = crate::remote::remote().filter(|remote| remote.root() == repo_root).ok_or_else(|| anyhow::anyhow!("{} is not the workspace's repository", repo_root.display()))?;
    let relative = path.strip_prefix(repo_root).unwrap_or(path).to_string_lossy().replace('\\', "/");
    remote.blame(&relative, content)
}

/// Blames `content` as the current text of `path`.
#[cfg(not(target_family = "wasm"))]
pub fn blame_buffer(repo_root: &Path, path: &Path, content: &str) -> Result<Vec<BlameLine>> {
    let repo = Repository::open(repo_root)?;
    let relative = relative(&repo, path)?;
    blame(&repo, &relative, content.as_bytes())
}

#[cfg(not(target_family = "wasm"))]
fn line_count(content: &[u8]) -> u32 {
    let breaks = content.iter().filter(|byte| **byte == b'\n').count();
    (breaks + usize::from(!content.is_empty() && !content.ends_with(b"\n"))) as u32
}

#[cfg(not(target_family = "wasm"))]
fn blame(repo: &Repository, path: &Path, content: &[u8]) -> Result<Vec<BlameLine>> {
    let total = line_count(content);
    let mut out: Vec<BlameLine> = (1..=total).map(|line| BlameLine { line, commit: None, starts_hunk: false }).collect();
    // A file never committed (or a repository without commits) is all new lines.
    let committed = match repo.blame_file(path, Some(BlameOptions::new().use_mailmap(true))) {
        Ok(committed) => committed,
        Err(_) if repo.head().ok().and_then(|head| head.peel_to_tree().ok()?.get_path(path).ok()).is_none() => {
            if let Some(first) = out.first_mut() {
                first.starts_hunk = true;
            }
            return Ok(out);
        }
        Err(error) => return Err(error).context("blaming the file"),
    };
    let blame = committed.blame_buffer(content).context("blaming the current text")?;
    let mut commits: HashMap<Oid, Option<Arc<BlameCommit>>> = HashMap::new();
    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let commit = if oid.is_zero() {
            None
        } else {
            commits
                .entry(oid)
                .or_insert_with(|| {
                    let commit = repo.find_commit(oid).ok()?;
                    let author = commit.author();
                    Some(Arc::new(BlameCommit {
                        hash: oid.to_string(),
                        author: String::from_utf8_lossy(author.name_bytes()).into_owned(),
                        email: String::from_utf8_lossy(author.email_bytes()).into_owned(),
                        time: author.when().seconds(),
                        summary: commit.summary().unwrap_or_default().to_string(),
                    }))
                })
                .clone()
        };
        let start = hunk.final_start_line();
        for line in start..start + hunk.lines_in_hunk() {
            if let Some(entry) = out.get_mut(line.wrapping_sub(1)) {
                entry.commit = commit.clone();
                entry.starts_hunk = line == start;
            }
        }
    }
    // Neighbouring hunks of the same commit read as one.
    for index in 1..out.len() {
        let same = out[index].commit.as_ref().map(|commit| &commit.hash) == out[index - 1].commit.as_ref().map(|commit| &commit.hash);
        if same {
            out[index].starts_hunk = false;
        }
    }
    if let Some(first) = out.first_mut() {
        first.starts_hunk = true;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::git::tests::{commit_all, scratch};

    #[test]
    fn blames_committed_and_new_lines() {
        let (dir, repo) = scratch();
        fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
        let first = commit_all(&repo, "First commit");
        fs::write(dir.path().join("a.txt"), "one\ntwo\nthree\n").unwrap();
        let second = commit_all(&repo, "Second commit");
        fs::write(dir.path().join("a.txt"), "one\nTWO\nthree\nfour").unwrap();

        let lines = blame_lines(dir.path(), Path::new("a.txt")).unwrap();
        let hashes: Vec<Option<String>> = lines.iter().map(|line| line.commit.as_ref().map(|commit| commit.hash.clone())).collect();
        assert_eq!(hashes, [Some(first.to_string()), None, Some(second.to_string()), None]);
        assert_eq!(lines[0].commit.as_ref().unwrap().summary, "First commit");
        assert_eq!(lines[0].commit.as_ref().unwrap().author, "Ada");
        assert_eq!(lines.iter().map(|line| line.starts_hunk).collect::<Vec<_>>(), [true, true, true, true]);

        let absolute = dir.path().join("a.txt");
        assert_eq!(blame_lines(dir.path(), &absolute).unwrap().len(), 4);

        let buffer = blame_buffer(dir.path(), Path::new("a.txt"), "zero\none\ntwo\nthree\n").unwrap();
        let committed: Vec<bool> = buffer.iter().map(|line| line.commit.is_some()).collect();
        assert_eq!(committed, [false, true, true, true]);
        assert!(!buffer[2].starts_hunk, "lines of one commit in a row share a hunk");
    }

    #[test]
    fn untracked_files_are_all_new() {
        let (dir, repo) = scratch();
        fs::write(dir.path().join("a.txt"), "a\n").unwrap();
        commit_all(&repo, "First");
        fs::write(dir.path().join("b.txt"), "x\ny\n").unwrap();
        let lines = blame_lines(dir.path(), Path::new("b.txt")).unwrap();
        assert_eq!(lines.len(), 2);
        assert!(lines.iter().all(|line| line.commit.is_none()));
    }
}
