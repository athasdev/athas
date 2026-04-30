use crate::git::{GitRemote, IntoStringError};
use anyhow::{Context, Result, bail};
use git2::Repository;
use std::{
   path::Path,
   process::{Command, Stdio},
};

pub fn git_push(repo_path: String, branch: Option<String>, remote: String) -> Result<(), String> {
   _git_push(repo_path, branch, remote).into_string_error()
}

pub(crate) fn execute_remote_git_command(
   repo_dir: &Path,
   args: &[&str],
   operation: &str,
) -> Result<()> {
   let output = Command::new("git")
      .current_dir(repo_dir)
      .env("GIT_TERMINAL_PROMPT", "0")
      .env("GCM_INTERACTIVE", "never")
      .env("SSH_ASKPASS_REQUIRE", "never")
      .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
      .stdin(Stdio::null())
      .args(args)
      .output()
      .with_context(|| format!("Failed to execute git {operation}"))?;

   if output.status.success() {
      return Ok(());
   }

   let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
   let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
   let details = if !stderr.is_empty() {
      stderr
   } else if !stdout.is_empty() {
      stdout
   } else {
      "Git returned a non-zero exit status without output.".to_string()
   };

   bail!("Git {operation} failed: {details}");
}

fn _git_push(repo_path: String, branch: Option<String>, remote: String) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let mut args = vec!["push", &remote];
   let branch_str;
   if let Some(b) = branch {
      branch_str = b;
      args.push(&branch_str);
   }

   execute_remote_git_command(repo_dir, &args, "push")
}

pub fn git_pull(repo_path: String, branch: Option<String>, remote: String) -> Result<(), String> {
   _git_pull(repo_path, branch, remote).into_string_error()
}

fn _git_pull(repo_path: String, branch: Option<String>, remote: String) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let mut args = vec!["pull", &remote];
   let branch_str;
   if let Some(b) = branch {
      branch_str = b;
      args.push(&branch_str);
   }

   execute_remote_git_command(repo_dir, &args, "pull")
}

pub fn git_fetch(repo_path: String, remote: Option<String>) -> Result<(), String> {
   _git_fetch(repo_path, remote).into_string_error()
}

fn _git_fetch(repo_path: String, remote: Option<String>) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let mut args = vec!["fetch"];
   let remote_str;
   if let Some(r) = remote {
      remote_str = r;
      args.push(&remote_str);
   }

   execute_remote_git_command(repo_dir, &args, "fetch")
}

pub fn git_get_remotes(repo_path: String) -> Result<Vec<GitRemote>, String> {
   _git_get_remotes(repo_path).into_string_error()
}

fn _git_get_remotes(repo_path: String) -> Result<Vec<GitRemote>> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let remote_names = repo.remotes().context("Failed to get remote names")?;

   let mut remotes = Vec::new();
   for name in remote_names.iter().flatten() {
      let remote = repo.find_remote(name).context("Failed to find remote")?;
      if let Some(url) = remote.url() {
         remotes.push(GitRemote {
            name: name.to_string(),
            url: url.to_string(),
         });
      }
   }

   Ok(remotes)
}

pub fn git_add_remote(repo_path: String, name: String, url: String) -> Result<(), String> {
   _git_add_remote(repo_path, name, url).into_string_error()
}

fn _git_add_remote(repo_path: String, name: String, url: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   repo.remote(&name, &url).context("Failed to add remote")?;
   Ok(())
}

pub fn git_remove_remote(repo_path: String, name: String) -> Result<(), String> {
   _git_remove_remote(repo_path, name).into_string_error()
}

fn _git_remove_remote(repo_path: String, name: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   repo
      .remote_delete(&name)
      .context("Failed to remove remote")?;
   Ok(())
}
