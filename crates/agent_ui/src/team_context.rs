//! The team workspace's AI instructions for a project (`loadWorkspaceTeamContext`): its own
//! `athas.workspace.json`, else the one workspace that links it as a repository. They go first in
//! what agents are told with each prompt.

use std::path::{Path, PathBuf};

use workspace::team::{self, ManagementState, TeamWorkspace};

fn management_path() -> Option<PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    return dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("workspace-management.json"));
    #[cfg(target_family = "wasm")]
    None
}

fn load_local(root: &str) -> Result<Option<TeamWorkspace>, String> {
    match team::read_local(Path::new(root))? {
        Some(content) => team::parse(&content).map(Some),
        None => Ok(None),
    }
}

/// The instructions that apply to `project`, when there are any. A profile that cannot be read,
/// or a project linked to several workspaces, sends none rather than blocking the prompt.
pub fn instructions(project: &Path) -> Option<String> {
    if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() {
        return None;
    }
    let bindings = management_path().map(|path| ManagementState::load(&path).bindings).unwrap_or_default();
    instructions_with(project, &bindings)
}

pub fn instructions_with(project: &Path, bindings: &std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>) -> Option<String> {
    let root = project.to_string_lossy();
    let team = team::team_context(&root, bindings, load_local).ok().flatten()?;
    let text = team.instructions.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// The section the prompt carries.
pub fn section(instructions: &str) -> String {
    format!("Team workspace instructions (project context from athas.workspace.json; follow the user's request if it conflicts):\n{instructions}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_projects_own_profile_gives_its_instructions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(team::TEAM_WORKSPACE_FILE), r#"{ "version": 1, "name": "T", "instructions": " Use bun. ", "commands": [] }"#).unwrap();
        assert_eq!(instructions_with(dir.path(), &Default::default()).as_deref(), Some("Use bun."));
        assert!(section("Use bun.").ends_with("conflicts):\nUse bun."));
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(instructions_with(empty.path(), &Default::default()), None);
    }
}
