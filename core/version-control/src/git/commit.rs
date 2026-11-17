use crate::git::{GitCommit, IntoStringError, RepositoryHost};
use anyhow::{Context, Result};
use git2::{Commit, ErrorCode, Repository, Sort};

pub fn git_commit(repo_path: String, message: String, sign_off: bool) -> Result<(), String> {
   _git_commit(repo_path, message, sign_off).into_string_error()
}

fn _git_commit(repo_path: String, message: String, sign_off: bool) -> Result<()> {
   let host = RepositoryHost::detect(&repo_path);
   if host.uses_distro_git() {
      let mut args = vec!["commit", "-q", "-F", "-"];
      if sign_off {
         args.push("--signoff");
      }
      host
         .git()
         .args(args)
         .stdin(message.into_bytes())
         .run("commit")?;
      return Ok(());
   }

   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let mut index = repo.index().context("Failed to get index")?;

   let tree_id = index.write_tree().context("Failed to write tree")?;
   let tree = repo.find_tree(tree_id).context("Failed to find tree")?;
   let sig = repo.signature().context("Failed to get signature")?;
   let message = if sign_off {
      append_sign_off(&message, &sig)
   } else {
      message
   };
   // A freshly initialized repository has no HEAD commit yet; its first
   // commit is a root commit without parents.
   let parent_commit = match repo.head() {
      Ok(head) => Some(
         head
            .peel_to_commit()
            .context("Failed to get parent commit")?,
      ),
      Err(error) if error.code() == ErrorCode::UnbornBranch => None,
      Err(error) => return Err(error).context("Failed to get HEAD"),
   };
   let parents: Vec<&Commit> = parent_commit.iter().collect();

   repo
      .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
      .context("Failed to create commit")?;

   Ok(())
}

/// Adds a `Signed-off-by` trailer the way `git commit --signoff` does: joined
/// to an existing trailer block, and skipped when the same trailer is the last
/// one already.
fn append_sign_off(message: &str, sig: &git2::Signature) -> String {
   let trailer = format!(
      "Signed-off-by: {} <{}>",
      sig.name().unwrap_or_default(),
      sig.email().unwrap_or_default()
   );
   let body = message.trim_end();
   if body.lines().last() == Some(trailer.as_str()) {
      return format!("{body}\n");
   }
   let last_paragraph = body.rsplit("\n\n").next().unwrap_or_default();
   let ends_with_trailers = body.contains("\n\n")
      && last_paragraph.lines().all(|line| {
         line
            .split_once(": ")
            .is_some_and(|(key, _)| !key.is_empty() && !key.contains(char::is_whitespace))
      });
   let separator = if body.is_empty() {
      ""
   } else if ends_with_trailers {
      "\n"
   } else {
      "\n\n"
   };
   format!("{body}{separator}{trailer}\n")
}

pub fn git_log(
   repo_path: String,
   limit: Option<u32>,
   skip: Option<u32>,
) -> Result<Vec<GitCommit>, String> {
   _git_log(repo_path, limit, skip).into_string_error()
}

fn _git_log(repo_path: String, limit: Option<u32>, skip: Option<u32>) -> Result<Vec<GitCommit>> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let mut revwalk = repo.revwalk().context("Failed to create revwalk")?;

   revwalk.push_head().context("Failed to push HEAD")?;
   revwalk
      .set_sorting(Sort::TIME)
      .context("Failed to set sorting")?;

   let skip = skip.unwrap_or(0) as usize;
   let limit = limit.unwrap_or(50) as usize;
   let mut commits = Vec::new();

   for (_idx, oid) in revwalk.enumerate().skip(skip).take(limit) {
      let oid = oid.context("Failed to get commit oid")?;
      let commit = repo.find_commit(oid).context("Failed to find commit")?;

      let author = commit.author();
      let time = chrono::DateTime::<chrono::Utc>::from_timestamp(author.when().seconds(), 0)
         .map(|dt| dt.format("%Y-%m-%d").to_string())
         .unwrap_or_default();

      commits.push(GitCommit {
         hash: oid.to_string(),
         message: commit.summary().unwrap_or("").to_string(),
         description: commit
            .body()
            .map(str::trim)
            .filter(|body| !body.is_empty())
            .map(str::to_string),
         author: author.name().unwrap_or("Unknown").to_string(),
         email: author.email().unwrap_or("").to_string(),
         date: time,
      });
   }

   Ok(commits)
}
