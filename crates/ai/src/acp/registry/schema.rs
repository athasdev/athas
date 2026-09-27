//! The ACP Registry's `registry.json` and `quarantine.json`, and how Athas picks the
//! distribution it installs for this machine. Format:
//! https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md

use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};

/// One agent from `registry.json`. Unknown fields are ignored so newer registry versions keep
/// parsing.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct RegistryAgent {
   pub id: String,
   pub name: String,
   pub version: String,
   #[serde(default)]
   pub description: Option<String>,
   #[serde(default)]
   pub repository: Option<String>,
   #[serde(default)]
   pub website: Option<String>,
   #[serde(default)]
   pub authors: Vec<String>,
   #[serde(default)]
   pub license: Option<String>,
   #[serde(default)]
   pub license_url: Option<String>,
   #[serde(default)]
   pub icon: Option<String>,
   #[serde(default)]
   pub distribution: Distribution,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Distribution {
   /// Builds keyed by registry platform (`darwin-aarch64`, `windows-x86_64`, ...).
   #[serde(default)]
   pub binary: BTreeMap<String, BinaryTarget>,
   #[serde(default)]
   pub npx: Option<PackageDistribution>,
   #[serde(default)]
   pub uvx: Option<PackageDistribution>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct BinaryTarget {
   pub archive: String,
   #[serde(default)]
   pub sha256: Option<String>,
   pub cmd: String,
   #[serde(default)]
   pub args: Vec<String>,
   #[serde(default)]
   pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct PackageDistribution {
   pub package: String,
   #[serde(default)]
   pub args: Vec<String>,
   #[serde(default)]
   pub env: BTreeMap<String, String>,
}

/// The distribution Athas installs for an agent on this machine.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedDistribution {
   /// A verified download. `sha256` is lowercase hex.
   Binary {
      archive: String,
      sha256: String,
      cmd: String,
      args: Vec<String>,
      env: BTreeMap<String, String>,
   },
   /// An npm package installed with npm into Athas's own directory and run with Node.
   Npx {
      name: String,
      version: String,
      args: Vec<String>,
      env: BTreeMap<String, String>,
   },
   /// A PyPI package run through the user's `uvx`.
   Uvx {
      package: String,
      args: Vec<String>,
      env: BTreeMap<String, String>,
   },
}

impl ResolvedDistribution {
   pub fn kind(&self) -> &'static str {
      match self {
         Self::Binary { .. } => "binary",
         Self::Npx { .. } => "npx",
         Self::Uvx { .. } => "uvx",
      }
   }

   pub fn args(&self) -> &[String] {
      match self {
         Self::Binary { args, .. } | Self::Npx { args, .. } | Self::Uvx { args, .. } => args,
      }
   }

   pub fn env(&self) -> &BTreeMap<String, String> {
      match self {
         Self::Binary { env, .. } | Self::Npx { env, .. } | Self::Uvx { env, .. } => env,
      }
   }
}

/// Parses `registry.json`. Entries that do not match the format, or whose id is not safe to use
/// as a directory name, are skipped instead of failing the whole registry.
pub fn parse_registry(body: &str) -> Result<Vec<RegistryAgent>, String> {
   #[derive(Deserialize)]
   struct RawRegistry {
      #[serde(default)]
      agents: Vec<serde_json::Value>,
   }

   let raw: RawRegistry =
      serde_json::from_str(body).map_err(|error| format!("Invalid ACP registry: {error}"))?;
   Ok(raw
      .agents
      .into_iter()
      .filter_map(
         |value| match serde_json::from_value::<RegistryAgent>(value) {
            Ok(agent) if is_valid_agent_id(&agent.id) => Some(agent),
            Ok(agent) => {
               log::warn!("Skipping ACP registry agent with unsafe id {:?}", agent.id);
               None
            }
            Err(error) => {
               log::warn!("Skipping invalid ACP registry agent: {error}");
               None
            }
         },
      )
      .collect())
}

/// Parses `quarantine.json`: agent id to the reason it is quarantined.
pub fn parse_quarantine(body: &str) -> Result<HashMap<String, String>, String> {
   serde_json::from_str(body).map_err(|error| format!("Invalid ACP registry quarantine: {error}"))
}

