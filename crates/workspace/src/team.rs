//! Team workspaces (`features/workspace/team`): the `athas.workspace.json` a team commits beside
//! its code (name, description, shared tasks, AI instructions, related repositories and
//! recommended integrations), and what this device keeps about them: the workspaces it manages,
//! the section shown and where each related repository is checked out.

use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const TEAM_WORKSPACE_FILE: &str = "athas.workspace.json";

pub const MAX_COMMANDS: usize = 40;
pub const MAX_REPOSITORIES: usize = 40;
pub const MAX_RECOMMENDED_EXTENSIONS: usize = 100;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamCommand {
    pub name: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamRepository {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamWorkspace {
    pub version: u32,
    pub name: String,
    pub instructions: String,
    pub commands: Vec<TeamCommand>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repositories: Option<Vec<TeamRepository>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_extensions: Option<Vec<String>>,
}

impl TeamWorkspace {
    /// `createTeamWorkspace`: a new profile named after its folder.
    pub fn new(name: impl Into<String>) -> Self {
        Self { version: 1, name: name.into(), instructions: String::new(), commands: Vec::new(), description: None, repositories: None, recommended_extensions: None }
    }

    /// The file as Athas writes it: two-space JSON and a final newline.
    pub fn to_file_content(&self) -> String {
        format!("{}\n", serde_json::to_string_pretty(self).unwrap_or_default())
    }

    /// The profile checked as a save would check it.
    pub fn validated(&self) -> Result<TeamWorkspace, String> {
        parse(&serde_json::to_string(self).map_err(|error| error.to_string())?)
    }
}

/// Lengths as the webview counts them (UTF-16 code units).
fn len16(text: &str) -> usize {
    text.encode_utf16().count()
}

fn assert_keys(value: &Map<String, Value>, keys: &[&str]) -> Result<(), String> {
    match value.keys().find(|key| !keys.contains(&key.as_str())) {
        Some(unknown) => Err(format!("Unknown team workspace field: {unknown}")),
        None => Ok(()),
    }
}

fn is_repository_id(id: &str) -> bool {
    (1..=80).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn is_extension_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && id.len() <= 160
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn check_repository_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Use an HTTPS repository URL.".to_string())?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some_and(|query| !query.is_empty()) || parsed.fragment().is_some_and(|fragment| !fragment.is_empty()) {
        return Err("Use an HTTPS repository URL without credentials or query parameters.".into());
    }
    Ok(())
}

/// `parseTeamWorkspace`: reads and checks `athas.workspace.json`, trimming what it keeps.
pub fn parse(content: &str) -> Result<TeamWorkspace, String> {
    if len16(content) > 100_000 {
        return Err("Team workspace exceeds 100 KB.".into());
    }
    let value: Value = serde_json::from_str(content).map_err(|_| format!("{TEAM_WORKSPACE_FILE} must contain valid JSON."))?;
    let Some(value) = value.as_object().filter(|value| value.get("version").and_then(Value::as_f64) == Some(1.)) else {
        return Err("Team workspace version must be 1.".into());
    };
    assert_keys(value, &["version", "name", "instructions", "commands", "description", "repositories", "recommendedExtensions"])?;
    let name = value.get("name").and_then(Value::as_str).filter(|name| !name.trim().is_empty() && len16(name) <= 120);
    let Some(name) = name else {
        return Err("Enter a team workspace name of up to 120 characters.".into());
    };
    let Some(instructions) = value.get("instructions").and_then(Value::as_str).filter(|text| len16(text) <= 20_000) else {
        return Err("AI instructions must be text of up to 20,000 characters.".into());
    };
    let Some(entries) = value.get("commands").and_then(Value::as_array).filter(|commands| commands.len() <= MAX_COMMANDS) else {
        return Err("A team workspace can contain up to 40 commands.".into());
    };
    let mut names = HashSet::new();
    let mut commands = Vec::new();
    for entry in entries {
        let Some(entry) = entry.as_object() else {
            return Err("Each team command must be an object.".into());
        };
        assert_keys(entry, &["name", "command", "workingDirectory"])?;
        let Some(name) = entry.get("name").and_then(Value::as_str).filter(|name| !name.trim().is_empty() && len16(name) <= 120) else {
            return Err("Each command needs a name of up to 120 characters.".into());
        };
        let name = name.trim();
        if !names.insert(name.to_lowercase()) {
            return Err(format!("Duplicate command name: {name}"));
        }
        let command = entry.get("command").and_then(Value::as_str).filter(|command| !command.trim().is_empty() && len16(command) <= 4_000 && !command.contains('\0'));
        let Some(command) = command else {
            return Err(format!("Enter a command of up to 4,000 characters for {name}."));
        };
        let directory = match entry.get("workingDirectory") {
            None => None,
            Some(Value::String(directory)) => Some(directory.as_str()),
            Some(_) => return Err(format!("Working directory for {name} must be text.")),
        };
        let directory = directory.map(|directory| directory.trim().replace('\\', "/")).filter(|directory| !directory.is_empty()).unwrap_or_else(|| ".".into());
        if directory.starts_with('/') || directory.contains(':') || directory.split('/').any(|part| part == "..") || directory.chars().any(|c| (c as u32) < 32) {
            return Err(format!("Working directory for {name} must be a relative path inside the project."));
        }
        commands.push(TeamCommand { name: name.into(), command: command.trim().into(), working_directory: Some(directory) });
    }
    let mut team = TeamWorkspace { version: 1, name: name.trim().into(), instructions: instructions.trim().into(), commands, description: None, repositories: None, recommended_extensions: None };
    if let Some(description) = value.get("description") {
        let Some(description) = description.as_str().filter(|text| len16(text) <= 2_000) else {
            return Err("Description must be text of up to 2,000 characters.".into());
        };
        team.description = Some(description.trim().into());
    }
    if let Some(repositories) = value.get("repositories") {
        let Some(entries) = repositories.as_array().filter(|entries| entries.len() <= MAX_REPOSITORIES) else {
            return Err("A workspace can contain up to 40 repositories.".into());
        };
        let mut ids = HashSet::new();
        let mut repositories = Vec::new();
        for entry in entries {
            let Some(entry) = entry.as_object() else {
                return Err("Each repository must be an object.".into());
            };
            assert_keys(entry, &["id", "name", "url"])?;
            let Some(id) = entry.get("id").and_then(Value::as_str).filter(|id| is_repository_id(id) && !ids.contains(*id)) else {
                return Err("Each repository needs a unique ID.".into());
            };
            ids.insert(id.to_string());
            let Some(name) = entry.get("name").and_then(Value::as_str).filter(|name| !name.trim().is_empty() && len16(name) <= 120) else {
                return Err("Each repository needs a name of up to 120 characters.".into());
            };
            let url = match entry.get("url") {
                None => None,
                Some(Value::String(url)) if len16(url) <= 2_000 => Some(url.trim()),
                Some(_) => return Err("Repository URL must be text.".into()),
            };
            let url = url.filter(|url| !url.is_empty());
            if let Some(url) = url {
                check_repository_url(url)?;
            }
            repositories.push(TeamRepository { id: id.into(), name: name.trim().into(), url: url.map(str::to_string) });
        }
        team.repositories = Some(repositories);
    }
    if let Some(extensions) = value.get("recommendedExtensions") {
        let ids = extensions
            .as_array()
            .filter(|ids| ids.len() <= MAX_RECOMMENDED_EXTENSIONS)
            .and_then(|ids| ids.iter().map(|id| id.as_str().filter(|id| is_extension_id(id))).collect::<Option<Vec<_>>>());
        let Some(ids) = ids else {
            return Err("Use up to 100 valid integration IDs.".into());
        };
        let mut unique: Vec<String> = Vec::new();
        for id in ids {
            if !unique.iter().any(|seen| seen == id) {
                unique.push(id.into());
            }
        }
        team.recommended_extensions = Some(unique);
    }
    Ok(team)
}

/// `resolveRunWorkingDirectory`: a task's folder, relative to the project unless absolute.
pub fn resolve_working_directory(root: &Path, directory: Option<&str>) -> PathBuf {
    match directory.map(str::trim) {
        None | Some("") | Some(".") => root.to_path_buf(),
        Some(directory)
            if directory.starts_with('/')
                || directory.starts_with("remote://")
                || directory.starts_with("wsl://")
                || (directory.len() > 2 && directory.as_bytes()[0].is_ascii_alphabetic() && directory.as_bytes()[1] == b':' && matches!(directory.as_bytes()[2], b'/' | b'\\')) =>
        {
            PathBuf::from(directory)
        }
        Some(directory) => root.join(directory),
    }
}

/// `normalizeProjectTabPath`: repeated and trailing separators dropped; a URI keeps its scheme,
/// its authority and the slash of a bare root.
pub fn normalize_root(path: &str) -> String {
    let trimmed = path.trim();
    if let Some(scheme_end) = trimmed.find("://").filter(|&at| at > 0 && trimmed[..at].chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))) {
        let rest = &trimmed[scheme_end + 3..];
        let (authority, uri_path) = rest.find('/').map_or((rest, ""), |at| rest.split_at(at));
        if uri_path.is_empty() {
            return trimmed.to_string();
        }
        let collapsed = collapse(uri_path, &['/']);
        let collapsed = if collapsed == "/" { collapsed } else { collapsed.trim_end_matches('/').to_string() };
        return format!("{}://{authority}{collapsed}", &trimmed[..scheme_end]);
    }
    let unc = trimmed.len() > 2 && matches!(trimmed.as_bytes()[0], b'/' | b'\\') && matches!(trimmed.as_bytes()[1], b'/' | b'\\') && !matches!(trimmed.as_bytes()[2], b'/' | b'\\');
    let (prefix, rest) = if unc { trimmed.split_at(2) } else { ("", trimmed) };
    let joined = format!("{prefix}{}", collapse(rest, &['/', '\\']));
    let stripped = joined.trim_end_matches(['/', '\\']);
    if stripped.is_empty() { joined } else { stripped.to_string() }
}

