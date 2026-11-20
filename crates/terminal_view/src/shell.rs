//! Which shell a terminal starts, in which folder, with which environment, and the shell
//! integration scripts that report the working directory (OSC 7) and command marks (OSC 133).
//! Ported from Athas's `crates/terminal` (`connection.rs`, `shell.rs`, `shell_integration.rs`).

use std::{
    fs, io,
    path::{Path, PathBuf},
};

/// A program to run on a terminal's PTY.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ShellCommand {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub env_remove: Vec<String>,
}

impl ShellCommand {
    pub(crate) fn set_env(&mut self, key: &str, value: impl Into<String>) {
        self.env.retain(|(existing, _)| existing != key);
        self.env.push((key.to_string(), value.into()));
    }

    #[cfg(test)]
    fn env(&self, key: &str) -> Option<&str> {
        self.env.iter().find(|(existing, _)| existing == key).map(|(_, value)| value.as_str())
    }

    /// The shell's name for a tab: `zsh` for `/bin/zsh`.
    pub fn name(&self) -> String {
        executable_name(&self.program)
    }
}

/// Bump when an embedded script changes so installed copies are rewritten.
const SHELL_INTEGRATION_VERSION: &str = "2";

const SCRIPTS: &[(&str, &str)] = &[
    ("zsh/.zshenv", include_str!("../shell-integration/zsh/zshenv")),
    ("zsh/.zprofile", include_str!("../shell-integration/zsh/zprofile")),
    ("zsh/.zshrc", include_str!("../shell-integration/zsh/zshrc")),
    ("zsh/.zlogin", include_str!("../shell-integration/zsh/zlogin")),
    ("zsh/athas-shell-integration.zsh", include_str!("../shell-integration/zsh/athas-shell-integration.zsh")),
    ("bash/athas-shell-integration.bash", include_str!("../shell-integration/bash/athas-shell-integration.bash")),
    (
        "fish/fish/vendor_conf.d/athas-shell-integration.fish",
        include_str!("../shell-integration/fish/fish/vendor_conf.d/athas-shell-integration.fish"),
    ),
    ("powershell/athas-shell-integration.ps1", include_str!("../shell-integration/powershell/athas-shell-integration.ps1")),
];

/// `program` in the user's home folder with the terminal's environment, instead of their shell
/// (`wsl.exe --distribution …` for a WSL project).
pub(crate) fn program_command(program: String, args: Vec<String>) -> ShellCommand {
    let cwd = home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let mut command = ShellCommand { program, args, cwd, ..Default::default() };
    command.set_env("TERM", "xterm-256color");
    command.set_env("COLORTERM", "truecolor");
    command.set_env("TERM_PROGRAM", "athas");
    command
}

/// `program` (the user's login shell when `None`) in `cwd`, with the shell integration scripts
/// when `integration` is on (`terminalShellIntegration`).
pub(crate) fn shell_command(program: Option<String>, cwd: Option<&Path>, integration: bool) -> ShellCommand {
    let home = home_dir();
    let cwd = cwd
        .filter(|path| path.is_dir())
        .map(Path::to_path_buf)
        .or_else(|| home.clone())
        .unwrap_or_else(|| PathBuf::from("/"));
    let program = program.unwrap_or_else(default_shell);
    let mut command = ShellCommand { program, cwd, ..Default::default() };

    command.set_env("TERM", "xterm-256color");
    command.set_env("COLORTERM", "truecolor");
    command.set_env("TERM_PROGRAM", "athas");
    command.set_env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    command.set_env("CLICOLOR", "1");
    command.set_env("SHELL", command.program.clone());
    // Apps started from Finder have no locale; without one shells mangle non-ASCII input.
    if std::env::var_os("LANG").is_none() {
        command.set_env("LANG", "en_US.UTF-8");
    }
    command.env_remove = inherited_terminal_markers(std::env::vars().map(|(key, _)| key));
    command.env_remove.extend(["NO_COLOR", "FORCE_COLOR", "CLICOLOR_FORCE"].map(String::from));

    let integration = integration.then(integration_base_dir).flatten().and_then(|base| ensure_shell_integration_dir(&base).ok());
    let integrated = integration.as_deref().is_some_and(|dir| apply_shell_integration(&mut command, dir));
    if !integrated {
        command.args.extend(login_args(&command.name()));
    }
    command
}

