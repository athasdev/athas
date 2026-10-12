use crate::{
   DockerBuildPreset, DockerComposePreset, DockerDebugPreset, DockerEnvFile, DockerEnvFileContent,
   DockerProjectConfig, DockerRunPreset, debug_presets::discover_workspace_debug_presets,
   devcontainer::discover_dev_containers, normalize_optional_value, normalize_workspace_path,
   path_string, require_workspace_path,
};
use std::{
   collections::BTreeMap,
   fs,
   path::{Path, PathBuf},
};

/// The workspace's saved presets plus its discovered env files, dev containers, and
/// `launch.json` debug presets. Blank, WSL, and remote workspaces get an empty config.
pub fn project_config(workspace_path: Option<String>) -> Result<DockerProjectConfig, String> {
   let Some(workspace_path) = workspace_path.and_then(normalize_workspace_path) else {
      return Ok(empty_project_config(None));
   };
   ensure_workspace_dir(&workspace_path)?;

   let mut config = read_project_config(&workspace_path)?;
   config.workspace_path = Some(path_string(&workspace_path));
   config.env_files = discover_env_files(&workspace_path);
   config.dev_containers = discover_dev_containers(&workspace_path);
   config.workspace_debug_presets = discover_workspace_debug_presets(&workspace_path);

   Ok(config)
}

/// Saves only the user-editable presets of `config` to `.athas/docker.json`, then returns the
/// reloaded config.
pub fn save_project_config(
   workspace_path: String,
   config: DockerProjectConfig,
) -> Result<DockerProjectConfig, String> {
   let workspace_path = require_workspace_path(workspace_path)?;
   ensure_workspace_dir(&workspace_path)?;

   let config_path = project_config_path(&workspace_path);
   if let Some(parent) = config_path.parent() {
      fs::create_dir_all(parent)
         .map_err(|error| format!("Failed to create Docker config directory: {}", error))?;
   }

   let saved_config = DockerProjectConfig {
      build_presets: sanitize_build_presets(config.build_presets),
      run_presets: sanitize_run_presets(config.run_presets),
      compose_presets: sanitize_compose_presets(config.compose_presets),
      debug_presets: sanitize_debug_presets(config.debug_presets),
      ..empty_project_config(None)
   };
   let contents = serde_json::to_string_pretty(&saved_config)
      .map_err(|error| format!("Failed to encode Docker project config: {}", error))?;
   fs::write(&config_path, format!("{}\n", contents))
      .map_err(|error| format!("Failed to write Docker project config: {}", error))?;

   project_config(Some(path_string(&workspace_path)))
}

/// Resolves `path` to a `.env` file inside the workspace; `verb` names the action in the error.
fn resolve_env_file(
   workspace_path: String,
   path: String,
   verb: &str,
) -> Result<(PathBuf, PathBuf), String> {
   let workspace_path = require_workspace_path(workspace_path)?;
   ensure_workspace_dir(&workspace_path)?;
   let path = resolve_workspace_file(&workspace_path, path)?;
   if !is_env_file_path(&path) {
      return Err(format!(
         "Only .env files can be {} from Docker project settings.",
         verb
      ));
   }
   Ok((workspace_path, path))
}

pub fn read_env_file(workspace_path: String, path: String) -> Result<String, String> {
   let (_, path) = resolve_env_file(workspace_path, path, "opened")?;
   fs::read_to_string(&path).map_err(|error| format!("Failed to read env file: {}", error))
}

/// Reads the env file, creating it empty when it does not exist yet.
pub fn open_env_file(workspace_path: String, path: String) -> Result<DockerEnvFileContent, String> {
   let (workspace_path, path) = resolve_env_file(workspace_path, path, "opened")?;
   let content = if path.exists() {
      if !path.is_file() {
         return Err("Env file path must point to a file.".to_string());
      }
      fs::read_to_string(&path).map_err(|error| format!("Failed to read env file: {}", error))?
   } else {
      fs::write(&path, "").map_err(|error| format!("Failed to create env file: {}", error))?;
      String::new()
   };
   let file = inspect_env_file(&workspace_path, &path)?;
   Ok(DockerEnvFileContent { file, content })
}

pub fn write_env_file(
   workspace_path: String,
   path: String,
   content: String,
) -> Result<DockerEnvFile, String> {
   let (workspace_path, path) = resolve_env_file(workspace_path, path, "edited")?;
   fs::write(&path, content).map_err(|error| format!("Failed to write env file: {}", error))?;
   inspect_env_file(&workspace_path, &path)
}

