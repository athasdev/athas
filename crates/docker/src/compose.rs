use crate::{
   Docker, DockerComposeProject, DockerComposeService,
   cli_output::{DockerComposeServiceRow, parse_json_lines},
   normalize_optional_value, normalize_workspace_path, path_string, require_workspace_path,
   shell::join_command_output,
};
use std::{
   collections::HashMap,
   path::{Path, PathBuf},
};

const COMPOSE_FILE_CANDIDATES: [&str; 8] = [
   "compose.yaml",
   "compose.yml",
   "docker-compose.yaml",
   "docker-compose.yml",
   ".devcontainer/compose.yaml",
   ".devcontainer/compose.yml",
   ".devcontainer/docker-compose.yaml",
   ".devcontainer/docker-compose.yml",
];

impl Docker {
   pub async fn compose_project(
      &self,
      workspace_path: Option<String>,
   ) -> Result<DockerComposeProject, String> {
      let Some(workspace_path) = workspace_path.and_then(normalize_workspace_path) else {
         return Ok(DockerComposeProject {
            workspace_path: None,
            files: Vec::new(),
            services: Vec::new(),
         });
      };

      let compose_files = discover_compose_files(&workspace_path);
      if compose_files.is_empty() {
         return Ok(DockerComposeProject {
            workspace_path: Some(path_string(&workspace_path)),
            files: Vec::new(),
            services: Vec::new(),
         });
      }

      let services = self
         .compose_services(&workspace_path, &compose_files)
         .await?;

      Ok(DockerComposeProject {
         workspace_path: Some(path_string(&workspace_path)),
         files: compose_files.iter().map(|path| path_string(path)).collect(),
         services,
      })
   }

   pub async fn compose_action(
      &self,
      workspace_path: String,
      files: Vec<String>,
      service: Option<String>,
      action: String,
      env_files: Option<Vec<String>>,
   ) -> Result<String, String> {
      let workspace_path = require_workspace_path(workspace_path)?;
      if files.is_empty() {
         return Err("No Docker Compose files were found for this workspace.".to_string());
      }

      let mut args = compose_args(files.iter().cloned());
      for env_file in env_files.unwrap_or_default() {
         if let Some(env_file) = normalize_optional_value(Some(env_file)) {
            args.push("--env-file".to_string());
            args.push(env_file);
         }
      }
      let service = normalize_optional_value(service);
      let with_service = |mut args: Vec<String>, command: &[&str]| {
         args.extend(command.iter().map(ToString::to_string));
         args.extend(service.clone());
         args
      };

      match action.as_str() {
         "up" => {
            self
               .run_in(&with_service(args, &["up", "--detach"]), &workspace_path)
               .await
         }
         "stop" | "restart" | "build" => {
            self
               .run_in(&with_service(args, &[action.as_str()]), &workspace_path)
               .await
         }
         "down" => {
            args.push("down".to_string());
            self.run_in(&args, &workspace_path).await
         }
         "rebuild" => {
            let build_output = self
               .run_in(&with_service(args.clone(), &["build"]), &workspace_path)
               .await?;
            let up_output = self
               .run_in(&with_service(args, &["up", "--detach"]), &workspace_path)
               .await?;
            Ok(join_command_output(build_output, up_output))
         }
         _ => Err(format!("Unsupported Docker Compose action: {}", action)),
      }
   }

   async fn compose_services(
      &self,
      workspace_path: &Path,
      compose_files: &[PathBuf],
   ) -> Result<Vec<DockerComposeService>, String> {
      let mut names_args = compose_path_args(compose_files);
      names_args.extend(["config".to_string(), "--services".to_string()]);
      let service_names = self.run_in(&names_args, workspace_path).await?;

      let mut ps_args = compose_path_args(compose_files);
      ps_args.extend([
         "ps".to_string(),
         "--all".to_string(),
         "--format".to_string(),
         "json".to_string(),
      ]);
      let rows = parse_compose_ps_output(&self.run_in(&ps_args, workspace_path).await?)?;

      Ok(merge_compose_services(
         service_names
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string),
         rows,
      ))
   }
}

/// Every declared service, with its container row when one exists, plus containers whose service
/// is no longer declared; sorted by name.
pub(crate) fn merge_compose_services(
   service_names: impl IntoIterator<Item = String>,
   rows: Vec<DockerComposeServiceRow>,
) -> Vec<DockerComposeService> {
   let mut row_by_service = rows
      .into_iter()
      .filter(|row| !row.service.trim().is_empty())
      .map(|row| (row.service.clone(), row))
      .collect::<HashMap<_, _>>();

   let mut services = service_names
      .into_iter()
      .map(|name| {
         row_by_service
            .remove(&name)
            .map(DockerComposeService::from)
            .unwrap_or_else(|| DockerComposeService {
               name,
               state: "not created".to_string(),
               status: "No container".to_string(),
               health: None,
               container_id: None,
               container_name: None,
               ports: String::new(),
            })
      })
      .collect::<Vec<_>>();

   services.extend(row_by_service.into_values().map(DockerComposeService::from));
   services.sort_by(|a, b| a.name.cmp(&b.name));
   services
}

pub(crate) fn discover_compose_files(workspace_path: &Path) -> Vec<PathBuf> {
   COMPOSE_FILE_CANDIDATES
      .into_iter()
      .map(|relative| workspace_path.join(relative))
      .filter(|path| path.is_file())
      .collect()
}

pub(crate) fn compose_path_args(compose_files: &[PathBuf]) -> Vec<String> {
   compose_args(compose_files.iter().map(|path| path_string(path)))
}

fn compose_args(compose_files: impl IntoIterator<Item = String>) -> Vec<String> {
   let mut args = vec!["compose".to_string()];
   for file in compose_files {
      args.push("--file".to_string());
      args.push(file);
   }
   args
}

/// Parses `docker compose ps --format json`, which newer CLIs print as one array and older ones
/// as one object per line.
pub(crate) fn parse_compose_ps_output(
   output: &str,
) -> Result<Vec<DockerComposeServiceRow>, String> {
   let trimmed = output.trim();
   if trimmed.is_empty() {
      return Ok(Vec::new());
   }

   match serde_json::from_str::<serde_json::Value>(trimmed) {
      Ok(serde_json::Value::Array(values)) => values
         .into_iter()
         .map(|value| {
            serde_json::from_value(value)
               .map_err(|error| format!("Failed to parse Docker Compose output: {}", error))
         })
         .collect(),
      Ok(serde_json::Value::Object(_)) => serde_json::from_str(trimmed)
         .map(|row| vec![row])
         .map_err(|error| format!("Failed to parse Docker Compose output: {}", error)),
      Ok(_) => Ok(Vec::new()),
      Err(_) => parse_json_lines::<DockerComposeServiceRow>(trimmed),
   }
}
