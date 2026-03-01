use super::types::AgentConfig;
use std::{
   collections::HashMap,
   env, fs,
   path::{Path, PathBuf},
   time::Instant,
};

/// Cache duration for binary detection (60 seconds)
const DETECTION_CACHE_SECONDS: u64 = 60;

/// Registry of known ACP-compatible agents
#[derive(Clone)]
pub struct AgentRegistry {
   agents: HashMap<String, AgentConfig>,
   last_detection: Option<Instant>,
}

impl AgentRegistry {
   pub fn new() -> Self {
      let mut agents = HashMap::new();

      // Claude Code - ACP adapter (Zed)
      // Install: npm install -g @zed-industries/claude-code-acp
      agents.insert(
         "claude-code".to_string(),
         AgentConfig::new("claude-code", "Claude Code", "claude-code-acp")
            .with_description("Claude Code (ACP adapter)"),
      );

      // Codex CLI (OpenAI) - ACP adapter
      // Preferred install: npm install -g @zed-industries/codex-acp
      agents.insert(
         "codex-cli".to_string(),
         AgentConfig::new("codex-cli", "Codex CLI", "codex-acp")
            .with_description("OpenAI Codex (ACP adapter)"),
      );

      // Gemini CLI - native ACP support with --experimental-acp flag
      agents.insert(
         "gemini-cli".to_string(),
         AgentConfig::new("gemini-cli", "Gemini CLI", "gemini")
            .with_description("Google Gemini CLI")
            .with_args(vec!["--experimental-acp"]),
      );

      // Kimi CLI - native ACP support with --acp flag
      // Install: npm install -g @anthropic/kimi-cli or cargo install kimi-cli
      agents.insert(
         "kimi-cli".to_string(),
         AgentConfig::new("kimi-cli", "Kimi CLI", "kimi")
            .with_description("Moonshot Kimi CLI")
            .with_args(vec!["--acp"]),
      );

      // OpenCode - native ACP support with 'acp' subcommand
      // Install: go install github.com/sst/opencode@latest
      agents.insert(
         "opencode".to_string(),
         AgentConfig::new("opencode", "OpenCode", "opencode")
            .with_description("SST OpenCode")
            .with_args(vec!["acp"]),
      );

      // Qwen Code - native ACP support with --acp flag
      // Install: pip install qwen-code or npm install -g qwen-code
      agents.insert(
         "qwen-code".to_string(),
         AgentConfig::new("qwen-code", "Qwen Code", "qwen-code")
            .with_description("Alibaba Qwen Code")
            .with_args(vec!["--acp"]),
      );

      Self {
         agents,
         last_detection: None,
      }
   }

   pub fn get(&self, id: &str) -> Option<&AgentConfig> {
      self.agents.get(id)
   }

   pub fn list_all(&self) -> Vec<AgentConfig> {
      self.agents.values().cloned().collect()
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
         if config.id == "codex-cli" {
            detect_codex_adapter(config);
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
}

impl Default for AgentRegistry {
   fn default() -> Self {
      Self::new()
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

   // Fallback to npx for users who haven't installed codex-acp globally yet.
   if let Some(path) = find_binary("npx") {
      config.installed = true;
      config.binary_path = Some(path.to_string_lossy().to_string());
      config.args = vec!["-y".to_string(), "@zed-industries/codex-acp".to_string()];
      log::debug!("Using npx fallback for codex-acp at {}", path.display());
      return;
   }

   config.installed = false;
   config.binary_path = None;
   config.args.clear();
   log::debug!("Codex ACP adapter not found (neither codex-acp nor npx available)");
}

fn find_binary(binary_name: &str) -> Option<PathBuf> {
   if let Ok(path) = which::which(binary_name) {
      return Some(path);
   }

   let mut candidates: Vec<PathBuf> = Vec::new();

   // PATH entries
   if let Some(paths) = env::var_os("PATH") {
      candidates.extend(env::split_paths(&paths));
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
