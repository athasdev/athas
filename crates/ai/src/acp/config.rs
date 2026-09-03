use super::types::AgentConfig;
use crate::{executable_path::find_executable, runtime::AthasAppHandle as AppHandle};
use semver::Version;
use std::{
   collections::HashMap,
   fs,
   path::{Path, PathBuf},
   process::Command,
   time::Instant,
};
use tauri::Manager;

/// Cache duration for binary detection (60 seconds)
const DETECTION_CACHE_SECONDS: u64 = 60;

/// Registry of ACP-compatible agents loaded from extension manifests.
#[derive(Clone)]
pub struct AgentRegistry {
   agents: HashMap<String, AgentConfig>,
   last_detection: Option<Instant>,
   managed_bin_dir: Option<PathBuf>,
}

impl AgentRegistry {
   pub fn new(app_handle: &AppHandle) -> Self {
      Self {
         agents: HashMap::new(),
         last_detection: None,
         managed_bin_dir: managed_acp_bin_dir(app_handle),
      }
   }

   pub fn get(&self, id: &str) -> Option<&AgentConfig> {
      self.agents.get(id)
   }

   pub fn list_all(&self) -> Vec<AgentConfig> {
      let mut agents: Vec<_> = self.agents.values().cloned().collect();
      agents.sort_by_key(|agent| agent.name.clone());
      agents
   }

   pub fn replace_agents(&mut self, agents: Vec<AgentConfig>) {
      self.agents = agents
         .into_iter()
         .map(|agent| (agent.id.clone(), agent))
         .collect();
      self.invalidate_detection_cache();
   }

   pub fn detect_installed(&mut self) {
      // Check if we should skip detection due to caching
      if let Some(last) = self.last_detection {
         let elapsed = last.elapsed().as_secs();
         if elapsed < DETECTION_CACHE_SECONDS {
            log::debug!(
               "Skipping binary detection, cached for {}s more",
               DETECTION_CACHE_SECONDS - elapsed
            );
            return;
         }
      }

      log::debug!("Running binary detection for ACP agents");
      for config in self.agents.values_mut() {
         if let Some(path) = managed_wrapper_path(self.managed_bin_dir.as_deref(), &config.id) {
            config.installed = true;
            config.binary_path = Some(path.to_string_lossy().to_string());
            config.managed = true;
            config.installed_version =
               managed_agent_version(self.managed_bin_dir.as_deref(), &config.id);
            config.update_available = should_update_agent(config, true);
            continue;
         }

         if let Some(path) = find_executable(&config.binary_name) {
            config.installed = true;
            config.installed_version = detect_binary_version(&path);
            config.binary_path = Some(path.to_string_lossy().to_string());
            config.managed = false;
            config.update_available = should_update_agent(config, false);
         } else {
            config.installed = false;
            config.binary_path = None;
            config.installed_version = None;
            config.managed = false;
            config.update_available = false;
         }
      }

      self.last_detection = Some(Instant::now());
   }

   pub fn invalidate_detection_cache(&mut self) {
      self.last_detection = None;
   }
}

fn should_update_agent(config: &AgentConfig, managed: bool) -> bool {
   let Some(available) = config
      .available_version
      .as_deref()
      .and_then(|version| Version::parse(version).ok())
   else {
      return false;
   };

   match config
      .installed_version
      .as_deref()
      .and_then(|version| Version::parse(version).ok())
   {
      Some(installed) => installed < available,
      None => managed,
   }
}

fn managed_agent_version(managed_bin_dir: Option<&Path>, agent_id: &str) -> Option<String> {
   let metadata_path = managed_bin_dir?.join(format!("{agent_id}.json"));
   let metadata = fs::read_to_string(metadata_path).ok()?;
   serde_json::from_str::<serde_json::Value>(&metadata)
      .ok()?
      .get("version")?
      .as_str()
      .map(ToString::to_string)
}

fn detect_binary_version(path: &Path) -> Option<String> {
   let output = Command::new(path).arg("--version").output().ok()?;
   let text = format!(
      "{} {}",
      String::from_utf8_lossy(&output.stdout),
      String::from_utf8_lossy(&output.stderr)
   );

   text
      .split(|character: char| {
         !(character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+'))
      })
      .map(|candidate| candidate.trim_start_matches('v'))
      .find_map(|candidate| Version::parse(candidate).ok())
      .map(|version| version.to_string())
}

impl Default for AgentRegistry {
   fn default() -> Self {
      panic!("AgentRegistry::default requires an AppHandle")
   }
}

pub fn managed_wrapper_path(managed_bin_dir: Option<&Path>, agent_id: &str) -> Option<PathBuf> {
   let dir = managed_bin_dir?;
   let path = dir.join(wrapper_file_name(agent_id));
   path.is_file().then_some(path)
}

fn managed_acp_bin_dir(app_handle: &AppHandle) -> Option<PathBuf> {
   let data_dir = app_handle.path().app_data_dir().ok()?;
   Some(data_dir.join("tools").join("acp"))
}

fn wrapper_file_name(agent_id: &str) -> String {
   #[cfg(target_os = "windows")]
   {
      format!("{agent_id}.cmd")
   }

   #[cfg(not(target_os = "windows"))]
   {
      agent_id.to_string()
   }
}

#[cfg(test)]
mod tests {
   use super::{managed_agent_version, managed_wrapper_path, should_update_agent};
   use crate::acp::types::AgentConfig;
   use std::fs;

   #[test]
   fn managed_wrapper_path_prefers_expected_wrapper_name() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let wrapper = if cfg!(windows) {
         temp_dir.path().join("test-agent.cmd")
      } else {
         temp_dir.path().join("test-agent")
      };
      fs::write(&wrapper, "echo test").expect("write wrapper");

      let resolved =
         managed_wrapper_path(Some(temp_dir.path()), "test-agent").expect("wrapper should exist");
      assert_eq!(resolved, wrapper);
   }

   #[test]
   fn compares_managed_agent_versions_semantically() {
      let mut agent = AgentConfig::new("test-agent", "Test Agent", "test-agent");
      agent.available_version = Some("2.0.0".to_string());
      agent.installed_version = Some("1.10.0".to_string());

      assert!(should_update_agent(&agent, true));

      agent.installed_version = Some("2.0.0".to_string());
      assert!(!should_update_agent(&agent, true));
   }

   #[test]
   fn reads_managed_agent_version_metadata() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      fs::write(
         temp_dir.path().join("test-agent.json"),
         r#"{"version":"3.2.1"}"#,
      )
      .expect("write metadata");

      assert_eq!(
         managed_agent_version(Some(temp_dir.path()), "test-agent"),
         Some("3.2.1".to_string())
      );
   }
}
