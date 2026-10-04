//! Terminals inside the Flatpak sandbox would only see the GNOME runtime, not
//! the user's shells and toolchains. When Athas runs as a Flatpak, terminal
//! processes are started on the host through `flatpak-spawn --host`, which the
//! manifest allows with `--talk-name=org.freedesktop.Flatpak`. The pty slave is
//! forwarded as stdio, so the host shell still gets a real terminal.

use portable_pty::CommandBuilder;
use std::{
   path::{Path, PathBuf},
   process::Command,
   sync::OnceLock,
};

/// Host directories the sandbox can only read through `--filesystem=host-os`.
const HOST_OS_PREFIXES: &[&str] = &["/usr", "/bin", "/sbin", "/lib", "/lib64"];
const HOST_OS_ROOT: &str = "/run/host";

pub fn is_sandboxed() -> bool {
   static SANDBOXED: OnceLock<bool> = OnceLock::new();
   *SANDBOXED.get_or_init(|| cfg!(target_os = "linux") && Path::new("/.flatpak-info").exists())
}

/// Rewrites a fully configured pty command so it runs on the host. Only the
/// variables Athas set explicitly are forwarded; the sandbox environment
/// (PATH=/app/bin, runtime XDG dirs, ...) must not leak into host processes.
pub fn host_pty_command(command: &CommandBuilder) -> CommandBuilder {
   let mut host = CommandBuilder::new("flatpak-spawn");
   host.args(host_spawn_args(
      command.get_cwd().map(Path::new),
      command.iter_extra_env_as_str(),
   ));
   host.args(command.get_argv());
   if let Some(cwd) = command.get_cwd() {
      host.cwd(cwd);
   }
   host
}

/// Starts `program` on the host with the host session environment.
pub fn host_command(program: &str) -> Command {
   let mut command = Command::new("flatpak-spawn");
   command.args(host_spawn_args(None, std::iter::empty()));
   command.arg(program);
   command
}

/// Whether an absolute host path exists, looking through `/run/host` for the
/// operating system directories the sandbox replaces with the runtime.
pub fn host_path_exists(path: &str) -> bool {
   sandbox_view_of_host_path(path).exists()
}

/// Host directories that usually contain login shells.
pub fn host_shell_dirs() -> Vec<PathBuf> {
   let mut dirs = vec![
      PathBuf::from("/usr/local/bin"),
      PathBuf::from("/usr/bin"),
      PathBuf::from("/bin"),
   ];
   if let Some(home) = dirs::home_dir() {
      dirs.push(home.join(".local/bin"));
      dirs.push(home.join(".cargo/bin"));
      dirs.push(home.join(".nix-profile/bin"));
   }
   dirs.push(PathBuf::from("/run/current-system/sw/bin"));
   dirs.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
   dirs
}

fn sandbox_view_of_host_path(path: &str) -> PathBuf {
   let is_host_os_path = HOST_OS_PREFIXES
      .iter()
      .any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")));
   if is_host_os_path {
      PathBuf::from(format!("{HOST_OS_ROOT}{path}"))
   } else {
      PathBuf::from(path)
   }
}

fn host_spawn_args<'a>(
   cwd: Option<&Path>,
   env: impl Iterator<Item = (&'a str, &'a str)>,
) -> Vec<String> {
   let mut args = vec!["--host".to_string(), "--watch-bus".to_string()];
   if let Some(cwd) = cwd {
      args.push(format!("--directory={}", cwd.display()));
   }
   args.extend(env.map(|(key, value)| format!("--env={key}={value}")));
   args.push("--".to_string());
   args
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::ffi::OsString;

   #[test]
   fn maps_operating_system_paths_through_run_host() {
      assert_eq!(
         sandbox_view_of_host_path("/usr/bin/zsh"),
         PathBuf::from("/run/host/usr/bin/zsh")
      );
      assert_eq!(
         sandbox_view_of_host_path("/bin/bash"),
         PathBuf::from("/run/host/bin/bash")
      );
      assert_eq!(
         sandbox_view_of_host_path("/home/me/.cargo/bin/nu"),
         PathBuf::from("/home/me/.cargo/bin/nu")
      );
      assert_eq!(
         sandbox_view_of_host_path("/usrlocal/zsh"),
         PathBuf::from("/usrlocal/zsh")
      );
   }

   #[test]
   fn forwards_command_cwd_and_explicit_environment_only() {
      let mut command = CommandBuilder::new("/usr/bin/zsh");
      command.arg("-l");
      command.cwd("/home/me/project");
      command.env("TERM", "xterm-256color");

      let host = host_pty_command(&command);
      let argv = host.get_argv();

      assert_eq!(argv[0], OsString::from("flatpak-spawn"));
      assert!(argv.contains(&OsString::from("--host")));
      assert!(argv.contains(&OsString::from("--directory=/home/me/project")));
      assert!(argv.contains(&OsString::from("--env=TERM=xterm-256color")));
      assert!(
         !argv
            .iter()
            .any(|arg| arg.to_string_lossy().starts_with("--env=PATH="))
      );
      let separator = argv.iter().position(|arg| arg == "--").unwrap();
      assert_eq!(
         &argv[separator + 1..],
         &[OsString::from("/usr/bin/zsh"), OsString::from("-l")]
      );
   }
}
