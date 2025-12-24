use super::types::AgentConfig;
use std::collections::HashMap;

/// Registry of known ACP-compatible agents
pub struct AgentRegistry {
   agents: HashMap<String, AgentConfig>,
}

impl AgentRegistry {
   pub fn new() -> Self {
      let mut agents = HashMap::new();

      // Claude Code - native ACP support
      // Install: npm install -g @anthropic-ai/claude-code
      agents.insert(
         "claude-code".to_string(),
         AgentConfig::new("claude-code", "Claude Code", "claude")
            .with_description("Anthropic Claude Code"),
      );

      // Codex CLI (OpenAI) - native ACP support
      // Install: npm install -g @openai/codex
      agents.insert(
         "codex-cli".to_string(),
         AgentConfig::new("codex-cli", "Codex CLI", "codex").with_description("OpenAI Codex"),
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

      Self { agents }
   }

   pub fn get(&self, id: &str) -> Option<&AgentConfig> {
      self.agents.get(id)
   }

   pub fn list_all(&self) -> Vec<AgentConfig> {
      self.agents.values().cloned().collect()
   }

   /// Detect which agents are installed on the system
   pub fn detect_installed(&mut self) {
      for config in self.agents.values_mut() {
         config.installed = which::which(&config.binary_name).is_ok();
         if config.installed {
            log::info!(
               "Agent '{}' detected: binary '{}' found",
               config.name,
               config.binary_name
            );
         }
      }
   }
}

impl Default for AgentRegistry {
   fn default() -> Self {
      Self::new()
   }
}
