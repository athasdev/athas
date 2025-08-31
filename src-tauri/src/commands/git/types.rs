use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct GitStatus {
   pub branch: String,
   pub ahead: i32,
   pub behind: i32,
   pub files: Vec<GitFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
   Modified,
   Added,
   Deleted,
   Renamed,
   Untracked,
}

#[derive(Serialize)]
pub struct GitFile {
   pub path: String,
   pub status: FileStatus,
   pub staged: bool,
}

#[derive(Serialize)]
pub struct GitCommit {
   pub hash: String,
   pub message: String,
   pub author: String,
   pub date: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DiffLineType {
   Added,
   Removed,
   Context,
   Header,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitDiffLine {
   pub line_type: DiffLineType,
   pub content: String,
   pub old_line_number: Option<u32>,
   pub new_line_number: Option<u32>,
}

#[derive(Serialize)]
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
}

#[derive(Serialize)]
pub struct GitBlame {
   pub file_path: String,
   pub lines: Vec<GitBlameLine>,
}

#[derive(Serialize)]
pub struct GitBlameLine {
   pub line_number: usize,
   pub total_lines: usize,
   pub commit_hash: String,
   pub author: String,
   pub email: String,
   pub time: i64,
   pub commit: String,
}

#[derive(Serialize)]
pub struct GitRemote {
   pub name: String,
   pub url: String,
}

#[derive(Serialize)]
pub struct GitStash {
   pub index: usize,
   pub message: String,
   pub date: String,
}

#[derive(Serialize)]
pub struct GitTag {
   pub name: String,
   pub commit: String,
   pub message: Option<String>,
   pub date: String,
}

#[derive(Deserialize)]
pub struct GitHunk {
   pub file_path: String,
   pub lines: Vec<GitDiffLine>,
}
