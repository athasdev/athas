use super::{DockerDevContainer, jsonc::normalize_jsonc, normalize_optional_value, shell_quote};
use std::{
   collections::BTreeMap,
   fs,
   path::{Path, PathBuf},
};

pub(super) fn discover_dev_containers(workspace_path: &Path) -> Vec<DockerDevContainer> {
   let mut candidates = BTreeMap::<PathBuf, ()>::new();

   for relative in [".devcontainer.json", ".devcontainer/devcontainer.json"] {
      let path = workspace_path.join(relative);
      if path.is_file() {
         candidates.insert(path, ());
      }
   }

   let devcontainer_path = workspace_path.join(".devcontainer");
   if let Ok(entries) = fs::read_dir(devcontainer_path) {
      for entry in entries.flatten() {
         let path = entry.path().join("devcontainer.json");
         if path.is_file() {
            candidates.insert(path, ());
         }
      }
   }

   candidates
      .into_keys()
      .filter_map(|path| read_dev_container(workspace_path, &path).ok())
      .collect()
}

pub(super) fn read_dev_container(
   workspace_path: &Path,
   config_path: &Path,
) -> Result<DockerDevContainer, String> {
   let content = fs::read_to_string(config_path)
      .map_err(|error| format!("Failed to read devcontainer config: {}", error))?;
   let value = serde_json::from_str::<serde_json::Value>(&normalize_jsonc(&content))
      .map_err(|error| format!("Failed to parse devcontainer config: {}", error))?;
   let config_dir = config_path
      .parent()
      .ok_or_else(|| "Dev Container config path must have a parent directory.".to_string())?;
   let relative_path = config_path
      .strip_prefix(workspace_path)
      .unwrap_or(config_path)
      .to_string_lossy()
      .into_owned();
   let name = string_value(&value, "name")
      .or_else(|| {
         config_path
            .parent()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())
            .filter(|name| *name != ".devcontainer")
            .map(ToString::to_string)
      })
      .unwrap_or_else(|| "Dev Container".to_string());
   let build = value.get("build");
   let docker_file = string_value(&value, "dockerFile")
      .or_else(|| build.and_then(|build| string_value(build, "dockerfile")))
      .or_else(|| build.and_then(|build| string_value(build, "dockerFile")))
      .map(|path| resolve_devcontainer_path(config_dir, &path));
   let context = build
      .and_then(|build| string_value(build, "context"))
      .map(|path| resolve_devcontainer_path(config_dir, &path))
      .or_else(|| {
         docker_file
            .as_ref()
            .map(|_| config_dir.to_string_lossy().into_owned())
      });
   let docker_compose_files = string_array_or_single(&value, "dockerComposeFile")
      .into_iter()
      .map(|path| resolve_devcontainer_path(config_dir, &path))
      .collect::<Vec<_>>();
   let kind = if !docker_compose_files.is_empty() {
      "compose"
   } else if docker_file.is_some() {
      "dockerfile"
   } else if string_value(&value, "image").is_some() {
      "image"
   } else {
      "unsupported"
   }
   .to_string();
   let features = value
      .get("features")
      .and_then(|features| features.as_object())
      .map(|features| features.keys().cloned().collect())
      .unwrap_or_default();
   let mut forward_ports = port_values(&value, "forwardPorts");
   forward_ports.extend(port_values(&value, "appPort"));
   forward_ports.sort();
   forward_ports.dedup();

   Ok(DockerDevContainer {
      name,
      config_path: config_path.to_string_lossy().into_owned(),
      relative_path,
      kind,
      image: string_value(&value, "image"),
      docker_file,
      context,
      docker_compose_files,
      service: string_value(&value, "service"),
      workspace_folder: string_value(&value, "workspaceFolder"),
      remote_user: string_value(&value, "remoteUser"),
      run_args: string_array_or_single(&value, "runArgs"),
      container_env: string_map_entries(&value, "containerEnv"),
      remote_env: string_map_entries(&value, "remoteEnv"),
      workspace_mount: string_value(&value, "workspaceMount"),
      mounts: string_array_or_single(&value, "mounts"),
      forward_ports,
      on_create_command: command_value(&value, "onCreateCommand"),
      post_create_command: command_value(&value, "postCreateCommand"),
      post_start_command: command_value(&value, "postStartCommand"),
      post_attach_command: command_value(&value, "postAttachCommand"),
      features,
   })
}

