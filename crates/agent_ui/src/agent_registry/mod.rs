//! ACP agents the user can install: the agents Athas's extension catalog contributes, merged with
//! the public ACP Registry (https://agentclientprotocol.com/registry), installed into
//! `<data dir>/dev.athas.gpui/agents/` with the Node.js package manager the user already has (npm
//! or bun); when neither is there, Athas's managed Node.js (`athas-runtime`, downloaded into
//! `<data dir>/runtimes` as the language tools' is) installs and runs npm agents.
//!
//! Each install is `agents/<id>/` (the package, and `install.json` with what was installed) and a
//! launcher `agents/bin/<id>` that `acp::agents::resolve` runs.
//!
//! Ported from Athas's `crates/ai/src/acp/{agent_catalog,agent_install}.rs` and
//! `crates/ai/src/acp/registry/{schema,catalog,store}.rs`.

#[cfg(not(target_family = "wasm"))]
pub mod binary;
mod store;

/// The web build installs no agents on this machine.
#[cfg(target_family = "wasm")]
pub mod binary {
    use std::path::{Path, PathBuf};

    pub type Download = fn(&str, &Path) -> Result<(), String>;

    pub fn registry_platform() -> Option<&'static str> {
        None
    }

    pub fn manifest_platform() -> Option<&'static str> {
        None
    }

    pub fn checked_sha256(sha256: Option<&str>) -> Result<String, String> {
        sha256.map(str::to_ascii_lowercase).ok_or_else(|| "The registry publishes no checksum for this platform's build".into())
    }

    pub fn download_https(_: &str, _: &Path) -> Result<(), String> {
        Err("Agents are not installed in the browser".into())
    }

    pub fn install(_: Download, _: &Path, _: &str, _: &str, _: Option<&str>, _: &str) -> Result<(String, PathBuf), String> {
        Err("Agents are not installed in the browser".into())
    }

    pub fn remove_stale_versions(_: &Path, _: &[&str]) -> Vec<PathBuf> {
        Vec::new()
    }
}

use std::{
    cmp::Ordering,
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use store::{AgentRegistry, Operation, new_chat_agents};
use binary::{manifest_platform, registry_platform};

pub const REGISTRY_URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
/// How long a downloaded registry is used before it is fetched again.
pub const REFRESH_SECS: u64 = 60 * 60;
/// Registry ids that Athas's manifests name differently.
const ATHAS_AGENT_IDS: &[(&str, &str)] = &[("gemini", "gemini-cli"), ("kimi", "kimi-cli")];

/// How an agent installs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Runtime {
    /// An npm package, installed with npm or bun and run with node or bun.
    Node,
    /// A PyPI package the user's `uvx` runs.
    Uvx,
    /// A download for this platform, unpacked into a versioned folder.
    Binary,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSpec {
    pub runtime: Runtime,
    /// The npm or PyPI package, without its version.
    pub package: String,
    pub version: Option<String>,
    /// For npm agents, the versions the catalog allows beyond `version`: a semver range
    /// (`~0.73`, `^1`), or `*` for whatever npm calls latest. Agent adapters carry the model
    /// list their vendor's SDK was built with, so a catalog pin decides which models a user can
    /// reach; the catalog names the floor and npm names the newest. Binary agents stay pinned to
    /// the checksummed download the catalog gives.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<String>,
    /// The package's program, for npm packages.
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// The build to download, for binary installs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive: Option<String>,
    /// The build's SHA-256 (lowercase hex), checked before it is unpacked; the registry always
    /// gives one, extension manifests (whose catalog is itself checksummed) do not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// Athas's extension catalog.
    Extension,
    /// Only the ACP Registry lists it.
    Registry,
}

/// An agent the catalog offers.
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogAgent {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source: Source,
    /// The program on `PATH` that counts as installed for catalog agents.
    pub binary: Option<String>,
    pub install: Option<InstallSpec>,
    /// Why this machine cannot install it, if it cannot.
    pub unavailable: Option<String>,
}

impl CatalogAgent {
    pub fn available_version(&self) -> Option<&str> {
        self.install.as_ref().and_then(|install| install.version.as_deref())
    }
}

/// What `install.json` records.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub spec: InstallSpec,
    /// The runtime the launcher runs the package with.
    pub runner: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InstallState {
    NotInstalled,
    /// Installed by this app; `update` names a newer version the catalog has.
    Managed { version: Option<String>, update: Option<String> },
    /// Found on `PATH` (or in the Tauri app's installs): runs, but is not managed here.
    External(PathBuf),
}

impl InstallState {
    pub fn is_installed(&self) -> bool {
        !matches!(self, InstallState::NotInstalled)
    }
}

/// Where installs go.
pub fn agents_dir() -> Option<PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    {
        dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("agents"))
    }
    #[cfg(target_family = "wasm")]
    {
        None
    }
}

/// Splits `@scope/name@1.2.3` into name and version.
pub fn split_npm_spec(spec: &str) -> (&str, Option<&str>) {
    let from = usize::from(spec.starts_with('@'));
    match spec[from..].find('@') {
        Some(index) => (&spec[..index + from], Some(&spec[index + from + 1..])),
        None => (spec, None),
    }
}