fn collapse(path: &str, separators: &[char]) -> String {
    let mut out = String::with_capacity(path.len());
    let mut previous_separator = false;
    for c in path.chars() {
        let separator = separators.contains(&c);
        if !(separator && previous_separator) {
            out.push(c);
        }
        previous_separator = separator;
    }
    out
}

/// `areProjectTabPathsEqual`: Windows drive and UNC paths compare without case.
pub fn paths_equal(left: &str, right: &str) -> bool {
    let (left, right) = (normalize_root(left), normalize_root(right));
    let insensitive = |path: &str| {
        let path = path.replace('\\', "/");
        path.starts_with("//") || (path.len() > 2 && path.as_bytes()[0].is_ascii_alphabetic() && &path[1..3] == ":/")
    };
    if insensitive(&left) || insensitive(&right) {
        return left.replace('\\', "/").to_lowercase() == right.replace('\\', "/").to_lowercase();
    }
    left == right
}

/// The last part of a path, which a new profile is named after.
pub fn base_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().filter(|name| !name.is_empty()).unwrap_or(path).to_string()
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceSection {
    #[default]
    Overview,
    Repositories,
    Environments,
    Tasks,
    Ai,
    Extensions,
}

impl WorkspaceSection {
    pub const ALL: [WorkspaceSection; 6] = [Self::Overview, Self::Repositories, Self::Environments, Self::Tasks, Self::Ai, Self::Extensions];

