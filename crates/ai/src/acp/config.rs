use super::types::AgentConfig;
use crate::runtime::AthasAppHandle as AppHandle;
use serde::Deserialize;
use std::{
   collections::HashMap,
   env, fs,
   path::{Path, PathBuf},
   process::Command,
   sync::OnceLock,
   time::Instant,
};
use tauri::Manager;

/// Cache duration for binary detection (60 seconds)
const DETECTION_CACHE_SECONDS: u64 = 60;

/// Get the user's login shell PATH. Bundled apps inherit a minimal PATH,
/// so we source the full one from the user's shell and cache it.
pub(crate) fn user_shell_path() -> Option<&'static str> {
   static CACHED: OnceLock<Option<String>> = OnceLock::new();
   CACHED
      .get_or_init(|| {
         if cfg!(target_os = "windows") {
            return None;
         }
         let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
         let output = Command::new(&shell)
            .args(["-ilc", "echo $PATH"])
            .output()
            .ok()?;
         let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
         if path.is_empty() { None } else { Some(path) }
      })
      .as_deref()
}

/// Registry of ACP-compatible agents loaded from extension manifests.
#[derive(Clone)]
pub struct AgentRegistry {
   agents: HashMap<String, AgentConfig>,
   last_detection: Option<Instant>,
   managed_bin_dir: Option<PathBuf>,
   managed_receipt_dir: Option<PathBuf>,
}

impl AgentRegistry {
   pub fn new(app_handle: &AppHandle) -> Self {
      Self {
         agents: HashMap::new(),
         last_detection: None,
         managed_bin_dir: managed_acp_bin_dir(app_handle),
         managed_receipt_dir: managed_acp_receipt_dir(app_handle),
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
            config.update_available =
               managed_agent_needs_update(self.managed_receipt_dir.as_deref(), config);
            continue;
         }

         config.update_available = false;

         if config.id == "codex-cli" {
            detect_codex_adapter(config);
            continue;
         }

         if let Some(path) = config.binary_path.as_ref().map(PathBuf::from)
            && path.is_file()
         {
            config.installed = true;
            config.binary_path = Some(path.to_string_lossy().to_string());
            continue;
         }

         if let Some(path) = find_binary(&config.binary_name) {
            config.installed = true;
            config.binary_path = Some(path.to_string_lossy().to_string());
         } else {
            config.installed = false;
            config.binary_path = None;
         }
      }

      self.last_detection = Some(Instant::now());
   }

   pub fn invalidate_detection_cache(&mut self) {
      self.last_detection = None;
   }
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

fn managed_acp_receipt_dir(app_handle: &AppHandle) -> Option<PathBuf> {
   let data_dir = app_handle.path().app_data_dir().ok()?;
   Some(data_dir.join("tools").join("acp").join(".receipts"))
}

fn managed_agent_receipt_path(receipt_dir: Option<&Path>, agent_id: &str) -> Option<PathBuf> {
   let dir = receipt_dir?;
   Some(dir.join(format!("{}.json", receipt_file_stem(agent_id))))
}

fn receipt_file_stem(agent_id: &str) -> String {
   agent_id
      .chars()
      .map(|character| match character {
         'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => character,
         _ => '_',
      })
      .collect()
}

