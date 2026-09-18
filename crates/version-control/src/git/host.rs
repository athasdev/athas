use anyhow::{Context, Result, bail};
use std::{
   ffi::{OsStr, OsString},
   io::Write,
   path::{Path, PathBuf},
   process::{Command, Output, Stdio},
};

/// Where a repository lives from the point of view of the app process.
///
/// Repositories inside a WSL distribution are reachable from Windows through a
/// `\\wsl$` or `\\wsl.localhost` share, which is enough for libgit2 to read
/// them, but everything that mutates the repository or talks to a remote runs
/// through the distribution's own `git` so that file modes, symlinks, hooks,
/// SSH keys, and credential helpers behave exactly as they do in a WSL shell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepositoryHost {
   Local {
      path: PathBuf,
   },
   Wsl {
      distro: String,
      linux_path: String,
      native_path: PathBuf,
   },
}

impl RepositoryHost {
   pub fn detect(path: &str) -> Self {
      if let Some(location) = athas_wsl::parse_wsl_location(path) {
         let native_path = if athas_wsl::is_wsl_path(path) {
            PathBuf::from(
               athas_wsl::wsl_uri_to_windows_unc(path).unwrap_or_else(|_| path.to_string()),
            )
         } else {
            PathBuf::from(path)
         };
         return Self::Wsl {
            distro: location.distro,
            linux_path: location.linux_path,
            native_path,
         };
      }

      Self::Local {
         path: PathBuf::from(path),
      }
   }

   pub fn native_path(&self) -> &Path {
      match self {
         Self::Local { path } => path,
         Self::Wsl { native_path, .. } => native_path,
      }
   }

   pub fn is_wsl(&self) -> bool {
      matches!(self, Self::Wsl { .. })
   }

   /// True when git commands for this repository should run inside the WSL
   /// distribution instead of on the host.
   pub fn uses_distro_git(&self) -> bool {
      match self {
         Self::Local { .. } => false,
         Self::Wsl { distro, .. } => athas_wsl::git_available(distro),
      }
   }

   /// The host for the directory containing this path, used when a command
   /// needs a working directory but the path may point at a file.
   pub fn parent(&self) -> Self {
      match self {
         Self::Local { path } => Self::Local {
            path: path
               .parent()
               .map(Path::to_path_buf)
               .unwrap_or_else(|| path.clone()),
         },
         Self::Wsl {
            distro,
            linux_path,
            native_path,
         } => Self::Wsl {
            distro: distro.clone(),
            linux_path: linux_parent(linux_path),
            native_path: native_path
               .parent()
               .map(Path::to_path_buf)
               .unwrap_or_else(|| native_path.clone()),
         },
      }
   }

   pub fn git(&self) -> GitCommand {
      GitCommand::new(self.clone())
   }

   /// Rewrites a path argument so the git process can understand it.
   pub fn argument_path(&self, path: &str) -> String {
      match self {
         Self::Local { .. } => path.to_string(),
         Self::Wsl { distro, .. } => athas_wsl::linux_argument_path(distro, path),
      }
   }
}

fn linux_parent(path: &str) -> String {
   match path.rfind('/') {
      Some(0) | None => "/".to_string(),
      Some(index) => path[..index].to_string(),
   }
}

/// A `git` invocation bound to a repository host.
pub struct GitCommand {
   host: RepositoryHost,
   args: Vec<OsString>,
   envs: Vec<(String, OsString)>,
   stdin: Option<Vec<u8>>,
}

impl GitCommand {
   fn new(host: RepositoryHost) -> Self {
      Self {
         host,
         args: Vec::new(),
         envs: Vec::new(),
         stdin: None,
      }
   }

   pub fn arg(mut self, arg: impl AsRef<OsStr>) -> Self {
      self.args.push(arg.as_ref().to_os_string());
      self
   }

   pub fn args<I, S>(mut self, args: I) -> Self
   where
      I: IntoIterator<Item = S>,
      S: AsRef<OsStr>,
   {
      self
         .args
         .extend(args.into_iter().map(|arg| arg.as_ref().to_os_string()));
      self
   }

   pub fn env(mut self, key: &str, value: impl AsRef<OsStr>) -> Self {
      self
         .envs
         .push((key.to_string(), value.as_ref().to_os_string()));
      self
   }

   pub fn stdin(mut self, input: Vec<u8>) -> Self {
      self.stdin = Some(input);
      self
   }

   /// The program and arguments that will be spawned, for logging and tests.
   pub fn command_line(&self) -> Vec<String> {
      let command = self.build();
      std::iter::once(command.get_program())
         .chain(command.get_args())
         .map(|part| part.to_string_lossy().into_owned())
         .collect()
   }

   fn build(&self) -> Command {
      match &self.host {
         RepositoryHost::Local { path } => {
            let mut command = Command::new("git");
            command.current_dir(path);
            for (key, value) in &self.envs {
               command.env(key, value);
            }
            command.args(&self.args);
            command
         }
         RepositoryHost::Wsl {
            distro, linux_path, ..
         } => {
            let mut command = athas_wsl::exec_command(distro);
            command.arg("git").arg("-C").arg(linux_path);
            for (key, value) in &self.envs {
               athas_wsl::forward_env(&mut command, key, value);
            }
            command.args(&self.args);
            command
         }
      }
   }