/// Registry ids become directory and file names, so only lowercase letters, digits, `-`, `_` and
/// `.` (not leading) are accepted.
pub fn is_valid_agent_id(id: &str) -> bool {
   !id.is_empty()
      && id.len() <= 64
      && !id.starts_with('.')
      && id
         .chars()
         .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

/// The registry platform key for an OS/arch pair as Rust names them.
pub fn registry_platform(os: &str, arch: &str) -> Option<&'static str> {
   match (os, arch) {
      ("macos", "aarch64") => Some("darwin-aarch64"),
      ("macos", "x86_64") => Some("darwin-x86_64"),
      ("linux", "aarch64") => Some("linux-aarch64"),
      ("linux", "x86_64") => Some("linux-x86_64"),
      ("windows", "aarch64") => Some("windows-aarch64"),
      ("windows", "x86_64") => Some("windows-x86_64"),
      _ => None,
   }
}

pub fn current_registry_platform() -> Option<&'static str> {
   registry_platform(std::env::consts::OS, std::env::consts::ARCH)
}

/// Picks what to install on `platform`: a checksummed HTTPS binary build first, then npm, then
/// uvx. The error is a user-facing reason the agent cannot be installed here.
pub fn resolve_distribution(
   agent: &RegistryAgent,
   platform: Option<&str>,
) -> Result<ResolvedDistribution, String> {
   let mut binary_problem = None;
   if let Some(target) = platform.and_then(|platform| agent.distribution.binary.get(platform)) {
      match resolve_binary(target) {
         Ok(resolved) => return Ok(resolved),
         Err(problem) => binary_problem = Some(problem),
      }
   }

   if let Some(npx) = &agent.distribution.npx {
      return resolve_npx(npx, &agent.version);
   }

   if let Some(uvx) = &agent.distribution.uvx {
      return resolve_uvx(uvx);
   }

   Err(binary_problem.unwrap_or_else(|| {
      if agent.distribution.binary.is_empty() {
         "The registry lists no distribution Athas can install".to_string()
      } else {
         "The registry has no build for this platform".to_string()
      }
   }))
}

fn resolve_binary(target: &BinaryTarget) -> Result<ResolvedDistribution, String> {
   if !target.archive.starts_with("https://") {
      return Err("The registry build is not served over HTTPS".to_string());
   }
   let sha256 = target
      .sha256
      .as_deref()
      .map(str::trim)
      .filter(|sha| !sha.is_empty())
      .ok_or_else(|| "The registry publishes no checksum for this platform's build".to_string())?;
   if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
      return Err("The registry checksum for this build is malformed".to_string());
   }
   Ok(ResolvedDistribution::Binary {
      archive: target.archive.clone(),
      sha256: sha256.to_ascii_lowercase(),
      cmd: target.cmd.clone(),
      args: target.args.clone(),
      env: target.env.clone(),
   })
}

fn resolve_npx(
   npx: &PackageDistribution,
   registry_version: &str,
) -> Result<ResolvedDistribution, String> {
   let (name, version) = split_npm_spec(&npx.package);
   if !is_valid_npm_name(name) {
      return Err(format!(
         "The registry npm package {:?} is not valid",
         npx.package
      ));
   }
   let version = version.unwrap_or(registry_version);
   if semver::Version::parse(version).is_err() {
      return Err(format!(
         "The registry npm package {:?} is not pinned to an exact version",
         npx.package
      ));
   }
   Ok(ResolvedDistribution::Npx {
      name: name.to_string(),
      version: version.to_string(),
      args: npx.args.clone(),
      env: npx.env.clone(),
   })
}

fn resolve_uvx(uvx: &PackageDistribution) -> Result<ResolvedDistribution, String> {
   let valid = !uvx.package.is_empty()
      && !uvx.package.starts_with('-')
      && uvx.package.chars().all(|c| {
         c.is_ascii_alphanumeric()
            || matches!(
               c,
               '.' | '_' | '-' | '[' | ']' | ',' | '=' | '<' | '>' | '!' | '~' | '@'
            )
      });
   if !valid {
      return Err(format!(
         "The registry Python package {:?} is not valid",
         uvx.package
      ));
   }
   Ok(ResolvedDistribution::Uvx {
      package: uvx.package.clone(),
      args: uvx.args.clone(),
      env: uvx.env.clone(),
   })
}