    pub fn id(self) -> &'static str {
        match self {
            Self::Overview => "overview",
            Self::Repositories => "repositories",
            Self::Environments => "environments",
            Self::Tasks => "tasks",
            Self::Ai => "ai",
            Self::Extensions => "extensions",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|section| section.id() == id)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Overview => "Overview",
            Self::Repositories => "Repositories",
            Self::Environments => "Environments",
            Self::Tasks => "Tasks",
            Self::Ai => "AI & Context",
            Self::Extensions => "Integrations",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Overview => "The projects, tools and conventions your team shares.",
            Self::Repositories => "Bring related projects together and link your local checkouts.",
            Self::Environments => "Inspect project requirements and connect to remote development environments.",
            Self::Tasks => "Define the commands your team uses to develop, test and build.",
            Self::Ai => "Give your agents the context and conventions of your team.",
            Self::Extensions => "Keep your team's recommended development tools together.",
        }
    }
}

/// What this device keeps (`athas-workspace-management`): the workspaces added, the one and the
/// section shown, and the local checkout linked to each repository of each workspace.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ManagementState {
    pub roots: Vec<String>,
    pub selected_root: Option<String>,
    pub section: WorkspaceSection,
    pub bindings: BTreeMap<String, BTreeMap<String, String>>,
}

