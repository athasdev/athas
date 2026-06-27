use crate::app_runtime::AppHandle;
use serde::{Deserialize, Serialize};
use std::{
   collections::{BTreeMap, HashMap},
   io::Cursor,
   path::PathBuf,
   process::Stdio,
   sync::Arc,
};
use tauri::{Emitter, State};
use tokio::{
   io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader},
   process::Command,
   sync::Mutex,
   task::JoinHandle,
};
use uuid::Uuid;

#[derive(Default)]
pub struct DockerLogStreams {
   tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerInventory {
   pub containers: Vec<DockerContainer>,
   pub images: Vec<DockerImage>,
   pub volumes: Vec<DockerVolume>,
   pub networks: Vec<DockerNetwork>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerComposeProject {
   pub workspace_path: Option<String>,
   pub files: Vec<String>,
   pub services: Vec<DockerComposeService>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerComposeService {
   pub name: String,
   pub state: String,
   pub status: String,
   pub health: Option<String>,
   pub container_id: Option<String>,
   pub container_name: Option<String>,
   pub ports: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerLogEvent {
   pub stream_id: String,
   pub container_id: String,
   pub stream: String,
   pub line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerLogExitEvent {
   pub stream_id: String,
   pub container_id: String,
   pub code: Option<i32>,
   pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
   pub id: String,
   pub name: String,
   pub image: String,
   pub command: String,
   pub status: String,
   pub state: String,
   pub ports: String,
   pub networks: String,
   pub created_at: String,
   pub health: Option<String>,
   pub stats: Option<DockerContainerStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerStats {
   pub cpu_percent: String,
   pub memory_usage: String,
   pub memory_percent: String,
   pub network_io: String,
   pub block_io: String,
   pub pids: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerFileEntry {
   pub name: String,
   pub path: String,
   pub is_directory: bool,
   pub size: u64,
   pub modified: Option<u64>,
   pub mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerBuildImageRequest {
   pub context_path: String,
   pub dockerfile_path: Option<String>,
   pub tag: Option<String>,
   pub build_args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRunImageRequest {
   pub image: String,
   pub name: Option<String>,
   pub ports: Option<Vec<String>>,
   pub volumes: Option<Vec<String>>,
   pub env: Option<Vec<String>>,
   pub command: Option<String>,
   pub detach: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRegistryLoginRequest {
   pub registry: Option<String>,
   pub username: String,
   pub password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRegistrySearchResult {
   pub name: String,
   pub description: String,
   pub star_count: String,
   pub official: String,
   pub automated: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImage {
   pub id: String,
   pub repository: String,
   pub tag: String,
   pub digest: String,
   pub size: String,
   pub created_since: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerVolume {
   pub name: String,
   pub driver: String,
   pub scope: String,
   pub mountpoint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerNetwork {
   pub id: String,
   pub name: String,
   pub driver: String,
   pub scope: String,
   pub internal: String,
   pub ipv6: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerContainerRow {
   #[serde(rename = "ID")]
   id: String,
   names: String,
   image: String,
   command: String,
   status: String,
   state: String,
   ports: String,
   networks: String,
   #[serde(default)]
   created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerStatsRow {
   #[serde(default, rename = "ID")]
   id: String,
   #[serde(default)]
   name: String,
   #[serde(default, rename = "CPUPerc")]
   cpu_percent: String,
   #[serde(default)]
   mem_usage: String,
   #[serde(default, rename = "MemPerc")]
   memory_percent: String,
   #[serde(default, rename = "NetIO")]
   network_io: String,
   #[serde(default, rename = "BlockIO")]
   block_io: String,
   #[serde(default, rename = "PIDs")]
   pids: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerImageRow {
   #[serde(rename = "ID")]
   id: String,
   repository: String,
   tag: String,
   digest: String,
   size: String,
   #[serde(default)]
   created_since: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerRegistrySearchRow {
   name: String,
   #[serde(default)]
   description: String,
   #[serde(default)]
   star_count: String,
   #[serde(default)]
   official: String,
   #[serde(default)]
   automated: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerVolumeRow {
   name: String,
   driver: String,
   scope: String,
   #[serde(default)]
   mountpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerNetworkRow {
   #[serde(rename = "ID")]
   id: String,
   name: String,
   driver: String,
   scope: String,
   #[serde(default)]
   internal: String,
   #[serde(default, rename = "IPv6")]
   ipv6: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerComposeServiceRow {
   #[serde(default, rename = "ID")]
   id: String,
   #[serde(default)]
   name: String,
   #[serde(default)]
   service: String,
   #[serde(default)]
   state: String,
   #[serde(default)]
   health: String,
   #[serde(default)]
   status: String,
   #[serde(default)]
   publishers: Vec<DockerComposePublisherRow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerComposePublisherRow {
   #[serde(default, rename = "URL")]
   url: String,
   #[serde(default)]
   target_port: u16,
   #[serde(default)]
   published_port: u16,
   #[serde(default)]
   protocol: String,
}

#[tauri::command]
pub async fn docker_get_inventory() -> Result<DockerInventory, String> {
   Ok(DockerInventory {
      containers: docker_list_containers().await?,
      images: docker_list_images().await?,
      volumes: docker_list_volumes().await?,
      networks: docker_list_networks().await?,
   })
}

#[tauri::command]
pub async fn docker_container_action(
   container_id: String,
   action: String,
   force: Option<bool>,
) -> Result<(), String> {
   if container_id.trim().is_empty() {
      return Err("Container id is required.".to_string());
   }

   let mut args = match action.as_str() {
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

   let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
   run_docker(&borrowed).await?;
   args.clear();
   Ok(())
}

#[tauri::command]
pub async fn docker_get_container_logs(
   container_id: String,
   tail: Option<u16>,
) -> Result<String, String> {
   if container_id.trim().is_empty() {
      return Err("Container id is required.".to_string());
   }

   let tail = tail.unwrap_or(500).to_string();
   run_docker(&["logs", "--timestamps", "--tail", &tail, &container_id]).await
}

#[tauri::command]
pub async fn docker_start_container_log_stream(
   container_id: String,
   tail: Option<u16>,
   app_handle: AppHandle,
   streams: State<'_, DockerLogStreams>,
) -> Result<String, String> {
   if container_id.trim().is_empty() {
      return Err("Container id is required.".to_string());
   }

   let stream_id = Uuid::new_v4().to_string();
   let stream_id_for_task = stream_id.clone();
   let container_id_for_task = container_id.clone();
   let tail = tail.unwrap_or(300).to_string();
   let tasks = streams.tasks.clone();

   let handle = tokio::spawn(async move {
      run_container_log_stream(
         app_handle,
         tasks,
         stream_id_for_task,
         container_id_for_task,
         tail,
      )
      .await;
   });

   streams.tasks.lock().await.insert(stream_id.clone(), handle);
   Ok(stream_id)
}

#[tauri::command]
pub async fn docker_stop_container_log_stream(
   stream_id: String,
   streams: State<'_, DockerLogStreams>,
) -> Result<(), String> {
   if stream_id.trim().is_empty() {
      return Ok(());
   }

   if let Some(handle) = streams.tasks.lock().await.remove(&stream_id) {
      handle.abort();
   }

   Ok(())
}

#[tauri::command]
pub async fn docker_get_compose_project(
   workspace_path: Option<String>,
) -> Result<DockerComposeProject, String> {
   let workspace_path = workspace_path.and_then(normalize_workspace_path);
   let Some(workspace_path) = workspace_path else {
      return Ok(DockerComposeProject {
         workspace_path: None,
         files: Vec::new(),
         services: Vec::new(),
      });
   };

   let compose_files = discover_compose_files(&workspace_path);
   if compose_files.is_empty() {
      return Ok(DockerComposeProject {
         workspace_path: Some(workspace_path.to_string_lossy().into_owned()),
         files: Vec::new(),
         services: Vec::new(),
      });
   }

   let services = docker_compose_services(&workspace_path, &compose_files).await?;

   Ok(DockerComposeProject {
      workspace_path: Some(workspace_path.to_string_lossy().into_owned()),
      files: compose_files
         .iter()
         .map(|path| path.to_string_lossy().into_owned())
         .collect(),
      services,
   })
}

#[tauri::command]
pub async fn docker_compose_action(
   workspace_path: String,
   files: Vec<String>,
   service: Option<String>,
   action: String,
) -> Result<String, String> {
   let workspace_path = normalize_workspace_path(workspace_path)
      .ok_or_else(|| "Workspace path is required.".to_string())?;
   if files.is_empty() {
      return Err("No Docker Compose files were found for this workspace.".to_string());
   }

   let mut args = compose_file_args(&files);
   match action.as_str() {
      "up" => {
         args.push("up".to_string());
         args.push("--detach".to_string());
         if let Some(service) = normalize_service(service) {
            args.push(service);
         }
         run_docker_in(&args, &workspace_path).await
      }
      "stop" | "restart" | "build" => {
         args.push(action);
         if let Some(service) = normalize_service(service) {
            args.push(service);
         }
         run_docker_in(&args, &workspace_path).await
      }
      "down" => {
         args.push("down".to_string());
         run_docker_in(&args, &workspace_path).await
      }
      "rebuild" => {
         let mut build_args = args.clone();
         build_args.push("build".to_string());
         if let Some(service) = normalize_service(service.clone()) {
            build_args.push(service);
         }
         let build_output = run_docker_in(&build_args, &workspace_path).await?;

         args.push("up".to_string());
         args.push("--detach".to_string());
         if let Some(service) = normalize_service(service) {
            args.push(service);
         }
         let up_output = run_docker_in(&args, &workspace_path).await?;
         Ok(join_command_output(build_output, up_output))
      }
      _ => Err(format!("Unsupported Docker Compose action: {}", action)),
   }
}

#[tauri::command]
pub async fn docker_build_image(request: DockerBuildImageRequest) -> Result<String, String> {
   let context_path = normalize_required_path(request.context_path, "Build context path")?;
   let mut args = vec!["build".to_string()];

   if let Some(tag) = normalize_optional_value(request.tag) {
      args.push("--tag".to_string());
      args.push(tag);
   }
   if let Some(dockerfile_path) = request
      .dockerfile_path
      .and_then(|path| normalize_optional_value(Some(path)))
      .map(PathBuf::from)
   {
      args.push("--file".to_string());
      args.push(dockerfile_path.to_string_lossy().into_owned());
   }
   for build_arg in request.build_args.unwrap_or_default() {
      if let Some(build_arg) = normalize_optional_value(Some(build_arg)) {
         args.push("--build-arg".to_string());
         args.push(build_arg);
      }
   }
   args.push(context_path.to_string_lossy().into_owned());

   run_docker_in(&args, &context_path).await
}

#[tauri::command]
pub async fn docker_run_image(request: DockerRunImageRequest) -> Result<String, String> {
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
   for port in request.ports.unwrap_or_default() {
      if let Some(port) = normalize_optional_value(Some(port)) {
         args.push("--publish".to_string());
         args.push(port);
      }
   }
   for volume in request.volumes.unwrap_or_default() {
      if let Some(volume) = normalize_optional_value(Some(volume)) {
         args.push("--volume".to_string());
         args.push(volume);
      }
   }
   for env in request.env.unwrap_or_default() {
      if let Some(env) = normalize_optional_value(Some(env)) {
         args.push("--env".to_string());
         args.push(env);
      }
   }
   args.push(image);
   if let Some(command) = normalize_optional_value(request.command) {
      args.extend(command.split_whitespace().map(ToString::to_string));
   }

   run_docker_owned(&args).await
}

#[tauri::command]
pub async fn docker_image_action(
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
         run_docker_owned(&args).await
      }
      _ => Err(format!("Unsupported Docker image action: {}", action)),
   }
}

#[tauri::command]
pub async fn docker_prune_resources(
   target: String,
   include_volumes: Option<bool>,
) -> Result<String, String> {
   let mut args = match target.as_str() {
      "containers" => vec![
         "container".to_string(),
         "prune".to_string(),
         "--force".to_string(),
      ],
      "images" => vec![
         "image".to_string(),
         "prune".to_string(),
         "--all".to_string(),
         "--force".to_string(),
      ],
      "volumes" => vec![
         "volume".to_string(),
         "prune".to_string(),
         "--all".to_string(),
         "--force".to_string(),
      ],
      "networks" => vec![
         "network".to_string(),
         "prune".to_string(),
         "--force".to_string(),
      ],
      "system" => vec![
         "system".to_string(),
         "prune".to_string(),
         "--force".to_string(),
      ],
      _ => return Err(format!("Unsupported Docker prune target: {}", target)),
   };

   if target == "system" && include_volumes.unwrap_or(false) {
      args.push("--volumes".to_string());
   }

   run_docker_owned(&args).await
}

#[tauri::command]
pub async fn docker_list_container_files(
   container_id: String,
   path: Option<String>,
) -> Result<Vec<DockerContainerFileEntry>, String> {
   let container_id = normalize_optional_value(Some(container_id))
      .ok_or_else(|| "Container id is required.".to_string())?;
   let container_path = normalize_container_path(path);
   let source = format!("{}:{}", container_id, container_path);
   let args = vec!["cp".to_string(), source, "-".to_string()];
   let archive = run_docker_bytes(&args).await?;

   parse_container_file_archive(&archive, &container_path)
}

#[tauri::command]
pub async fn docker_copy_from_container(
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

   run_docker_owned(&[
      "cp".to_string(),
      format!("{}:{}", container_id, container_path),
      host_path,
   ])
   .await
}

#[tauri::command]
pub async fn docker_copy_to_container(
   container_id: String,
   host_path: String,
   container_path: String,
) -> Result<String, String> {
   let container_id = normalize_optional_value(Some(container_id))
      .ok_or_else(|| "Container id is required.".to_string())?;
   let host_path = normalize_required_path(host_path, "Host path")?;
   let container_path = normalize_optional_value(Some(container_path))
      .ok_or_else(|| "Container path is required.".to_string())?;

   run_docker_owned(&[
      "cp".to_string(),
      host_path.to_string_lossy().into_owned(),
      format!("{}:{}", container_id, container_path),
   ])
   .await
}

#[tauri::command]
pub async fn docker_registry_search(
   query: String,
   limit: Option<u16>,
) -> Result<Vec<DockerRegistrySearchResult>, String> {
   let query = normalize_optional_value(Some(query))
      .ok_or_else(|| "Search query is required.".to_string())?;
   let limit = limit.unwrap_or(25).clamp(1, 100).to_string();
   let output = run_docker_owned(&[
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

#[tauri::command]
pub async fn docker_registry_login(request: DockerRegistryLoginRequest) -> Result<String, String> {
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

   run_docker_with_stdin(&args, request.password).await
}

#[tauri::command]
pub async fn docker_registry_pull(image: String) -> Result<String, String> {
   let image =
      normalize_optional_value(Some(image)).ok_or_else(|| "Image is required.".to_string())?;
   run_docker_owned(&["pull".to_string(), image]).await
}

#[tauri::command]
pub async fn docker_registry_push(image: String) -> Result<String, String> {
   let image =
      normalize_optional_value(Some(image)).ok_or_else(|| "Image is required.".to_string())?;
   run_docker_owned(&["push".to_string(), image]).await
}

#[tauri::command]
pub async fn docker_tag_image(source: String, target: String) -> Result<String, String> {
   let source = normalize_optional_value(Some(source))
      .ok_or_else(|| "Source image is required.".to_string())?;
   let target = normalize_optional_value(Some(target))
      .ok_or_else(|| "Target tag is required.".to_string())?;
   run_docker_owned(&["tag".to_string(), source, target]).await
}

async fn docker_list_containers() -> Result<Vec<DockerContainer>, String> {
   let output = run_docker(&["ps", "--all", "--format", "{{json .}}"]).await?;
   let stats = docker_container_stats().await.unwrap_or_default();
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
            container
         })
         .collect()
   })
}

async fn docker_list_images() -> Result<Vec<DockerImage>, String> {
   let output = run_docker(&["images", "--all", "--format", "{{json .}}"]).await?;
   parse_json_lines::<DockerImageRow>(&output)
      .map(|rows| rows.into_iter().map(Into::into).collect())
}

async fn docker_list_volumes() -> Result<Vec<DockerVolume>, String> {
   let output = run_docker(&["volume", "ls", "--format", "{{json .}}"]).await?;
   parse_json_lines::<DockerVolumeRow>(&output)
      .map(|rows| rows.into_iter().map(Into::into).collect())
}

async fn docker_list_networks() -> Result<Vec<DockerNetwork>, String> {
   let output = run_docker(&["network", "ls", "--format", "{{json .}}"]).await?;
   parse_json_lines::<DockerNetworkRow>(&output)
      .map(|rows| rows.into_iter().map(Into::into).collect())
}

async fn docker_container_stats() -> Result<HashMap<String, DockerContainerStats>, String> {
   let output = run_docker(&["stats", "--no-stream", "--all", "--format", "{{json .}}"]).await?;
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

async fn docker_compose_services(
   workspace_path: &PathBuf,
   compose_files: &[PathBuf],
) -> Result<Vec<DockerComposeService>, String> {
   let service_names = docker_compose_service_names(workspace_path, compose_files).await?;
   let rows = docker_compose_ps(workspace_path, compose_files).await?;
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

   Ok(services)
}

async fn docker_compose_service_names(
   workspace_path: &PathBuf,
   compose_files: &[PathBuf],
) -> Result<Vec<String>, String> {
   let mut args = compose_path_args(compose_files);
   args.push("config".to_string());
   args.push("--services".to_string());

   let output = run_docker_in(&args, workspace_path).await?;
   Ok(output
      .lines()
      .map(str::trim)
      .filter(|line| !line.is_empty())
      .map(ToString::to_string)
      .collect())
}

async fn docker_compose_ps(
   workspace_path: &PathBuf,
   compose_files: &[PathBuf],
) -> Result<Vec<DockerComposeServiceRow>, String> {
   let mut args = compose_path_args(compose_files);
   args.extend([
      "ps".to_string(),
      "--all".to_string(),
      "--format".to_string(),
      "json".to_string(),
   ]);

   let output = run_docker_in(&args, workspace_path).await?;
   parse_compose_ps_output(&output)
}

fn normalize_workspace_path(path: String) -> Option<PathBuf> {
   let trimmed = path.trim();
   if trimmed.is_empty() || trimmed.starts_with("wsl://") || trimmed.starts_with("remote://") {
      return None;
   }

   Some(PathBuf::from(trimmed))
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

fn normalize_optional_value(value: Option<String>) -> Option<String> {
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

fn normalize_service(service: Option<String>) -> Option<String> {
   normalize_optional_value(service)
}

fn discover_compose_files(workspace_path: &PathBuf) -> Vec<PathBuf> {
   [
      "compose.yaml",
      "compose.yml",
      "docker-compose.yaml",
      "docker-compose.yml",
      ".devcontainer/compose.yaml",
      ".devcontainer/compose.yml",
      ".devcontainer/docker-compose.yaml",
      ".devcontainer/docker-compose.yml",
   ]
   .into_iter()
   .map(|relative| workspace_path.join(relative))
   .filter(|path| path.is_file())
   .collect()
}

fn compose_path_args(compose_files: &[PathBuf]) -> Vec<String> {
   let mut args = vec!["compose".to_string()];
   for file in compose_files {
      args.push("--file".to_string());
      args.push(file.to_string_lossy().into_owned());
   }
   args
}

fn compose_file_args(compose_files: &[String]) -> Vec<String> {
   let mut args = vec!["compose".to_string()];
   for file in compose_files {
      args.push("--file".to_string());
      args.push(file.clone());
   }
   args
}

fn join_command_output(first: String, second: String) -> String {
   [first.trim(), second.trim()]
      .into_iter()
      .filter(|output| !output.is_empty())
      .collect::<Vec<_>>()
      .join("\n")
}

async fn run_docker(args: &[&str]) -> Result<String, String> {
   let output = Command::new("docker")
      .args(args)
      .output()
      .await
      .map_err(|error| format!("Failed to launch Docker CLI: {}", error))?;

   if output.status.success() {
      return String::from_utf8(output.stdout)
         .map_err(|error| format!("Docker returned non-UTF-8 output: {}", error));
   }

   let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
   let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
   let detail = if !stderr.is_empty() { stderr } else { stdout };

   Err(if detail.is_empty() {
      format!("Docker command failed with status {}", output.status)
   } else {
      detail
   })
}

async fn run_docker_in(args: &[String], cwd: &PathBuf) -> Result<String, String> {
   let output = Command::new("docker")
      .args(args)
      .current_dir(cwd)
      .output()
      .await
      .map_err(|error| format!("Failed to launch Docker CLI: {}", error))?;

   docker_output_result(output).await
}

async fn run_docker_owned(args: &[String]) -> Result<String, String> {
   let output = Command::new("docker")
      .args(args)
      .output()
      .await
      .map_err(|error| format!("Failed to launch Docker CLI: {}", error))?;

   docker_output_result(output).await
}

async fn run_docker_with_stdin(args: &[String], stdin: String) -> Result<String, String> {
   let mut child = Command::new("docker")
      .args(args)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|error| format!("Failed to launch Docker CLI: {}", error))?;

   if let Some(mut child_stdin) = child.stdin.take() {
      child_stdin
         .write_all(stdin.as_bytes())
         .await
         .map_err(|error| format!("Failed to write Docker command input: {}", error))?;
   }

   let output = child
      .wait_with_output()
      .await
      .map_err(|error| format!("Docker command task failed: {}", error))?;

   docker_output_result(output).await
}

async fn run_docker_bytes(args: &[String]) -> Result<Vec<u8>, String> {
   let output = Command::new("docker")
      .args(args)
      .output()
      .await
      .map_err(|error| format!("Failed to launch Docker CLI: {}", error))?;

   if output.status.success() {
      return Ok(output.stdout);
   }

   let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
   let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
   let detail = if !stderr.is_empty() { stderr } else { stdout };

   Err(if detail.is_empty() {
      format!("Docker command failed with status {}", output.status)
   } else {
      detail
   })
}

async fn docker_output_result(output: std::process::Output) -> Result<String, String> {
   if output.status.success() {
      return String::from_utf8(output.stdout)
         .map_err(|error| format!("Docker returned non-UTF-8 output: {}", error));
   }

   let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
   let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
   let detail = if !stderr.is_empty() { stderr } else { stdout };

   Err(if detail.is_empty() {
      format!("Docker command failed with status {}", output.status)
   } else {
      detail
   })
}

async fn run_container_log_stream(
   app_handle: AppHandle,
   tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
   stream_id: String,
   container_id: String,
   tail: String,
) {
   let mut command = Command::new("docker");
   command
      .args([
         "logs",
         "--follow",
         "--timestamps",
         "--tail",
         &tail,
         &container_id,
      ])
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .kill_on_drop(true);

   let mut child = match command.spawn() {
      Ok(child) => child,
      Err(error) => {
         emit_log_exit(
            &app_handle,
            &stream_id,
            &container_id,
            None,
            Some(format!("Failed to launch Docker CLI: {}", error)),
         );
         tasks.lock().await.remove(&stream_id);
         return;
      }
   };

   let stdout_task = child.stdout.take().map(|stdout| {
      spawn_log_reader(
         app_handle.clone(),
         stream_id.clone(),
         container_id.clone(),
         "stdout",
         stdout,
      )
   });
   let stderr_task = child.stderr.take().map(|stderr| {
      spawn_log_reader(
         app_handle.clone(),
         stream_id.clone(),
         container_id.clone(),
         "stderr",
         stderr,
      )
   });

   match child.wait().await {
      Ok(status) => emit_log_exit(&app_handle, &stream_id, &container_id, status.code(), None),
      Err(error) => emit_log_exit(
         &app_handle,
         &stream_id,
         &container_id,
         None,
         Some(format!("Docker log stream failed: {}", error)),
      ),
   }

   if let Some(task) = stdout_task {
      task.abort();
   }
   if let Some(task) = stderr_task {
      task.abort();
   }

   tasks.lock().await.remove(&stream_id);
}

fn spawn_log_reader<R>(
   app_handle: AppHandle,
   stream_id: String,
   container_id: String,
   stream: &'static str,
   reader: R,
) -> JoinHandle<()>
where
   R: AsyncRead + Unpin + Send + 'static,
{
   tokio::spawn(async move {
      let mut lines = BufReader::new(reader).lines();
      loop {
         match lines.next_line().await {
            Ok(Some(line)) => {
               let _ = app_handle.emit(
                  "docker-container-log",
                  DockerLogEvent {
                     stream_id: stream_id.clone(),
                     container_id: container_id.clone(),
                     stream: stream.to_string(),
                     line,
                  },
               );
            }
            Ok(None) => break,
            Err(error) => {
               let _ = app_handle.emit(
                  "docker-container-log",
                  DockerLogEvent {
                     stream_id: stream_id.clone(),
                     container_id: container_id.clone(),
                     stream: "stderr".to_string(),
                     line: format!("Failed to read Docker log stream: {}", error),
                  },
               );
               break;
            }
         }
      }
   })
}

fn emit_log_exit(
   app_handle: &AppHandle,
   stream_id: &str,
   container_id: &str,
   code: Option<i32>,
   error: Option<String>,
) {
   let _ = app_handle.emit(
      "docker-container-log-exit",
      DockerLogExitEvent {
         stream_id: stream_id.to_string(),
         container_id: container_id.to_string(),
         code,
         error,
      },
   );
}

fn parse_json_lines<T>(output: &str) -> Result<Vec<T>, String>
where
   T: for<'de> Deserialize<'de>,
{
   output
      .lines()
      .filter(|line| !line.trim().is_empty())
      .map(|line| {
         serde_json::from_str(line)
            .map_err(|error| format!("Failed to parse Docker output: {}", error))
      })
      .collect()
}

fn parse_compose_ps_output(output: &str) -> Result<Vec<DockerComposeServiceRow>, String> {
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

fn parse_container_file_archive(
   archive_bytes: &[u8],
   container_path: &str,
) -> Result<Vec<DockerContainerFileEntry>, String> {
   let mut archive = tar::Archive::new(Cursor::new(archive_bytes));
   let mut raw_entries = Vec::new();

   for entry in archive
      .entries()
      .map_err(|error| format!("Failed to read Docker copy archive: {}", error))?
   {
      let entry =
         entry.map_err(|error| format!("Failed to read Docker copy archive: {}", error))?;
      let path = entry
         .path()
         .map_err(|error| format!("Failed to read Docker copy archive path: {}", error))?
         .to_string_lossy()
         .replace('\\', "/");
      let components = path
         .split('/')
         .filter(|part| !part.is_empty() && *part != ".")
         .map(ToString::to_string)
         .collect::<Vec<_>>();
      let header = entry.header();
      raw_entries.push((
         components,
         header.entry_type().is_dir(),
         header.size().unwrap_or(0),
         header.mtime().ok(),
         header.mode().ok().map(|mode| format!("{:o}", mode)),
      ));
   }

   let strip_root = common_archive_root(&raw_entries, container_path);
   let mut entries = BTreeMap::<String, DockerContainerFileEntry>::new();

   for (mut components, is_directory, size, modified, mode) in raw_entries {
      if strip_root {
         if components.is_empty() {
            continue;
         }
         components.remove(0);
      }
      if components.is_empty() {
         continue;
      }

      let name = components[0].clone();
      let child_is_directory = is_directory || components.len() > 1;
      let entry = entries
         .entry(name.clone())
         .or_insert_with(|| DockerContainerFileEntry {
            path: join_container_path(container_path, &name),
            name,
            is_directory: child_is_directory,
            size: if child_is_directory { 0 } else { size },
            modified,
            mode: mode.clone(),
         });

      if child_is_directory {
         entry.is_directory = true;
         entry.size = 0;
      } else {
         entry.size = size;
      }
      if entry.modified.is_none() {
         entry.modified = modified;
      }
      if entry.mode.is_none() {
         entry.mode = mode;
      }
   }

   Ok(entries.into_values().collect())
}

fn common_archive_root(
   entries: &[(Vec<String>, bool, u64, Option<u64>, Option<String>)],
   container_path: &str,
) -> bool {
   let Some(expected_root) = container_path
      .trim_end_matches('/')
      .rsplit('/')
      .find(|part| !part.is_empty())
   else {
      return false;
   };

   !entries.is_empty()
      && entries.iter().all(|(components, _, _, _, _)| {
         components.first().is_some_and(|part| part == expected_root)
      })
}

fn join_container_path(parent: &str, child: &str) -> String {
   if parent == "/" {
      format!("/{}", child)
   } else {
      format!("{}/{}", parent.trim_end_matches('/'), child)
   }
}

fn parse_health(status: &str) -> Option<String> {
   if status.contains("(healthy)") {
      Some("healthy".to_string())
   } else if status.contains("(unhealthy)") {
      Some("unhealthy".to_string())
   } else if status.contains("(health: starting)") {
      Some("starting".to_string())
   } else {
      None
   }
}

impl From<DockerContainerRow> for DockerContainer {
   fn from(row: DockerContainerRow) -> Self {
      let health = parse_health(&row.status);
      Self {
         id: row.id,
         name: row.names,
         image: row.image,
         command: row.command,
         status: row.status,
         state: row.state,
         ports: row.ports,
         networks: row.networks,
         created_at: row.created_at,
         health,
         stats: None,
      }
   }
}

impl From<DockerStatsRow> for DockerContainerStats {
   fn from(row: DockerStatsRow) -> Self {
      Self {
         cpu_percent: row.cpu_percent,
         memory_usage: row.mem_usage,
         memory_percent: row.memory_percent,
         network_io: row.network_io,
         block_io: row.block_io,
         pids: row.pids,
      }
   }
}

impl From<DockerImageRow> for DockerImage {
   fn from(row: DockerImageRow) -> Self {
      Self {
         id: row.id,
         repository: row.repository,
         tag: row.tag,
         digest: row.digest,
         size: row.size,
         created_since: row.created_since,
      }
   }
}

impl From<DockerRegistrySearchRow> for DockerRegistrySearchResult {
   fn from(row: DockerRegistrySearchRow) -> Self {
      Self {
         name: row.name,
         description: row.description,
         star_count: row.star_count,
         official: row.official,
         automated: row.automated,
      }
   }
}

impl From<DockerVolumeRow> for DockerVolume {
   fn from(row: DockerVolumeRow) -> Self {
      Self {
         name: row.name,
         driver: row.driver,
         scope: row.scope,
         mountpoint: row.mountpoint,
      }
   }
}

impl From<DockerNetworkRow> for DockerNetwork {
   fn from(row: DockerNetworkRow) -> Self {
      Self {
         id: row.id,
         name: row.name,
         driver: row.driver,
         scope: row.scope,
         internal: row.internal,
         ipv6: row.ipv6,
      }
   }
}

impl From<DockerComposeServiceRow> for DockerComposeService {
   fn from(row: DockerComposeServiceRow) -> Self {
      let ports = row
         .publishers
         .iter()
         .filter_map(|publisher| {
            if publisher.published_port == 0 || publisher.target_port == 0 {
               return None;
            }
            let host = if publisher.url.trim().is_empty() {
               "0.0.0.0"
            } else {
               publisher.url.trim()
            };
            Some(
               format!(
                  "{}:{}->{}{}",
                  host,
                  publisher.published_port,
                  publisher.target_port,
                  if publisher.protocol.trim().is_empty() {
                     ""
                  } else {
                     "/"
                  }
               ) + publisher.protocol.trim(),
            )
         })
         .collect::<Vec<_>>()
         .join(", ");
      let health = if row.health.trim().is_empty() {
         parse_health(&row.status)
      } else {
         Some(row.health)
      };
      let state = if row.state.trim().is_empty() {
         "unknown".to_string()
      } else {
         row.state
      };
      let status = if row.status.trim().is_empty() {
         state.clone()
      } else {
         row.status
      };

      Self {
         name: row.service,
         state,
         status,
         health,
         container_id: if row.id.trim().is_empty() {
            None
         } else {
            Some(row.id)
         },
         container_name: if row.name.trim().is_empty() {
            None
         } else {
            Some(row.name)
         },
         ports,
      }
   }
}

#[cfg(test)]
mod tests {
   use super::{
      DockerComposeService, DockerContainerRow, DockerRegistrySearchRow, DockerStatsRow,
      parse_compose_ps_output, parse_container_file_archive, parse_health, parse_json_lines,
   };
   use std::io::Cursor;

   #[test]
   fn parses_docker_json_lines() {
      let rows = parse_json_lines::<DockerContainerRow>(
         r#"{"ID":"abc123","Names":"web","Image":"nginx","Command":"\"nginx\"","Status":"Up 2 minutes (healthy)","State":"running","Ports":"0.0.0.0:8080->80/tcp","Networks":"bridge","CreatedAt":"2026-06-27 10:00:00 +0000 UTC"}"#,
      )
      .expect("valid docker json line");

      assert_eq!(rows.len(), 1);
      assert_eq!(rows[0].id, "abc123");
      assert_eq!(parse_health(&rows[0].status).as_deref(), Some("healthy"));
   }

   #[test]
   fn parses_compose_ps_json_array() {
      let rows = parse_compose_ps_output(
         r#"[{"ID":"abc123","Name":"app-web-1","Service":"web","State":"running","Health":"healthy","Status":"running","Publishers":[{"URL":"0.0.0.0","TargetPort":3000,"PublishedPort":8080,"Protocol":"tcp"}]}]"#,
      )
      .expect("valid docker compose json");

      assert_eq!(rows.len(), 1);
      let service = DockerComposeService::from(rows.into_iter().next().unwrap());
      assert_eq!(service.name, "web");
      assert_eq!(service.health.as_deref(), Some("healthy"));
      assert_eq!(service.ports, "0.0.0.0:8080->3000/tcp");
   }

   #[test]
   fn parses_docker_stats_json_lines() {
      let rows = parse_json_lines::<DockerStatsRow>(
         r#"{"ID":"abc123","Name":"web","CPUPerc":"1.25%","MemUsage":"64MiB / 2GiB","MemPerc":"3.12%","NetIO":"1kB / 2kB","BlockIO":"3MB / 4MB","PIDs":"8"}"#,
      )
      .expect("valid docker stats json line");

      assert_eq!(rows.len(), 1);
      assert_eq!(rows[0].id, "abc123");
      assert_eq!(rows[0].cpu_percent, "1.25%");
      assert_eq!(rows[0].memory_percent, "3.12%");
   }

   #[test]
   fn parses_container_file_archive_top_level_entries() {
      let mut builder = tar::Builder::new(Vec::new());
      append_tar_file(&mut builder, "app/package.json", b"{}");
      append_tar_file(&mut builder, "app/src/main.rs", b"fn main() {}");
      let archive = builder.into_inner().expect("archive bytes");

      let entries = parse_container_file_archive(&archive, "/app").expect("container files");

      assert_eq!(entries.len(), 2);
      assert!(
         entries
            .iter()
            .any(|entry| entry.name == "src" && entry.is_directory)
      );
      assert!(entries.iter().any(|entry| {
         entry.name == "package.json" && !entry.is_directory && entry.path == "/app/package.json"
      }));
   }

   #[test]
   fn parses_registry_search_json_lines() {
      let rows = parse_json_lines::<DockerRegistrySearchRow>(
         r#"{"Name":"nginx","Description":"Official build of Nginx.","StarCount":"21000","Official":"[OK]","Automated":""}"#,
      )
      .expect("valid docker search json");

      assert_eq!(rows.len(), 1);
      assert_eq!(rows[0].name, "nginx");
      assert_eq!(rows[0].official, "[OK]");
   }

   fn append_tar_file(builder: &mut tar::Builder<Vec<u8>>, path: &str, contents: &[u8]) {
      let mut header = tar::Header::new_gnu();
      header.set_path(path).expect("tar path");
      header.set_size(contents.len() as u64);
      header.set_cksum();
      builder
         .append(&header, Cursor::new(contents))
         .expect("append tar file");
   }
}