/// Splits `@scope/name@1.2.3` into name and version.
pub fn split_npm_spec(spec: &str) -> (&str, Option<&str>) {
   let search_from = usize::from(spec.starts_with('@'));
   match spec[search_from..].find('@') {
      Some(index) => {
         let index = index + search_from;
         (&spec[..index], Some(&spec[index + 1..]))
      }
      None => (spec, None),
   }
}

/// npm package names: optional `@scope/`, lowercase URL-safe characters, never starting with
/// `.`, `_` or `-` (which would also let a name pass as a command-line flag).
pub fn is_valid_npm_name(name: &str) -> bool {
   fn valid_part(part: &str) -> bool {
      !part.is_empty()
         && !part.starts_with(['.', '_', '-'])
         && part
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.' | '_'))
   }

   if name.len() > 214 {
      return false;
   }
   match name.strip_prefix('@') {
      Some(scoped) => match scoped.split_once('/') {
         Some((scope, package)) => valid_part(scope) && valid_part(package),
         None => false,
      },
      None => valid_part(name),
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   const REGISTRY: &str = r#"{
      "version": "1.0.0",
      "agents": [
         {
            "id": "opencode",
            "name": "OpenCode",
            "version": "1.18.32",
            "description": "The open source coding agent",
            "repository": "https://github.com/anomalyco/opencode",
            "authors": ["Anomaly"],
            "license": "MIT",
            "icon": "https://cdn.agentclientprotocol.com/registry/v1/latest/opencode.svg",
            "futureField": true,
            "distribution": {
               "binary": {
                  "darwin-aarch64": {
                     "archive": "https://example.com/opencode-darwin-arm64.zip",
                     "cmd": "./opencode",
                     "args": ["acp"],
                     "sha256": "FA643F93401C13508D8D513780E54CE9CC01203D501114BE9B88D62408B8101F"
                  },
                  "linux-x86_64": {
                     "archive": "https://example.com/opencode-linux-x64.tar.gz",
                     "cmd": "./opencode",
                     "args": ["acp"]
                  }
               }
            }
         },
         {
            "id": "claude-acp",
            "name": "Claude Agent",
            "version": "0.81.2",
            "distribution": { "npx": { "package": "@agentclientprotocol/claude-agent-acp@0.81.2" } }
         },
         {
            "id": "fast-agent",
            "name": "fast-agent",
            "version": "0.10.1",
            "distribution": {
               "uvx": { "package": "fast-agent-acp==0.10.1", "args": ["-x"], "env": { "A": "1" } }
            }
         },
         { "id": "broken", "name": "Missing version" },
         { "id": "../escape", "name": "Escape", "version": "1.0.0", "distribution": {} }
      ]
   }"#;

   fn agent(id: &str) -> RegistryAgent {
      parse_registry(REGISTRY)
         .unwrap()
         .into_iter()
         .find(|agent| agent.id == id)
         .unwrap()
   }

   #[test]
   fn parses_the_registry_and_skips_invalid_or_unsafe_entries() {
      let agents = parse_registry(REGISTRY).unwrap();
      let ids = agents
         .iter()
         .map(|agent| agent.id.as_str())
         .collect::<Vec<_>>();
      assert_eq!(ids, vec!["opencode", "claude-acp", "fast-agent"]);
      assert_eq!(agents[0].authors, vec!["Anomaly".to_string()]);
      assert_eq!(agents[0].license.as_deref(), Some("MIT"));
      assert!(parse_registry("not json").is_err());
   }

   #[test]
   fn parses_quarantine() {
      let quarantine = parse_quarantine(r#"{ "crow-cli": "ACP initialize fails" }"#).unwrap();
      assert_eq!(quarantine["crow-cli"], "ACP initialize fails");
   }

   #[test]
   fn maps_rust_platforms_to_registry_keys() {
      assert_eq!(
         registry_platform("macos", "aarch64"),
         Some("darwin-aarch64")
      );
      assert_eq!(
         registry_platform("windows", "x86_64"),
         Some("windows-x86_64")
      );
      assert_eq!(registry_platform("freebsd", "x86_64"), None);
   }

   #[test]
   fn prefers_a_checksummed_binary_for_the_current_platform() {
      let resolved = resolve_distribution(&agent("opencode"), Some("darwin-aarch64")).unwrap();
      match resolved {
         ResolvedDistribution::Binary { sha256, args, .. } => {
            assert_eq!(
               sha256,
               "fa643f93401c13508d8d513780e54ce9cc01203d501114be9b88d62408b8101f"
            );
            assert_eq!(args, vec!["acp".to_string()]);
         }
         other => panic!("expected a binary, got {other:?}"),
      }
   }

   #[test]
   fn refuses_binaries_without_a_checksum_or_for_other_platforms() {
      let error = resolve_distribution(&agent("opencode"), Some("linux-x86_64")).unwrap_err();
      assert!(error.contains("checksum"), "{error}");
      let error = resolve_distribution(&agent("opencode"), Some("windows-aarch64")).unwrap_err();
      assert!(error.contains("no build"), "{error}");
   }

   #[test]
   fn falls_back_to_npm_when_the_binary_has_no_checksum() {
      let mut agent = agent("opencode");
      agent.distribution.npx = Some(PackageDistribution {
         package: "opencode-ai@1.18.32".to_string(),
         args: vec!["acp".to_string()],
         env: BTreeMap::new(),
      });
      let resolved = resolve_distribution(&agent, Some("linux-x86_64")).unwrap();
      assert_eq!(resolved.kind(), "npx");
   }

   #[test]
   fn refuses_plain_http_archives() {
      let mut agent = agent("opencode");
      agent
         .distribution
         .binary
         .get_mut("darwin-aarch64")
         .unwrap()
         .archive = "http://example.com/opencode.zip".to_string();
      let error = resolve_distribution(&agent, Some("darwin-aarch64")).unwrap_err();
      assert!(error.contains("HTTPS"), "{error}");
   }

   #[test]
   fn resolves_npm_packages_to_an_exact_version() {
      match resolve_distribution(&agent("claude-acp"), Some("darwin-aarch64")).unwrap() {
         ResolvedDistribution::Npx { name, version, .. } => {
            assert_eq!(name, "@agentclientprotocol/claude-agent-acp");
            assert_eq!(version, "0.81.2");
         }
         other => panic!("expected npx, got {other:?}"),
      }
   }

   #[test]
   fn rejects_npm_specs_that_are_not_plain_pinned_packages() {
      let mut agent = agent("claude-acp");
      for package in ["--global", "git+https://x/y", "pkg@^1.0.0", "pkg@latest"] {
         agent.distribution.npx.as_mut().unwrap().package = package.to_string();
         assert!(
            resolve_distribution(&agent, None).is_err(),
            "{package} should be rejected"
         );
      }
   }

   #[test]
   fn resolves_uvx_packages_and_rejects_flags() {
      let mut agent = agent("fast-agent");
      let resolved = resolve_distribution(&agent, None).unwrap();
      assert_eq!(resolved.kind(), "uvx");
      assert_eq!(resolved.env()["A"], "1");
      agent.distribution.uvx.as_mut().unwrap().package = "minion-code@0.1.44".to_string();
      assert!(resolve_distribution(&agent, None).is_ok());
      agent.distribution.uvx.as_mut().unwrap().package = "--with evil".to_string();
      assert!(resolve_distribution(&agent, None).is_err());
   }

   #[test]
   fn splits_npm_specs() {
      assert_eq!(split_npm_spec("@a/b@1.0.0"), ("@a/b", Some("1.0.0")));
      assert_eq!(split_npm_spec("cline@3.0.65"), ("cline", Some("3.0.65")));
      assert_eq!(split_npm_spec("@a/b"), ("@a/b", None));
   }
}
