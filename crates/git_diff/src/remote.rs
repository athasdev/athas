//! Repositories git runs on elsewhere: the web build's, on its workspace server. Their diffs come
//! back as `git diff` patches ([`parse_patch`]) and their blame as `git blame --porcelain`
//! ([`parse_blame`]).

use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, OnceLock},
};

use anyhow::Result;

use crate::{
    BlameCommit, BlameLine, DiffTarget,
    git::{CommitDetails, HunkAction, is_image},
    model::{DiffLine, FileContent, FileDiff, FileStatus, Hunk, LineKind, MAX_LINES},
};

/// What the diff, commit and blame views ask of a repository they cannot open themselves.
pub trait RemoteRepository: Send + Sync {
    /// The working tree's root.
    fn root(&self) -> &Path;
    fn load(&self, target: &DiffTarget) -> Result<Vec<FileDiff>>;
    fn apply_hunk(&self, file: &FileDiff, hunk: &Hunk, action: HunkAction) -> Result<()>;
    fn set_file_staged(&self, file: &FileDiff, staged: bool) -> Result<()>;
    fn commit_details(&self, rev: &str) -> Result<CommitDetails>;
    /// Blames `path` (relative to the root) as it is on disk, or as `content` when given.
    fn blame(&self, path: &str, content: Option<&str>) -> Result<Vec<BlameLine>>;
    /// `path` (relative to the root) as it was at `commit`.
    fn file_at_commit(&self, commit: &str, path: &str) -> Result<String> {
        let _ = (commit, path);
        anyhow::bail!("Not available here")
    }
}

static REMOTE: OnceLock<Arc<dyn RemoteRepository>> = OnceLock::new();

/// Installs the repository the web build's views read; the first one stays.
pub fn set_remote(repository: Arc<dyn RemoteRepository>) {
    let _ = REMOTE.set(repository);
}

pub fn remote() -> Option<&'static Arc<dyn RemoteRepository>> {
    REMOTE.get()
}

/// A path of a patch header, without its `a/` or `b/` and the quotes git puts around unusual
/// names.
fn header_path(raw: &str) -> Option<String> {
    let raw = raw.trim_end_matches('\t');
    if raw == "/dev/null" {
        return None;
    }
    let unquoted = match raw.strip_prefix('"').and_then(|raw| raw.strip_suffix('"')) {
        Some(quoted) => unescape(quoted),
        None => raw.to_string(),
    };
    Some(unquoted.strip_prefix("a/").or_else(|| unquoted.strip_prefix("b/")).map(str::to_string).unwrap_or(unquoted))
}

