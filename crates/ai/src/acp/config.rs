use super::types::{AgentConfig, AgentSource};
use crate::{
   executable_path::{find_executable, probe_command},
   runtime::AthasAppHandle as AppHandle,
};
use semver::Version;
use std::{
   collections::HashMap,
   fs,
   path::{Path, PathBuf},
   process::Command,
   time::{Duration, Instant, SystemTime},
};
use tauri::Manager;

/// Cache duration for binary detection (60 seconds)
const DETECTION_CACHE_SECONDS: u64 = 60;

/// How long a binary's `--version` answer is trusted while the file itself is unchanged.
const VERSION_CACHE_TTL: Duration = Duration::from_secs(10 * 60);

/// A binary's `--version` answer and the file it came from.
#[derive(Clone)]
struct CachedVersion {
   modified: Option<SystemTime>,
   len: u64,
   checked_at: Instant,
   version: Option<String>,
}

/// Registry of ACP-compatible agents loaded from extension manifests.
#[derive(Clone)]
pub struct AgentRegistry {
   agents: HashMap<String, AgentConfig>,
   last_detection: Option<Instant>,
   managed_bin_dir: Option<PathBuf>,
   /// `--version` answers by binary path. The catalog is rebuilt on every request, which resets
   /// detection, so without this every agent on PATH was run again each time.
   versions: HashMap<PathBuf, CachedVersion>,
}

impl AgentRegistry {
   pub fn new(app_handle: &AppHandle) -> Self {
      Self {
         agents: HashMap::new(),
         last_detection: None,
         managed_bin_dir: managed_acp_bin_dir(app_handle),
         versions: HashMap::new(),
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

         // Registry-only agents run from Athas's own install, never a same-named program.
         let on_path = (config.source == AgentSource::Extension)
            .then(|| find_executable(&config.binary_name))
            .flatten();
         if let Some(path) = on_path {
            config.installed = true;
            config.installed_version =
               cached_binary_version(&mut self.versions, &path, Instant::now(), |path| {
                  detect_binary_version(path)
               });
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

   /// Forgets every `--version` answer too, for when the user asks for a fresh look.
   pub fn clear_version_cache(&mut self) {
      self.versions.clear();
      self.invalidate_detection_cache();
   }
}

/// The version of the binary at `path`, asking `probe` only when the file changed since it was
/// last asked or the answer is older than [`VERSION_CACHE_TTL`].
fn cached_binary_version(
   cache: &mut HashMap<PathBuf, CachedVersion>,
   path: &Path,
   now: Instant,
   probe: impl FnOnce(&Path) -> Option<String>,
) -> Option<String> {
   let metadata = fs::metadata(path).ok();
   let modified = metadata
      .as_ref()
      .and_then(|metadata| metadata.modified().ok());
   let len = metadata.as_ref().map_or(0, |metadata| metadata.len());
   if let Some(cached) = cache.get(path)
      && cached.modified == modified
      && cached.len == len
      && now.saturating_duration_since(cached.checked_at) < VERSION_CACHE_TTL
   {
      return cached.version.clone();
   }
   let version = probe(path);
   cache.insert(
      path.to_path_buf(),
      CachedVersion {
         modified,
         len,
         checked_at: now,
         version: version.clone(),
      },
   );
   version
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
   let output = probe_command(Command::new(path).arg("--version"), Duration::from_secs(2)).ok()?;
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
   use super::{
      AgentRegistry, VERSION_CACHE_TTL, cached_binary_version, managed_agent_version,
      managed_wrapper_path, should_update_agent,
   };
   use crate::acp::types::{AgentConfig, AgentSource};
   use std::{cell::Cell, collections::HashMap, fs, time::Instant};

   #[test]
   fn asks_a_binary_its_version_again_only_when_it_changed_or_the_answer_is_old() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let binary = temp_dir.path().join("agent");
      fs::write(&binary, "v1").expect("write binary");
      let mut cache = HashMap::new();
      let probes = Cell::new(0);
      let probe = |_: &std::path::Path| {
         probes.set(probes.get() + 1);
         Some(format!("1.0.{}", probes.get()))
      };
      let start = Instant::now();

      assert_eq!(
         cached_binary_version(&mut cache, &binary, start, probe).as_deref(),
         Some("1.0.1")
      );
      assert_eq!(
         cached_binary_version(&mut cache, &binary, start, probe).as_deref(),
         Some("1.0.1")
      );
      assert_eq!(probes.get(), 1);

      // A replaced binary (another size here) is asked again.
      fs::write(&binary, "version 2").expect("rewrite binary");
      assert_eq!(
         cached_binary_version(&mut cache, &binary, start, probe).as_deref(),
         Some("1.0.2")
      );

      let later = start + VERSION_CACHE_TTL;
      assert_eq!(
         cached_binary_version(&mut cache, &binary, later, probe).as_deref(),
         Some("1.0.3")
      );
      assert_eq!(probes.get(), 3);
   }

   #[cfg(unix)]
   #[test]
   fn registry_only_agents_are_not_taken_from_path() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let mut from_extension = AgentConfig::new("ext", "Extension", "sh");
      from_extension.source = AgentSource::Extension;
      let mut from_registry = AgentConfig::new("reg", "Registry", "sh");
      from_registry.source = AgentSource::Registry;
      let mut registry = AgentRegistry {
         agents: Default::default(),
         last_detection: None,
         managed_bin_dir: Some(temp_dir.path().to_path_buf()),
         versions: HashMap::new(),
      };
      registry.replace_agents(vec![from_extension, from_registry]);

      registry.detect_installed();

      assert!(registry.get("ext").unwrap().installed);
      assert!(!registry.get("reg").unwrap().installed);

      fs::write(temp_dir.path().join("reg"), "#!/bin/sh\n").expect("write launcher");
      registry.invalidate_detection_cache();
      registry.detect_installed();
      assert!(registry.get("reg").unwrap().installed);
   }

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
