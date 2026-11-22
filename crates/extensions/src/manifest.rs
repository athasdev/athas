//! The extension manifest (`extension.json`), as `extensions/schema/extension.schema.json`
//! describes it. Contributions can sit at the top level or under `contributes`; the accessors
//! return both.

use std::collections::BTreeMap;

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

pub const SCHEMA_URL: &str = "https://athas.dev/schemas/extension.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub version: String,
    pub publisher: String,
    pub categories: Vec<Category>,
    #[serde(default)]
    pub languages: Vec<LanguageContribution>,
    #[serde(default)]
    pub agents: Vec<AgentContribution>,
    #[serde(default)]
    pub ai_providers: Vec<serde_json::Value>,
    #[serde(default)]
    pub integrations: Vec<IntegrationContribution>,
    #[serde(default)]
    pub skills: Vec<SkillContribution>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerContribution>,
    #[serde(default)]
    pub themes: Vec<ThemeContribution>,
    #[serde(default)]
    pub icons: Vec<IconThemeContribution>,
    /// The old name of `icons`.
    #[serde(default)]
    pub icon_themes: Vec<IconThemeContribution>,
    #[serde(default)]
    pub contributes: Contributes,
    #[serde(default)]
    pub capabilities: Capabilities,
    #[serde(default)]
    pub activation_events: Vec<String>,
    #[serde(default)]
    pub extension_dependencies: Vec<String>,
    pub main: Option<String>,
    pub permissions: Option<Permissions>,
    pub icon: Option<String>,
    pub license: Option<String>,
    pub repository: Option<Repository>,
    pub installation: Option<Installation>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
pub enum Category {
    Language,
    #[serde(rename = "AI")]
    Ai,
    Integration,
    Agent,
    Skill,
    #[serde(rename = "Icon Theme")]
    IconTheme,
    Linter,
    Formatter,
    Theme,
    Keymaps,
    Snippets,
    #[serde(rename = "UI")]
    Ui,
    Other,
}

