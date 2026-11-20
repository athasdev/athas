//! Terminal profiles: the default terminal, one per installed shell, and the user's own, as
//! Athas's `terminal-profiles.ts` and `crates/terminal/src/shell.rs` list them.

use std::path::{Path, PathBuf};

use serde::Deserialize;

pub(crate) const SYSTEM_DEFAULT_PROFILE_ID: &str = "system-default";
const DEFAULT_SHELL_OPTION_VALUE: &str = "system";
const DEFAULT_PROFILE_LABEL: &str = "Default Terminal";

/// A shell installed on this machine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shell {
    pub id: String,
    pub name: String,
    pub executable: String,
}

/// A way to start a terminal (`TerminalProfile`). The user's own profiles are read from the
/// `terminalProfiles` setting.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalProfile {
    pub id: String,
    pub name: String,
    pub shell: Option<String>,
    pub startup_directory: Option<String>,
    pub env: Option<std::collections::BTreeMap<String, String>>,
    pub startup_commands: Option<Vec<String>>,
}

/// What a new terminal runs (`resolveTerminalLaunch`).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ResolvedLaunch {
    /// The shell's executable; the login shell when `None`.
    pub program: Option<String>,
    /// Arguments for `program`, such as `wsl.exe`'s distribution and folder.
    pub args: Vec<String>,
    pub working_directory: Option<PathBuf>,
    pub initial_command: Option<String>,
    pub env: Vec<(String, String)>,
    pub name: String,
    pub profile_id: Option<String>,
}

/// The shells Athas knows, where they are installed.
pub fn available_shells() -> Vec<Shell> {
    let candidates: &[(&str, &str, &str)] = if cfg!(windows) {
        &[
            ("cmd", "Command Prompt", "cmd.exe"),
            ("powershell", "Windows PowerShell", "powershell.exe"),
            ("pwsh", "PowerShell Core", "pwsh.exe"),
            ("nu", "Nushell", "nu.exe"),
            ("wsl", "WSL Default", "wsl.exe"),
            ("bash", "Git Bash", "bash.exe"),
        ]
    } else {
        &[("bash", "Bash", "bash"), ("nu", "Nushell", "nu"), ("zsh", "Zsh", "zsh"), ("fish", "Fish", "fish")]
    };
    #[cfg(not(target_family = "wasm"))]
    if crate::flatpak::is_sandboxed() {
        let dirs = crate::flatpak::host_shell_dirs();
        return candidates
            .iter()
            .filter_map(|(id, name, exe)| {
                let executable = crate::flatpak::find_host_shell(exe, &dirs)?;
                Some(Shell { id: id.to_string(), name: name.to_string(), executable })
            })
            .collect();
    }
    let path = std::env::var_os("PATH");
    #[cfg_attr(target_family = "wasm", allow(unused_mut))]
    let mut shells: Vec<Shell> = candidates
        .iter()
        .filter_map(|(id, name, exe)| {
            let found = path.as_ref().and_then(|paths| std::env::split_paths(paths).map(|dir| dir.join(exe)).find(|candidate| candidate.is_file()))?;
            Some(Shell { id: id.to_string(), name: name.to_string(), executable: found.to_string_lossy().into_owned() })
        })
        .collect();
    #[cfg(not(target_family = "wasm"))]
    if cfg!(windows)
        && let Some(wsl) = shells.iter().find(|shell| shell.id == "wsl").map(|shell| shell.executable.clone())
        && let Ok(distributions) = athas_wsl::list_distributions()
    {
        shells.extend(distribution_shells(&wsl, distributions.into_iter().map(|distribution| distribution.name)));
    }
    shells
}

/// A `WSL: <name>` shell per installed distribution, started through `wsl_executable`.
#[cfg(not(target_family = "wasm"))]
fn distribution_shells(wsl_executable: &str, distributions: impl Iterator<Item = String>) -> Vec<Shell> {
    distributions
        .map(|name| Shell { id: athas_wsl::wsl_shell_id(&name), name: format!("WSL: {name}"), executable: wsl_executable.to_string() })
        .collect()
}

