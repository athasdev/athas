//! Git over the protocol: the server runs the git command line and answers with these shapes,
//! parsed from the same machine-readable output the cloud workspace parses.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusFile {
    pub path: String,
    pub status: FileStatus,
    pub staged: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub branch: String,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<StatusFile>,
}

fn status_of(code: char) -> FileStatus {
    match code {
        'A' => FileStatus::Added,
        'D' => FileStatus::Deleted,
        'R' | 'C' => FileStatus::Renamed,
        _ => FileStatus::Modified,
    }
}

/// Parses `git status --porcelain=v2 --branch -z`.
pub fn parse_status(output: &str) -> Status {
    let mut result = Status::default();
    let mut fields = output.split('\0');
    while let Some(field) = fields.next() {
        if field.is_empty() {
            continue;
        }
        if let Some(header) = field.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.head" => result.branch = if value == "(detached)" { "HEAD".into() } else { value.into() },
                "branch.oid" => result.head = (value != "(initial)").then(|| value.to_string()),
                "branch.upstream" => result.upstream = Some(value.into()),
                "branch.ab" => {
                    let mut counts = value.split(' ');
                    let ahead = counts.next().and_then(|count| count.strip_prefix('+')?.parse().ok());
                    let behind = counts.next().and_then(|count| count.strip_prefix('-')?.parse().ok());
                    if let (Some(ahead), Some(behind)) = (ahead, behind) {
                        result.ahead = ahead;
                        result.behind = behind;
                    }
                }
                _ => {}
            }
            continue;
        }
        let kind = field.chars().next().unwrap_or(' ');
        if kind == '?' {
            result.files.push(StatusFile { path: field[2..].into(), status: FileStatus::Untracked, staged: false, old_path: None });
            continue;
        }
        if !matches!(kind, '1' | '2' | 'u') {
            continue;
        }
        // "1 XY sub mH mI mW hH hI path", "2 ... Xscore path" then the old path as the next field,
        // "u XY sub m1 m2 m3 mW h1 h2 h3 path".
        let path_index = match kind {
            '1' => 8,
            '2' => 9,
            _ => 10,
        };
        let parts: Vec<&str> = field.splitn(path_index + 1, ' ').collect();
        let Some(path) = parts.get(path_index) else { continue };
        let xy: Vec<char> = parts.get(1).map(|xy| xy.chars().collect()).unwrap_or_default();
        let old_path = if kind == '2' { fields.next().map(str::to_string) } else { None };
        let (index, worktree) = if kind == 'u' { ('U', 'U') } else { (xy.first().copied().unwrap_or('.'), xy.get(1).copied().unwrap_or('.')) };
        if index != '.' {
            result.files.push(StatusFile { path: path.to_string(), status: status_of(index), staged: true, old_path: old_path.clone() });
        }
        if worktree != '.' {
            result.files.push(StatusFile { path: path.to_string(), status: status_of(worktree), staged: false, old_path: None });
        }
    }
    result
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitEntry {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub message: String,
    pub description: Option<String>,
}

/// The `git log --format` that [`parse_log`] reads: fields split by 0x1f, records by 0x1e.
pub const LOG_FORMAT: &str = "%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e";

pub fn parse_log(output: &str) -> Vec<CommitEntry> {
    output
        .split('\x1e')
        .map(|record| record.strip_prefix('\n').unwrap_or(record))
        .filter(|record| !record.is_empty())
        .map(|record| {
            let mut fields = record.split('\x1f');
            let mut next = || fields.next().unwrap_or_default().to_string();
            let (hash, author, email, date, message, body) = (next(), next(), next(), next(), next(), next());
            let body = body.trim();
            CommitEntry { hash, author, email, date, message, description: (!body.is_empty()).then(|| body.to_string()) }
        })
        .collect()
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchList {
    pub current: Option<String>,
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

/// The `git for-each-ref` format that [`parse_branches`] reads.
pub const BRANCH_FORMAT: &str = "%(refname)%1f%(HEAD)%1f%(symref)";

/// Parses `git for-each-ref --format=<BRANCH_FORMAT> refs/heads refs/remotes`. Symbolic refs
/// such as origin/HEAD are left out.
pub fn parse_branches(output: &str) -> BranchList {
    let mut result = BranchList::default();
    for line in output.lines() {
        let mut fields = line.split('\x1f');
        let (reference, head, symref) = (fields.next().unwrap_or_default(), fields.next().unwrap_or_default(), fields.next().unwrap_or_default());
        if reference.is_empty() || !symref.is_empty() {
            continue;
        }
        if let Some(name) = reference.strip_prefix("refs/heads/") {
            result.local.push(name.into());
            if head == "*" {
                result.current = Some(name.into());
            }
        } else if let Some(name) = reference.strip_prefix("refs/remotes/") {
            result.remote.push(name.into());
        }
    }
    result
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffStat {
    pub path: String,
    pub staged: bool,
    pub additions: usize,
    pub deletions: usize,
}

/// Parses `git diff --numstat -z`; binary files count no lines.
pub fn parse_numstat(output: &str, staged: bool) -> Vec<DiffStat> {
    let mut stats = Vec::new();
    let mut fields = output.split('\0');
    while let Some(field) = fields.next() {
        let mut parts = field.splitn(3, '\t');
        let (Some(additions), Some(deletions), Some(path)) = (parts.next(), parts.next(), parts.next()) else { continue };
        // A rename leaves the path empty and names both sides in the next two fields.
        let path = if path.is_empty() {
            fields.next();
            fields.next().unwrap_or_default().to_string()
        } else {
            path.to_string()
        };
        stats.push(DiffStat { path, staged, additions: additions.parse().unwrap_or(0), deletions: deletions.parse().unwrap_or(0) });
    }
    stats
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub date: String,
}

/// The `git stash list --format` that [`parse_stashes`] reads.
pub const STASH_FORMAT: &str = "%gd%x1f%gs%x1f%cI";

pub fn parse_stashes(output: &str) -> Vec<StashEntry> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\x1f');
            let index = fields.next()?.strip_prefix("stash@{")?.strip_suffix('}')?.parse().ok()?;
            let message = fields.next().unwrap_or_default().to_string();
            let date = fields.next().unwrap_or_default().to_string();
            Some(StashEntry { index, message, date })
        })
        .collect()
}