/// A category Athas does not know is `Other`, not a manifest that will not load: extensions
/// installed by an older Athas carry categories this one has never heard of, and an upgrade must
/// not drop them.
impl<'de> Deserialize<'de> for Category {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let name = String::deserialize(deserializer)?;
        Ok(match name.as_str() {
            "Language" => Category::Language,
            "AI" => Category::Ai,
            "Integration" => Category::Integration,
            "Agent" => Category::Agent,
            "Skill" => Category::Skill,
            "Icon Theme" => Category::IconTheme,
            "Linter" => Category::Linter,
            "Formatter" => Category::Formatter,
            "Theme" => Category::Theme,
            "Keymaps" => Category::Keymaps,
            "Snippets" => Category::Snippets,
            "UI" => Category::Ui,
            _ => Category::Other,
        })
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributes {
    #[serde(default)]
    pub languages: Vec<LanguageContribution>,
    #[serde(default)]
    pub agents: Vec<AgentContribution>,
    #[serde(default)]
    pub ai_providers: Vec<serde_json::Value>,
    #[serde(default)]
    pub integrations: Vec<IntegrationContribution>,
    #[serde(default)]
    pub skills: Vec<SkillContribution>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerContribution>,
    #[serde(default)]
    pub themes: Vec<ThemeContribution>,
    #[serde(default)]
    pub icons: Vec<IconThemeContribution>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageContribution {
    pub id: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub filename_patterns: Vec<String>,
    pub first_line: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContribution {
    pub id: String,
    pub name: String,
    pub binary_name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub args_by_platform: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub env_vars: BTreeMap<String, String>,
    pub icon: Option<String>,
    /// How the agent's runtime installs it (npm package, binary download); read by the agent
    /// host, not by this crate.
    pub install: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IntegrationContribution {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// `code-host`, `observability`, `project-management` or `other`.
    pub kind: String,
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SkillContribution {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// The skill's Markdown inside the package.
    pub path: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerContribution {
    /// The lowercase name agents see.
    pub id: String,
    pub name: String,
    pub description: String,
    /// `popular`, `developer`, `work` or `data`.
    pub group: String,
    /// What the user still has to fill in before the server works.
    pub setup_note: Option<String>,
    pub config: McpServerConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "transport", rename_all = "lowercase")]
pub enum McpServerConfig {
    Stdio {
        command: String,
        args: Vec<String>,
        /// Environment variables the user fills in.
        #[serde(default)]
        env: Vec<String>,
    },
    Http {
        url: String,
        /// Headers the user fills in.
        #[serde(default)]
        headers: Vec<String>,
    },
    Sse {
        url: String,
        #[serde(default)]
        headers: Vec<String>,
    },
}

/// A colour theme in the theme file format (`theme::ThemeRegistry::load_json`).
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ThemeContribution {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `light` or `dark`.
    pub appearance: String,
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
    #[serde(default)]
    pub syntax: BTreeMap<String, String>,
}

/// A file icon theme. Definitions are inline `<svg>` markup or paths into the package.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconThemeContribution {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub preview: Option<IconThemePreview>,
    #[serde(default)]
    pub icon_definitions: BTreeMap<String, String>,
    #[serde(default)]
    pub light_icon_definitions: BTreeMap<String, String>,
    #[serde(default)]
    pub file_extensions: BTreeMap<String, String>,
    #[serde(default)]
    pub filenames: BTreeMap<String, String>,
    #[serde(default)]
    pub folders: BTreeMap<String, String>,
    #[serde(default)]
    pub expanded_folders: BTreeMap<String, String>,
    pub default_file: Option<String>,
    pub default_folder: Option<String>,
    pub default_folder_open: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconThemePreview {
    pub file_name: String,
    /// `file` or `folder`.
    pub kind: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Capabilities {
    pub lsp: Option<ToolDescriptor>,
    pub formatter: Option<ToolDescriptor>,
    pub linter: Option<ToolDescriptor>,
}

/// A language server, formatter or linter, and how to install and run it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptor {
    pub name: String,
    pub runtime: ToolRuntime,
    pub package: Option<String>,
    #[serde(default)]
    pub packages: Vec<String>,
    /// May hold `${targetArch}`, `${targetOs}` and `${archiveExt}`.
    pub download_url: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub initialization_options: Option<serde_json::Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolRuntime {
    Bun,
    Node,
    Python,
    Go,
    Rust,
    Ruby,
    R,
    System,
    Binary,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    #[serde(default)]
    pub network: Vec<String>,
    #[serde(default)]
    pub secrets: bool,
    #[serde(default)]
    pub settings: Vec<String>,
    /// `read` when the extension may read the workspace.
    pub workspace: Option<String>,
    #[serde(default)]
    pub open_external: bool,
    #[serde(default)]
    pub clipboard_write: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Repository {
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    pub download_url: Option<String>,
    pub size: Option<u64>,
    pub checksum: Option<String>,
    pub min_editor_version: Option<String>,
    pub max_editor_version: Option<String>,
    #[serde(default)]
    pub platform_arch: BTreeMap<String, Package>,
}

/// One downloadable `.tar.gz`: its URL, byte size and SHA-256.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub download_url: String,
    pub size: u64,
    pub checksum: String,
}

impl ExtensionManifest {
    pub fn from_json(json: &str) -> Result<Self> {
        let manifest: Self = serde_json::from_str(json)?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Checks what the schema requires of every manifest.
    pub fn validate(&self) -> Result<()> {
        if self.schema != SCHEMA_URL {
            bail!("{}: `$schema` must be {SCHEMA_URL}", self.id);
        }
        if !is_lower_id(&self.id, true) {
            bail!("`{}` is not a valid extension id", self.id);
        }
        for (field, value) in [
            ("name", &self.name),
            ("displayName", &self.display_name),
            ("description", &self.description),
            ("publisher", &self.publisher),
        ] {
            if value.trim().is_empty() {
                bail!("{}: `{field}` is empty", self.id);
            }
        }
        if !is_version(&self.version) {
            bail!("{}: `{}` is not a version", self.id, self.version);
        }
        if self.categories.is_empty() {
            bail!("{}: no categories", self.id);
        }
        for (index, category) in self.categories.iter().enumerate() {
            if self.categories[..index].contains(category) {
                bail!("{}: category {category:?} is listed twice", self.id);
            }
        }
        for server in self.mcp_servers() {
            if !is_lower_id(&server.id, false) {
                bail!("{}: `{}` is not a valid MCP server id", self.id, server.id);
            }
        }
        for skill in self.skills() {
            if !is_relative_path(&skill.path) {
                bail!("{}: skill path `{}` leaves the package", self.id, skill.path);
            }
        }
        if let Some(main) = &self.main
            && !is_relative_path(main)
        {
            bail!("{}: `main` leaves the package", self.id);
        }
        if let Some(installation) = &self.installation {
            for (platform, package) in &installation.platform_arch {
                if package.size == 0 || !is_sha256(&package.checksum) {
                    bail!("{}: the {platform} package needs a size and a SHA-256", self.id);
                }
            }
        }
        Ok(())
    }

    pub fn languages(&self) -> impl Iterator<Item = &LanguageContribution> {
        self.languages.iter().chain(&self.contributes.languages)
    }

    pub fn agents(&self) -> impl Iterator<Item = &AgentContribution> {
        self.agents.iter().chain(&self.contributes.agents)
    }

    pub fn ai_providers(&self) -> impl Iterator<Item = &serde_json::Value> {
        self.ai_providers.iter().chain(&self.contributes.ai_providers)
    }

    pub fn integrations(&self) -> impl Iterator<Item = &IntegrationContribution> {
        self.integrations.iter().chain(&self.contributes.integrations)
    }

    pub fn skills(&self) -> impl Iterator<Item = &SkillContribution> {
        self.skills.iter().chain(&self.contributes.skills)
    }

    pub fn mcp_servers(&self) -> impl Iterator<Item = &McpServerContribution> {
        self.mcp_servers.iter().chain(&self.contributes.mcp_servers)
    }

    pub fn themes(&self) -> impl Iterator<Item = &ThemeContribution> {
        self.themes.iter().chain(&self.contributes.themes)
    }

    pub fn icon_themes(&self) -> impl Iterator<Item = &IconThemeContribution> {
        self.icons.iter().chain(&self.icon_themes).chain(&self.contributes.icons)
    }

    /// The package to download on `platform` (`darwin-arm64`), when the extension has one.
    pub fn package_for(&self, platform: &str) -> Option<Package> {
        let installation = self.installation.as_ref()?;
        if !installation.platform_arch.is_empty() {
            return installation.platform_arch.get(platform).cloned();
        }
        Some(Package {
            download_url: installation.download_url.clone()?,
            size: installation.size?,
            checksum: installation.checksum.clone()?,
        })
    }

    /// Whether installing downloads a package; the rest are data only.
    pub fn has_package(&self) -> bool {
        self.installation.as_ref().is_some_and(|installation| {
            installation.download_url.is_some() || !installation.platform_arch.is_empty()
        })
    }

    /// The theme file `theme::ThemeRegistry::load_json` reads, when the extension has themes.
    pub fn theme_file_json(&self) -> Option<String> {
        let themes: Vec<&ThemeContribution> = self.themes().collect();
        if themes.is_empty() {
            return None;
        }
        let file = serde_json::json!({
            "name": self.display_name,
            "author": self.publisher,
            "themes": themes,
        });
        Some(file.to_string())
    }
}

fn is_lower_id(id: &str, allow_dots: bool) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || (allow_dots && ch == '.'))
}

/// `1.2.3`, optionally with a `-pre` or `+build` suffix.
fn is_version(version: &str) -> bool {
    let (core, suffix) = match version.find(['-', '+']) {
        Some(index) => (&version[..index], Some(&version[index + 1..])),
        None => (version, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
        && suffix.is_none_or(|suffix| {
            !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-')
        })
}

/// A path that stays inside the package: not absolute and without `..`.
fn is_relative_path(path: &str) -> bool {
    !path.is_empty() && !path.starts_with('/') && !path.split(['/', '\\']).any(|part| part == "..")
}

pub(crate) fn is_sha256(checksum: &str) -> bool {
    checksum.len() == 64 && checksum.chars().all(|ch| ch.is_ascii_digit() || ('a'..='f').contains(&ch))
}

/// Compares two versions by their numeric parts, so `1.10.0` is newer than `1.9.0`.
pub fn is_newer(candidate: &str, installed: &str) -> bool {
    let numbers = |version: &str| -> Vec<u64> {
        version.split(['-', '+']).next().unwrap_or_default().split('.').map(|part| part.parse().unwrap_or(0)).collect()
    };
    numbers(candidate) > numbers(installed)
}

#[cfg(test)]
mod tests {
    /// A manifest written by the Tauri app (top-level contributions, no `contributes`) still
    /// loads: an upgrade must not drop the extensions someone already installed.
    #[test]
    fn an_old_install_still_loads() {
        let json = r#"{
            "$schema": "https://athas.dev/schemas/extension.json",
            "id": "athas.database.postgres",
            "name": "PostgreSQL",
            "displayName": "PostgreSQL Provider",
            "version": "1.0.0",
            "description": "PostgreSQL connection, schema, and query provider.",
            "publisher": "Athas",
            "categories": ["Database"],
            "activationEvents": ["onDatabase:postgres"],
            "databaseProviders": [
                {"id": "postgres", "label": "PostgreSQL", "isFileBased": false, "defaultPort": 5432,
                 "sidecar": {"darwin-arm64": "bin/athas-db-postgres"}}
            ],
            "license": "MIT",
            "icon": "icon.svg"
        }"#;
        let manifest = super::ExtensionManifest::from_json(json).expect("an old manifest loads");
        assert_eq!(manifest.id, "athas.database.postgres");
    }

    use super::*;

    fn minimal(extra: &str) -> String {
        format!(
            r#"{{"$schema": "{SCHEMA_URL}", "id": "athas.test", "name": "test", "displayName": "Test",
            "description": "A test", "version": "1.0.0", "publisher": "Athas", "categories": ["Theme"]{extra}}}"#
        )
    }

    #[test]
    fn requires_the_schema_fields() {
        assert!(ExtensionManifest::from_json(&minimal("")).is_ok());
        let missing = r#"{"$schema": "https://athas.dev/schemas/extension.json", "id": "a", "name": "a"}"#;
        assert!(ExtensionManifest::from_json(missing).is_err());
        assert!(ExtensionManifest::from_json(&minimal("").replace("1.0.0", "1.0")).is_err());
        assert!(ExtensionManifest::from_json(&minimal("").replace("athas.test", "Athas.Test")).is_err());
        assert!(ExtensionManifest::from_json(&minimal("").replace("\"Theme\"", "\"Theme\", \"Theme\"")).is_err());
        // A category this Athas has not heard of reads as Other rather than throwing the manifest
        // away: see `an_old_install_still_loads`.
        let unknown = ExtensionManifest::from_json(&minimal("").replace("\"Theme\"", "\"Nonsense\"")).expect("an unknown category loads");
        assert_eq!(unknown.categories, vec![Category::Other]);
        assert!(ExtensionManifest::from_json(&minimal(r#", "main": "../escape.js""#)).is_err());
    }

    #[test]
    fn versions() {
        for version in ["1.0.0", "0.12.3-beta.1", "2.0.0+build"] {
            assert!(is_version(version), "{version}");
        }
        for version in ["1.0", "1.0.0-", "a.b.c", "1..0"] {
            assert!(!is_version(version), "{version}");
        }
        assert!(is_newer("1.10.0", "1.9.0"));
        assert!(!is_newer("1.0.0", "1.0.0"));
    }

    #[test]
    fn mcp_server_transports() {
        let manifest = ExtensionManifest::from_json(&minimal(
            r#", "contributes": {"mcpServers": [
                {"id": "fetch", "name": "Fetch", "description": "d", "group": "developer",
                 "config": {"transport": "stdio", "command": "uvx", "args": ["mcp-server-fetch"]}},
                {"id": "github", "name": "GitHub", "description": "d", "group": "popular",
                 "config": {"transport": "http", "url": "https://x.dev/mcp", "headers": ["Authorization"]}}
            ]}"#,
        ))
        .unwrap();
        let servers: Vec<_> = manifest.mcp_servers().collect();
        assert!(matches!(&servers[0].config, McpServerConfig::Stdio { command, .. } if command == "uvx"));
        assert!(matches!(&servers[1].config, McpServerConfig::Http { headers, .. } if headers == &["Authorization"]));
    }

    #[test]
    fn picks_the_platform_package() {
        let checksum = "a".repeat(64);
        let manifest = ExtensionManifest::from_json(&minimal(&format!(
            r#", "installation": {{"downloadUrl": "https://x/generic.tar.gz", "size": 3, "checksum": "{checksum}",
              "platformArch": {{"darwin-arm64": {{"downloadUrl": "https://x/mac.tar.gz", "size": 4, "checksum": "{checksum}"}}}}}}"#
        )))
        .unwrap();
        assert_eq!(manifest.package_for("darwin-arm64").unwrap().download_url, "https://x/mac.tar.gz");
        assert!(manifest.package_for("linux-x64").is_none());
        assert!(manifest.has_package());
    }
}