/// Whether a shell runs through `wsl.exe`: the default WSL shell, a distribution's, or a custom
/// program named `wsl.exe`.
#[cfg(not(target_family = "wasm"))]
fn is_wsl_shell(shell_id: Option<&str>, program: Option<&str>) -> bool {
    shell_id.is_some_and(|id| id.eq_ignore_ascii_case("wsl") || athas_wsl::parse_wsl_shell_id(id).is_some())
        || program.and_then(|program| program.rsplit(['/', '\\']).next()).is_some_and(|name| name.eq_ignore_ascii_case("wsl.exe"))
}

/// `wsl.exe`'s arguments for a terminal (`wsl_startup_args`): the shell's distribution, or the
/// one a `wsl://` folder names, and the folder inside it to start in; a Windows folder is
/// reached through `/mnt/<drive>`.
#[cfg(not(target_family = "wasm"))]
fn wsl_startup_args(shell_id: Option<&str>, working_directory: Option<&Path>) -> Vec<String> {
    let mut distribution = shell_id.and_then(athas_wsl::parse_wsl_shell_id).map(str::to_string);
    let mut linux_directory = None;
    if let Some(directory) = working_directory.and_then(Path::to_str) {
        if athas_wsl::is_wsl_path(directory) {
            if let Ok(parsed) = athas_wsl::parse_wsl_uri(directory) {
                distribution = Some(parsed.distro);
                linux_directory = Some(parsed.linux_path);
            }
        } else {
            linux_directory = athas_wsl::windows_path_to_wsl_path(directory);
        }
    }
    let mut args = Vec::new();
    if let Some(distribution) = distribution.filter(|value| !value.trim().is_empty()) {
        args.extend(["--distribution".to_string(), distribution]);
    }
    if let Some(directory) = linux_directory.filter(|value| !value.trim().is_empty()) {
        args.extend(["--cd".to_string(), directory]);
    }
    args
}

/// The user's own profiles from the `terminalProfiles` setting.
pub(crate) fn custom_profiles(settings: &settings::Settings) -> Vec<TerminalProfile> {
    settings
        .extra
        .get("terminalProfiles")
        .and_then(|value| Vec::<TerminalProfile>::deserialize(value).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|profile| !profile.id.is_empty())
        .collect()
}

/// `getAllTerminalProfiles`: the default terminal, a profile per shell, then the user's own.
pub fn all_profiles(shells: &[Shell], custom: &[TerminalProfile]) -> Vec<TerminalProfile> {
    let mut profiles = vec![TerminalProfile { id: SYSTEM_DEFAULT_PROFILE_ID.into(), name: DEFAULT_PROFILE_LABEL.into(), ..Default::default() }];
    profiles.extend(shells.iter().map(|shell| TerminalProfile {
        id: format!("shell:{}", shell.id),
        name: shell.name.clone(),
        shell: Some(shell.id.clone()),
        ..Default::default()
    }));
    profiles.extend(custom.iter().cloned());
    profiles
}