impl ManagementState {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path).ok().and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string(self)?)?;
        Ok(())
    }

    /// `register`: adds a workspace (once) and shows it.
    pub fn register(&mut self, path: &str) {
        let root = path.trim_end_matches(['/', '\\']);
        if root.is_empty() {
            return;
        }
        if !self.roots.iter().any(|existing| existing == root) {
            self.roots.push(root.to_string());
        }
        self.selected_root = Some(root.to_string());
    }

    pub fn bind_repository(&mut self, root: &str, id: &str, path: &str) {
        self.bindings.entry(root.to_string()).or_default().insert(id.to_string(), path.to_string());
    }

    pub fn binding(&self, root: &str, id: &str) -> Option<&str> {
        self.bindings.get(root).and_then(|bindings| bindings.get(id)).map(String::as_str)
    }

    /// `useWorkspaceSelection`: the workspace shown, and every workspace to choose from: the ones
    /// added, the open projects and the active one.
    pub fn selection(&self, active: Option<&str>, open: &[String]) -> (Option<String>, Vec<String>) {
        let root = self.selected_root.clone().or_else(|| active.map(str::to_string)).or_else(|| self.roots.first().cloned()).or_else(|| open.first().cloned());
        let mut paths: Vec<String> = Vec::new();
        for path in self.roots.iter().map(String::as_str).chain(open.iter().map(String::as_str)).chain(active) {
            if !paths.iter().any(|existing| existing == path) {
                paths.push(path.to_string());
            }
        }
        (root, paths)
    }
}

