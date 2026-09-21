use crate::git::{DiffLineType, GitHunk, IntoStringError, RepositoryHost};
use anyhow::{Result, bail};

fn create_patch_from_hunk(hunk: &GitHunk) -> Result<String, String> {
   let mut patch = String::new();

   let header_line = hunk
      .lines
      .iter()
      .find(|line| matches!(line.line_type, DiffLineType::Header))
      .ok_or_else(|| {
         log::error!(
            "No header line found in hunk. Line types present: {:?}",
            hunk.lines.iter().map(|l| &l.line_type).collect::<Vec<_>>()
         );
         "No header line found in hunk".to_string()
      })?;

   patch.push_str(&format!(
      "diff --git a/{} b/{}\n",
      hunk.file_path, hunk.file_path
   ));
   patch.push_str(&format!("--- a/{}\n", hunk.file_path));
   patch.push_str(&format!("+++ b/{}\n", hunk.file_path));
   patch.push_str(&header_line.content);
   if !header_line.content.ends_with('\n') {
      patch.push('\n');
   }

   for line in &hunk.lines {
      match line.line_type {
         DiffLineType::Added => {
            patch.push('+');
            patch.push_str(&line.content);
            patch.push('\n');
         }
         DiffLineType::Removed => {
            patch.push('-');
            patch.push_str(&line.content);
            patch.push('\n');
         }
         DiffLineType::Context => {
            patch.push(' ');
            patch.push_str(&line.content);
            patch.push('\n');
         }
         DiffLineType::Header => {}
      }
   }

   Ok(patch)
}

pub fn git_stage_hunk(repo_path: String, hunk: GitHunk) -> Result<(), String> {
   _git_stage_hunk(repo_path, hunk).into_string_error()
}

fn _git_stage_hunk(repo_path: String, hunk: GitHunk) -> Result<()> {
   let patch_content = create_patch_from_hunk(&hunk).map_err(|e| anyhow::anyhow!(e))?;

   let output = RepositoryHost::detect(&repo_path)
      .git()
      .args(["apply", "--cached", "-"])
      .stdin(patch_content.into_bytes())
      .output()?;

   if !output.status.success() {
      bail!(
         "Failed to stage hunk: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}

pub fn git_unstage_hunk(repo_path: String, hunk: GitHunk) -> Result<(), String> {
   _git_unstage_hunk(repo_path, hunk).into_string_error()
}

fn _git_unstage_hunk(repo_path: String, hunk: GitHunk) -> Result<()> {
   let patch_content = create_patch_from_hunk(&hunk).map_err(|e| anyhow::anyhow!(e))?;

   let output = RepositoryHost::detect(&repo_path)
      .git()
      .args(["apply", "--reverse", "--cached", "-"])
      .stdin(patch_content.into_bytes())
      .output()?;

   if !output.status.success() {
      bail!(
         "Failed to unstage hunk: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}