pub fn delete_env_file(workspace_path: String, path: String) -> Result<(), String> {
   let (_, path) = resolve_env_file(workspace_path, path, "deleted")?;
   if !path.is_file() {
      return Err("Env file path must point to a file.".to_string());
   }
   fs::remove_file(&path).map_err(|error| format!("Failed to delete env file: {}", error))
}

pub(crate) fn discover_env_files(workspace_path: &Path) -> Vec<DockerEnvFile> {
   let mut candidates = BTreeMap::<PathBuf, ()>::new();

   for relative in [".env", ".env.local", ".env.development", ".env.production"] {
      let path = workspace_path.join(relative);
      if path.is_file() {
         candidates.insert(path, ());
      }
   }

   if let Ok(entries) = fs::read_dir(workspace_path) {
      for entry in entries.flatten() {
         let path = entry.path();
         if path.is_file() && is_env_file_path(&path) {
            candidates.insert(path, ());
         }
      }
   }

   let devcontainer_path = workspace_path.join(".devcontainer");
   if let Ok(entries) = fs::read_dir(devcontainer_path) {
      for entry in entries.flatten() {
         let path = entry.path();
         if path.is_file() && is_env_file_path(&path) {
            candidates.insert(path, ());
         }
      }
   }

   candidates
      .into_keys()
      .filter_map(|path| inspect_env_file(workspace_path, &path).ok())
      .collect()
}

pub(crate) fn inspect_env_file(
   workspace_path: &Path,
   path: &Path,
) -> Result<DockerEnvFile, String> {
   let content =
      fs::read_to_string(path).map_err(|error| format!("Failed to read env file: {}", error))?;
   let keys = parse_env_keys(&content);
   let canonical_workspace = workspace_path.canonicalize().ok();
   let relative_path = canonical_workspace
      .as_ref()
      .and_then(|workspace| path.strip_prefix(workspace).ok())
      .or_else(|| path.strip_prefix(workspace_path).ok())
      .unwrap_or(path)
      .to_string_lossy()
      .into_owned();
   Ok(DockerEnvFile {
      path: path.to_string_lossy().into_owned(),
      relative_path,
      variable_count: keys.len(),
      keys,
   })
}

pub(crate) fn parse_env_keys(content: &str) -> Vec<String> {
   let mut keys = content
      .lines()
      .filter_map(|line| {
         let line = line.trim();
         if line.is_empty() || line.starts_with('#') {
            return None;
         }
         let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
         let (key, _) = line.split_once('=')?;
         let key = key.trim();
         if key.is_empty() || key.contains(char::is_whitespace) {
            None
         } else {
            Some(key.to_string())
         }
      })
      .collect::<Vec<_>>();
   keys.sort();
   keys.dedup();
   keys
}

pub(crate) fn is_env_file_path(path: &Path) -> bool {
   path
      .file_name()
      .and_then(|name| name.to_str())
      .is_some_and(|name| name == ".env" || name.starts_with(".env."))
}

pub(crate) fn project_config_path(workspace_path: &Path) -> PathBuf {
   workspace_path.join(".athas").join("docker.json")
}

pub(crate) fn read_project_config(workspace_path: &Path) -> Result<DockerProjectConfig, String> {
   let path = project_config_path(workspace_path);
   if !path.exists() {
      return Ok(empty_project_config(Some(
         workspace_path.to_string_lossy().into_owned(),
      )));
   }

   let contents = fs::read_to_string(&path)
      .map_err(|error| format!("Failed to read Docker project config: {}", error))?;
   let mut config = serde_json::from_str::<DockerProjectConfig>(&contents)
      .map_err(|error| format!("Failed to parse Docker project config: {}", error))?;
   config.build_presets = sanitize_build_presets(config.build_presets);
   config.run_presets = sanitize_run_presets(config.run_presets);
   config.compose_presets = sanitize_compose_presets(config.compose_presets);
   config.debug_presets = sanitize_debug_presets(config.debug_presets);
   Ok(config)
}

pub(crate) fn empty_project_config(workspace_path: Option<String>) -> DockerProjectConfig {
   DockerProjectConfig {
      workspace_path,
      build_presets: Vec::new(),
      run_presets: Vec::new(),
      compose_presets: Vec::new(),
      debug_presets: Vec::new(),
      workspace_debug_presets: Vec::new(),
      env_files: Vec::new(),
      dev_containers: Vec::new(),
   }
}

