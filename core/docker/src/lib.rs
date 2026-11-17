//! Docker, Docker Compose, and Dev Container support driven through the `docker` CLI.
//!
//! [`Docker`] wraps the CLI binary so every operation can run against a fake executable in
//! tests; the Tauri commands construct [`Docker::default`] and call one method each.

use std::{
   collections::HashMap,
   ffi::OsString,
   path::{Path, PathBuf},
};

mod cli_output;
mod compose;
mod container_files;
mod debug_presets;
mod dev_container_open;
mod devcontainer;
mod jsonc;
mod log_stream;
mod process;
mod project_config;
mod shell;
mod types;

use cli_output::{
   DockerContainerRow, DockerImageRow, DockerInspectContainerRow, DockerNetworkRow,
   DockerRegistrySearchRow, DockerStatsRow, DockerVolumeRow, parse_json_lines,
};
use container_files::parse_container_file_archive;
pub use log_stream::{DockerLogSink, DockerLogStreams};
pub use project_config::{
   delete_env_file, open_env_file, project_config, read_env_file, save_project_config,
   write_env_file,
};
use shell::split_command_args;
pub use types::*;

/// Handle to the Docker CLI used for every Docker operation.
#[derive(Debug, Clone)]
pub struct Docker {
   program: OsString,
}

impl Default for Docker {
   fn default() -> Self {
      Self::with_program("docker")
   }
}

impl Docker {
   /// Uses `program` instead of `docker` from `PATH`.
   pub fn with_program(program: impl Into<OsString>) -> Self {
      Self {
         program: program.into(),
      }
   }

   pub async fn inventory(&self) -> Result<DockerInventory, String> {
      Ok(DockerInventory {
         containers: self.list_containers().await?,
         images: self.list_images().await?,
         volumes: self.list_volumes().await?,
         networks: self.list_networks().await?,
      })
   }

   pub async fn container_action(
      &self,
      container_id: String,
      action: String,
      force: Option<bool>,
   ) -> Result<(), String> {
      if container_id.trim().is_empty() {
         return Err("Container id is required.".to_string());
      }

      let args = match action.as_str() {
         "start" | "stop" | "restart" | "pause" | "unpause" => vec![action, container_id],
         "remove" => {
            let mut args = vec!["rm".to_string()];
            if force.unwrap_or(false) {
               args.push("--force".to_string());
            }
            args.push(container_id);
            args
         }
         _ => return Err(format!("Unsupported Docker container action: {}", action)),
      };

      self.run_owned(&args).await?;
      Ok(())
   }

   pub async fn container_logs(
      &self,
      container_id: String,
      tail: Option<u16>,
   ) -> Result<String, String> {
      if container_id.trim().is_empty() {
         return Err("Container id is required.".to_string());
      }

      let tail = tail.unwrap_or(500).to_string();
      self
         .run(&["logs", "--timestamps", "--tail", &tail, &container_id])
         .await
   }

   pub async fn build_image(&self, request: DockerBuildImageRequest) -> Result<String, String> {
      let context_path = normalize_required_path(request.context_path, "Build context path")?;
      let mut args = vec!["build".to_string()];

      if let Some(tag) = normalize_optional_value(request.tag) {
         args.push("--tag".to_string());
         args.push(tag);
      }
      if let Some(dockerfile_path) = normalize_optional_value(request.dockerfile_path) {
         args.push("--file".to_string());
         args.push(dockerfile_path);
      }
      push_flag_values(
         &mut args,
         "--build-arg",
         request.build_args.unwrap_or_default(),
      );
      args.push(context_path.to_string_lossy().into_owned());

      self.run_in(&args, &context_path).await
   }

   pub async fn run_image(&self, request: DockerRunImageRequest) -> Result<String, String> {
      self.run_owned(&run_image_args(request)?).await
   }