fn managed_agent_needs_update(receipt_dir: Option<&Path>, config: &AgentConfig) -> bool {
   if !config.can_install {
      return false;
   }

   let Some(receipt_path) = managed_agent_receipt_path(receipt_dir, &config.id) else {
      return false;
   };
   let Ok(receipt_json) = fs::read_to_string(receipt_path) else {
      return true;
   };
   let Ok(receipt) = serde_json::from_str::<ManagedAgentReceipt>(&receipt_json) else {
      return true;
   };

   !receipt.matches(config)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedAgentReceipt {
   install_runtime: Option<String>,
   install_package: Option<String>,
   install_download_url: Option<String>,
   install_command: Option<String>,
}

impl ManagedAgentReceipt {
   fn matches(&self, config: &AgentConfig) -> bool {
      self.install_runtime == agent_runtime_key(config)
         && self.install_package == config.install_package
         && self.install_download_url == config.install_download_url
         && self.install_command == config.install_command
   }
}

fn agent_runtime_key(config: &AgentConfig) -> Option<String> {
   config
      .install_runtime
      .as_ref()
      .and_then(|runtime| serde_json::to_value(runtime).ok())
      .and_then(|value| value.as_str().map(ToString::to_string))
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

fn detect_codex_adapter(config: &mut AgentConfig) {
   // Prefer a direct codex-acp binary when available.
   if let Some(path) = find_binary("codex-acp") {
      config.installed = true;
      config.binary_path = Some(path.to_string_lossy().to_string());
      config.args.clear();
      log::debug!("Detected codex-acp binary at {}", path.display());
      return;
   }

   config.installed = false;
   config.binary_path = None;
   config.args.clear();
   log::debug!("Codex ACP adapter not found");
}

fn find_binary(binary_name: &str) -> Option<PathBuf> {
   if let Ok(path) = which::which(binary_name) {
      return Some(path);
   }

   let mut candidates: Vec<PathBuf> = Vec::new();

   // PATH entries from the current process
   if let Some(paths) = env::var_os("PATH") {
      candidates.extend(env::split_paths(&paths));
   }

   // Bundled apps inherit a restricted PATH. Source the user's login shell
   // to get the full PATH (cached for the process lifetime).
   if let Some(shell_path) = user_shell_path() {
      candidates.extend(env::split_paths(&std::ffi::OsString::from(shell_path)));
   }

   // Common global bin locations
   if let Some(home) = env::var_os("HOME") {
      let home = PathBuf::from(home);
      candidates.push(home.join(".local/bin"));
      candidates.push(home.join(".npm-global/bin"));
      candidates.push(home.join(".yarn/bin"));
      candidates.push(home.join(".config/yarn/global/node_modules/.bin"));
      candidates.push(home.join(".bun/bin"));
      candidates.push(home.join(".pnpm"));
      candidates.push(home.join("Library/pnpm"));
      candidates.push(home.join("Library/pnpm/bin"));
      candidates.push(home.join(".cargo/bin"));
      candidates.push(home.join("go/bin"));
      candidates.push(home.join(".asdf/shims"));
      candidates.push(home.join(".local/share/mise/shims"));

      // mise Node installs: ~/.local/share/mise/installs/node/*/bin
      let mise_node = home.join(".local/share/mise/installs/node");
      if let Ok(entries) = fs::read_dir(mise_node) {
         for entry in entries.flatten() {
            candidates.push(entry.path().join("bin"));
         }
      }

      // asdf Node installs: ~/.asdf/installs/nodejs/*/bin
      let asdf_node = home.join(".asdf/installs/nodejs");
      if let Ok(entries) = fs::read_dir(asdf_node) {
         for entry in entries.flatten() {
            candidates.push(entry.path().join("bin"));
         }
      }

      // nvm Node installs: ~/.nvm/versions/node/*/bin
      let nvm_node = home.join(".nvm/versions/node");
      if let Ok(entries) = fs::read_dir(nvm_node) {
         for entry in entries.flatten() {
            candidates.push(entry.path().join("bin"));
         }
      }
   }

   // Common system paths on macOS/Linux
   candidates.push(PathBuf::from("/usr/local/bin"));
   candidates.push(PathBuf::from("/opt/homebrew/bin"));
   candidates.push(PathBuf::from("/usr/bin"));
   candidates.push(PathBuf::from("/bin"));
   candidates.push(PathBuf::from("/opt/local/bin"));

   if let Ok(cwd) = env::current_dir() {
      candidates.push(cwd.join("node_modules/.bin"));
   }

   // Env-specific bin dirs if present
   if let Some(dir) = env::var_os("PNPM_HOME") {
      candidates.push(PathBuf::from(dir));
   }
   if let Some(dir) = env::var_os("BUN_INSTALL") {
      candidates.push(PathBuf::from(dir).join("bin"));
   }
   if let Some(dir) = env::var_os("VOLTA_HOME") {
      candidates.push(PathBuf::from(dir).join("bin"));
   }
   if let Some(dir) = env::var_os("NVM_BIN") {
      candidates.push(PathBuf::from(dir));
   }
   if let Some(dir) = env::var_os("MISE_DATA_DIR") {
      let mise_node = PathBuf::from(dir).join("installs/node");
      if let Ok(entries) = fs::read_dir(mise_node) {
         for entry in entries.flatten() {
            candidates.push(entry.path().join("bin"));
         }
      }
   }
   if let Some(dir) = env::var_os("ASDF_DATA_DIR") {
      let asdf_node = PathBuf::from(dir).join("installs/nodejs");
      if let Ok(entries) = fs::read_dir(asdf_node) {
         for entry in entries.flatten() {
            candidates.push(entry.path().join("bin"));
         }
      }
   }
   if let Some(dir) = env::var_os("GOPATH") {
      candidates.push(PathBuf::from(dir).join("bin"));
   }
   if let Some(dir) = env::var_os("GOBIN") {
      candidates.push(PathBuf::from(dir));
   }
   if let Some(dir) = env::var_os("CARGO_HOME") {
      candidates.push(PathBuf::from(dir).join("bin"));
   }

   for dir in candidates {
      if let Some(found) = check_dir_for_binary(&dir, binary_name) {
         return Some(found);
      }
   }

   None
}

fn check_dir_for_binary(dir: &Path, binary_name: &str) -> Option<PathBuf> {
   #[cfg(target_os = "windows")]
   {
      let lowercase_name = binary_name.to_ascii_lowercase();
      let mut candidate_names = vec![binary_name.to_string()];

      for ext in [".exe", ".cmd", ".bat", ".ps1"] {
         if !lowercase_name.ends_with(ext) {
            candidate_names.push(format!("{binary_name}{ext}"));
         }
      }

      for name in candidate_names {
         let candidate = dir.join(name);
         if candidate.is_file() {
            return Some(candidate);
         }
      }

      None
   }

   #[cfg(not(target_os = "windows"))]
   {
      let candidate = dir.join(binary_name);
      if candidate.is_file() {
         return Some(candidate);
      }
      None
   }
}

#[cfg(test)]
mod tests {
   use super::{check_dir_for_binary, managed_agent_needs_update, managed_wrapper_path};
   use crate::acp::types::{AgentConfig, AgentRuntime};
   use std::{fs, path::PathBuf};

   #[test]
   fn managed_wrapper_path_prefers_expected_wrapper_name() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let wrapper = if cfg!(windows) {
         temp_dir.path().join("codex-cli.cmd")
      } else {
         temp_dir.path().join("codex-cli")
      };
      fs::write(&wrapper, "echo test").expect("write wrapper");

      let resolved =
         managed_wrapper_path(Some(temp_dir.path()), "codex-cli").expect("wrapper should exist");
      assert_eq!(resolved, wrapper);
   }

   #[test]
   fn check_dir_for_binary_returns_none_for_missing_binary() {
      let missing = check_dir_for_binary(PathBuf::from("/tmp/athas-missing").as_path(), "nope");
      assert!(missing.is_none());
   }

   #[test]
   fn missing_managed_receipt_marks_install_update_available() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let mut config = AgentConfig::new("amp-acp", "Amp", "amp-acp");
      config.install_runtime = Some(AgentRuntime::Binary);
      config.install_package = Some("./amp-acp".to_string());
      config.install_download_url = Some("https://example.com/amp-v1.tar.gz".to_string());
      config.install_command = Some("amp-acp".to_string());
      config.can_install = true;

      assert!(managed_agent_needs_update(Some(temp_dir.path()), &config));
   }

   #[test]
   fn stale_managed_receipt_marks_install_update_available() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      fs::write(
         temp_dir.path().join("amp-acp.json"),
         r#"{
  "installRuntime": "binary",
  "installPackage": "./amp-acp",
  "installDownloadUrl": "https://example.com/amp-v1.tar.gz",
  "installCommand": "amp-acp"
}"#,
      )
      .expect("write receipt");

      let mut config = AgentConfig::new("amp-acp", "Amp", "amp-acp");
      config.install_runtime = Some(AgentRuntime::Binary);
      config.install_package = Some("./amp-acp".to_string());
      config.install_download_url = Some("https://example.com/amp-v2.tar.gz".to_string());
      config.install_command = Some("amp-acp".to_string());
      config.can_install = true;

      assert!(managed_agent_needs_update(Some(temp_dir.path()), &config));
   }

   #[test]
   fn current_managed_receipt_keeps_install_current() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      fs::write(
         temp_dir.path().join("codex-acp.json"),
         r#"{
  "installRuntime": "node",
  "installPackage": "@vendor/codex-acp@1.0.0",
  "installDownloadUrl": null,
  "installCommand": "codex-acp"
}"#,
      )
      .expect("write receipt");

      let mut config = AgentConfig::new("codex-acp", "Codex", "codex-acp");
      config.install_runtime = Some(AgentRuntime::Node);
      config.install_package = Some("@vendor/codex-acp@1.0.0".to_string());
      config.install_command = Some("codex-acp".to_string());
      config.can_install = true;

      assert!(!managed_agent_needs_update(Some(temp_dir.path()), &config));
   }
}
