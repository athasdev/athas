//! Which program runs a session's agent: one this app installed (`agent_registry`, under
//! `dev.athas.gpui/agents/`), one the Tauri app installed under its data directory
//! (`tools/acp/<id>`, a launcher script), or the agent's program on `PATH`.
//!
//! Ported from `crates/ai/src/acp/config.rs` and the agent manifests in
//! `extensions/official/*/extension.json`.

#[cfg(not(target_family = "wasm"))]
use std::path::Path;
use std::path::PathBuf;

/// An agent Athas knows how to launch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KnownAgent {
    /// The id Athas's agent catalog uses, and the launcher's file name.
    pub id: &'static str,
    pub name: &'static str,
    /// The program's name on `PATH`.
    pub binary: &'static str,
    /// Arguments that put the program into ACP mode.
    pub args: &'static [&'static str],
    /// How to install it, for the "not installed" state.
    pub install_hint: &'static str,
}

pub const KNOWN_AGENTS: &[KnownAgent] = &[
    KnownAgent {
        id: "claude-acp",
        name: "Claude Agent",
        binary: "claude-agent-acp",
        args: &[],
        install_hint: "npm install -g @agentclientprotocol/claude-agent-acp",
    },
    KnownAgent {
        id: "gemini-cli",
        name: "Gemini CLI",
        binary: "gemini",
        args: &["--acp"],
        install_hint: "npm install -g @google/gemini-cli",
    },
    KnownAgent {
        id: "github-copilot-cli",
        name: "GitHub Copilot",
        binary: "copilot",
        args: &["--acp"],
        install_hint: "npm install -g @github/copilot",
    },
    KnownAgent {
        id: "opencode",
        name: "OpenCode",
        binary: "opencode",
        args: &["acp"],
        install_hint: "npm install -g opencode-ai",
    },
    KnownAgent {
        id: "kimi-cli",
        name: "Kimi CLI",
        binary: "kimi",
        args: &["acp"],
        install_hint: "Install the Kimi CLI from github.com/MoonshotAI/kimi-cli",
    },
    KnownAgent {
        id: "qwen-code",
        name: "Qwen Code",
        binary: "qwen",
        args: &["--acp", "--experimental-skills"],
        install_hint: "npm install -g @qwen-code/qwen-code",
    },
];

/// The catalog id behind a session's agent id. Sessions made before Athas moved Claude to ACP say
/// `claude-code`, the terminal integration's id; the workbench still starts sessions with it.
pub fn catalog_id(agent: &str) -> &str {
    match agent {
        "claude-code" | "claude" => "claude-acp",
        "gemini" => "gemini-cli",
        "codex" | "codex-cli" => "codex-acp",
        other => other,
    }
}

pub fn known_agent(agent: &str) -> Option<&'static KnownAgent> {
    let id = catalog_id(agent);
    KNOWN_AGENTS.iter().find(|known| known.id == id)
}

/// A readable name for an agent id.
pub fn display_name(agent: &str) -> String {
    match known_agent(agent) {
        Some(known) => known.name.to_string(),
        None => {
            let mut name = String::new();
            for (index, word) in agent.split(['-', '_']).filter(|word| !word.is_empty()).enumerate() {
                if index > 0 {
                    name.push(' ');
                }
                let mut chars = word.chars();
                if let Some(first) = chars.next() {
                    name.extend(first.to_uppercase());
                    name.push_str(chars.as_str());
                }
            }
            name
        }
    }
}

/// How to start an agent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Where an agent's program was looked for, and what was found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Resolution {
    Found(AgentCommand),
    NotInstalled { name: String, hint: String },
}

#[cfg(not(target_family = "wasm"))]
/// Finds the program for `agent`: `ATHAS_AGENT_COMMAND` (a whole command line, for development),
/// then this app's install, then the Tauri app's, then the agent's program on `PATH`.
pub fn resolve(agent: &str) -> Resolution {
    if let Ok(command) = std::env::var("ATHAS_AGENT_COMMAND") {
        let mut parts = command.split_whitespace().map(str::to_string);
        if let Some(program) = parts.next() {
            return Resolution::Found(AgentCommand { program: program.into(), args: parts.collect(), env: Vec::new() });
        }
    }
    let id = catalog_id(agent);
    if let Some(command) = crate::agent_registry::managed_command(id) {
        return Resolution::Found(command);
    }
    let known = known_agent(agent);
    let args: Vec<String> = known.map(|known| known.args.iter().map(|arg| arg.to_string()).collect()).unwrap_or_default();
    if let Some(launcher) = athas_data_dirs().iter().find_map(|dir| managed_launcher(dir, id)) {
        return Resolution::Found(AgentCommand { program: launcher, args, env: Vec::new() });
    }
    if let Some(program) = known.and_then(|known| find_on_path(known.binary, &search_path())) {
        return Resolution::Found(AgentCommand { program, args, env: Vec::new() });
    }
    Resolution::NotInstalled {
        name: display_name(agent),
        hint: known.map(|known| known.install_hint.to_string()).unwrap_or_else(|| {
            format!("Install the {} agent from Athas's agent settings, or put it on PATH.", display_name(agent))
        }),
    }
}

