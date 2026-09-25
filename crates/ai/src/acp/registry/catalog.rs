//! Merges the ACP Registry into the agent catalog built from Athas's extension manifests.
//!
//! Precedence:
//! - An agent Athas ships a manifest for keeps its manifest entry (name, description, the binary
//!   name used to find a copy on PATH). When the registry can install it on this machine and has
//!   not quarantined it, installs and updates come from the registry: its version becomes the
//!   available version and its args and env are used to launch the agent. Otherwise the manifest's
//!   own install stays in charge (for example a binary the registry publishes without a checksum).
//! - An agent only the registry lists is added as a registry agent. It is launched only from
//!   Athas's own install, never from a same-named program on PATH.

use super::{
   schema::{RegistryAgent, resolve_distribution},
   store::RegistrySnapshot,
};
use crate::acp::types::{AgentConfig, AgentRuntime, AgentSource, RegistryAgentInfo};
use std::collections::HashMap;

/// Registry ids that Athas's manifests name differently.
const ATHAS_AGENT_IDS: &[(&str, &str)] = &[("gemini", "gemini-cli"), ("kimi", "kimi-cli")];

/// The Athas agent id for a registry id.
pub fn athas_agent_id(registry_id: &str) -> &str {
   ATHAS_AGENT_IDS
      .iter()
      .find(|(registry, _)| *registry == registry_id)
      .map_or(registry_id, |(_, athas)| athas)
}

fn runtime_for(distribution: &str) -> AgentRuntime {
   match distribution {
      "npx" => AgentRuntime::Node,
      "uvx" => AgentRuntime::Python,
      _ => AgentRuntime::Binary,
   }
}

fn registry_info(
   agent: &RegistryAgent,
   snapshot: &RegistrySnapshot,
   platform: Option<&str>,
) -> (RegistryAgentInfo, Option<super::ResolvedDistribution>) {
   let quarantined = snapshot.quarantine.get(&agent.id).cloned();
   let resolved = resolve_distribution(agent, platform);
   let unavailable_reason = match (&resolved, &quarantined) {
      (Err(reason), _) => Some(reason.clone()),
      (Ok(_), Some(reason)) => Some(format!("Quarantined by the ACP Registry: {reason}")),
      (Ok(_), None) => None,
   };
   let resolved = resolved.ok().filter(|_| quarantined.is_none());
   let info = RegistryAgentInfo {
      id: agent.id.clone(),
      version: agent.version.clone(),
      repository: agent.repository.clone(),
      website: agent.website.clone(),
      authors: agent.authors.clone(),
      license: agent.license.clone(),
      license_url: agent.license_url.clone(),
      distribution: resolved
         .as_ref()
         .map(|resolved| resolved.kind().to_string()),
      installs_from_registry: resolved.is_some(),
      unavailable_reason,
      quarantined,
   };
   (info, resolved)
}

fn apply_distribution(agent: &mut AgentConfig, resolved: &super::ResolvedDistribution) {
   agent.args = resolved.args().to_vec();
   agent.env_vars.extend(
      resolved
         .env()
         .iter()
         .map(|(key, value)| (key.clone(), value.clone())),
   );
}

