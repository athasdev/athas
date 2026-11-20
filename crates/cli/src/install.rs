//! Installs the `athas` command for the Settings "Shell Command" row: a symlink at
//! `~/.local/bin/athas` to the `athas-cli` binary next to the app (`%USERPROFILE%\.athas\bin\athas.cmd`
//! on Windows), plus one PATH line in the shell's startup file when no file mentions the folder yet.
//!
//! Every function takes the home folder, so tests run against a temporary one.

use std::{
    fs,
    path::{Path, PathBuf},
};

/// The first lines of the launcher scripts the Tauri app wrote; those are replaced on install.
#[cfg(not(target_family = "wasm"))]
const TAURI_LAUNCHER_MARKER: &str = "# Athas CLI launcher";
const CLI_BINARY: &str = if cfg!(windows) { "athas-cli.exe" } else { "athas-cli" };

#[derive(Clone, Debug, PartialEq)]
pub enum CliInstallState {
    NotInstalled,
    /// The command points at this `athas-cli`.
    Installed(PathBuf),
    /// A command from the Tauri app, or a link to an `athas-cli` that no longer exists.
    Outdated,
    /// Something else is installed under that name; Athas leaves it alone.
    Foreign,
}

/// What `install` did about PATH.
#[derive(Clone, Debug, PartialEq)]
pub enum ShellPathSetup {
    AlreadyOnPath,
    Added(PathBuf),
    Manual,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Installed {
    pub command: PathBuf,
    pub path_setup: ShellPathSetup,
}

impl Installed {
    /// The sentence the Settings row shows after installing.
    pub fn message(&self) -> String {
        let bin_dir = self.command.parent().unwrap_or(Path::new("")).display();
        let installed = format!("Installed the athas command at {}.", self.command.display());
        match &self.path_setup {
            ShellPathSetup::AlreadyOnPath => format!("{installed} Open a new terminal and run `athas .` to open a folder."),
            ShellPathSetup::Added(file) => format!(
                "{installed} Added {bin_dir} to your PATH in {}. Open a new terminal and run `athas .` to open a folder.",
                file.display()
            ),
            ShellPathSetup::Manual => format!("{installed} Add {bin_dir} to your PATH to use it from any terminal."),
        }
    }
}

/// The user's home folder.
pub fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

/// Where the command goes.
pub fn command_path(home: &Path) -> PathBuf {
    if cfg!(windows) {
        home.join(".athas").join("bin").join("athas.cmd")
    } else {
        home.join(".local").join("bin").join("athas")
    }
}

/// The `athas-cli` that ships next to the running app binary (`Athas.app/Contents/MacOS/`).
pub fn bundled_cli_binary() -> Option<PathBuf> {
    let exe = dunce::canonicalize(std::env::current_exe().ok()?).ok()?;
    let cli = exe.parent()?.join(CLI_BINARY);
    cli.is_file().then_some(cli)
}

/// macOS runs apps opened straight from Downloads or a disk image from a random read-only path
/// that disappears when the app quits, so a command pointing there would stop working.
pub fn is_translocated(binary: &Path) -> bool {
    binary.components().any(|component| component.as_os_str() == "AppTranslocation")
}

#[cfg(not(target_family = "wasm"))]
fn is_tauri_launcher(path: &Path) -> bool {
    fs::read_to_string(path).is_ok_and(|script| script.lines().take(2).any(|line| line.trim() == TAURI_LAUNCHER_MARKER))
}

#[cfg(unix)]
pub fn state(home: &Path) -> CliInstallState {
    let command = command_path(home);
    let Ok(metadata) = fs::symlink_metadata(&command) else { return CliInstallState::NotInstalled };
    if metadata.file_type().is_symlink() {
        let Ok(target) = fs::read_link(&command) else { return CliInstallState::Foreign };
        if target.file_name().is_none_or(|name| name != CLI_BINARY) {
            return CliInstallState::Foreign;
        }
        return if target.is_file() { CliInstallState::Installed(target) } else { CliInstallState::Outdated };
    }
    if is_tauri_launcher(&command) { CliInstallState::Outdated } else { CliInstallState::Foreign }
}

/// The browser installs no command.
#[cfg(target_family = "wasm")]
pub fn state(_: &Path) -> CliInstallState {
    CliInstallState::NotInstalled
}

#[cfg(windows)]
pub fn state(home: &Path) -> CliInstallState {
    let command = command_path(home);
    let Ok(script) = fs::read_to_string(&command) else { return CliInstallState::NotInstalled };
    if is_tauri_launcher(&command) || script.contains("athas.ps1") {
        return CliInstallState::Outdated;
    }
    match windows_shim_target(&script) {
        Some(target) if target.is_file() => CliInstallState::Installed(target),
        Some(_) => CliInstallState::Outdated,
        None => CliInstallState::Foreign,
    }
}

#[cfg(windows)]
fn windows_shim(cli: &Path) -> String {
    format!("@echo off\r\n\"{}\" %*\r\n", cli.display())
}

#[cfg(windows)]
fn windows_shim_target(script: &str) -> Option<PathBuf> {
    let line = script.lines().find(|line| line.starts_with('"'))?;
    let end = line[1..].find('"')?;
    let target = PathBuf::from(&line[1..=end]);
    (target.file_name()? == CLI_BINARY).then_some(target)
}

/// Installs the command for the signed-in user, pointing at the `athas-cli` next to the app.
pub fn install_for_current_user() -> Result<Installed, String> {
    let home = home_dir().ok_or("Could not find your home folder")?;
    let cli = bundled_cli_binary().ok_or("athas-cli was not found next to the Athas binary")?;
    install(&home, &cli, &ShellEnv::current())
}

pub fn uninstall_for_current_user() -> Result<(), String> {
    uninstall(&home_dir().ok_or("Could not find your home folder")?)
}

pub fn state_for_current_user() -> CliInstallState {
    home_dir().map_or(CliInstallState::NotInstalled, |home| state(&home))
}

/// Installs the command pointing at `cli`. A command Athas did not write is never replaced.
pub fn install(home: &Path, cli: &Path, env: &ShellEnv) -> Result<Installed, String> {
    if is_translocated(cli) {
        return Err("Athas is running from a temporary location. Move Athas to your Applications folder, reopen it, \
                    and install the command again."
            .into());
    }
    if !cli.is_file() {
        return Err(format!("{} does not exist", cli.display()));
    }
    let command = command_path(home);
    if state(home) == CliInstallState::Foreign {
        return Err(format!("{} already exists and was not installed by Athas; remove it first", command.display()));
    }
    let bin_dir = command.parent().ok_or("the command has no folder")?;
    fs::create_dir_all(bin_dir).map_err(|error| format!("Could not create {}: {error}", bin_dir.display()))?;
    match fs::remove_file(&command) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err(format!("Could not replace {}: {error}", command.display()));
        }
        _ => {}
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(cli, &command).map_err(|error| format!("Could not link {}: {error}", command.display()))?;
    #[cfg(windows)]
    fs::write(&command, windows_shim(cli)).map_err(|error| format!("Could not write {}: {error}", command.display()))?;