/// `loadWorkspaceTeamContext`: the profile whose AI instructions apply to a project: its own, else
/// the one workspace that links it as a repository.
pub fn team_context(
    project_root: &str,
    bindings: &BTreeMap<String, BTreeMap<String, String>>,
    load: impl Fn(&str) -> Result<Option<TeamWorkspace>, String>,
) -> Result<Option<TeamWorkspace>, String> {
    if let Some(own) = load(project_root)? {
        return Ok(Some(own));
    }
    let mut matches = Vec::new();
    for (root, repositories) in bindings {
        let ids: Vec<&str> = repositories.iter().filter(|(_, path)| paths_equal(path, project_root)).map(|(id, _)| id.as_str()).collect();
        if ids.is_empty() || paths_equal(root, project_root) {
            continue;
        }
        if let Some(team) = load(root)?
            && team.repositories.as_ref().is_some_and(|repositories| repositories.iter().any(|repo| ids.contains(&repo.id.as_str())))
        {
            matches.push(team);
        }
    }
    if matches.len() > 1 {
        return Err("This project is linked to multiple team workspaces. Add an athas.workspace.json in this project to choose its AI instructions explicitly.".into());
    }
    Ok(matches.pop())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnvironmentKind {
    Local,
    Remote,
    Wsl,
}

impl EnvironmentKind {
    pub fn of(path: &str) -> Self {
        if path.starts_with("remote://") {
            Self::Remote
        } else if path.starts_with("wsl://") {
            Self::Wsl
        } else {
            Self::Local
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::Local => "Local environment",
            Self::Remote => "SSH environment",
            Self::Wsl => "WSL environment",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Requirement {
    pub name: String,
    pub version: String,
}

/// `inspectWorkspaceEnvironment`: what the project's top-level manifests say it needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnvironmentInfo {
    pub kind: EnvironmentKind,
    pub requirements: Vec<Requirement>,
    pub files: Vec<String>,
}

impl EnvironmentInfo {
    pub fn inspect(kind: EnvironmentKind, files: Vec<String>, package_json: Option<&str>) -> Result<Self, String> {
        let has = |name: &str| files.iter().any(|file| file == name);
        let mut requirements = Vec::new();
        let requirement = |name: &str, version: &str| Requirement { name: name.into(), version: version.into() };
        if has("package.json") {
            let manifest: Value = serde_json::from_str(package_json.unwrap_or_default()).map_err(|error| error.to_string())?;
            if let Some(engines) = manifest.get("engines").and_then(Value::as_object) {
                for (name, version) in engines {
                    if let Some(version) = version.as_str() {
                        requirements.push(requirement(name, version));
                    }
                }
            }
            if let Some(manager) = manifest.get("packageManager").and_then(Value::as_str) {
                requirements.push(requirement("Package manager", manager));
            }
        }
        if has("Cargo.toml") {
            requirements.push(requirement("Rust", "Cargo project"));
        }
        if has("go.mod") {
            requirements.push(requirement("Go", "Go module"));
        }
        if has("pyproject.toml") {
            requirements.push(requirement("Python", "Python project"));
        }
        Ok(Self { kind, requirements, files })
    }

    pub fn has_dev_container(&self) -> bool {
        self.files.iter().any(|file| file == ".devcontainer" || file == ".devcontainer.json")
    }
}

/// Reads a local workspace's profile: `None` when the folder has none.
pub fn read_local(root: &Path) -> Result<Option<String>, String> {
    let path = root.join(TEAM_WORKSPACE_FILE);
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// `saveTeamWorkspace` for a local folder: refuses when the file changed since it was read.
pub fn save_local(root: &Path, team: &TeamWorkspace, original: Option<&str>) -> Result<String, String> {
    let validated = team.validated()?;
    if read_local(root)?.as_deref() != original {
        return Err("The team workspace changed on disk. Reload the workspace before saving.".into());
    }
    let content = validated.to_file_content();
    std::fs::write(root.join(TEAM_WORKSPACE_FILE), &content).map_err(|error| error.to_string())?;
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn team(json: Value) -> Result<TeamWorkspace, String> {
        parse(&json.to_string())
    }

    #[test]
    fn parses_and_trims_a_profile() {
        let parsed = team(serde_json::json!({
            "version": 1,
            "name": " Platform ",
            "instructions": " Use bun. ",
            "commands": [{ "name": " Dev ", "command": " bun dev ", "workingDirectory": "apps\\web" }, { "name": "Test", "command": "bun test" }],
            "description": " Web ",
            "repositories": [{ "id": "api-1", "name": " API ", "url": " https://github.com/team/api " }],
            "recommendedExtensions": ["athas.rust", "athas.rust", "athas.go"],
        }))
        .unwrap();
        assert_eq!(parsed.name, "Platform");
        assert_eq!(parsed.instructions, "Use bun.");
        assert_eq!(parsed.commands[0], TeamCommand { name: "Dev".into(), command: "bun dev".into(), working_directory: Some("apps/web".into()) });
        assert_eq!(parsed.commands[1].working_directory.as_deref(), Some("."));
        assert_eq!(parsed.description.as_deref(), Some("Web"));
        assert_eq!(parsed.repositories.as_ref().unwrap()[0].url.as_deref(), Some("https://github.com/team/api"));
        assert_eq!(parsed.recommended_extensions.as_deref().unwrap(), ["athas.rust", "athas.go"]);
    }

    #[test]
    fn rejects_what_the_web_workbench_rejects() {
        let base = || serde_json::json!({ "version": 1, "name": "T", "instructions": "", "commands": [] });
        let with = |key: &str, value: Value| {
            let mut json = base();
            json[key] = value;
            team(json).unwrap_err()
        };
        assert_eq!(parse("{").unwrap_err(), "athas.workspace.json must contain valid JSON.");
        assert_eq!(with("version", 2.into()), "Team workspace version must be 1.");
        assert_eq!(with("extra", 1.into()), "Unknown team workspace field: extra");
        assert_eq!(with("name", " ".into()), "Enter a team workspace name of up to 120 characters.");
        assert_eq!(with("commands", serde_json::json!([{ "name": "a", "command": "x" }, { "name": "A", "command": "y" }])), "Duplicate command name: A");
        assert_eq!(
            with("commands", serde_json::json!([{ "name": "a", "command": "x", "workingDirectory": "../up" }])),
            "Working directory for a must be a relative path inside the project."
        );
        assert_eq!(with("commands", serde_json::json!([{ "name": "a", "command": "x", "workingDirectory": "/abs" }])), "Working directory for a must be a relative path inside the project.");
        assert_eq!(with("repositories", serde_json::json!([{ "id": "a b", "name": "x" }])), "Each repository needs a unique ID.");
        assert_eq!(with("repositories", serde_json::json!([{ "id": "a", "name": "x", "url": "http://x.dev" }])), "Use an HTTPS repository URL without credentials or query parameters.");
        assert_eq!(with("repositories", serde_json::json!([{ "id": "a", "name": "x", "url": "https://me:pw@x.dev" }])), "Use an HTTPS repository URL without credentials or query parameters.");
        assert_eq!(with("repositories", serde_json::json!([{ "id": "a", "name": "x", "url": "not a url" }])), "Use an HTTPS repository URL.");
        assert_eq!(with("recommendedExtensions", serde_json::json!(["-bad"])), "Use up to 100 valid integration IDs.");
        assert_eq!(parse(&"x".repeat(100_001)).unwrap_err(), "Team workspace exceeds 100 KB.");
    }

    #[test]
    fn writes_the_file_as_json_stringify_does() {
        let mut team = TeamWorkspace::new("athas");
        team.commands.push(TeamCommand { name: "Dev".into(), command: "bun dev".into(), working_directory: Some(".".into()) });
        assert_eq!(
            team.to_file_content(),
            "{\n  \"version\": 1,\n  \"name\": \"athas\",\n  \"instructions\": \"\",\n  \"commands\": [\n    {\n      \"name\": \"Dev\",\n      \"command\": \"bun dev\",\n      \"workingDirectory\": \".\"\n    }\n  ]\n}\n"
        );
        assert_eq!(parse(&team.to_file_content()).unwrap(), team);
    }

    #[test]
    fn checked_saves_refuse_a_profile_changed_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_local(dir.path()).unwrap(), None);
        let team = TeamWorkspace::new("demo");
        let saved = save_local(dir.path(), &team, None).unwrap();
        assert_eq!(read_local(dir.path()).unwrap().as_deref(), Some(saved.as_str()));
        std::fs::write(dir.path().join(TEAM_WORKSPACE_FILE), "{}").unwrap();
        assert_eq!(save_local(dir.path(), &team, Some(&saved)).unwrap_err(), "The team workspace changed on disk. Reload the workspace before saving.");
        let mut invalid = team.clone();
        invalid.name = String::new();
        assert!(save_local(dir.path(), &invalid, Some("{}")).is_err());
    }

    #[test]
    fn management_state_round_trips_and_selects() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace-management.json");
        let mut state = ManagementState::default();
        state.register("/work/api/");
        state.register("/work/api");
        state.section = WorkspaceSection::Tasks;
        state.bind_repository("/work/api", "web", "/work/web");
        state.save(&path).unwrap();
        let loaded = ManagementState::load(&path);
        assert_eq!(loaded, state);
        assert_eq!(loaded.roots, ["/work/api"]);
        assert_eq!(loaded.binding("/work/api", "web"), Some("/work/web"));
        let (root, paths) = ManagementState::default().selection(Some("/work/b"), &["/work/a".into(), "/work/b".into()]);
        assert_eq!(root.as_deref(), Some("/work/b"));
        assert_eq!(paths, ["/work/a", "/work/b"]);
    }

    #[test]
    fn team_context_prefers_the_projects_own_profile_then_one_link() {
        let mut api = TeamWorkspace::new("api");
        api.repositories = Some(vec![TeamRepository { id: "web".into(), name: "Web".into(), url: None }]);
        let mut bindings = BTreeMap::new();
        bindings.entry("/w/api".to_string()).or_insert_with(BTreeMap::new).insert("web".to_string(), "/w/web/".to_string());
        let load = |root: &str| Ok(if root == "/w/api" { Some(api.clone()) } else { None });
        assert_eq!(team_context("/w/web", &bindings, load).unwrap().unwrap().name, "api");
        assert_eq!(team_context("/w/other", &bindings, load).unwrap(), None);
        bindings.entry("/w/ops".to_string()).or_insert_with(BTreeMap::new).insert("web".to_string(), "/w/web".to_string());
        let both = |root: &str| Ok(if root == "/w/api" || root == "/w/ops" { Some(api.clone()) } else { None });
        assert!(team_context("/w/web", &bindings, both).is_err());
    }

    #[test]
    fn environments_and_paths() {
        let info = EnvironmentInfo::inspect(
            EnvironmentKind::of("/p"),
            vec!["package.json".into(), "Cargo.toml".into(), ".devcontainer".into()],
            Some(r#"{"engines":{"node":">=20"},"packageManager":"bun@1.2"}"#),
        )
        .unwrap();
        assert_eq!(info.requirements.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["node", "Package manager", "Rust"]);
        assert!(info.has_dev_container());
        assert_eq!(EnvironmentKind::of("remote://c/x"), EnvironmentKind::Remote);
        assert!(paths_equal("/a//b/", "/a/b"));
        assert!(paths_equal("C:\\Work\\App", "c:/work/app/"));
        assert!(paths_equal("remote://c1//home/x/", "remote://c1/home/x"));
        assert_eq!(normalize_root("remote://c1/"), "remote://c1/");
        assert_eq!(resolve_working_directory(Path::new("/p"), Some("apps/web")), PathBuf::from("/p/apps/web"));
        assert_eq!(resolve_working_directory(Path::new("/p"), Some(".")), PathBuf::from("/p"));
        assert_eq!(base_name("/w/api/"), "api");
    }
}