   pub async fn image_action(
      &self,
      image_id: String,
      action: String,
      force: Option<bool>,
   ) -> Result<String, String> {
      let image_id = normalize_optional_value(Some(image_id))
         .ok_or_else(|| "Image id is required.".to_string())?;

      match action.as_str() {
         "remove" => {
            let mut args = vec!["rmi".to_string()];
            if force.unwrap_or(false) {
               args.push("--force".to_string());
            }
            args.push(image_id);
            self.run_owned(&args).await
         }
         _ => Err(format!("Unsupported Docker image action: {}", action)),
      }
   }

   pub async fn prune_resources(
      &self,
      target: String,
      include_volumes: Option<bool>,
   ) -> Result<String, String> {
      self
         .run_owned(&prune_args(&target, include_volumes.unwrap_or(false))?)
         .await
   }

   pub async fn list_container_files(
      &self,
      container_id: String,
      path: Option<String>,
   ) -> Result<Vec<DockerContainerFileEntry>, String> {
      let container_id = normalize_optional_value(Some(container_id))
         .ok_or_else(|| "Container id is required.".to_string())?;
      let container_path = normalize_container_path(path);
      let source = format!("{}:{}", container_id, container_path);
      let args = vec!["cp".to_string(), source, "-".to_string()];
      let archive = self.run_bytes(&args).await?;

      parse_container_file_archive(&archive, &container_path)
   }

   pub async fn copy_from_container(
      &self,
      container_id: String,
      container_path: String,
      host_path: String,
   ) -> Result<String, String> {
      let container_id = normalize_optional_value(Some(container_id))
         .ok_or_else(|| "Container id is required.".to_string())?;
      let container_path = normalize_optional_value(Some(container_path))
         .ok_or_else(|| "Container path is required.".to_string())?;
      let host_path = normalize_optional_value(Some(host_path))
         .ok_or_else(|| "Host path is required.".to_string())?;

      self
         .run_owned(&[
            "cp".to_string(),
            format!("{}:{}", container_id, container_path),
            host_path,
         ])
         .await
   }

   pub async fn copy_to_container(
      &self,
      container_id: String,
      host_path: String,
      container_path: String,
   ) -> Result<String, String> {
      let container_id = normalize_optional_value(Some(container_id))
         .ok_or_else(|| "Container id is required.".to_string())?;
      let host_path = normalize_required_path(host_path, "Host path")?;
      let container_path = normalize_optional_value(Some(container_path))
         .ok_or_else(|| "Container path is required.".to_string())?;

      self
         .run_owned(&[
            "cp".to_string(),
            host_path.to_string_lossy().into_owned(),
            format!("{}:{}", container_id, container_path),
         ])
         .await
   }

   pub async fn registry_search(
      &self,
      query: String,
      limit: Option<u16>,
   ) -> Result<Vec<DockerRegistrySearchResult>, String> {
      let query = normalize_optional_value(Some(query))
         .ok_or_else(|| "Search query is required.".to_string())?;
      let limit = limit.unwrap_or(25).clamp(1, 100).to_string();
      let output = self
         .run_owned(&[
            "search".to_string(),
            "--limit".to_string(),
            limit,
            "--format".to_string(),
            "{{json .}}".to_string(),
            query,
         ])
         .await?;

      parse_json_lines::<DockerRegistrySearchRow>(&output)
         .map(|rows| rows.into_iter().map(Into::into).collect())
   }

   pub async fn registry_login(
      &self,
      request: DockerRegistryLoginRequest,
   ) -> Result<String, String> {
      let username = normalize_optional_value(Some(request.username))
         .ok_or_else(|| "Username is required.".to_string())?;
      if request.password.is_empty() {
         return Err("Password is required.".to_string());
      }

      let mut args = vec![
         "login".to_string(),
         "--username".to_string(),
         username,
         "--password-stdin".to_string(),
      ];
      if let Some(registry) = normalize_optional_value(request.registry) {
         args.push(registry);
      }

      self.run_with_stdin(&args, request.password).await
   }

