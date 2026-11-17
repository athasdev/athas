//! Terminals inside a Flatpak sandbox would only see its runtime, not the user's shells and
//! toolchains (`crates/terminal/src/flatpak.rs`). There, shells start on the host through
//! `flatpak-spawn --host`, with the PTY as their stdio, so they still get a real terminal.

use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

use crate::shell::ShellCommand;

/// Host directories the sandbox reads only through `--filesystem=host-os`.
const HOST_OS_PREFIXES: &[&str] = &["/usr", "/bin", "/sbin", "/lib", "/lib64"];
const HOST_OS_ROOT: &str = "/run/host";

pub(crate) fn is_sandboxed() -> bool {
    static SANDBOXED: OnceLock<bool> = OnceLock::new();
    *SANDBOXED.get_or_init(|| cfg!(target_os = "linux") && Path::new("/.flatpak-info").exists())
}

/// The command run on the host. Only the variables Athas set are forwarded; the sandbox's own
/// (`PATH=/app/bin`, runtime XDG folders) must not reach host processes.
pub(crate) fn on_host(command: &ShellCommand) -> ShellCommand {
    let mut args = vec!["--host".to_string(), "--watch-bus".to_string(), format!("--directory={}", command.cwd.display())];
    args.extend(command.env.iter().map(|(key, value)| format!("--env={key}={value}")));
    args.push("--".into());
    args.push(command.program.clone());
    args.extend(command.args.iter().cloned());
    ShellCommand { program: "flatpak-spawn".into(), args, cwd: command.cwd.clone(), env: Vec::new(), env_remove: Vec::new() }
}

/// Whether a host path exists, looking through `/run/host` for the system folders the sandbox
/// replaces with its runtime.
pub(crate) fn host_path_exists(path: &str) -> bool {
    sandbox_view_of_host_path(path).exists()
}

/// Host folders that usually hold login shells, searched instead of the sandbox's `PATH`.
pub(crate) fn host_shell_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from("/usr/local/bin"), PathBuf::from("/usr/bin"), PathBuf::from("/bin")];
    if let Some(home) = dirs::home_dir() {
        dirs.extend([".local/bin", ".cargo/bin", ".nix-profile/bin"].map(|dir| home.join(dir)));
    }
    dirs.push(PathBuf::from("/run/current-system/sw/bin"));
    dirs.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
    dirs
}

/// The first of `dirs` holding `exe` on the host.
pub(crate) fn find_host_shell(exe: &str, dirs: &[PathBuf]) -> Option<String> {
    dirs.iter().map(|dir| dir.join(exe).to_string_lossy().into_owned()).find(|path| host_path_exists(path))
}

fn sandbox_view_of_host_path(path: &str) -> PathBuf {
    let system = HOST_OS_PREFIXES.iter().any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")));
    if system { PathBuf::from(format!("{HOST_OS_ROOT}{path}")) } else { PathBuf::from(path) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_system_paths_through_run_host() {
        assert_eq!(sandbox_view_of_host_path("/usr/bin/zsh"), PathBuf::from("/run/host/usr/bin/zsh"));
        assert_eq!(sandbox_view_of_host_path("/bin/bash"), PathBuf::from("/run/host/bin/bash"));
        assert_eq!(sandbox_view_of_host_path("/home/me/.cargo/bin/nu"), PathBuf::from("/home/me/.cargo/bin/nu"));
        assert_eq!(sandbox_view_of_host_path("/usrlocal/zsh"), PathBuf::from("/usrlocal/zsh"));
    }

    #[test]
    fn finds_host_shells_in_the_given_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("fish"), "").unwrap();
        let dirs = [dir.path().join("missing"), dir.path().to_path_buf()];
        assert_eq!(find_host_shell("fish", &dirs), Some(dir.path().join("fish").to_string_lossy().into_owned()));
        assert_eq!(find_host_shell("nu", &dirs), None);
        assert!(host_shell_dirs().contains(&PathBuf::from("/usr/bin")));
    }

    #[test]
    fn forwards_the_directory_and_only_explicit_variables() {
        let command = ShellCommand {
            program: "/usr/bin/zsh".into(),
            args: vec!["-l".into()],
            cwd: PathBuf::from("/home/me/project"),
            env: vec![("TERM".into(), "xterm-256color".into())],
            env_remove: vec!["TMUX".into()],
        };
        let host = on_host(&command);
        assert_eq!(host.program, "flatpak-spawn");
        assert!(host.args.contains(&"--host".to_string()));
        assert!(host.args.contains(&"--directory=/home/me/project".to_string()));
        assert!(host.args.contains(&"--env=TERM=xterm-256color".to_string()));
        assert!(!host.args.iter().any(|arg| arg.starts_with("--env=PATH=")));
        let separator = host.args.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(&host.args[separator + 1..], ["/usr/bin/zsh", "-l"]);
        assert!(host.env.is_empty());
    }
}