/// Git's C-style escapes, octal bytes included.
fn unescape(quoted: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = quoted.bytes().peekable();
    while let Some(byte) = chars.next() {
        if byte != b'\\' {
            bytes.push(byte);
            continue;
        }
        match chars.next() {
            Some(b'n') => bytes.push(b'\n'),
            Some(b't') => bytes.push(b'\t'),
            Some(digit @ b'0'..=b'7') => {
                let mut value = (digit - b'0') as u32;
                for _ in 0..2 {
                    match chars.peek() {
                        Some(next @ b'0'..=b'7') => {
                            value = value * 8 + (next - b'0') as u32;
                            chars.next();
                        }
                        _ => break,
                    }
                }
                bytes.push(value as u8);
            }
            Some(other) => bytes.push(other),
            None => {}
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// `@@ -a,b +c,d @@ context`.
fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let ranges = line.strip_prefix("@@ ")?.split(" @@").next()?;
    let (old, new) = ranges.split_once(' ')?;
    let range = |range: &str| -> Option<(u32, u32)> {
        match range.split_once(',') {
            Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
            None => Some((range.parse().ok()?, 1)),
        }
    };
    let (old_start, old_lines) = range(old.strip_prefix('-')?)?;
    let (new_start, new_lines) = range(new.strip_prefix('+')?)?;
    Some((old_start, old_lines, new_start, new_lines))
}

/// The files of a `git diff` (or `git show`) patch, as the diff view draws them. Without the
/// files' whole text, unchanged lines between hunks cannot unfold.
pub fn parse_patch(patch: &str) -> Vec<FileDiff> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut budget = MAX_LINES;
    let mut lines = patch.lines().peekable();
    // Line numbers of the hunk being read.
    let (mut old_line, mut new_line) = (0u32, 0u32);
    let mut in_hunk = false;
    while let Some(line) = lines.next() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            in_hunk = false;
            let path = rest.split_once(" b/").map(|(_, new)| new.to_string()).or_else(|| header_path(rest.rsplit(' ').next().unwrap_or(rest))).unwrap_or_default();
            files.push(FileDiff {
                path,
                old_path: None,
                status: FileStatus::Modified,
                content: FileContent::Text { hunks: Vec::new(), old_text: None, new_text: None },
                additions: 0,
                deletions: 0,
                truncated: false,
            });
            continue;
        }
        let Some(file) = files.last_mut() else { continue };
        if !in_hunk || line.starts_with("@@ ") {
            if line.starts_with("new file mode") {
                file.status = FileStatus::Added;
            } else if line.starts_with("deleted file mode") {
                file.status = FileStatus::Deleted;
            } else if let Some(from) = line.strip_prefix("rename from ") {
                file.status = FileStatus::Renamed;
                file.old_path = Some(header_path(from).unwrap_or_default());
            } else if let Some(to) = line.strip_prefix("rename to ") {
                file.path = header_path(to).unwrap_or_default();
            } else if let Some(old) = line.strip_prefix("--- ") {
                if header_path(old).is_none() {
                    file.status = FileStatus::Added;
                }
            } else if let Some(new) = line.strip_prefix("+++ ") {
                match header_path(new) {
                    Some(path) => file.path = path,
                    None => file.status = FileStatus::Deleted,
                }
            } else if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
                file.content = if is_image(&file.path) { FileContent::Image { old: None, new: None } } else { FileContent::Binary };
            } else if let Some((old_start, old_lines, new_start, new_lines)) = parse_hunk_header(line) {
                in_hunk = true;
                (old_line, new_line) = (old_start, new_start);
                if let FileContent::Text { hunks, .. } = &mut file.content {
                    hunks.push(Hunk { header: line.trim_end().to_string(), old_start, old_lines, new_start, new_lines, lines: Vec::new() });
                }
            }
            if file.status == FileStatus::Deleted
                && let Some(old) = file.old_path.take()
            {
                file.path = old;
            }
            continue;
        }
        let Some(kind) = (match line.as_bytes().first() {
            Some(b' ') => Some(LineKind::Context),
            Some(b'+') => Some(LineKind::Added),
            Some(b'-') => Some(LineKind::Removed),
            Some(b'\\') => Some(LineKind::NoNewline),
            None => Some(LineKind::Context),
            _ => None,
        }) else {
            in_hunk = false;
            continue;
        };
        if budget == 0 {
            file.truncated = true;
            continue;
        }
        budget -= 1;
        // A diff line's first character is its marker, but the bytes come from git: slicing past
        // a character boundary on a malformed line would take the app down with it.
        let text = match kind {
            LineKind::NoNewline => String::new(),
            _ => line.char_indices().nth(1).map_or(String::new(), |(start, _)| line[start..].to_string()),
        };
        let (old, new) = match kind {
            LineKind::Context => (Some(old_line), Some(new_line)),
            LineKind::Added => (None, Some(new_line)),
            LineKind::Removed => (Some(old_line), None),
            LineKind::NoNewline => (None, None),
        };
        match kind {
            LineKind::Context => (old_line, new_line) = (old_line + 1, new_line + 1),
            LineKind::Added => {
                new_line += 1;
                file.additions += 1;
            }
            LineKind::Removed => {
                old_line += 1;
                file.deletions += 1;
            }
            LineKind::NoNewline => {}
        }
        if let FileContent::Text { hunks, .. } = &mut file.content
            && let Some(hunk) = hunks.last_mut()
        {
            hunk.lines.push(DiffLine { kind, old, new, text });
        }
    }
    files
}