/// npm package names: optional `@scope/`, lowercase URL-safe characters, never starting with
/// `.`, `_` or `-` (so a name cannot pass as a flag).
pub fn is_valid_npm_name(name: &str) -> bool {
    let valid = |part: &str| {
        !part.is_empty()
            && !part.starts_with(['.', '_', '-'])
            && part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.' | '_'))
    };
    match name.strip_prefix('@') {
        Some(scoped) => scoped.split_once('/').is_some_and(|(scope, rest)| valid(scope) && valid(rest)),
        None => valid(name),
    }
}

/// An exact version (`1.2.3`, `1.2.3-beta.1`): ranges and tags are refused so installs repeat.
pub fn is_exact_version(version: &str) -> bool {
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

/// Agent ids become folder and file names.
pub fn is_valid_agent_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && !id.starts_with('.') && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

fn install_from_manifest(install: &Value, binary: &str) -> (Option<InstallSpec>, Option<String>) {
    let runtime = install.get("runtime").and_then(Value::as_str).unwrap_or_default();
    let package = install.get("package").and_then(Value::as_str).unwrap_or_default();
    match runtime {
        "node" => {
            let (name, pinned) = split_npm_spec(package);
            let version = pinned.or_else(|| install.get("version").and_then(Value::as_str)).map(str::to_string);
            if !is_valid_npm_name(name) {
                return (None, Some(format!("The package {package:?} is not valid")));
            }
            let command = install.get("command").and_then(Value::as_str).unwrap_or(binary).to_string();
            // A manifest without a range follows npm's latest; one that wants the old behaviour
            // gives its exact version as the range.
            let range = install.get("range").and_then(Value::as_str).unwrap_or("*").to_string();
            let spec = InstallSpec { runtime: Runtime::Node, package: name.to_string(), version, range: Some(range), command, args: Vec::new(), env: BTreeMap::new(), archive: None, sha256: None };
            (Some(spec), None)
        }
        "binary" => {
            let platform = manifest_platform();
            let by_platform = |field: &str| platform.and_then(|platform| install.get(field)?.get(platform)?.as_str().map(str::to_string));
            let archive = by_platform("downloadUrls").or_else(|| install.get("downloadUrl").and_then(Value::as_str).map(str::to_string));
            let command = by_platform("commandsByPlatform")
                .or_else(|| install.get("command").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| binary.to_string());
            let unavailable = match &archive {
                None => Some(format!("{package} has no download for this platform; install {binary} and put it on PATH")),
                Some(url) if !url.starts_with("https://") => Some("The download is not served over HTTPS".to_string()),
                Some(_) => None,
            };
            let spec = InstallSpec {
                runtime: Runtime::Binary,
                package: package.to_string(),
                version: install.get("version").and_then(Value::as_str).map(str::to_string),
                range: None,
                command,
                args: Vec::new(),
                env: BTreeMap::new(),
                archive,
                sha256: None,
            };
            (Some(spec), unavailable)
        }
        "" => (None, None),
        other => (None, Some(format!("Installing {other} agents is not supported"))),
    }
}

/// The catalog's agents from the extension manifests (`extensions::get(cx).catalog_agents()`).
pub fn from_extensions(agents: &[(String, extensions::AgentContribution)]) -> Vec<CatalogAgent> {
    agents
        .iter()
        .filter(|(_, agent)| is_valid_agent_id(&agent.id))
        .map(|(_, agent)| {
            let (install, unavailable) = agent.install.as_ref().map(|install| install_from_manifest(install, &agent.binary_name)).unwrap_or((None, None));
            let install = install.map(|mut install| {
                install.args = agent.args.clone();
                install.env = agent.env_vars.clone();
                install
            });
            CatalogAgent {
                id: agent.id.clone(),
                name: agent.name.clone(),
                description: agent.description.clone(),
                source: Source::Extension,
                binary: Some(agent.binary_name.clone()),
                install,
                unavailable,
            }
        })
        .collect()
}

#[derive(Debug, Deserialize)]
struct RegistryAgent {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    distribution: Distribution,
}

#[derive(Debug, Default, Deserialize)]
struct Distribution {
    #[serde(default)]
    binary: BTreeMap<String, BinaryTarget>,
    #[serde(default)]
    npx: Option<PackageDistribution>,
    #[serde(default)]
    uvx: Option<PackageDistribution>,
}

#[derive(Debug, Deserialize)]
struct BinaryTarget {
    archive: String,
    #[serde(default)]
    sha256: Option<String>,
    cmd: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

/// A checksummed HTTPS build for this platform, or why there is none.
fn binary_install(agent: &RegistryAgent) -> Option<Result<InstallSpec, String>> {
    let target = registry_platform().and_then(|platform| agent.distribution.binary.get(platform))?;
    if !target.archive.starts_with("https://") {
        return Some(Err("The registry build is not served over HTTPS".into()));
    }
    Some(binary::checked_sha256(target.sha256.as_deref()).map(|sha256| InstallSpec {
        runtime: Runtime::Binary,
        package: agent.id.clone(),
        version: Some(agent.version.clone()),
        range: None,
        command: target.cmd.clone(),
        args: target.args.clone(),
        env: target.env.clone(),
        archive: Some(target.archive.clone()),
        sha256: Some(sha256),
    }))
}

#[derive(Debug, Deserialize)]
struct PackageDistribution {
    package: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

/// The agents in a `registry.json`; entries that do not parse or have unsafe ids are skipped.
pub fn parse_registry(body: &str) -> Result<Vec<CatalogAgent>, String> {
    #[derive(Deserialize)]
    struct Raw {
        #[serde(default)]
        agents: Vec<Value>,
    }
    let raw: Raw = serde_json::from_str(body).map_err(|error| format!("Invalid ACP registry: {error}"))?;
    Ok(raw
        .agents
        .into_iter()
        .filter_map(|value| serde_json::from_value::<RegistryAgent>(value).ok())
        .filter(|agent| is_valid_agent_id(&agent.id))
        .map(|agent| {
            let id = ATHAS_AGENT_IDS.iter().find(|(registry, _)| *registry == agent.id).map_or(agent.id.clone(), |(_, athas)| athas.to_string());
            let binary = binary_install(&agent);
            let binary_problem = binary.as_ref().and_then(|result| result.as_ref().err().cloned());
            let (install, unavailable) = if let Some(Ok(spec)) = binary {
                (Some(spec), None)
            } else if let Some(npx) = &agent.distribution.npx {
                let (name, pinned) = split_npm_spec(&npx.package);
                let version = pinned.unwrap_or(&agent.version);
                if !is_valid_npm_name(name) || !is_exact_version(version) {
                    (None, Some(format!("The registry package {:?} is not pinned to an exact version", npx.package)))
                } else {
                    let command = name.rsplit('/').next().unwrap_or(name).to_string();
                    let spec = InstallSpec {
                        runtime: Runtime::Node,
                        package: name.to_string(),
                        version: Some(version.to_string()),
                        // The ACP Registry's pin is part of what it publishes: it stays exact.
                        range: None,
                        command,
                        args: npx.args.clone(),
                        env: npx.env.clone(),
                        archive: None,
                        sha256: None,
                    };
                    (Some(spec), None)
                }
            } else if let Some(uvx) = &agent.distribution.uvx {
                let valid = !uvx.package.is_empty()
                    && !uvx.package.starts_with('-')
                    && uvx.package.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '[' | ']' | ',' | '=' | '<' | '>' | '!' | '~' | '@'));
                if valid {
                    let spec = InstallSpec {
                        runtime: Runtime::Uvx,
                        package: uvx.package.clone(),
                        version: Some(agent.version.clone()),
                        range: None,
                        command: "uvx".into(),
                        args: uvx.args.clone(),
                        env: uvx.env.clone(),
                        archive: None,
                        sha256: None,
                    };
                    (Some(spec), None)
                } else {
                    (None, Some(format!("The registry package {:?} is not valid", uvx.package)))
                }
            } else if let Some(problem) = binary_problem {
                (None, Some(problem))
            } else if !agent.distribution.binary.is_empty() {
                (None, Some("The registry has no build for this platform".to_string()))
            } else {
                (None, Some("The registry lists no distribution this app can install".to_string()))
            };
            CatalogAgent { id, name: agent.name, description: agent.description, source: Source::Registry, binary: None, install, unavailable }
        })
        .collect())
}

/// The catalog with the registry merged in: a catalog agent the registry can install takes the
/// registry's newer install; registry-only agents are added after.
pub fn merge(mut catalog: Vec<CatalogAgent>, registry: Vec<CatalogAgent>) -> Vec<CatalogAgent> {
    for agent in registry {
        match catalog.iter_mut().find(|known| known.id == agent.id) {
            Some(known) => {
                if let Some(mut install) = agent.install {
                    // The manifest knows the package's program; the registry only its package.
                    if let Some(own) = known.install.as_ref().filter(|own| own.runtime == install.runtime) {
                        install.command = own.command.clone();
                    }
                    known.install = Some(install);
                    known.unavailable = None;
                }
            }
            None => catalog.push(agent),
        }
    }
    catalog
}

/// The installs on this machine.
pub struct Installs {
    pub dir: PathBuf,
    /// Fetches download builds; tests stand in for the network.
    pub download: binary::Download,
}

impl Installs {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, download: binary::download_https }
    }

    pub fn launcher(&self, id: &str) -> PathBuf {
        let name = if cfg!(windows) { format!("{id}.cmd") } else { id.to_string() };
        self.dir.join("bin").join(name)
    }

    fn package_dir(&self, id: &str) -> PathBuf {
        self.dir.join(id)
    }

    pub fn installed(&self, id: &str) -> Option<Installed> {
        if !self.launcher(id).is_file() {
            return None;
        }
        let text = std::fs::read_to_string(self.package_dir(id).join("install.json")).ok()?;
        serde_json::from_str(&text).ok()
    }

    /// `latest` is what npm offers for an npm agent within the catalog's range, when it was
    /// asked (see [`AgentRegistry::refresh`]); an update is offered for whichever of it and the
    /// catalog's own version is newer than what is installed.
    pub fn state(&self, agent: &CatalogAgent, search_path: &[PathBuf], latest: Option<&str>) -> InstallState {
        if let Some(installed) = self.installed(&agent.id) {
            let current = installed.spec.version.clone();
            let update = [agent.available_version(), latest]
                .into_iter()
                .flatten()
                .max_by(|a, b| version_cmp(a, b))
                .filter(|newest| current.as_deref().is_none_or(|current| version_cmp(newest, current) == Ordering::Greater))
                .map(str::to_string);
            return InstallState::Managed { version: installed.spec.version, update };
        }
        if let Some(found) = agent.binary.as_deref().and_then(|binary| crate::acp::agents::find_on_path(binary, search_path)) {
            return InstallState::External(found);
        }
        // The Tauri app's install, which sessions run too.
        #[cfg(not(target_family = "wasm"))]
        if let Some(launcher) = crate::acp::agents::athas_data_dirs().iter().find_map(|dir| crate::acp::agents::managed_launcher(dir, &agent.id)) {
            return InstallState::External(launcher);
        }
        InstallState::NotInstalled
    }

    /// Installs (or updates) `agent` with the tools found by `tools`, running commands through
    /// `run`.
    pub fn install(&self, agent: &CatalogAgent, tools: &Tools, run: &dyn Fn(&mut Command) -> Result<(), String>) -> Result<Installed, String> {
        if let Some(reason) = &agent.unavailable {
            return Err(reason.clone());
        }
        if !is_valid_agent_id(&agent.id) {
            return Err(format!("{:?} is not a valid agent id", agent.id));
        }
        let mut spec = agent.install.clone().ok_or_else(|| format!("{} does not say how to install it", agent.name))?;
        let package_dir = self.package_dir(&agent.id);
        let runner = match spec.runtime {
            Runtime::Node => {
                // Without Node.js or Bun on the machine, Athas's managed Node.js runs npm, as the
                // original installs npm agents with its runtime crate.
                let (manager, runner) = match tools.node_manager() {
                    Some(found) => found,
                    None if tools.managed_node => managed_node()?,
                    None => return Err(format!("{} needs Node.js. Install Node.js (with npm) or Bun, then try again.", agent.name)),
                };
                if !is_valid_npm_name(&spec.package) {
                    return Err(format!("The package {:?} is not valid", spec.package));
                }
                let staging = self.dir.join(format!(".{}-staging", agent.id));
                let _ = std::fs::remove_dir_all(&staging);
                std::fs::create_dir_all(&staging).map_err(|error| format!("Could not create {}: {error}", staging.display()))?;
                std::fs::write(staging.join("package.json"), "{\"private\":true}\n").map_err(|error| error.to_string())?;
                // The catalog's version is the floor; npm says what the newest within the
                // catalog's range is. Without an answer the catalog's own version installs.
                let resolved = spec.range.as_deref().and_then(|range| npm_latest(&manager, &spec.package, range, spec.version.as_deref()));
                let target = match (&resolved, &spec.range, &spec.version) {
                    (Some(version), ..) => format!("{}@{version}", spec.package),
                    // No answer, but a range to hand over: the package manager picks within it.
                    (None, Some(range), _) if range != "*" => format!("{}@{range}", spec.package),
                    (None, _, Some(version)) => format!("{}@{version}", spec.package),
                    (None, ..) => spec.package.clone(),
                };
                let mut command = Command::new(&manager.program);
                if let Some(script) = &manager.script {
                    command.arg(script);
                    // npm's own scripts call `node`: the managed one comes first on PATH.
                    if let Some(dir) = manager.program.parent() {
                        command.env("PATH", dir);
                    }
                }
                match manager.kind {
                    ManagerKind::Npm => command.args(["install", "--no-audit", "--no-fund", "--omit=dev", "--prefix"]).arg(&staging).arg(&target),
                    ManagerKind::Bun => command.args(["add", "--cwd"]).arg(&staging).arg(&target),
                };
                command.current_dir(&staging);
                if let Err(error) = run(&mut command) {
                    let _ = std::fs::remove_dir_all(&staging);
                    return Err(error);
                }
                let bin = staging.join("node_modules").join(".bin");
                if !bin.join(&spec.command).exists() {
                    // A registry package names no program: take the only one it installed.
                    let programs: Vec<String> = std::fs::read_dir(&bin)
                        .map(|entries| entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
                        .unwrap_or_default();
                    match programs.as_slice() {
                        [only] => spec.command = only.clone(),
                        _ => {
                            let _ = std::fs::remove_dir_all(&staging);
                            return Err(format!("The package did not provide the program {}", spec.command));
                        }
                    }
                }
                // What landed, not what was asked for: a range leaves `install.json` exact, so
                // the next update compares against the version that actually runs.
                if let Some(version) = installed_npm_version(&staging, &spec.package) {
                    spec.version = Some(version);
                }
                let _ = std::fs::remove_dir_all(&package_dir);
                std::fs::rename(&staging, &package_dir).map_err(|error| format!("Could not finish the install: {error}"))?;
                runner
            }
            Runtime::Uvx => {
                std::fs::create_dir_all(&package_dir).map_err(|error| error.to_string())?;
                tools.uvx.clone().ok_or_else(|| format!("{} runs with uv. Install uv (which provides uvx), then try again.", agent.name))?
            }
            Runtime::Binary => {
                let archive = spec.archive.clone().ok_or_else(|| format!("{} has no download for this platform", agent.name))?;
                let version = spec.version.clone().unwrap_or_else(|| "latest".into());
                let (version_dir, executable) = binary::install(self.download, &package_dir, &version, &archive, spec.sha256.as_deref(), &spec.command)?;
                binary::remove_stale_versions(&package_dir, &[&version_dir, "install.json"]);
                executable
            }
        };
        let installed = Installed { spec, runner };
        std::fs::write(package_dir.join("install.json"), serde_json::to_vec_pretty(&installed).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        self.write_launcher(&agent.id, &installed)?;
        Ok(installed)
    }

    fn write_launcher(&self, id: &str, installed: &Installed) -> Result<(), String> {
        let launcher = self.launcher(id);
        if let Some(parent) = launcher.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let quote = |path: &Path| format!("\"{}\"", path.display());
        let script = match installed.spec.runtime {
            Runtime::Node => {
                let program = self.package_dir(id).join("node_modules").join(".bin").join(&installed.spec.command);
                let entry = std::fs::canonicalize(&program).unwrap_or(program);
                format!("#!/bin/sh\nexec {} {} \"$@\"\n", quote(&installed.runner), quote(&entry))
            }
            Runtime::Uvx => {
                let package = match &installed.spec.version {
                    Some(version) if !installed.spec.package.contains(['=', '@', '<', '>']) => format!("{}=={version}", installed.spec.package),
                    _ => installed.spec.package.clone(),
                };
                format!("#!/bin/sh\nexec {} '{package}' \"$@\"\n", quote(&installed.runner))
            }
            Runtime::Binary => format!("#!/bin/sh\nexec {} \"$@\"\n", quote(&installed.runner)),
        };
        std::fs::write(&launcher, script).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o755)).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn uninstall(&self, id: &str) -> Result<(), String> {
        if !is_valid_agent_id(id) {
            return Err(format!("{id:?} is not a valid agent id"));
        }
        let launcher = self.launcher(id);
        if launcher.exists() {
            std::fs::remove_file(&launcher).map_err(|error| format!("Could not remove the launcher: {error}"))?;
        }
        let dir = self.package_dir(id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|error| format!("Could not remove {}: {error}", dir.display()))?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManagerKind {
    Npm,
    Bun,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manager {
    pub kind: ManagerKind,
    pub program: PathBuf,
    /// The script `program` runs first: the managed runtime's `npm-cli.js`.
    pub script: Option<PathBuf>,
}

/// The runtimes already on this machine.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tools {
    pub node: Option<PathBuf>,
    pub npm: Option<PathBuf>,
    pub bun: Option<PathBuf>,
    pub uvx: Option<PathBuf>,
    /// Whether Athas can download its own Node.js when the machine has none (the desktop app).
    pub managed_node: bool,
}

impl Tools {
    pub fn find(search_path: &[PathBuf]) -> Self {
        let find = |name: &str| crate::acp::agents::find_on_path(name, search_path);
        Self { node: find("node"), npm: find("npm"), bun: find("bun"), uvx: find("uvx"), managed_node: cfg!(not(target_family = "wasm")) }
    }

    /// The package manager to install npm packages with, and the runtime to run them with: npm
    /// and node when both are there, else bun for both.
    pub fn node_manager(&self) -> Option<(Manager, PathBuf)> {
        if let (Some(npm), Some(node)) = (&self.npm, &self.node) {
            return Some((Manager { kind: ManagerKind::Npm, program: npm.clone(), script: None }, node.clone()));
        }
        self.bun.as_ref().map(|bun| (Manager { kind: ManagerKind::Bun, program: bun.clone(), script: None }, bun.clone()))
    }

    /// What a runtime-less machine is missing, for the agents list.
    pub fn missing_for(&self, runtime: &Runtime) -> Option<&'static str> {
        match runtime {
            Runtime::Node if self.node_manager().is_none() && !self.managed_node => Some("Needs Node.js or Bun"),
            Runtime::Uvx if self.uvx.is_none() => Some("Needs uv"),
            _ => None,
        }
    }
}

/// Athas's own Node.js and its npm, downloaded into `<data dir>/runtimes` the first time
/// (`NodeRuntime::get_or_install_with_npm`). Blocks; call it off the main thread.
#[cfg(not(target_family = "wasm"))]
fn managed_node() -> Result<(Manager, PathBuf), String> {
    let root = tooling::default_data_dir().ok_or_else(|| "There is no data folder for the Node.js runtime".to_string())?.join("runtimes");
    let node = futures::executor::block_on(tooling::spawn(async move { athas_runtime::NodeRuntime::get_or_install_with_npm(Some(&root)).await.map_err(|error| format!("Could not set up Node.js: {error}")) }))?;
    let script = node.npm_cli_path().ok_or_else(|| "The Node.js runtime is missing npm".to_string())?;
    let program = node.binary_path().clone();
    Ok((Manager { kind: ManagerKind::Npm, program: program.clone(), script: Some(script) }, program))
}

#[cfg(target_family = "wasm")]
fn managed_node() -> Result<(Manager, PathBuf), String> {
    Err("Agents run in the desktop app".into())
}

/// Puts the folders the caller gave on PATH (the managed Node.js) in front of the search path.
fn with_search_path(command: &mut Command) {
    let first: Vec<PathBuf> = command
        .get_envs()
        .find(|(key, _)| *key == "PATH")
        .and_then(|(_, value)| value)
        .map(|value| std::env::split_paths(value).collect())
        .unwrap_or_default();
    if let Ok(path) = std::env::join_paths(first.into_iter().chain(crate::acp::agents::search_path())) {
        command.env("PATH", path);
    }
}

/// Runs an install command, failing with the end of its output when it fails.
pub fn run_command(command: &mut Command) -> Result<(), String> {
    with_search_path(command);
    let output = command.output().map_err(|error| format!("Could not run the installer: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail: Vec<&str> = stderr.lines().rev().filter(|line| !line.trim().is_empty()).take(3).collect();
    let detail: Vec<&str> = tail.into_iter().rev().collect();
    Err(format!("The install failed ({}): {}", output.status, detail.join(" ")))
}

/// The version of `package` an install left in `dir`, read from its own `package.json`.
fn installed_npm_version(dir: &Path, package: &str) -> Option<String> {
    let manifest = dir.join("node_modules").join(package).join("package.json");
    let text = std::fs::read_to_string(manifest).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value.get("version")?.as_str().map(str::to_string)
}

/// Runs a command for what it prints; `None` when it cannot run or ends badly.
fn command_output(command: &mut Command) -> Option<String> {
    with_search_path(command);
    let output = command.output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Orders two versions the way npm does: the numeric parts first, then a prerelease behind the
/// release it leads to (`1.2.3-beta.2` < `1.2.3`, and `-beta.2` < `-beta.10`). A part that is
/// not a number compares as text, so an unexpected version never panics and never wins.
pub fn version_cmp(a: &str, b: &str) -> Ordering {
    let parts = |version: &str| {
        let core = version.split(['-', '+']).next().unwrap_or_default().to_string();
        let pre = version.split_once('-').map(|(_, rest)| rest.split('+').next().unwrap_or_default().to_string());
        (core, pre)
    };
    let (a_core, a_pre) = parts(a);
    let (b_core, b_pre) = parts(b);
    let (a_numbers, b_numbers): (Vec<&str>, Vec<&str>) = (a_core.split('.').collect(), b_core.split('.').collect());
    for index in 0..a_numbers.len().max(b_numbers.len()) {
        let number = |parts: &[&str]| parts.get(index).and_then(|part| part.parse::<u64>().ok()).unwrap_or(0);
        match number(&a_numbers).cmp(&number(&b_numbers)) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    match (&a_pre, &b_pre) {
        (None, None) => Ordering::Equal,
        // A release outranks any prerelease of the same numbers.
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(a_pre), Some(b_pre)) => {
            let (a_ids, b_ids): (Vec<&str>, Vec<&str>) = (a_pre.split('.').collect(), b_pre.split('.').collect());
            for (a_id, b_id) in a_ids.iter().zip(b_ids.iter()) {
                let order = match (a_id.parse::<u64>(), b_id.parse::<u64>()) {
                    (Ok(a_number), Ok(b_number)) => a_number.cmp(&b_number),
                    // Numbers rank below text, as semver says.
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => a_id.cmp(b_id),
                };
                if order != Ordering::Equal {
                    return order;
                }
            }
            // All the identifiers they share match: the longer one is the later prerelease.
            a_ids.len().cmp(&b_ids.len())
        }
    }
}

/// The newest version npm offers for `package` within `range` (`*` is npm's own latest), never
/// below `floor`. `None` when npm cannot answer — the caller keeps the version the catalog gave,
/// so a machine without a network, or behind a proxy npm cannot reach, installs as before.
///
/// Only npm resolves: bun has no `view` this can rely on, so a bun-only machine installs the
/// range and lets bun pick, and sees no update offered.
pub fn npm_latest(manager: &Manager, package: &str, range: &str, floor: Option<&str>) -> Option<String> {
    if manager.kind != ManagerKind::Npm || !is_valid_npm_name(package) {
        return None;
    }
    // The range reaches a shell-free `Command`, but it still names a package to fetch: anything
    // but a semver range is refused rather than passed on.
    if range.is_empty() || !range.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '*' | '^' | '~' | '<' | '>' | '=' | '|' | ' ')) {
        return None;
    }
    let target = if range == "*" { package.to_string() } else { format!("{package}@{range}") };
    let mut command = Command::new(&manager.program);
    if let Some(script) = &manager.script {
        command.arg(script);
        // npm's own scripts call `node`: the managed one comes first on PATH.
        if let Some(dir) = manager.program.parent() {
            command.env("PATH", dir);
        }
    }
    command.args(["view", &target, "version", "--json", "--fetch-retry-mintimeout", "2000", "--fetch-retry-maxtimeout", "5000"]);
    let printed = command_output(&mut command)?;
    // One matching version prints as a string, several as an array.
    let newest = match serde_json::from_str::<Value>(printed.trim()).ok()? {
        Value::String(version) => Some(version),
        Value::Array(versions) => versions.iter().filter_map(Value::as_str).max_by(|a, b| version_cmp(a, b)).map(str::to_string),
        _ => None,
    }?;
    match floor {
        // The catalog's version is a floor, never a ceiling: a yanked newest does not downgrade.
        Some(floor) if version_cmp(&newest, floor) == Ordering::Less => None,
        _ => Some(newest),
    }
}

/// The command an install of `id` runs with: its launcher and the arguments that put it into ACP
/// mode. `None` when this app has not installed it.
pub fn managed_command(id: &str) -> Option<crate::acp::agents::AgentCommand> {
    let installs = Installs::new(agents_dir()?);
    let installed = installs.installed(id)?;
    Some(crate::acp::agents::AgentCommand {
        program: installs.launcher(id),
        args: installed.spec.args.clone(),
        env: installed.spec.env.clone().into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node_agent(id: &str, version: &str) -> CatalogAgent {
        CatalogAgent {
            id: id.into(),
            name: "Test Agent".into(),
            description: None,
            source: Source::Extension,
            binary: Some("test-agent".into()),
            install: Some(InstallSpec {
                runtime: Runtime::Node,
                package: "@test/agent".into(),
                version: Some(version.into()),
                // Pinned, so these tests never reach for npm.
                range: None,
                command: "test-agent".into(),
                args: vec!["--acp".into()],
                env: BTreeMap::new(),
                archive: None,
                sha256: None,
            }),
            unavailable: None,
        }
    }

    #[test]
    fn npm_specs_and_ids_are_checked() {
        assert_eq!(split_npm_spec("@scope/name@1.2.3"), ("@scope/name", Some("1.2.3")));
        assert_eq!(split_npm_spec("plain"), ("plain", None));
        assert!(is_valid_npm_name("@agentclientprotocol/claude-agent-acp") && is_valid_npm_name("opencode-ai"));
        assert!(!is_valid_npm_name("--global") && !is_valid_npm_name("git+https://x/y") && !is_valid_npm_name("@scope"));
        assert!(is_exact_version("1.2.3") && is_exact_version("0.1.0-beta.2") && !is_exact_version("^1.0.0") && !is_exact_version("latest"));
        assert!(!is_valid_agent_id("../x") && is_valid_agent_id("gemini-cli"));
    }

    #[test]
    fn the_registry_merges_into_the_catalog() {
        let registry = parse_registry(
            r#"{"agents":[
                {"id":"gemini","name":"Gemini","version":"9.9.9","distribution":{"npx":{"package":"@google/gemini-cli@9.9.9","args":["--acp"]}}},
                {"id":"goose","name":"Goose","version":"1.0.0","distribution":{"binary":{"darwin-aarch64":{"archive":"https://x/a.tgz","cmd":"./goose"}}}},
                {"id":"fast-agent","name":"fast-agent","version":"0.3.1","distribution":{"uvx":{"package":"fast-agent-acp","args":["-x"]}}},
                {"id":"Bad Id","name":"x","version":"1"},
                {"id":"floating","name":"Floating","version":"latest","distribution":{"npx":{"package":"floating"}}}
            ]}"#,
        )
        .unwrap();
        assert_eq!(registry.len(), 4);
        assert_eq!(registry[0].id, "gemini-cli");
        assert!(registry[1].unavailable.is_some());
        assert_eq!(registry[2].install.as_ref().unwrap().runtime, Runtime::Uvx);
        assert!(registry[3].unavailable.is_some());

        let catalog = vec![CatalogAgent { id: "gemini-cli".into(), unavailable: Some("x".into()), install: None, ..node_agent("gemini-cli", "1.0.0") }];
        let merged = merge(catalog, registry);
        assert_eq!(merged.len(), 4);
        assert_eq!(merged[0].available_version(), Some("9.9.9"));
        assert!(merged[0].unavailable.is_none());
    }

    #[test]
    fn manifest_installs_are_read() {
        let manifest: extensions::AgentContribution = serde_json::from_value(serde_json::json!({
            "id": "qwen-code", "name": "Qwen Code", "binaryName": "qwen", "args": ["--acp"],
            "install": { "runtime": "node", "package": "@qwen-code/qwen-code@0.22.3", "version": "0.22.3", "command": "qwen" }
        }))
        .unwrap();
        let agents = from_extensions(&[("athas.agent.qwen-code".into(), manifest)]);
        let install = agents[0].install.as_ref().unwrap();
        assert_eq!((install.package.as_str(), install.version.as_deref(), install.args.as_slice()), ("@qwen-code/qwen-code", Some("0.22.3"), ["--acp".to_string()].as_slice()));
        // The catalog's version is the floor, and without a range npm's latest is the ceiling.
        assert_eq!(install.range.as_deref(), Some("*"));
    }

    #[test]
    fn a_manifest_range_narrows_what_npm_may_offer() {
        let manifest: extensions::AgentContribution = serde_json::from_value(serde_json::json!({
            "id": "qwen-code", "name": "Qwen Code", "binaryName": "qwen",
            "install": { "runtime": "node", "package": "@qwen-code/qwen-code", "version": "0.22.3", "range": "~0.22", "command": "qwen" }
        }))
        .unwrap();
        let agents = from_extensions(&[("athas.agent.qwen-code".into(), manifest)]);
        assert_eq!(agents[0].install.as_ref().unwrap().range.as_deref(), Some("~0.22"));
    }

    #[test]
    fn a_binary_agent_stays_pinned_to_its_checksummed_build() {
        let registry = parse_registry(
            r#"{"agents":[{"id":"goose","name":"Goose","version":"1.0.0","distribution":{"npx":{"package":"goose@1.0.0"}}}]}"#,
        )
        .unwrap();
        // The ACP Registry publishes its own pin: Athas does not widen it.
        assert_eq!(registry[0].install.as_ref().unwrap().range, None);
    }

    #[test]
    fn versions_order_as_npm_orders_them() {
        let newer = |a: &str, b: &str| version_cmp(a, b) == Ordering::Greater;
        assert!(newer("0.107.0", "0.73.0"), "0.107 is not 0.1 followed by 07");
        assert!(newer("1.0.0", "0.99.9") && newer("1.2.10", "1.2.9"));
        assert!(newer("1.2.3", "1.2.3-beta.1"), "a release outranks its prerelease");
        assert!(newer("1.2.3-beta.10", "1.2.3-beta.2") && newer("1.2.3-beta.2", "1.2.3-alpha.9"));
        assert!(newer("1.2.3-rc.1", "1.2.3-1"), "text outranks a number in a prerelease");
        assert_eq!(version_cmp("1.2.3", "1.2.3"), Ordering::Equal);
        assert_eq!(version_cmp("1.2", "1.2.0"), Ordering::Equal, "a missing part is zero");
    }

    #[test]
    fn npm_is_only_asked_for_something_that_looks_like_a_range() {
        let manager = Manager { kind: ManagerKind::Npm, program: "/nonexistent/npm".into(), script: None };
        // A name or range this did not vet would reach `npm view` as a package to fetch.
        assert_eq!(npm_latest(&manager, "@test/agent", "; rm -rf /", None), None);
        assert_eq!(npm_latest(&manager, "--global", "*", None), None);
        // bun has no `view` to rely on, so it resolves as it installs instead.
        let bun = Manager { kind: ManagerKind::Bun, program: "/nonexistent/bun".into(), script: None };
        assert_eq!(npm_latest(&bun, "@test/agent", "*", None), None);
    }

    #[test]
    fn installs_with_the_users_package_manager_and_uninstalls() {
        let dir = tempfile::tempdir().unwrap();
        let installs = Installs::new(dir.path().to_path_buf());
        let agent = node_agent("test-agent", "1.0.0");
        assert!(installs.install(&agent, &Tools::default(), &|_| Ok(())).unwrap_err().contains("needs Node.js"));

        let tools = Tools { node: Some("/usr/bin/node".into()), npm: Some("/usr/bin/npm".into()), ..Default::default() };
        let commands = std::sync::Mutex::new(Vec::new());
        // Stands in for npm: records the command and lays out what npm would.
        let fake_npm = |command: &mut Command| -> Result<(), String> {
            let args: Vec<String> = command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect();
            let prefix = PathBuf::from(&args[args.iter().position(|arg| arg == "--prefix").unwrap() + 1]);
            let bin = prefix.join("node_modules").join(".bin");
            std::fs::create_dir_all(&bin).unwrap();
            std::fs::write(bin.join("test-agent"), "#!/usr/bin/env node\n").unwrap();
            commands.lock().unwrap().push(args);
            Ok(())
        };
        let installed = installs.install(&agent, &tools, &fake_npm).unwrap();
        assert_eq!(installed.runner, PathBuf::from("/usr/bin/node"));
        assert!(commands.lock().unwrap()[0].contains(&"@test/agent@1.0.0".to_string()));
        let launcher = std::fs::read_to_string(installs.launcher("test-agent")).unwrap();
        assert!(launcher.starts_with("#!/bin/sh\nexec \"/usr/bin/node\"") && launcher.contains("test-agent"));
        assert_eq!(installs.state(&agent, &[], None), InstallState::Managed { version: Some("1.0.0".into()), update: None });
        assert_eq!(installs.state(&node_agent("test-agent", "1.1.0"), &[], None), InstallState::Managed { version: Some("1.0.0".into()), update: Some("1.1.0".into()) });
        // What npm offers counts too, and only when it is newer than what is installed.
        assert_eq!(installs.state(&agent, &[], Some("1.4.0")), InstallState::Managed { version: Some("1.0.0".into()), update: Some("1.4.0".into()) });
        assert_eq!(installs.state(&agent, &[], Some("0.9.0")), InstallState::Managed { version: Some("1.0.0".into()), update: None });

        installs.uninstall("test-agent").unwrap();
        assert_eq!(installs.state(&agent, &[], None), InstallState::NotInstalled);
        assert!(!dir.path().join("test-agent").exists());
    }

    #[test]
    fn a_failed_install_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let installs = Installs::new(dir.path().to_path_buf());
        let tools = Tools { bun: Some("/opt/bun".into()), ..Default::default() };
        let error = installs.install(&node_agent("test-agent", "1.0.0"), &tools, &|_| Err("network down".into())).unwrap_err();
        assert_eq!(error, "network down");
        assert!(installs.installed("test-agent").is_none());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