    let path_setup = ensure_on_shell_path(home, bin_dir, env);
    Ok(Installed { command, path_setup })
}

/// Removes the command if Athas installed it.
pub fn uninstall(home: &Path) -> Result<(), String> {
    let command = command_path(home);
    match state(home) {
        CliInstallState::NotInstalled => Err("The athas command is not installed".into()),
        CliInstallState::Foreign => Err(format!("{} was not installed by Athas; leaving it alone", command.display())),
        CliInstallState::Installed(_) | CliInstallState::Outdated => {
            fs::remove_file(&command).map_err(|error| format!("Could not remove {}: {error}", command.display()))
        }
    }
}

/// The parts of the environment that decide which startup file gets the PATH line.
#[derive(Clone, Debug, Default)]
pub struct ShellEnv {
    pub shell: Option<String>,
    pub zdotdir: Option<PathBuf>,
    pub path: Option<std::ffi::OsString>,
}

impl ShellEnv {
    pub fn current() -> Self {
        Self {
            shell: std::env::var("SHELL").ok().or_else(|| cfg!(target_os = "macos").then(|| "/bin/zsh".to_string())),
            zdotdir: std::env::var_os("ZDOTDIR").map(PathBuf::from),
            path: std::env::var_os("PATH"),
        }
    }
}

const POSIX_PATH_LINE: &str = "export PATH=\"$HOME/.local/bin:$PATH\"";
const FISH_PATH_LINE: &str = "fish_add_path -g \"$HOME/.local/bin\"";

