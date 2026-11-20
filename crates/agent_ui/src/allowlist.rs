//! What the user chose to always allow Athas's own agent to do without asking: command prefixes
//! per workspace, and MCP tools per server. Saved in `<data dir>/dev.athas.gpui/agent-allowlist.json`
//! and listed under Settings > AI > Allowed Commands, where entries can be removed.
//!
//! Ported from Athas's `intelligence/services/intelligence-{command,mcp}-allowlist.ts`.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Mutex, atomic::{AtomicU64, Ordering}},
};

use serde::{Deserialize, Serialize};

const MAX_PREFIXES_PER_WORKSPACE: usize = 200;
const MAX_TOOLS_PER_SERVER: usize = 200;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Allowlist {
    /// Command prefixes, by workspace root.
    pub commands: BTreeMap<String, Vec<String>>,
    /// Tool names, by MCP server.
    pub mcp_tools: BTreeMap<String, Vec<String>>,
}

static LOCK: Mutex<()> = Mutex::new(());
static REVISION: AtomicU64 = AtomicU64::new(0);

/// Goes up whenever the allowlist changes, so a settings page knows to read it again.
pub fn revision() -> u64 {
    REVISION.load(Ordering::Relaxed)
}

fn file() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("ATHAS_AGENT_ALLOWLIST") {
        return Some(PathBuf::from(path));
    }
    #[cfg(not(target_family = "wasm"))]
    {
        dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("agent-allowlist.json"))
    }
    #[cfg(target_family = "wasm")]
    {
        None
    }
}

fn workspace_key(root: &Path) -> String {
    root.to_string_lossy().trim_end_matches(['/', '\\']).to_string()
}

/// Everything allowed; empty when nothing is saved or the file cannot be read.
pub fn load() -> Allowlist {
    file().and_then(|path| std::fs::read_to_string(path).ok()).and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

fn update(change: impl FnOnce(&mut Allowlist) -> bool) {
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut allowlist = load();
    if !change(&mut allowlist) {
        return;
    }
    allowlist.commands.retain(|_, prefixes| !prefixes.is_empty());
    allowlist.mcp_tools.retain(|_, tools| !tools.is_empty());
    let Some(path) = file() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Unavailable storage only means the action is asked about again next time.
    if let Ok(json) = serde_json::to_vec_pretty(&allowlist) {
        let temp = path.with_extension("json.tmp");
        if std::fs::write(&temp, json).is_ok() {
            let _ = std::fs::rename(&temp, &path);
        }
    }
    REVISION.fetch_add(1, Ordering::Relaxed);
}

/// The command prefixes always allowed in `root`.
pub fn commands(root: &Path) -> Vec<String> {
    load().commands.remove(&workspace_key(root)).unwrap_or_default()
}

pub fn allow_command(root: &Path, prefix: &str) {
    update(|allowlist| {
        let prefixes = allowlist.commands.entry(workspace_key(root)).or_default();
        if prefixes.iter().any(|known| known == prefix) {
            return false;
        }
        prefixes.push(prefix.to_string());
        let excess = prefixes.len().saturating_sub(MAX_PREFIXES_PER_WORKSPACE);
        prefixes.drain(..excess);
        true
    });
}

pub fn remove_command(root: &str, prefix: &str) {
    update(|allowlist| {
        let Some(prefixes) = allowlist.commands.get_mut(root) else { return false };
        prefixes.retain(|known| known != prefix);
        true
    });
}

pub fn mcp_allowed(server: &str, tool: &str) -> bool {
    load().mcp_tools.get(server).is_some_and(|tools| tools.iter().any(|known| known == tool))
}

pub fn allow_mcp(server: &str, tool: &str) {
    update(|allowlist| {
        let tools = allowlist.mcp_tools.entry(server.to_string()).or_default();
        if tools.iter().any(|known| known == tool) {
            return false;
        }
        tools.push(tool.to_string());
        let excess = tools.len().saturating_sub(MAX_TOOLS_PER_SERVER);
        tools.drain(..excess);
        true
    });
}

pub fn remove_mcp(server: &str, tool: &str) {
    update(|allowlist| {
        let Some(tools) = allowlist.mcp_tools.get_mut(server) else { return false };
        tools.retain(|known| known != tool);
        true
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowances_are_saved_per_workspace_and_server() {
        let dir = tempfile::tempdir().unwrap();
        // SAFETY: tests that touch the allowlist all run in this one test.
        unsafe { std::env::set_var("ATHAS_AGENT_ALLOWLIST", dir.path().join("allow.json")) };
        let root = Path::new("/work/app/");
        allow_command(root, "cargo test");
        allow_command(root, "cargo test");
        allow_command(Path::new("/other"), "ls");
        assert_eq!(commands(Path::new("/work/app")), vec!["cargo test".to_string()]);
        allow_mcp("github", "search");
        assert!(mcp_allowed("github", "search"));
        assert!(!mcp_allowed("github", "delete"));
        remove_command("/work/app", "cargo test");
        remove_mcp("github", "search");
        let saved = load();
        assert!(!saved.commands.contains_key("/work/app"));
        assert!(saved.mcp_tools.is_empty());
        assert_eq!(saved.commands["/other"], vec!["ls".to_string()]);
    }
}
