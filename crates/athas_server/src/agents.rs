//! Where an agent's program is on this machine. The client names the agent and the program its
//! catalog expects (`claude-agent-acp`, `codex-acp`, …); `ATHAS_AGENT_COMMAND`, a whole command
//! line, runs instead for every agent, as it does on desktop.

use std::{ffi::OsString, path::PathBuf};

use web_protocol::CallError;

/// `PATH` with the places a service's environment leaves out: Homebrew, `/usr/local`, user bins.
fn search_path() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
    let mut extra = vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        extra.extend([".local/bin", ".bun/bin", ".npm-global/bin", ".volta/bin", ".cargo/bin"].map(|dir| home.join(dir)));
    }
    for dir in extra {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

fn is_executable(path: &std::path::Path) -> bool {
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

/// The program, its arguments and the `PATH` to run `agent` with.
pub(crate) fn resolve(agent: &str, program: &str, args: Vec<String>) -> Result<(PathBuf, Vec<String>, Option<OsString>), CallError> {
    let dirs = search_path();
    let path = std::env::join_paths(&dirs).ok();
    if let Ok(command) = std::env::var("ATHAS_AGENT_COMMAND") {
        let mut parts = command.split_whitespace().map(str::to_string);
        if let Some(program) = parts.next() {
            return Ok((program.into(), parts.collect(), path));
        }
    }
    if program.is_empty() || program.contains('/') {
        return Err(CallError::invalid("Invalid command."));
    }
    let found = dirs.iter().map(|dir| dir.join(program)).find(|candidate| is_executable(candidate));
    match found {
        Some(program) => Ok((program, args, path)),
        None => Err(CallError::new("not_installed", format!("{agent} is not installed on the workspace server ({program} is not on its PATH)."))),
    }
}