/// `resolveTerminalLaunch`: the explicit profile, else the default profile setting, else the
/// default terminal with the default shell setting.
pub(crate) fn resolve_launch(
    current_directory: Option<&Path>,
    explicit_profile: Option<&str>,
    default_profile: &str,
    default_shell: &str,
    shells: &[Shell],
    custom: &[TerminalProfile],
) -> ResolvedLaunch {
    let profile_id = explicit_profile.filter(|id| !id.is_empty()).or((!default_profile.is_empty()).then_some(default_profile)).unwrap_or(SYSTEM_DEFAULT_PROFILE_ID);
    let profiles = all_profiles(shells, custom);
    let profile = profiles.iter().find(|profile| profile.id == profile_id);
    let fallback_shell = (!default_shell.is_empty() && default_shell != DEFAULT_SHELL_OPTION_VALUE).then_some(default_shell);
    let shell_id = profile.and_then(|profile| profile.shell.as_deref()).or(fallback_shell);
    let program = shell_id.map(|id| shells.iter().find(|shell| shell.id == id).map(|shell| shell.executable.clone()).unwrap_or_else(|| id.to_string()));
    let initial_command = profile
        .and_then(|profile| profile.startup_commands.as_ref())
        .map(|commands| commands.iter().filter(|command| !command.is_empty()).cloned().collect::<Vec<_>>().join("\n"))
        .filter(|command| !command.is_empty());
    let working_directory = profile
        .and_then(|profile| profile.startup_directory.as_deref())
        .map(str::trim)
        .filter(|directory| !directory.is_empty())
        .map(PathBuf::from)
        .or_else(|| current_directory.map(Path::to_path_buf));
    let env = profile
        .and_then(|profile| profile.env.as_ref())
        .map(|env| env.iter().map(|(key, value)| (key.clone(), value.clone())).collect())
        .unwrap_or_default();
    #[cfg(not(target_family = "wasm"))]
    let args = if is_wsl_shell(shell_id, program.as_deref()) { wsl_startup_args(shell_id, working_directory.as_deref()) } else { Vec::new() };
    #[cfg(target_family = "wasm")]
    let args = Vec::new();
    ResolvedLaunch {
        program,
        args,
        working_directory,
        initial_command,
        env,
        name: profile.map(|profile| profile.name.clone()).unwrap_or_else(|| DEFAULT_PROFILE_LABEL.into()),
        profile_id: profile.map(|profile| profile.id.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shells() -> Vec<Shell> {
        vec![Shell { id: "fish".into(), name: "Fish".into(), executable: "/opt/fish".into() }]
    }

    #[cfg(not(target_family = "wasm"))]
    #[test]
    fn starts_wsl_shells_in_their_distribution() {
        let wsl = r"C:\Windows\System32\wsl.exe";
        let mut shells = vec![Shell { id: "wsl".into(), name: "WSL Default".into(), executable: wsl.into() }];
        shells.extend(distribution_shells(wsl, ["Ubuntu".to_string(), "Debian".to_string()].into_iter()));
        assert_eq!(shells[1], Shell { id: "wsl:Ubuntu".into(), name: "WSL: Ubuntu".into(), executable: wsl.into() });
        let profiles = all_profiles(&shells, &[]);
        assert!(profiles.iter().any(|profile| profile.id == "shell:wsl:Debian" && profile.name == "WSL: Debian"));

        let launch = resolve_launch(Some(Path::new("wsl://Debian/home/me/app")), Some("shell:wsl:Ubuntu"), "", "", &shells, &[]);
        assert_eq!(launch.program.as_deref(), Some(wsl));
        assert_eq!(launch.args, ["--distribution", "Debian", "--cd", "/home/me/app"]);
        let launch = resolve_launch(Some(Path::new(r"C:\code\app")), Some("shell:wsl:Ubuntu"), "", "", &shells, &[]);
        assert_eq!(launch.args, ["--distribution", "Ubuntu", "--cd", "/mnt/c/code/app"]);
        let launch = resolve_launch(None, Some("shell:wsl"), "", "", &shells, &[]);
        assert!(launch.args.is_empty());
        let launch = resolve_launch(Some(Path::new("/srv")), None, "", "fish", &self::shells(), &[]);
        assert!(launch.args.is_empty());
        assert!(is_wsl_shell(None, Some(r"D:\tools\WSL.EXE")));
        assert!(!is_wsl_shell(Some("bash"), Some("/bin/bash")));
    }

    #[test]
    fn resolves_profiles() {
        let custom = vec![TerminalProfile {
            id: "profile_1".into(),
            name: "Dev".into(),
            shell: Some("fish".into()),
            startup_directory: Some(" /srv ".into()),
            startup_commands: Some(vec!["npm i".into(), "".into(), "npm run dev".into()]),
            ..Default::default()
        }];
        let cwd = Path::new("/repo");
        let launch = resolve_launch(Some(cwd), Some("profile_1"), "", "", &shells(), &custom);
        assert_eq!(launch.program.as_deref(), Some("/opt/fish"));
        assert_eq!(launch.working_directory.as_deref(), Some(Path::new("/srv")));
        assert_eq!(launch.initial_command.as_deref(), Some("npm i\nnpm run dev"));
        assert_eq!(launch.name, "Dev");

        let launch = resolve_launch(Some(cwd), None, "", "fish", &shells(), &custom);
        assert_eq!(launch.program.as_deref(), Some("/opt/fish"));
        assert_eq!(launch.profile_id.as_deref(), Some(SYSTEM_DEFAULT_PROFILE_ID));
        assert_eq!(launch.working_directory.as_deref(), Some(cwd));

        let launch = resolve_launch(Some(cwd), None, "", "system", &shells(), &custom);
        assert_eq!(launch.program, None);
        assert_eq!(all_profiles(&shells(), &custom).iter().map(|profile| profile.id.as_str()).collect::<Vec<_>>(), vec![
            SYSTEM_DEFAULT_PROFILE_ID,
            "shell:fish",
            "profile_1"
        ]);
    }
}