   pub async fn registry_pull(&self, image: String) -> Result<String, String> {
      let image =
         normalize_optional_value(Some(image)).ok_or_else(|| "Image is required.".to_string())?;
      self.run_owned(&["pull".to_string(), image]).await
   }

   pub async fn registry_push(&self, image: String) -> Result<String, String> {
      let image =
         normalize_optional_value(Some(image)).ok_or_else(|| "Image is required.".to_string())?;
      self.run_owned(&["push".to_string(), image]).await
   }

   pub async fn tag_image(&self, source: String, target: String) -> Result<String, String> {
      let source = normalize_optional_value(Some(source))
         .ok_or_else(|| "Source image is required.".to_string())?;
      let target = normalize_optional_value(Some(target))
         .ok_or_else(|| "Target tag is required.".to_string())?;
      self.run_owned(&["tag".to_string(), source, target]).await
   }

   async fn list_containers(&self) -> Result<Vec<DockerContainer>, String> {
      let output = self
         .run(&["ps", "--all", "--size", "--format", "{{json .}}"])
         .await?;
      let stats = self.container_stats().await.unwrap_or_default();
      let health_details = self.container_health_details().await.unwrap_or_default();
      parse_json_lines::<DockerContainerRow>(&output).map(|rows| {
         rows
            .into_iter()
            .map(|row| {
               let stats_key = row.id.clone();
               let stats_by_name_key = row.names.clone();
               let mut container = DockerContainer::from(row);
               container.stats = stats
                  .get(&stats_key)
                  .or_else(|| stats.get(&stats_by_name_key))
                  .cloned();
               container.health_details = health_details
                  .get(&stats_key)
                  .or_else(|| health_details.get(&stats_by_name_key))
                  .cloned();
               container
            })
            .collect()
      })
   }

   async fn list_images(&self) -> Result<Vec<DockerImage>, String> {
      let output = self
         .run(&["images", "--all", "--format", "{{json .}}"])
         .await?;
      parse_json_lines::<DockerImageRow>(&output)
         .map(|rows| rows.into_iter().map(Into::into).collect())
   }

   async fn list_volumes(&self) -> Result<Vec<DockerVolume>, String> {
      let output = self
         .run(&["volume", "ls", "--format", "{{json .}}"])
         .await?;
      parse_json_lines::<DockerVolumeRow>(&output)
         .map(|rows| rows.into_iter().map(Into::into).collect())
   }

   async fn list_networks(&self) -> Result<Vec<DockerNetwork>, String> {
      let output = self
         .run(&["network", "ls", "--format", "{{json .}}"])
         .await?;
      parse_json_lines::<DockerNetworkRow>(&output)
         .map(|rows| rows.into_iter().map(Into::into).collect())
   }

   async fn container_stats(&self) -> Result<HashMap<String, DockerContainerStats>, String> {
      let output = self
         .run(&["stats", "--no-stream", "--all", "--format", "{{json .}}"])
         .await?;
      parse_json_lines::<DockerStatsRow>(&output).map(|rows| {
         rows
            .into_iter()
            .flat_map(|row| {
               let stats = DockerContainerStats::from(row.clone());
               [(row.id, stats.clone()), (row.name, stats)]
            })
            .filter(|(key, _)| !key.trim().is_empty())
            .collect()
      })
   }

   async fn container_health_details(
      &self,
   ) -> Result<HashMap<String, DockerContainerHealthDetails>, String> {
      let ids = self.run(&["ps", "--all", "--quiet"]).await?;
      let ids = ids
         .lines()
         .map(str::trim)
         .filter(|id| !id.is_empty())
         .collect::<Vec<_>>();
      if ids.is_empty() {
         return Ok(HashMap::new());
      }
      let mut args = vec![
         "inspect".to_string(),
         "--format".to_string(),
         "{{json .}}".to_string(),
      ];
      args.extend(ids.into_iter().map(ToString::to_string));
      let output = self.run_owned(&args).await?;

      parse_json_lines::<DockerInspectContainerRow>(&output).map(|rows| {
         rows
            .into_iter()
            .filter_map(|row| {
               let health = row.state.health?;
               let details = DockerContainerHealthDetails::from(health);
               let name = row.name.trim_start_matches('/').to_string();
               Some([(row.id, details.clone()), (name, details)])
            })
            .flatten()
            .filter(|(key, _)| !key.trim().is_empty())
            .collect()
      })
   }
}