/// Whether `name` is a branch name git and the protocol accept.
pub fn is_branch_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with('/')
        && !name.starts_with('-')
        && !name.ends_with('/')
        && !name.ends_with(".lock")
        && !name.contains("..")
        && !name.contains("//")
        && !name.contains("@{")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2_status() {
        let output = [
            "# branch.oid 1234abcd",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 M. N... 100644 100644 100644 aaa bbb src/lib.rs",
            "1 .M N... 100644 100644 100644 aaa bbb README.md",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new name.rs",
            "old.rs",
            "? notes.txt",
            "",
        ]
        .join("\0");
        let status = parse_status(&output);
        assert_eq!(status.branch, "main");
        assert_eq!(status.head.as_deref(), Some("1234abcd"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (2, 1));
        assert_eq!(
            status.files,
            vec![
                StatusFile { path: "src/lib.rs".into(), status: FileStatus::Modified, staged: true, old_path: None },
                StatusFile { path: "README.md".into(), status: FileStatus::Modified, staged: false, old_path: None },
                StatusFile { path: "new name.rs".into(), status: FileStatus::Renamed, staged: true, old_path: Some("old.rs".into()) },
                StatusFile { path: "notes.txt".into(), status: FileStatus::Untracked, staged: false, old_path: None },
            ]
        );
        assert_eq!(parse_status("# branch.oid (initial)\0# branch.head (detached)\0").head, None);
    }

    #[test]
    fn parses_log_and_branches() {
        let log = "abc\x1fAda\x1fada@example.com\x1f2026-01-01T00:00:00+00:00\x1fFirst\x1fBody text\n\x1e\ndef\x1fBob\x1fbob@example.com\x1f2026-01-02T00:00:00+00:00\x1fSecond\x1f\x1e";
        let commits = parse_log(log);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].description.as_deref(), Some("Body text"));
        assert_eq!(commits[1].hash, "def");
        assert_eq!(commits[1].description, None);

        let branches = parse_branches("refs/heads/main\x1f*\x1f\nrefs/heads/dev\x1f \x1f\nrefs/remotes/origin/HEAD\x1f \x1frefs/remotes/origin/main\nrefs/remotes/origin/main\x1f \x1f\n");
        assert_eq!(branches, BranchList { current: Some("main".into()), local: vec!["main".into(), "dev".into()], remote: vec!["origin/main".into()] });
        assert!(is_branch_name("feature/web"));
        assert!(!is_branch_name("-x") && !is_branch_name("a..b") && !is_branch_name("x.lock"));
    }

    #[test]
    fn parses_numstat_and_stashes() {
        let stats = parse_numstat("3\t1\tsrc/lib.rs\0-\t-\tlogo.png\00\t0\t\0old.rs\0new.rs\0", true);
        assert_eq!(
            stats,
            vec![
                DiffStat { path: "src/lib.rs".into(), staged: true, additions: 3, deletions: 1 },
                DiffStat { path: "logo.png".into(), staged: true, additions: 0, deletions: 0 },
                DiffStat { path: "new.rs".into(), staged: true, additions: 0, deletions: 0 },
            ]
        );
        let stashes = parse_stashes("stash@{0}\x1fOn main: wip\x1f2026-01-02T00:00:00+00:00\nstash@{1}\x1fWIP on main\x1f2026-01-01T00:00:00+00:00\n");
        assert_eq!(stashes[1], StashEntry { index: 1, message: "WIP on main".into(), date: "2026-01-01T00:00:00+00:00".into() });
    }
}