/// The startup files a shell reads, the one Athas appends to, and the line that puts
/// `~/.local/bin` on PATH there. `None` for shells Athas does not know.
fn shell_path_setup(shell: &str, home: &Path, zdotdir: Option<&Path>) -> Option<(Vec<PathBuf>, PathBuf, &'static str)> {
    let name = Path::new(shell).file_name()?.to_str()?;
    match name {
        "zsh" => {
            let dir = zdotdir.unwrap_or(home);
            let files = [".zshenv", ".zprofile", ".zshrc"].map(|file| dir.join(file));
            Some((files.to_vec(), dir.join(".zshrc"), POSIX_PATH_LINE))
        }
        "bash" => {
            let files = [".bashrc", ".bash_profile", ".profile"].map(|file| home.join(file));
            let target = if cfg!(target_os = "macos") { home.join(".bash_profile") } else { home.join(".bashrc") };
            Some((files.to_vec(), target, POSIX_PATH_LINE))
        }
        "fish" => {
            let config = home.join(".config").join("fish");
            let target = config.join("conf.d").join("athas.fish");
            Some((vec![config.join("config.fish"), target.clone()], target, FISH_PATH_LINE))
        }
        _ => None,
    }
}

fn mentions_local_bin(content: &str) -> bool {
    content.lines().map(str::trim).filter(|line| !line.starts_with('#')).any(|line| line.contains(".local/bin"))
}