/// The catalog with the registry merged in. `include` filters registry ids (Athas keeps some
/// agents, such as its terminal integrations, out of the ACP catalog).
pub fn merge_registry_agents(
   manifest_agents: Vec<AgentConfig>,
   snapshot: &RegistrySnapshot,
   platform: Option<&str>,
   include: impl Fn(&str) -> bool,
) -> Vec<AgentConfig> {
   let mut agents = manifest_agents
      .into_iter()
      .map(|agent| (agent.id.clone(), agent))
      .collect::<HashMap<_, _>>();

   for registry_agent in &snapshot.agents {
      let agent_id = athas_agent_id(&registry_agent.id).to_string();
      if !include(&agent_id) {
         continue;
      }
      let (info, resolved) = registry_info(registry_agent, snapshot, platform);
      let icon = snapshot.icons.get(&registry_agent.id).cloned();

      match agents.get_mut(&agent_id) {
         Some(agent) => {
            if let Some(resolved) = &resolved {
               apply_distribution(agent, resolved);
               agent.available_version = Some(registry_agent.version.clone());
               agent.can_install = true;
            }
            if agent.icon.is_none() {
               agent.icon = icon;
            }
            agent.registry = Some(info);
         }
         None => {
            let mut agent = AgentConfig::new(&agent_id, &registry_agent.name, &agent_id);
            agent.source = AgentSource::Registry;
            agent.description = registry_agent.description.clone();
            agent.icon = icon;
            agent.available_version = Some(registry_agent.version.clone());
            if let Some(resolved) = &resolved {
               apply_distribution(&mut agent, resolved);
               agent.install_runtime = Some(runtime_for(resolved.kind()));
               agent.can_install = true;
            }
            agent.registry = Some(info);
            agents.insert(agent_id, agent);
         }
      }
   }

   let mut agents = agents.into_values().collect::<Vec<_>>();
   agents.sort_by(|left, right| left.name.cmp(&right.name));
   agents
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::acp::registry::schema::parse_registry;

   fn snapshot() -> RegistrySnapshot {
      let agents = parse_registry(
         r#"{ "agents": [
            { "id": "gemini", "name": "Gemini CLI", "version": "0.61.0",
              "repository": "https://github.com/google-gemini/gemini-cli",
              "authors": ["Google"], "license": "Apache-2.0",
              "distribution": { "npx": { "package": "@google/gemini-cli@0.61.0", "args": ["--acp"],
                                         "env": { "NO_UPDATE": "1" } } } },
            { "id": "antigravity-acp", "name": "Antigravity", "version": "1.2.1",
              "distribution": { "binary": { "darwin-aarch64": {
                 "archive": "https://example.com/a.tar.gz", "cmd": "./agy" } } } },
            { "id": "goose", "name": "Goose", "version": "1.52.0",
              "description": "An open source agent",
              "distribution": { "binary": { "darwin-aarch64": {
                 "archive": "https://example.com/goose.tar.bz2", "cmd": "./goose", "args": ["acp"],
                 "sha256": "fa643f93401c13508d8d513780e54ce9cc01203d501114be9b88d62408b8101f" } } } },
            { "id": "crow-cli", "name": "Crow", "version": "0.1.24",
              "distribution": { "npx": { "package": "crow-cli@0.1.24" } } },
            { "id": "claude-code", "name": "Terminal integration", "version": "1.0.0",
              "distribution": { "npx": { "package": "claude-code@1.0.0" } } }
         ] }"#,
      )
      .unwrap();
      RegistrySnapshot {
         agents,
         quarantine: HashMap::from([("crow-cli".to_string(), "Broken".to_string())]),
         icons: HashMap::from([(
            "goose".to_string(),
            "data:image/svg+xml;base64,".to_string(),
         )]),
         fetched_at: None,
      }
   }

   fn manifest_agent(id: &str, version: &str) -> AgentConfig {
      let mut agent = AgentConfig::new(id, id, id).with_install(AgentRuntime::Node, "pkg@1.0.0");
      agent.available_version = Some(version.to_string());
      agent.args = vec!["--old".to_string()];
      agent
   }

   fn merged() -> Vec<AgentConfig> {
      merge_registry_agents(
         vec![
            manifest_agent("gemini-cli", "0.58.0"),
            manifest_agent("antigravity-acp", "1.0.0"),
         ],
         &snapshot(),
         Some("darwin-aarch64"),
         |id| id != "claude-code",
      )
   }

   fn find<'a>(agents: &'a [AgentConfig], id: &str) -> &'a AgentConfig {
      agents.iter().find(|agent| agent.id == id).unwrap()
   }

   #[test]
   fn the_registry_installs_manifest_agents_it_can_serve() {
      let agents = merged();
      let gemini = find(&agents, "gemini-cli");
      assert_eq!(gemini.source, AgentSource::Extension);
      assert_eq!(gemini.available_version.as_deref(), Some("0.61.0"));
      assert_eq!(gemini.args, vec!["--acp".to_string()]);
      assert_eq!(gemini.env_vars["NO_UPDATE"], "1");
      let info = gemini.registry.as_ref().unwrap();
      assert!(info.installs_from_registry);
      assert_eq!(info.distribution.as_deref(), Some("npx"));
      assert_eq!(info.license.as_deref(), Some("Apache-2.0"));
      // The manifest install stays on record for cleaning up earlier installs.
      assert_eq!(gemini.install_package.as_deref(), Some("pkg@1.0.0"));
   }

   #[test]
   fn the_manifest_keeps_agents_the_registry_cannot_install_safely() {
      let agents = merged();
      let antigravity = find(&agents, "antigravity-acp");
      assert_eq!(antigravity.available_version.as_deref(), Some("1.0.0"));
      assert_eq!(antigravity.args, vec!["--old".to_string()]);
      let info = antigravity.registry.as_ref().unwrap();
      assert!(!info.installs_from_registry);
      assert!(
         info
            .unavailable_reason
            .as_deref()
            .unwrap()
            .contains("checksum")
      );
   }

   #[test]
   fn registry_only_agents_join_the_catalog() {
      let agents = merged();
      let goose = find(&agents, "goose");
      assert_eq!(goose.source, AgentSource::Registry);
      assert!(goose.can_install);
      assert_eq!(goose.install_runtime, Some(AgentRuntime::Binary));
      assert_eq!(goose.args, vec!["acp".to_string()]);
      assert_eq!(goose.description.as_deref(), Some("An open source agent"));
      assert!(goose.icon.as_deref().unwrap().starts_with("data:"));
   }

   #[test]
   fn quarantined_agents_are_listed_but_not_installable() {
      let agents = merged();
      let crow = find(&agents, "crow-cli");
      assert!(!crow.can_install);
      let info = crow.registry.as_ref().unwrap();
      assert_eq!(info.quarantined.as_deref(), Some("Broken"));
      assert!(!info.installs_from_registry);
   }

   #[test]
   fn excluded_ids_stay_out() {
      assert!(merged().iter().all(|agent| agent.id != "claude-code"));
   }

   #[test]
   fn an_empty_registry_leaves_the_manifest_catalog_alone() {
      let agents = merge_registry_agents(
         vec![manifest_agent("gemini-cli", "0.58.0")],
         &RegistrySnapshot::default(),
         Some("darwin-aarch64"),
         |_| true,
      );
      assert_eq!(agents.len(), 1);
      assert!(agents[0].registry.is_none());
      assert_eq!(agents[0].available_version.as_deref(), Some("0.58.0"));
   }
}
