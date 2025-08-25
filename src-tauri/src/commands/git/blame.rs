use crate::commands::git::{GitBlame, GitBlameLine};
use git2::Repository;
use std::path::Path;
use tauri::command;

#[command]
pub fn git_blame_file(repo_path: &str, file_path: &str) -> Result<GitBlame, String> {
   let repo =
      Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

   // Get the blame information
   let blame = repo
      .blame_file(Path::new(file_path), None)
      .map_err(|e| format!("Failed to get blame for file '{}': {}", file_path, e))?;

   // Read the file content to get actual line content
   // Use the repository's workdir to get the correct absolute path
   let workdir = repo
      .workdir()
      .ok_or_else(|| "Repository has no working directory".to_string())?;
   let full_file_path = workdir.join(file_path);
   let file_content = std::fs::read_to_string(&full_file_path)
      .map_err(|e| format!("Failed to read file '{}': {}", full_file_path.display(), e))?;

   let file_lines: Vec<&str> = file_content.lines().collect();

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
      let line_index = (hunk.final_start_line() - 1) as usize; // Convert 1-based to 0-based
      let line_content = file_lines
         .get(line_index)
         .map(|&s| s.to_string())
         .unwrap_or_else(|| {
            // Handle case where blame has more lines than file content
            format!("<line {} not found>", hunk.final_start_line())
         });

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