/// One [`BlameLine`] per line of `git blame --porcelain` output; lines not committed yet (all
/// zeros) have no commit.
pub fn parse_blame(porcelain: &str) -> Vec<BlameLine> {
    #[derive(Default)]
    struct Fields {
        author: String,
        email: String,
        time: i64,
        summary: String,
    }
    let mut fields: HashMap<String, Fields> = HashMap::new();
    let mut commits: HashMap<String, Arc<BlameCommit>> = HashMap::new();
    let mut entries: Vec<(u32, String)> = Vec::new();
    let mut current: Option<String> = None;
    for line in porcelain.lines() {
        if line.starts_with('\t') {
            if let Some(hash) = current.take() {
                let commit = fields.get(&hash).map(|fields| BlameCommit {
                    hash: hash.clone(),
                    author: fields.author.clone(),
                    email: fields.email.clone(),
                    time: fields.time,
                    summary: fields.summary.clone(),
                });
                if let Some(commit) = commit {
                    commits.entry(hash).or_insert_with(|| Arc::new(commit));
                }
            }
            continue;
        }
        let mut words = line.split(' ');
        let first = words.next().unwrap_or_default();
        if first.len() == 40 && first.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            let final_line = words.nth(1).and_then(|line| line.parse().ok()).unwrap_or(0);
            entries.push((final_line, first.to_string()));
            fields.entry(first.to_string()).or_default();
            current = Some(first.to_string());
            continue;
        }
        let Some(fields) = current.as_ref().and_then(|hash| fields.get_mut(hash)) else { continue };
        let value = line.split_once(' ').map_or("", |(_, value)| value);
        match first {
            "author" => fields.author = value.to_string(),
            "author-mail" => fields.email = value.trim_start_matches('<').trim_end_matches('>').to_string(),
            "author-time" => fields.time = value.parse().unwrap_or(0),
            "summary" => fields.summary = value.to_string(),
            _ => {}
        }
    }
    entries.sort_by_key(|(line, _)| *line);
    let mut previous: Option<String> = None;
    entries
        .into_iter()
        .map(|(line, hash)| {
            let commit = (!hash.bytes().all(|byte| byte == b'0')).then(|| commits.get(&hash).cloned()).flatten();
            let starts_hunk = previous.as_deref() != Some(hash.as_str());
            previous = Some(hash);
            BlameLine { line, commit, starts_hunk }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_parse_into_files() {
        let patch = "diff --git a/src/a.rs b/src/a.rs\nindex 1..2 100644\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -1,3 +1,3 @@ fn main\n a\n-b\n+c\n d\n@@ -10 +10,2 @@\n x\n+y\n\\ No newline at end of file\ndiff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hi\ndiff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\ndiff --git a/x.rs b/y.rs\nsimilarity index 90%\nrename from x.rs\nrename to y.rs\ndiff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n";
        let files = parse_patch(patch);
        let summary: Vec<_> = files.iter().map(|file| (file.path.as_str(), file.old_path.as_deref(), file.status, file.additions, file.deletions)).collect();
        assert_eq!(
            summary,
            vec![
                ("src/a.rs", None, FileStatus::Modified, 2, 1),
                ("new.txt", None, FileStatus::Added, 1, 0),
                ("old.txt", None, FileStatus::Deleted, 0, 1),
                ("y.rs", Some("x.rs"), FileStatus::Renamed, 0, 0),
                ("logo.png", None, FileStatus::Modified, 0, 0),
            ]
        );
        let hunks = files[0].hunks();
        assert_eq!((hunks.len(), hunks[0].context(), hunks[1].old_lines, hunks[1].new_lines), (2, "fn main", 1, 2));
        assert_eq!(
            hunks[0].lines,
            vec![
                DiffLine { kind: LineKind::Context, old: Some(1), new: Some(1), text: "a".into() },
                DiffLine { kind: LineKind::Removed, old: Some(2), new: None, text: "b".into() },
                DiffLine { kind: LineKind::Added, old: None, new: Some(2), text: "c".into() },
                DiffLine { kind: LineKind::Context, old: Some(3), new: Some(3), text: "d".into() },
            ]
        );
        assert_eq!(hunks[1].lines.last().map(|line| line.kind), Some(LineKind::NoNewline));
        assert!(matches!(files[4].content, FileContent::Image { .. }));
        assert_eq!(header_path("\"a/caf\\303\\251 x.txt\""), Some("café x.txt".into()));
    }

    #[test]
    fn blame_porcelain_parses() {
        let hash = "a".repeat(40);
        let zero = "0".repeat(40);
        let porcelain = format!(
            "{hash} 1 1 2\nauthor Ada\nauthor-mail <ada@example.com>\nauthor-time 100\nsummary First\nfilename a.txt\n\tone\n{hash} 2 2\n\ttwo\n{zero} 3 3 1\nauthor Not Committed Yet\nauthor-time 200\nsummary Version of a.txt from a.txt\nfilename a.txt\n\tthree\n"
        );
        let lines = parse_blame(&porcelain);
        assert_eq!(lines.iter().map(|line| (line.line, line.starts_hunk, line.commit.is_some())).collect::<Vec<_>>(), vec![(1, true, true), (2, false, true), (3, true, false)]);
        let commit = lines[0].commit.as_ref().unwrap();
        assert_eq!((commit.author.as_str(), commit.email.as_str(), commit.time, commit.summary.as_str()), ("Ada", "ada@example.com", 100, "First"));
    }
}