   pub fn output(self) -> Result<Output> {
      let mut command = self.build();
      let Some(input) = self.stdin else {
         return command
            .stdin(Stdio::null())
            .output()
            .context("Failed to start git");
      };

      command
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped());
      let mut child = command.spawn().context("Failed to start git")?;
      if let Some(mut stdin) = child.stdin.take() {
         stdin
            .write_all(&input)
            .context("Failed to write to git stdin")?;
      }
      child.wait_with_output().context("Failed to wait for git")
   }

   /// Runs the command and turns a non-zero exit into an error that carries
   /// git's own explanation.
   pub fn run(self, operation: &str) -> Result<Output> {
      let output = self
         .output()
         .with_context(|| format!("Failed to execute git {operation}"))?;
      if output.status.success() {
         return Ok(output);
      }

      bail!("Git {operation} failed: {}", describe_failure(&output));
   }
}

pub fn describe_failure(output: &Output) -> String {
   let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
   let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
   if !stderr.is_empty() {
      stderr
   } else if !stdout.is_empty() {
      stdout
   } else {
      "Git returned a non-zero exit status without output.".to_string()
   }
}

/// Applies process-wide libgit2 settings that the app relies on.
///
/// libgit2 refuses to open repositories whose directory owner is not the
/// current user. On Windows that check trips on every network share, including
/// the `\\wsl$` shares that expose WSL distributions, so the app disables it
/// there. libgit2 never runs hooks, which is what the check protects against.
pub fn configure_libgit2() {
   #[cfg(windows)]
   // SAFETY: libgit2 options must be set before any other libgit2 call from
   // another thread. This runs once during app setup, before any command that
   // touches a repository can be invoked.
   unsafe {
      if let Err(error) = git2::opts::set_verify_owner_validation(false) {
         log::warn!("Failed to disable libgit2 owner validation: {error}");
      }
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn detects_wsl_hosts_from_uris_and_share_paths() {
      let from_uri = RepositoryHost::detect("wsl://Ubuntu/home/me/repo");
      let from_share = RepositoryHost::detect(r"\\wsl$\Ubuntu\home\me\repo");
      let from_forward_share = RepositoryHost::detect("//wsl.localhost/Ubuntu/home/me/repo/");

      for host in [&from_uri, &from_share, &from_forward_share] {
         match host {
            RepositoryHost::Wsl {
               distro, linux_path, ..
            } => {
               assert_eq!(distro, "Ubuntu");
               assert_eq!(linux_path, "/home/me/repo");
            }
            RepositoryHost::Local { .. } => panic!("expected a WSL host"),
         }
      }
      assert_eq!(
         from_share.native_path(),
         Path::new(r"\\wsl$\Ubuntu\home\me\repo")
      );
      assert!(matches!(
         RepositoryHost::detect("/home/me/repo"),
         RepositoryHost::Local { .. }
      ));
      assert!(matches!(
         RepositoryHost::detect(r"C:\Users\me\repo"),
         RepositoryHost::Local { .. }
      ));
   }

   #[test]
   fn wsl_commands_run_git_inside_the_distribution() {
      let host = RepositoryHost::detect("wsl://Ubuntu/home/me/repo");
      let command = host
         .git()
         .args(["status", "--porcelain=v2"])
         .arg(host.argument_path(r"\\wsl$\Ubuntu\home\me\other"));

      assert_eq!(
         command.command_line(),
         vec![
            "wsl.exe",
            "--distribution",
            "Ubuntu",
            "--exec",
            "git",
            "-C",
            "/home/me/repo",
            "status",
            "--porcelain=v2",
            "/home/me/other",
         ]
      );
   }

   #[test]
   fn local_commands_run_git_in_the_repository_directory() {
      let host = RepositoryHost::detect("/home/me/repo");
      let command = host.git().args(["fetch", "origin"]);

      assert_eq!(command.command_line(), vec!["git", "fetch", "origin"]);
      assert_eq!(host.argument_path("../worktree"), "../worktree");
   }

   #[test]
   fn wsl_commands_forward_environment_through_wslenv() {
      let host = RepositoryHost::detect("wsl://Ubuntu/home/me/repo");
      let command = host
         .git()
         .env("GIT_TERMINAL_PROMPT", "0")
         .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
         .build();
      let wslenv = command
         .get_envs()
         .find(|(key, _)| *key == OsStr::new("WSLENV"))
         .and_then(|(_, value)| value)
         .map(|value| value.to_string_lossy().into_owned())
         .unwrap_or_default();

      assert!(
         wslenv
            .split(':')
            .any(|entry| entry == "GIT_TERMINAL_PROMPT")
      );
      assert!(wslenv.split(':').any(|entry| entry == "GIT_SSH_COMMAND"));
   }

   #[test]
   fn parent_host_moves_up_one_directory() {
      let host = RepositoryHost::detect("wsl://Ubuntu/home/me/repo/src/main.rs").parent();
      match host {
         RepositoryHost::Wsl { linux_path, .. } => assert_eq!(linux_path, "/home/me/repo/src"),
         RepositoryHost::Local { .. } => panic!("expected a WSL host"),
      }
      assert_eq!(linux_parent("/file"), "/");
      assert_eq!(linux_parent("/"), "/");
   }

   #[test]
   fn stdin_is_delivered_to_the_process() {
      let host = RepositoryHost::detect(std::env::temp_dir().to_str().unwrap());
      let output = host
         .git()
         .args(["--version"])
         .stdin(b"ignored".to_vec())
         .output()
         .expect("git runs");
      assert!(output.status.success());
   }
}