/// The shell to start: `$SHELL`, then the first of zsh, bash and sh that exists.
fn default_shell() -> String {
    if cfg!(windows) {
        return std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    }
    #[cfg(not(target_family = "wasm"))]
    let exists = |shell: &str| if crate::flatpak::is_sandboxed() { crate::flatpak::host_path_exists(shell) } else { Path::new(shell).exists() };
    #[cfg(target_family = "wasm")]
    let exists = |shell: &str| Path::new(shell).exists();
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty() && exists(shell))
        .or_else(|| ["/bin/zsh", "/bin/bash", "/usr/bin/zsh", "/usr/bin/bash"].into_iter().find(|shell| exists(shell)).map(String::from))
        .unwrap_or_else(|| "/bin/sh".into())
}

/// Shells start as login shells, as Terminal.app starts them, so the profile sets `PATH` even
/// when Athas was opened from Finder with the minimal launchd environment.
fn login_args(shell: &str) -> Vec<String> {
    match shell {
        "zsh" | "bash" | "fish" | "sh" | "ksh" | "dash" | "nu" => vec!["-l".into()],
        "pwsh" | "powershell" => vec!["-NoLogo".into()],
        _ => Vec::new(),
    }
}

/// Variables another terminal set for its own shells, which would confuse programs here.
fn inherited_terminal_markers(keys: impl Iterator<Item = String>) -> Vec<String> {
    const EXACT: &[&str] = &["WT_SESSION", "TERM_SESSION_ID", "VTE_VERSION", "TMUX", "TMUX_PANE"];
    const PREFIXES: &[&str] = &["KITTY_", "GHOSTTY_", "WEZTERM_", "ITERM_"];
    keys.filter(|key| {
        let upper = key.to_ascii_uppercase();
        EXACT.contains(&upper.as_str()) || PREFIXES.iter().any(|prefix| upper.starts_with(prefix))
    })
    .collect()
}

#[cfg(not(target_family = "wasm"))]
fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

#[cfg(target_family = "wasm")]
fn home_dir() -> Option<PathBuf> {
    None
}

#[cfg(not(target_family = "wasm"))]
fn integration_base_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("shell-integration"))
}

#[cfg(target_family = "wasm")]
fn integration_base_dir() -> Option<PathBuf> {
    None
}

/// Writes the embedded scripts under `base_dir` and returns the versioned folder shells load
/// them from. Copies that already match are left alone.
pub(crate) fn ensure_shell_integration_dir(base_dir: &Path) -> io::Result<PathBuf> {
    let dir = base_dir.join(SHELL_INTEGRATION_VERSION);
    for (relative_path, contents) in SCRIPTS {
        let path = dir.join(relative_path);
        if fs::read_to_string(&path).is_ok_and(|existing| existing == *contents) {
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, contents)?;
    }
    Ok(dir)
}

/// Points the shell at the integration scripts. Returns false (leaving the command alone) for
/// shells without a script.
fn apply_shell_integration(command: &mut ShellCommand, integration_dir: &Path) -> bool {
    let lookup = |key: &str| std::env::var(key).ok().filter(|value| !value.is_empty());
    let applied = match command.name().as_str() {
        "zsh" if !cfg!(windows) => {
            let zsh_dir = integration_dir.join("zsh");
            if !zsh_dir.join(".zshrc").is_file() {
                return false;
            }
            if let Some(user_zdotdir) = lookup("ZDOTDIR").or_else(|| lookup("HOME")) {
                command.set_env("ATHAS_USER_ZDOTDIR", user_zdotdir);
            }
            command.set_env("ZDOTDIR", zsh_dir.to_string_lossy());
            command.args.push("-l".into());
            true
        }
        "bash" => {
            let script = integration_dir.join("bash").join("athas-shell-integration.bash");
            if !script.is_file() {
                return false;
            }
            // A login shell ignores --init-file, so the script reads the login profile itself.
            command.args.extend(["--init-file".into(), script.to_string_lossy().into_owned()]);
            command.set_env("ATHAS_SHELL_LOGIN", "1");
            true
        }
        "fish" if !cfg!(windows) => {
            let data_dir = integration_dir.join("fish");
            if !data_dir.join("fish").join("vendor_conf.d").is_dir() {
                return false;
            }
            let existing = lookup("XDG_DATA_DIRS").unwrap_or_else(|| "/usr/local/share:/usr/share".into());
            command.set_env("XDG_DATA_DIRS", format!("{}:{existing}", data_dir.display()));
            command.args.push("-l".into());
            true
        }
        "pwsh" | "powershell" => {
            let script = integration_dir.join("powershell").join("athas-shell-integration.ps1");
            if !script.is_file() {
                return false;
            }
            command.args.extend([
                "-NoLogo".into(),
                "-NoExit".into(),
                "-Command".into(),
                format!(". '{}'", script.to_string_lossy().replace('\'', "''")),
            ]);
            true
        }
        _ => false,
    };
    if applied {
        command.set_env("ATHAS_SHELL_INTEGRATION", "1");
    }
    applied
}

