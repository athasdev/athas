use crate::git::{GitBlame, GitBlameLine};
use git2::Repository;
use std::path::Path;

pub fn git_blame_file(root_path: &str, file_path: &str, content: &str) -> Result<GitBlame, String> {
   let repo =
      Repository::open(root_path).map_err(|e| format!("Failed to open repository: {}", e))?;

   let committed_blame = repo
      .blame_file(Path::new(file_path), None)
      .map_err(|e| format!("Failed to get blame for file '{}': {}", file_path, e))?;
   let blame = committed_blame
      .blame_buffer(content.as_bytes())
      .map_err(|e| {
         format!(
            "Failed to get blame for editor content '{}': {}",
            file_path, e
         )
      })?;

   if blame.is_empty() {
      return Err(format!(
         "No blame information available for file '{}'",
         file_path
      ));
   }

   let mut blame_lines = Vec::new();

   for hunk in blame.iter() {
      let commit_id = hunk.final_commit_id();
      let is_uncommitted = commit_id.is_zero();
      let (commit_hash, author, email, time, commit) = if is_uncommitted {
         (
            String::new(),
            String::new(),
            String::new(),
            0,
            String::new(),
         )
      } else {
         let signature = hunk.final_signature();
         let commit = repo
            .find_commit(commit_id)
            .map_err(|e| format!("Failed to load blame commit '{}': {}", commit_id, e))?;

         (
            commit_id.to_string(),
            signature.name().unwrap_or("Unknown").to_string(),
            signature.email().unwrap_or("").to_string(),
            signature.when().seconds(),
            commit.message().unwrap_or("").to_string(),
         )
      };

      blame_lines.push(GitBlameLine {
         line_number: hunk.final_start_line(),
         total_lines: hunk.lines_in_hunk(),
         commit_hash,
         is_uncommitted,
         author,
         email,
         time,
         commit,
      });
   }

   Ok(GitBlame {
      file_path: file_path.to_string(),
      lines: blame_lines,
   })
}

#[cfg(test)]
mod tests {
   use super::*;
   use git2::{IndexAddOption, Signature};
   use std::fs;

   fn commit_file(repo: &Repository, relative_path: &str, content: &str) {
      let workdir = repo.workdir().expect("repository workdir");
      fs::write(workdir.join(relative_path), content).expect("write file");

      let mut index = repo.index().expect("repository index");
      index
         .add_all([relative_path], IndexAddOption::DEFAULT, None)
         .expect("add file");
      index.write().expect("write index");
      let tree_id = index.write_tree().expect("write tree");
      let tree = repo.find_tree(tree_id).expect("find tree");
      let signature = Signature::now("Athas Test", "test@athas.dev").expect("signature");
      repo
         .commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Initial commit",
            &tree,
            &[],
         )
         .expect("commit file");
   }

   #[test]
   fn aligns_blame_with_inserted_editor_content() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");
      commit_file(&repo, "example.txt", "first\nsecond\n");

      let blame = git_blame_file(
         temp_dir.path().to_str().expect("repo path"),
         "example.txt",
         "inserted\nfirst\nsecond\n",
      )
      .expect("blame editor content");

      let inserted = blame
         .lines
         .iter()
         .find(|line| line.line_number == 1)
         .expect("inserted line blame");
      let committed = blame
         .lines
         .iter()
         .find(|line| line.line_number <= 2 && 2 < line.line_number + line.total_lines)
         .expect("committed line blame");

      assert!(inserted.is_uncommitted);
      assert!(inserted.commit_hash.is_empty());
      assert!(!committed.is_uncommitted);
      assert_eq!(committed.author, "Athas Test");
   }

   #[test]
   fn aligns_blame_after_deleting_a_committed_line() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");
      commit_file(&repo, "example.txt", "first\nsecond\n");

      let blame = git_blame_file(
         temp_dir.path().to_str().expect("repo path"),
         "example.txt",
         "second\n",
      )
      .expect("blame editor content");
      let first_line = blame
         .lines
         .iter()
         .find(|line| line.line_number == 1)
         .expect("first visible line blame");

      assert!(!first_line.is_uncommitted);
      assert_eq!(first_line.author, "Athas Test");
   }
}
