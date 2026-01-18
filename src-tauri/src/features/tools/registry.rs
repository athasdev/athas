use super::types::{ToolConfig, ToolRuntime, ToolType};
use std::collections::HashMap;

/// Built-in tool configurations for supported languages
pub struct ToolRegistry;

impl ToolRegistry {
   /// Get tool configuration for a language
   pub fn get_tools(language_id: &str) -> Option<HashMap<ToolType, ToolConfig>> {
      match language_id {
         "typescript" | "javascript" | "typescriptreact" | "javascriptreact" => {
            Some(Self::javascript_tools())
         }
         "python" => Some(Self::python_tools()),
         "rust" => Some(Self::rust_tools()),
         "go" => Some(Self::go_tools()),
         "php" => Some(Self::php_tools()),
         "html" | "css" | "scss" | "less" => Some(Self::web_tools()),
         "json" | "jsonc" => Some(Self::json_tools()),
         "yaml" | "yml" => Some(Self::yaml_tools()),
         "toml" => Some(Self::toml_tools()),
         "markdown" => Some(Self::markdown_tools()),
         _ => None,
      }
   }

   /// Get a specific tool configuration
   pub fn get_tool(language_id: &str, tool_type: ToolType) -> Option<ToolConfig> {
      Self::get_tools(language_id).and_then(|tools| tools.get(&tool_type).cloned())
   }

   fn javascript_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "typescript-language-server".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("typescript-language-server".to_string()),
            download_url: None,
            args: vec!["--stdio".to_string()],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Formatter,
         ToolConfig {
            name: "prettier".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("prettier".to_string()),
            download_url: None,
            args: vec!["--stdin-filepath".to_string(), "${file}".to_string()],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Linter,
         ToolConfig {
            name: "eslint".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("eslint".to_string()),
            download_url: None,
            args: vec![
               "--stdin".to_string(),
               "--stdin-filename".to_string(),
               "${file}".to_string(),
               "--format".to_string(),
               "json".to_string(),
            ],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn python_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "pyright".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("pyright".to_string()),
            download_url: None,
            args: vec!["--stdio".to_string()],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Formatter,
         ToolConfig {
            name: "black".to_string(),
            runtime: ToolRuntime::Python,
            package: Some("black".to_string()),
            download_url: None,
            args: vec![
               "--stdin-filename".to_string(),
               "${file}".to_string(),
               "-".to_string(),
            ],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Linter,
         ToolConfig {
            name: "ruff".to_string(),
            runtime: ToolRuntime::Python,
            package: Some("ruff".to_string()),
            download_url: None,
            args: vec![
               "check".to_string(),
               "--stdin-filename".to_string(),
               "${file}".to_string(),
               "--output-format".to_string(),
               "json".to_string(),
               "-".to_string(),
            ],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn rust_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "rust-analyzer".to_string(),
            runtime: ToolRuntime::Binary,
            package: None,
            download_url: Some(Self::rust_analyzer_url()),
            args: vec![],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn go_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "gopls".to_string(),
            runtime: ToolRuntime::Go,
            package: Some("golang.org/x/tools/gopls".to_string()),
            download_url: None,
            args: vec!["serve".to_string()],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Linter,
         ToolConfig {
            name: "golangci-lint".to_string(),
            runtime: ToolRuntime::Go,
            package: Some("github.com/golangci/golangci-lint/cmd/golangci-lint".to_string()),
            download_url: None,
            args: vec![
               "run".to_string(),
               "--out-format".to_string(),
               "json".to_string(),
            ],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn php_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "intelephense".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("intelephense".to_string()),
            download_url: None,
            args: vec!["--stdio".to_string()],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn web_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "vscode-langservers-extracted".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("vscode-langservers-extracted".to_string()),
            download_url: None,
            args: vec!["--stdio".to_string()],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Formatter,
         ToolConfig {
            name: "prettier".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("prettier".to_string()),
            download_url: None,
            args: vec!["--stdin-filepath".to_string(), "${file}".to_string()],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn json_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "vscode-langservers-extracted".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("vscode-langservers-extracted".to_string()),
            download_url: None,
            args: vec!["--stdio".to_string()],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Formatter,
         ToolConfig {
            name: "prettier".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("prettier".to_string()),
            download_url: None,
            args: vec!["--stdin-filepath".to_string(), "${file}".to_string()],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn yaml_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "yaml-language-server".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("yaml-language-server".to_string()),
            download_url: None,
            args: vec!["--stdio".to_string()],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Formatter,
         ToolConfig {
            name: "prettier".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("prettier".to_string()),
            download_url: None,
            args: vec!["--stdin-filepath".to_string(), "${file}".to_string()],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn toml_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Lsp,
         ToolConfig {
            name: "taplo".to_string(),
            runtime: ToolRuntime::Rust,
            package: Some("taplo-cli".to_string()),
            download_url: None,
            args: vec!["lsp".to_string(), "stdio".to_string()],
            env: HashMap::new(),
         },
      );

      tools.insert(
         ToolType::Formatter,
         ToolConfig {
            name: "taplo".to_string(),
            runtime: ToolRuntime::Rust,
            package: Some("taplo-cli".to_string()),
            download_url: None,
            args: vec!["format".to_string(), "-".to_string()],
            env: HashMap::new(),
         },
      );

      tools
   }

   fn markdown_tools() -> HashMap<ToolType, ToolConfig> {
      let mut tools = HashMap::new();

      tools.insert(
         ToolType::Formatter,
         ToolConfig {
            name: "prettier".to_string(),
            runtime: ToolRuntime::Bun,
            package: Some("prettier".to_string()),
            download_url: None,
            args: vec!["--stdin-filepath".to_string(), "${file}".to_string()],
            env: HashMap::new(),
         },
      );

      tools
   }

   /// Get rust-analyzer download URL for current platform
   fn rust_analyzer_url() -> String {
      let (os, ext) = match std::env::consts::OS {
         "macos" => ("apple-darwin", "gz"),
         "linux" => ("unknown-linux-gnu", "gz"),
         "windows" => ("pc-windows-msvc", "zip"),
         _ => ("unknown-linux-gnu", "gz"),
      };

      let arch = match std::env::consts::ARCH {
         "x86_64" => "x86_64",
         "aarch64" => "aarch64",
         _ => "x86_64",
      };

      format!(
            "https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-{}-{}.{}",
            arch, os, ext
        )
   }
}
