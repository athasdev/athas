use crate::{
   DockerDebugPreset,
   devcontainer::{string_array_or_single, string_value},
   jsonc::normalize_jsonc,
   shell::shell_join,
};
use std::{fs, path::Path};

/// Container debug presets derived from `.vscode/launch.json` configurations.
pub(crate) fn discover_workspace_debug_presets(workspace_path: &Path) -> Vec<DockerDebugPreset> {
   let path = workspace_path.join(".vscode").join("launch.json");
   let Ok(content) = fs::read_to_string(path) else {
      return Vec::new();
   };
   let Ok(value) = serde_json::from_str::<serde_json::Value>(&normalize_jsonc(&content)) else {
      return Vec::new();
   };
   let Some(configurations) = value
      .get("configurations")
      .and_then(|value| value.as_array())
   else {
      return Vec::new();
   };

   configurations
      .iter()
      .enumerate()
      .filter_map(|(index, config)| workspace_debug_preset_from_launch(index, config))
      .collect()
}

fn workspace_debug_preset_from_launch(
   index: usize,
   config: &serde_json::Value,
) -> Option<DockerDebugPreset> {
   let name = string_value(config, "name")?;
   let runtime = string_value(config, "runtime")
      .or_else(|| string_value(config, "type"))
      .unwrap_or_else(|| "custom".to_string());
   let args = string_array_or_single(config, "args");
   let program = string_value(config, "program");
   let prefixed = |prefix: &[&str], program: Option<String>, args: Vec<String>| {
      shell_join(
         prefix
            .iter()
            .map(ToString::to_string)
            .chain(program)
            .chain(args),
      )
   };
   let command = match normalize_debug_runtime(&runtime) {
      "bun" => prefixed(&["bun", "--inspect-brk"], program, args),
      "node" => prefixed(&["node", "--inspect-brk"], program, args),
      "python" => prefixed(&["python", "-m", "pdb"], program, args),
      "rust" => prefixed(&["cargo", "run"], None, args),
      "go" => prefixed(
         &["dlv", "debug"],
         program,
         std::iter::once("--".to_string()).chain(args).collect(),
      ),
      _ => string_value(config, "command")?,
   };
   if command.trim().is_empty() {
      return None;
   }

   Some(DockerDebugPreset {
      name: format!("{} ({})", name, index + 1),
      command: resolve_debug_command_variables(&command),
      workdir: string_value(config, "cwd").map(|cwd| resolve_debug_command_variables(&cwd)),
      target: "container".to_string(),
      source: Some("launch.json".to_string()),
   })
}

fn normalize_debug_runtime(value: &str) -> &'static str {
   let normalized = value.to_lowercase();
   if normalized.contains("bun") {
      "bun"
   } else if normalized.contains("node") {
      "node"
   } else if normalized.contains("python") || normalized.contains("debugpy") {
      "python"
   } else if normalized.contains("rust") || normalized.contains("lldb") {
      "rust"
   } else if normalized.contains("go") || normalized.contains("delve") {
      "go"
   } else {
      "custom"
   }
}

fn resolve_debug_command_variables(value: &str) -> String {
   value
      .replace("${workspaceFolder}", "/workspace")
      .replace("${workspaceRoot}", "/workspace")
      .replace("${fileWorkspaceFolder}", "/workspace")
}
