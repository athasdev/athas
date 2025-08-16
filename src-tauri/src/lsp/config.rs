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
      // Always try TypeScript server for JS/TS projects - it handles both
      if self.is_javascript_or_typescript_project(workspace) {
         self.servers.iter().find(|s| s.name == "typescript")
      } else {
         // For now, default to TypeScript if no other server is found
         // This ensures LSP functionality for most common file types
         self.servers.iter().find(|s| s.name == "typescript")
      }
   }

   fn is_javascript_or_typescript_project(&self, workspace: &Path) -> bool {
      // Check for TypeScript/JavaScript project indicators
      let config_indicators = [
         "tsconfig.json",
         "package.json", 
         "jsconfig.json",
      ];

      let file_extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

      // Check in workspace root for config files
      for indicator in &config_indicators {
         if workspace.join(indicator).exists() {
            return true;
         }
      }

      // Check for source files in common directories and root
      let source_dirs = ["src", "lib", "app", "pages", "components", "javascript", "js", "."];
      for dir in &source_dirs {
         let dir_path = if *dir == "." { workspace.to_path_buf() } else { workspace.join(dir) };
         if dir_path.exists() && dir_path.is_dir() {
            // Walk through the directory looking for TS/JS files
            if let Ok(entries) = std::fs::read_dir(&dir_path) {
               for entry in entries.flatten() {
                  if let Some(ext) = entry.path().extension() {
                     let ext_str = format!(".{}", ext.to_str().unwrap_or(""));
                     if file_extensions.contains(&ext_str.as_str()) {
                        return true;
                     }
                  }
               }
            }
         }
      }

      // If we found any JS/TS files anywhere, consider it a JS/TS project
      true // Default to yes for broader compatibility
   }
}