/// The name a tab shows for a terminal of `program` (the login shell when `None`).
pub(crate) fn launch_name(program: Option<&str>) -> String {
    executable_name(&program.map(str::to_string).unwrap_or_else(default_shell))
}

fn executable_name(path: &str) -> String {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let name = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name);
    name.to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn install_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("athas-gpui-shell-integration-{name}-{}", std::process::id()));
        ensure_shell_integration_dir(&base).unwrap()
    }

    fn command(program: &str) -> ShellCommand {
        ShellCommand { program: program.into(), ..Default::default() }
    }

    #[test]
    fn installs_every_script_and_refreshes_changed_copies() {
        let dir = install_dir("refresh");
        let zshrc = dir.join("zsh").join(".zshrc");
        assert!(zshrc.is_file());
        assert!(dir.join("bash").join("athas-shell-integration.bash").is_file());
        assert!(dir.join("fish/fish/vendor_conf.d/athas-shell-integration.fish").is_file());

        fs::write(&zshrc, "stale").unwrap();
        assert_eq!(ensure_shell_integration_dir(dir.parent().unwrap()).unwrap(), dir);
        assert!(fs::read_to_string(&zshrc).unwrap().contains("athas-shell-integration.zsh"));
        fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[cfg(unix)]
    #[test]
    fn zsh_starts_as_a_login_shell_through_the_integration_zdotdir() {
        let dir = install_dir("zsh");
        let mut zsh = command("/bin/zsh");
        assert!(apply_shell_integration(&mut zsh, &dir));
        assert_eq!(zsh.args, vec!["-l".to_string()]);
        assert_eq!(zsh.env("ZDOTDIR"), Some(dir.join("zsh").to_string_lossy().as_ref()));
        assert!(zsh.env("ATHAS_USER_ZDOTDIR").is_some());
        assert_eq!(zsh.env("ATHAS_SHELL_INTEGRATION"), Some("1"));
    }

    #[test]
    fn bash_loads_the_integration_as_its_init_file() {
        let dir = install_dir("bash");
        let mut bash = command("/usr/local/bin/bash");
        assert!(apply_shell_integration(&mut bash, &dir));
        let script = dir.join("bash").join("athas-shell-integration.bash");
        assert_eq!(bash.args, vec!["--init-file".to_string(), script.to_string_lossy().into_owned()]);
        assert_eq!(bash.env("ATHAS_SHELL_LOGIN"), Some("1"));
    }

    #[test]
    fn unknown_shells_keep_their_arguments() {
        let dir = install_dir("unknown");
        let mut nu = command("/usr/bin/nu");
        assert!(!apply_shell_integration(&mut nu, &dir));
        assert!(nu.args.is_empty());
        assert_eq!(nu.env("ATHAS_SHELL_INTEGRATION"), None);
        assert_eq!(login_args("nu"), vec!["-l".to_string()]);
        assert!(!apply_shell_integration(&mut command("/bin/zsh"), &dir.join("missing")));
    }

    #[test]
    fn default_command_sets_the_terminal_environment() {
        let missing = Path::new("/definitely/not/a/folder");
        let command = shell_command(None, Some(missing), false);
        assert_ne!(command.cwd, missing);
        assert_eq!(command.env("TERM"), Some("xterm-256color"));
        assert_eq!(command.env("COLORTERM"), Some("truecolor"));
        assert_eq!(command.env("TERM_PROGRAM"), Some("athas"));
        assert!(command.env_remove.iter().any(|key| key == "NO_COLOR"));
    }

    #[test]
    fn strips_other_terminals_markers() {
        let keys = ["PATH", "TERM_SESSION_ID", "ITERM_PROFILE", "kitty_window_id", "TMUX"].map(String::from);
        assert_eq!(
            inherited_terminal_markers(keys.into_iter()),
            vec!["TERM_SESSION_ID", "ITERM_PROFILE", "kitty_window_id", "TMUX"]
        );
    }

    #[test]
    fn executable_names() {
        assert_eq!(executable_name("/opt/homebrew/bin/fish"), "fish");
        assert_eq!(executable_name(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"), "powershell");
    }
}