pub(super) fn devcontainer_workspace_folder(
   workspace_path: &Path,
   dev_container: &DockerDevContainer,
) -> String {
   dev_container
      .workspace_folder
      .as_deref()
      .and_then(|folder| normalize_optional_value(Some(folder.to_string())))
      .or_else(|| {
         dev_container
            .workspace_mount
            .as_deref()
            .and_then(workspace_mount_target)
      })
      .unwrap_or_else(|| default_devcontainer_workspace_folder(workspace_path))
}

fn default_devcontainer_workspace_folder(workspace_path: &Path) -> String {
   format!(
      "/workspaces/{}",
      workspace_path
         .file_name()
         .and_then(|name| name.to_str())
         .unwrap_or("workspace")
   )
}

fn workspace_mount_target(workspace_mount: &str) -> Option<String> {
   workspace_mount.split(',').find_map(|part| {
      let (key, value) = part.split_once('=')?;
      let key = key.trim();
      if !matches!(key, "target" | "dst" | "destination") {
         return None;
      }
      let value = normalize_optional_value(Some(value.trim_matches('"').to_string()))?;
      if value.contains("${containerWorkspaceFolder}") {
         None
      } else {
         Some(value)
      }
   })
}

pub(super) fn resolve_workspace_mount(
   workspace_mount: &str,
   workspace_path: &Path,
   workspace_folder: &str,
) -> String {
   let local_workspace_folder = workspace_path.to_string_lossy();
   let local_workspace_basename = workspace_path
      .file_name()
      .and_then(|name| name.to_str())
      .unwrap_or("workspace");
   workspace_mount
      .replace("${localWorkspaceFolder}", local_workspace_folder.as_ref())
      .replace("${localWorkspaceFolderBasename}", local_workspace_basename)
      .replace("${containerWorkspaceFolder}", workspace_folder)
}

fn resolve_devcontainer_path(config_dir: &Path, path: &str) -> String {
   let path = PathBuf::from(path);
   if path.is_absolute() {
      path.to_string_lossy().into_owned()
   } else {
      config_dir.join(path).to_string_lossy().into_owned()
   }
}

pub(super) fn string_value(value: &serde_json::Value, key: &str) -> Option<String> {
   value
      .get(key)
      .and_then(|value| value.as_str())
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .map(ToString::to_string)
}

pub(super) fn string_array_or_single(value: &serde_json::Value, key: &str) -> Vec<String> {
   match value.get(key) {
      Some(serde_json::Value::String(value)) => vec![value.clone()],
      Some(serde_json::Value::Array(values)) => values
         .iter()
         .filter_map(|value| value.as_str())
         .map(str::trim)
         .filter(|value| !value.is_empty())
         .map(ToString::to_string)
         .collect(),
      _ => Vec::new(),
   }
}

fn string_map_entries(value: &serde_json::Value, key: &str) -> Vec<String> {
   value
      .get(key)
      .and_then(|value| value.as_object())
      .map(|entries| {
         let mut values = entries
            .iter()
            .filter_map(|(key, value)| {
               let value = match value {
                  serde_json::Value::String(value) => value.clone(),
                  serde_json::Value::Number(value) => value.to_string(),
                  serde_json::Value::Bool(value) => value.to_string(),
                  _ => return None,
               };
               Some(format!("{}={}", key, value))
            })
            .collect::<Vec<_>>();
         values.sort();
         values
      })
      .unwrap_or_default()
}

fn port_values(value: &serde_json::Value, key: &str) -> Vec<String> {
   match value.get(key) {
      Some(serde_json::Value::Array(values)) => values
         .iter()
         .filter_map(|value| match value {
            serde_json::Value::String(value) => normalize_optional_value(Some(value.clone())),
            serde_json::Value::Number(value) => Some(value.to_string()),
            _ => None,
         })
         .collect(),
      Some(serde_json::Value::String(value)) => vec![value.clone()],
      Some(serde_json::Value::Number(value)) => vec![value.to_string()],
      _ => Vec::new(),
   }
}

fn command_value(value: &serde_json::Value, key: &str) -> Option<String> {
   match value.get(key) {
      Some(serde_json::Value::String(value)) => normalize_optional_value(Some(value.clone())),
      Some(serde_json::Value::Array(values)) => {
         let parts = values
            .iter()
            .filter_map(|value| value.as_str())
            .map(shell_quote)
            .collect::<Vec<_>>();
         if parts.is_empty() {
            None
         } else {
            Some(parts.join(" "))
         }
      }
      Some(serde_json::Value::Object(commands)) => {
         let parts = commands
            .values()
            .filter_map(|value| command_value(&serde_json::json!({ "command": value }), "command"))
            .collect::<Vec<_>>();
         if parts.is_empty() {
            None
         } else {
            Some(parts.join(" && "))
         }
      }
      _ => None,
   }
}
