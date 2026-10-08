use serde::{Deserialize, Serialize};

#[derive(Serialize, specta::Type)]
pub struct GitStatus {
   pub branch: String,
   pub ahead: i32,
   pub behind: i32,
   pub files: Vec<GitFile>,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
   Modified,
   Added,
   Deleted,
   Renamed,
   Untracked,
}

#[derive(Serialize, specta::Type)]
pub struct GitFile {
   pub path: String,
   pub status: FileStatus,
   pub staged: bool,
}

#[derive(Serialize, specta::Type)]
pub struct GitCommit {
   pub hash: String,
   pub message: String,
   pub description: Option<String>,
   pub author: String,
   pub email: String,
   pub date: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DiffLineType {
   Added,
   Removed,
   Context,
   Header,
}

#[derive(Serialize, Deserialize, Clone, specta::Type)]
pub struct GitDiffLine {
   pub line_type: DiffLineType,
   pub content: String,
   pub old_line_number: Option<u32>,
   pub new_line_number: Option<u32>,
}

#[derive(Serialize, specta::Type)]
pub struct GitDiff {
   pub file_path: String,
   pub old_path: Option<String>,
   pub new_path: Option<String>,
   pub is_new: bool,
   pub is_deleted: bool,
   pub is_renamed: bool,
   pub is_binary: bool,
   pub is_image: bool,
   pub old_blob_base64: Option<String>,
   pub new_blob_base64: Option<String>,
   pub lines: Vec<GitDiffLine>,
   #[serde(skip_serializing_if = "Option::is_none")]
   pub raw_patch: Option<String>,
   #[serde(skip_serializing_if = "Option::is_none")]
   pub additions: Option<usize>,
   #[serde(skip_serializing_if = "Option::is_none")]
   pub deletions: Option<usize>,
   #[serde(skip_serializing_if = "Option::is_none")]
   pub is_truncated: Option<bool>,
}

#[derive(Serialize, specta::Type)]
pub struct GitDiffStat {
   pub file_path: String,
   pub staged: bool,
   pub additions: usize,
   pub deletions: usize,
}

/// Blame for a buffer: each commit is listed once, and hunks point into `commits`.
#[derive(Serialize, specta::Type)]
pub struct GitBlame {
   pub file_path: String,
   pub commits: Vec<GitBlameCommit>,
   pub hunks: Vec<GitBlameHunk>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
pub struct GitBlameCommit {
   pub hash: String,
   pub author: String,
   pub email: String,
   pub time: i64,
   pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
pub struct GitBlameHunk {
   /// First line of the hunk, counting from 1.
   pub line_number: usize,
   pub total_lines: usize,
   /// Index into `GitBlame::commits`; `None` for lines that are not committed.
   pub commit_index: Option<usize>,
}

#[derive(Serialize, specta::Type)]
pub struct GitRemote {
   pub name: String,
   pub url: String,
}

#[derive(Serialize, specta::Type)]
pub struct GitStash {
   pub index: usize,
   pub message: String,
   pub date: String,
}

#[derive(Serialize, specta::Type)]
pub struct GitTag {
   pub name: String,
   pub commit: String,
   pub message: Option<String>,
   pub date: String,
   pub is_annotated: bool,
}

#[derive(Serialize, specta::Type)]
pub struct GitWorktree {
   pub path: String,
   pub branch: Option<String>,
   pub head: String,
   pub is_bare: bool,
   pub is_detached: bool,
   pub locked_reason: Option<String>,
   pub prunable_reason: Option<String>,
   pub is_current: bool,
}

#[derive(Deserialize, specta::Type)]
pub struct GitHunk {
   pub file_path: String,
   pub lines: Vec<GitDiffLine>,
}