#[cfg(not(target_family = "wasm"))]
/// Athas's data directories, the release build's first.
pub(crate) fn athas_data_dirs() -> Vec<PathBuf> {
    let Some(base) = dirs::data_dir() else { return Vec::new() };
    let mut dirs: Vec<PathBuf> = ["com.code.athas", "com.code.athas.preview", "com.code.athas.alpha", "com.code.athas.dev"]
        .iter()
        .map(|name| base.join(name))
        .collect();
    if let Ok(entries) = std::fs::read_dir(&base) {
        let mut others: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("com.code.athas.") && !dirs.contains(path))
            })
            .collect();
        others.sort();
        dirs.extend(others);
    }
    dirs
}

#[cfg(not(target_family = "wasm"))]
/// The launcher Athas wrote for `id` under `data_dir`, when it and what it runs still exist.
pub fn managed_launcher(data_dir: &Path, id: &str) -> Option<PathBuf> {
    let name = if cfg!(windows) { format!("{id}.cmd") } else { id.to_string() };
    let path = data_dir.join("tools").join("acp").join(name);
    if !path.is_file() {
        return None;
    }
    let script = std::fs::read_to_string(&path).ok()?;
    launcher_targets_exist(&script).then_some(path)
}

#[cfg(not(target_family = "wasm"))]
/// Whether every absolute path a launcher script quotes exists. Launchers are one `exec` line
/// naming a runtime and an entry point, which an uninstall or a cleared cache can remove.
fn launcher_targets_exist(script: &str) -> bool {
    let mut quoted = Vec::new();
    for quote in ['\'', '"'] {
        let mut parts = script.split(quote);
        parts.next();
        while let Some(inside) = parts.next() {
            quoted.push(inside.to_string());
            parts.next();
        }
    }
    quoted.iter().filter(|text| text.starts_with('/')).all(|path| Path::new(path).exists())
}

#[cfg(not(target_family = "wasm"))]
/// `PATH` with the places a GUI launch leaves out: Homebrew, `/usr/local`, user bins.
pub fn search_path() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
    let mut extra = vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")];
    if let Some(home) = dirs::home_dir() {
        extra.extend([".local/bin", ".bun/bin", ".npm-global/bin", ".volta/bin", ".cargo/bin"].map(|dir| home.join(dir)));
    }
    for dir in extra {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

#[cfg(not(target_family = "wasm"))]
pub fn find_on_path(binary: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter().map(|dir| dir.join(binary)).find(|candidate| is_executable(candidate))
}

/// The browser runs no local programs; agents run on the workspace server.
#[cfg(target_family = "wasm")]
pub fn search_path() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_family = "wasm")]
pub fn find_on_path(_: &str, _: &[PathBuf]) -> Option<PathBuf> {
    None
}

#[cfg(not(target_family = "wasm"))]
fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata().is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_code_sessions_run_the_claude_acp_agent() {
        assert_eq!(catalog_id("claude-code"), "claude-acp");
        assert_eq!(known_agent("claude-code").unwrap().binary, "claude-agent-acp");
        assert_eq!(display_name("claude-code"), "Claude Agent");
        assert_eq!(display_name("my-agent"), "My Agent");
    }

    #[test]
    fn launchers_whose_targets_are_gone_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let acp = dir.path().join("tools").join("acp");
        std::fs::create_dir_all(&acp).unwrap();
        let target = dir.path().join("agent-binary");
        std::fs::write(&target, "").unwrap();
        std::fs::write(acp.join("good"), format!("#!/bin/sh\nexec '{}' \"$@\"\n", target.display())).unwrap();
        std::fs::write(acp.join("stale"), "#!/bin/sh\nexec '/nowhere/agent' \"$@\"\n").unwrap();
        assert_eq!(managed_launcher(dir.path(), "good"), Some(acp.join("good")));
        assert_eq!(managed_launcher(dir.path(), "stale"), None);
        assert_eq!(managed_launcher(dir.path(), "missing"), None);
    }

    #[cfg(unix)]
    #[test]
    fn finds_executables_on_the_search_path() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("agent");
        std::fs::write(&program, "#!/bin/sh\n").unwrap();
        assert_eq!(find_on_path("agent", &[dir.path().to_path_buf()]), None);
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(find_on_path("agent", &[dir.path().to_path_buf()]), Some(program));
    }
}