pub(crate) fn ensure_workspace_dir(workspace_path: &Path) -> Result<(), String> {
   if workspace_path.is_dir() {
      Ok(())
   } else {
      Err(format!(
         "Workspace path does not exist: {}",
         workspace_path.display()
      ))
   }
}

pub(crate) fn resolve_workspace_file(
   workspace_path: &Path,
   path: String,
) -> Result<PathBuf, String> {
   let requested_path =
      normalize_optional_value(Some(path)).ok_or_else(|| "File path is required.".to_string())?;
   let workspace_root = workspace_path
      .canonicalize()
      .map_err(|error| format!("Failed to resolve workspace path: {}", error))?;
   let requested_path = PathBuf::from(requested_path);
   let path = if requested_path.is_absolute() {
      requested_path
   } else {
      workspace_root.join(requested_path)
   };

   let resolved = if path.exists() {
      path
         .canonicalize()
         .map_err(|error| format!("Failed to resolve file path: {}", error))?
   } else {
      let parent = path
         .parent()
         .ok_or_else(|| "File path must have a parent directory.".to_string())?;
      let parent = parent
         .canonicalize()
         .map_err(|error| format!("Failed to resolve file parent directory: {}", error))?;
      parent.join(
         path
            .file_name()
            .ok_or_else(|| "File path must include a file name.".to_string())?,
      )
   };

   if !resolved.starts_with(&workspace_root) {
      return Err("Docker project file must be inside the workspace.".to_string());
   }

   Ok(resolved)
}

pub(crate) fn sanitize_build_presets(presets: Vec<DockerBuildPreset>) -> Vec<DockerBuildPreset> {
   presets
      .into_iter()
      .filter_map(|preset| {
         let name = normalize_optional_value(Some(preset.name))?;
         let context_path = normalize_optional_value(Some(preset.context_path))?;
         Some(DockerBuildPreset {
            name,
            context_path,
            dockerfile_path: normalize_optional_value(preset.dockerfile_path),
            tag: normalize_optional_value(preset.tag),
            build_args: sanitize_list(preset.build_args),
         })
      })
      .collect()
}

pub(crate) fn sanitize_run_presets(presets: Vec<DockerRunPreset>) -> Vec<DockerRunPreset> {
   presets
      .into_iter()
      .filter_map(|preset| {
         let name = normalize_optional_value(Some(preset.name))?;
         let image = normalize_optional_value(Some(preset.image))?;
         Some(DockerRunPreset {
            name,
            image,
            container_name: normalize_optional_value(preset.container_name),
            ports: sanitize_list(preset.ports),
            volumes: sanitize_list(preset.volumes),
            env: sanitize_list(preset.env),
            env_files: sanitize_list(preset.env_files),
            command: normalize_optional_value(preset.command),
         })
      })
      .collect()
}

pub(crate) fn sanitize_compose_presets(
   presets: Vec<DockerComposePreset>,
) -> Vec<DockerComposePreset> {
   presets
      .into_iter()
      .filter_map(|preset| {
         let name = normalize_optional_value(Some(preset.name))?;
         let action = normalize_optional_value(Some(preset.action))?;
         Some(DockerComposePreset {
            name,
            files: sanitize_list(preset.files),
            service: normalize_optional_value(preset.service),
            action,
            env_files: sanitize_list(preset.env_files),
         })
      })
      .collect()
}

pub(crate) fn sanitize_debug_presets(presets: Vec<DockerDebugPreset>) -> Vec<DockerDebugPreset> {
   presets
      .into_iter()
      .filter_map(|preset| {
         let name = normalize_optional_value(Some(preset.name))?;
         let command = normalize_optional_value(Some(preset.command))?;
         Some(DockerDebugPreset {
            name,
            command,
            workdir: normalize_optional_value(preset.workdir),
            target: normalize_optional_value(Some(preset.target))
               .unwrap_or_else(|| "container".to_string()),
            source: normalize_optional_value(preset.source).or_else(|| Some("project".to_string())),
         })
      })
      .collect()
}

fn sanitize_list(values: Vec<String>) -> Vec<String> {
   values
      .into_iter()
      .filter_map(|value| normalize_optional_value(Some(value)))
      .collect()
}