fn run_image_args(request: DockerRunImageRequest) -> Result<Vec<String>, String> {
   let image = normalize_optional_value(Some(request.image))
      .ok_or_else(|| "Image is required.".to_string())?;
   let mut args = vec!["run".to_string()];

   if request.detach.unwrap_or(true) {
      args.push("--detach".to_string());
   }
   if let Some(name) = normalize_optional_value(request.name) {
      args.push("--name".to_string());
      args.push(name);
   }
   push_flag_values(&mut args, "--publish", request.ports.unwrap_or_default());
   push_flag_values(&mut args, "--volume", request.volumes.unwrap_or_default());
   push_flag_values(&mut args, "--env", request.env.unwrap_or_default());
   push_flag_values(
      &mut args,
      "--env-file",
      request.env_files.unwrap_or_default(),
   );
   args.push(image);
   if let Some(command) = normalize_optional_value(request.command) {
      args.extend(split_command_args(&command)?);
   }

   Ok(args)
}

fn prune_args(target: &str, include_volumes: bool) -> Result<Vec<String>, String> {
   let base: &[&str] = match target {
      "containers" => &["container", "prune", "--force"],
      "images" => &["image", "prune", "--all", "--force"],
      "volumes" => &["volume", "prune", "--all", "--force"],
      "networks" => &["network", "prune", "--force"],
      "system" => &["system", "prune", "--force"],
      _ => return Err(format!("Unsupported Docker prune target: {}", target)),
   };
   let mut args = base.iter().map(ToString::to_string).collect::<Vec<_>>();
   if target == "system" && include_volumes {
      args.push("--volumes".to_string());
   }
   Ok(args)
}

/// Appends `flag value` for every non-blank value.
fn push_flag_values(args: &mut Vec<String>, flag: &str, values: Vec<String>) {
   for value in values {
      if let Some(value) = normalize_optional_value(Some(value)) {
         args.push(flag.to_string());
         args.push(value);
      }
   }
}

/// Local workspace path, or `None` for blank and WSL/remote workspaces Docker cannot reach.
pub(crate) fn normalize_workspace_path(path: String) -> Option<PathBuf> {
   let trimmed = path.trim();
   if trimmed.is_empty() || trimmed.starts_with("wsl://") || trimmed.starts_with("remote://") {
      return None;
   }

   Some(PathBuf::from(trimmed))
}

pub(crate) fn require_workspace_path(path: String) -> Result<PathBuf, String> {
   normalize_workspace_path(path).ok_or_else(|| "Workspace path is required.".to_string())
}

fn normalize_required_path(path: String, label: &str) -> Result<PathBuf, String> {
   let path =
      normalize_optional_value(Some(path)).ok_or_else(|| format!("{} is required.", label))?;
   let path = PathBuf::from(path);
   if !path.exists() {
      return Err(format!("{} does not exist: {}", label, path.display()));
   }
   Ok(path)
}

pub(crate) fn normalize_optional_value(value: Option<String>) -> Option<String> {
   value
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty())
}

fn normalize_container_path(path: Option<String>) -> String {
   let path = normalize_optional_value(path).unwrap_or_else(|| "/".to_string());
   if path.starts_with('/') {
      path
   } else {
      format!("/{}", path)
   }
}

pub(crate) fn path_string(path: &Path) -> String {
   path.to_string_lossy().into_owned()
}

#[cfg(all(test, unix))]
mod cli_tests;
#[cfg(all(test, unix))]
mod test_support;
#[cfg(test)]
mod tests;