/// Makes sure new terminals find the command in `bin_dir`, appending one PATH line to the shell's
/// startup file when none of its files mentions the folder yet.
fn ensure_on_shell_path(home: &Path, bin_dir: &Path, env: &ShellEnv) -> ShellPathSetup {
    let on_process_path =
        env.path.as_ref().is_some_and(|path| std::env::split_paths(path).any(|entry| entry == bin_dir));
    if cfg!(windows) {
        return if on_process_path { ShellPathSetup::AlreadyOnPath } else { ShellPathSetup::Manual };
    }
    let Some((files, target, line)) =
        env.shell.as_deref().and_then(|shell| shell_path_setup(shell, home, env.zdotdir.as_deref()))
    else {
        return if on_process_path { ShellPathSetup::AlreadyOnPath } else { ShellPathSetup::Manual };
    };
    let configured =
        files.iter().any(|file| fs::read_to_string(file).is_ok_and(|content| mentions_local_bin(&content)));
    if configured || on_process_path {
        return ShellPathSetup::AlreadyOnPath;
    }
    let existing = fs::read_to_string(&target).unwrap_or_default();
    let separator = if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" };
    let block = format!("{separator}\n# Added by Athas for the `athas` command\n{line}\n");
    let written = target.parent().map_or(Ok(()), fs::create_dir_all).and_then(|_| {
        use std::io::Write;
        fs::OpenOptions::new().create(true).append(true).open(&target)?.write_all(block.as_bytes())
    });
    match written {
        Ok(()) => ShellPathSetup::Added(target),
        Err(_) => ShellPathSetup::Manual,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// No shell and no PATH: installing never looks at the real environment.
    fn no_shell() -> ShellEnv {
        ShellEnv::default()
    }

    fn fake_cli(dir: &Path) -> PathBuf {
        let cli = dir.join("Athas.app/Contents/MacOS/athas-cli");
        fs::create_dir_all(cli.parent().unwrap()).unwrap();
        fs::write(&cli, "#!/bin/sh\n").unwrap();
        cli
    }

    #[test]
    fn installs_and_uninstalls_a_link_in_a_temporary_home() {
        let home = tempfile::tempdir().unwrap();
        let cli = fake_cli(home.path());
        assert_eq!(state(home.path()), CliInstallState::NotInstalled);

        let installed = install(home.path(), &cli, &no_shell()).unwrap();
        assert_eq!(installed.command, home.path().join(".local/bin/athas"));
        assert_eq!(fs::read_link(&installed.command).unwrap(), cli);
        assert_eq!(state(home.path()), CliInstallState::Installed(cli.clone()));
        assert!(installed.message().contains("athas command"));

        // Installing again replaces the link.
        install(home.path(), &cli, &no_shell()).unwrap();
        uninstall(home.path()).unwrap();
        assert_eq!(state(home.path()), CliInstallState::NotInstalled);
        assert!(uninstall(home.path()).is_err());
    }

    #[test]
    fn replaces_tauri_launchers_and_dangling_links_but_not_other_commands() {
        let home = tempfile::tempdir().unwrap();
        let cli = fake_cli(home.path());
        let command = command_path(home.path());
        fs::create_dir_all(command.parent().unwrap()).unwrap();

        fs::write(&command, "#!/usr/bin/env bash\n# Athas CLI launcher\nathas_binary='/x'\n").unwrap();
        assert_eq!(state(home.path()), CliInstallState::Outdated);
        install(home.path(), &cli, &no_shell()).unwrap();

        fs::remove_file(&command).unwrap();
        std::os::unix::fs::symlink(home.path().join("gone/athas-cli"), &command).unwrap();
        assert_eq!(state(home.path()), CliInstallState::Outdated);
        install(home.path(), &cli, &no_shell()).unwrap();

        fs::remove_file(&command).unwrap();
        fs::write(&command, "#!/bin/sh\nexec my-editor \"$@\"\n").unwrap();
        assert_eq!(state(home.path()), CliInstallState::Foreign);
        assert!(install(home.path(), &cli, &no_shell()).is_err());
        assert!(uninstall(home.path()).is_err());
        assert!(command.exists());
    }

    #[test]
    fn refuses_translocated_apps() {
        let home = tempfile::tempdir().unwrap();
        let cli = Path::new("/private/var/folders/x/AppTranslocation/1/d/Athas.app/Contents/MacOS/athas-cli");
        assert!(install(home.path(), cli, &no_shell()).unwrap_err().contains("temporary location"));
    }

    #[test]
    fn adds_one_path_line_to_the_shell_startup_file() {
        let home = tempfile::tempdir().unwrap();
        let bin_dir = home.path().join(".local/bin");
        let env = ShellEnv { shell: Some("/bin/zsh".into()), zdotdir: None, path: Some("/usr/bin".into()) };
        let zshrc = home.path().join(".zshrc");
        fs::write(&zshrc, "alias g=git").unwrap();

        assert_eq!(ensure_on_shell_path(home.path(), &bin_dir, &env), ShellPathSetup::Added(zshrc.clone()));
        assert_eq!(ensure_on_shell_path(home.path(), &bin_dir, &env), ShellPathSetup::AlreadyOnPath);
        let content = fs::read_to_string(&zshrc).unwrap();
        assert!(content.starts_with("alias g=git\n\n# Added by Athas"));
        assert_eq!(content.matches(POSIX_PATH_LINE).count(), 1);

        let on_path = ShellEnv { path: Some(bin_dir.clone().into_os_string()), ..env.clone() };
        let fresh = tempfile::tempdir().unwrap();
        assert_eq!(ensure_on_shell_path(fresh.path(), &bin_dir, &on_path), ShellPathSetup::AlreadyOnPath);
        let unknown = ShellEnv { shell: Some("/usr/bin/nu".into()), ..env };
        assert_eq!(ensure_on_shell_path(fresh.path(), &bin_dir, &unknown), ShellPathSetup::Manual);
    }

    #[test]
    fn picks_the_startup_file_for_each_shell() {
        let home = Path::new("/home/me");
        let (files, target, line) = shell_path_setup("/bin/zsh", home, None).unwrap();
        assert_eq!(target, home.join(".zshrc"));
        assert!(files.contains(&home.join(".zprofile")));
        assert_eq!(line, POSIX_PATH_LINE);
        let zdotdir = Path::new("/home/me/.config/zsh");
        assert_eq!(shell_path_setup("/bin/zsh", home, Some(zdotdir)).unwrap().1, zdotdir.join(".zshrc"));
        let (_, target, line) = shell_path_setup("/usr/local/bin/fish", home, None).unwrap();
        assert_eq!(target, home.join(".config/fish/conf.d/athas.fish"));
        assert_eq!(line, FISH_PATH_LINE);
        assert!(shell_path_setup("/usr/bin/nu", home, None).is_none());
    }

    #[test]
    fn ignores_commented_out_path_lines() {
        assert!(mentions_local_bin("export PATH=\"$HOME/.local/bin:$PATH\"\n"));
        assert!(mentions_local_bin("  path+=(~/.local/bin)\n"));
        assert!(!mentions_local_bin("# export PATH=\"$HOME/.local/bin:$PATH\"\n"));
        assert!(!mentions_local_bin("export PATH=\"$HOME/bin:$PATH\"\n"));
    }
}
