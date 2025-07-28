use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspSettings {
   pub max_completion_items: usize,
}

impl Default for LspSettings {
   fn default() -> Self {
      Self {
         max_completion_items: 100,
      }
   }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspServerConfig {
   pub name: String,
   pub language_id: String,
   pub command: PathBuf,
   pub args: Vec<String>,
   pub file_extensions: Vec<String>,
}

pub struct LspRegistry {
   servers: Vec<LspServerConfig>,
}

impl LspRegistry {
   pub fn new() -> Self {
      let mut registry = Self {
         servers: Vec::new(),
      };

      // Register TypeScript server
      registry.register_typescript();

      registry
   }

   fn register_typescript(&mut self) {
      self.servers.push(LspServerConfig {
         name: "typescript".to_string(),
         language_id: "typescript".to_string(),
         command: PathBuf::from("typescript-language-server"),
         args: vec!["--stdio".to_string()],
         file_extensions: vec![
            "ts".to_string(),
            "tsx".to_string(),
            "js".to_string(),
            "jsx".to_string(),
         ],
      });
   }

   pub fn find_server_for_workspace(&self, workspace: &Path) -> Option<&LspServerConfig> {
      // For now, detect TypeScript projects by looking for tsconfig.json or package.json
      if workspace.join("tsconfig.json").exists() || workspace.join("package.json").exists() {
         self.servers.iter().find(|s| s.name == "typescript")
      } else {
         None
      }
   }
}
