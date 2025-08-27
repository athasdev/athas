use crate::commands::git::{GitBlame, GitBlameLine};
use git2::Repository;
use std::path::Path;
use tauri::command;

#[command]
pub fn git_blame_file(root_path: &str, file_path: &str) -> Result<GitBlame, String> {
   let repo =
      Repository::open(root_path).map_err(|e| format!("Failed to open repository: {}", e))?;

   // Get the blame information
   let blame = repo
      .blame_file(Path::new(file_path), None)
      .map_err(|e| format!("Failed to get blame for file '{}': {}", file_path, e))?;

   // Validate that we have content to blame
   if blame.len() == 0 {
      return Err(format!(
         "No blame information available for file '{}'",
         file_path
      ));
   }

   // Process blame lines
   let mut blame_lines = Vec::new();

   for hunk in blame.iter() {
      let signature = hunk.final_signature();
      let commit = repo.find_commit(hunk.final_commit_id()).unwrap();

      blame_lines.push(GitBlameLine {
         line_number: hunk.final_start_line(),
         total_lines: hunk.lines_in_hunk(),
         commit_hash: hunk.final_commit_id().to_string(),
         author: signature.name().unwrap_or("Unknown").to_string(),
         email: signature.email().unwrap_or("").to_string(),
         time: signature.when().seconds(),
         commit: commit.message().unwrap_or("").to_string(),
      });
   }

   Ok(GitBlame {
      file_path: file_path.to_string(),
      lines: blame_lines,
   })
}
