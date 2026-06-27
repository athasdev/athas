use crate::app_runtime::AppHandle;
use serde::{Deserialize, Serialize};
use std::{
   collections::{BTreeMap, HashMap},
   fs,
   io::Cursor,
   path::{Path, PathBuf},
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
   pub health_details: Option<DockerContainerHealthDetails>,
   pub stats: Option<DockerContainerStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerHealthDetails {
   pub status: String,
   pub failing_streak: i64,
   pub last_output: Option<String>,
   pub last_exit_code: Option<i64>,
   pub last_started_at: Option<String>,
   pub last_finished_at: Option<String>,
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
   pub env_files: Option<Vec<String>>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerProjectConfig {
   pub workspace_path: Option<String>,
   #[serde(default)]
   pub build_presets: Vec<DockerBuildPreset>,
   #[serde(default)]
   pub run_presets: Vec<DockerRunPreset>,
   #[serde(default)]
   pub compose_presets: Vec<DockerComposePreset>,
   #[serde(default)]
   pub debug_presets: Vec<DockerDebugPreset>,
   #[serde(default)]
   pub workspace_debug_presets: Vec<DockerDebugPreset>,
   #[serde(default)]
   pub env_files: Vec<DockerEnvFile>,
   #[serde(default)]
   pub dev_containers: Vec<DockerDevContainer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerBuildPreset {
   pub name: String,
   pub context_path: String,
   pub dockerfile_path: Option<String>,
   pub tag: Option<String>,
   #[serde(default)]
   pub build_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRunPreset {
   pub name: String,
   pub image: String,
   pub container_name: Option<String>,
   #[serde(default)]
   pub ports: Vec<String>,
   #[serde(default)]
   pub volumes: Vec<String>,
   #[serde(default)]
   pub env: Vec<String>,
   #[serde(default)]
   pub env_files: Vec<String>,
   pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerComposePreset {
   pub name: String,
   #[serde(default)]
   pub files: Vec<String>,
   pub service: Option<String>,
   pub action: String,
   #[serde(default)]
   pub env_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerDebugPreset {
   pub name: String,
   pub command: String,
   pub workdir: Option<String>,
   pub target: String,
   pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerEnvFile {
   pub path: String,
   pub relative_path: String,
   pub variable_count: usize,
   #[serde(default)]
   pub keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerDevContainer {
   pub name: String,
   pub config_path: String,
   pub relative_path: String,
   pub kind: String,
   pub image: Option<String>,
   pub docker_file: Option<String>,
   pub context: Option<String>,
   #[serde(default)]
   pub docker_compose_files: Vec<String>,
   pub service: Option<String>,
   pub workspace_folder: Option<String>,
   pub remote_user: Option<String>,
   #[serde(default)]
   pub run_args: Vec<String>,
   #[serde(default)]
   pub container_env: Vec<String>,
   #[serde(default)]
   pub remote_env: Vec<String>,
   pub workspace_mount: Option<String>,
   #[serde(default)]
   pub mounts: Vec<String>,
   #[serde(default)]
   pub forward_ports: Vec<String>,
   pub post_create_command: Option<String>,
   pub post_start_command: Option<String>,
   #[serde(default)]
   pub features: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerDevContainerOpenResult {
   pub container_id: String,
   pub command: String,
   pub name: String,
   pub output: String,
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
struct DockerInspectContainerRow {
   #[serde(default, rename = "Id")]
   id: String,
   #[serde(default)]
   name: String,
   #[serde(default)]
   state: DockerInspectContainerState,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerInspectContainerState {
   health: Option<DockerInspectContainerHealth>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerInspectContainerHealth {
   #[serde(default)]
   status: String,
   #[serde(default)]
   failing_streak: i64,
   #[serde(default)]
   log: Vec<DockerInspectContainerHealthLog>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerInspectContainerHealthLog {
   #[serde(default)]
   start: String,
   #[serde(default)]
   end: String,
   #[serde(default)]
   exit_code: i64,
   #[serde(default)]
   output: String,
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
   env_files: Option<Vec<String>>,
) -> Result<String, String> {
   let workspace_path = normalize_workspace_path(workspace_path)
      .ok_or_else(|| "Workspace path is required.".to_string())?;
   if files.is_empty() {
      return Err("No Docker Compose files were found for this workspace.".to_string());
   }

   let mut args = compose_file_args(&files);
   for env_file in env_files.unwrap_or_default() {
      if let Some(env_file) = normalize_optional_value(Some(env_file)) {
         args.push("--env-file".to_string());
         args.push(env_file);
      }
   }
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
   for env_file in request.env_files.unwrap_or_default() {
      if let Some(env_file) = normalize_optional_value(Some(env_file)) {
         args.push("--env-file".to_string());
         args.push(env_file);
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

#[tauri::command]
pub async fn docker_get_project_config(
   workspace_path: Option<String>,
) -> Result<DockerProjectConfig, String> {
   let Some(workspace_path) = workspace_path.and_then(normalize_workspace_path) else {
      return Ok(empty_project_config(None));
   };
   ensure_workspace_dir(&workspace_path)?;

   let mut config = read_project_config(&workspace_path)?;
   config.workspace_path = Some(workspace_path.to_string_lossy().into_owned());
   config.env_files = discover_env_files(&workspace_path);
   config.dev_containers = discover_dev_containers(&workspace_path);
   config.workspace_debug_presets = discover_workspace_debug_presets(&workspace_path);

   Ok(config)
}

#[tauri::command]
pub async fn docker_save_project_config(
   workspace_path: String,
   config: DockerProjectConfig,
) -> Result<DockerProjectConfig, String> {
   let workspace_path = normalize_workspace_path(workspace_path)
      .ok_or_else(|| "Workspace path is required.".to_string())?;
   ensure_workspace_dir(&workspace_path)?;

   let config_path = project_config_path(&workspace_path);
   if let Some(parent) = config_path.parent() {
      fs::create_dir_all(parent)
         .map_err(|error| format!("Failed to create Docker config directory: {}", error))?;
   }

   let saved_config = DockerProjectConfig {
      workspace_path: None,
      env_files: Vec::new(),
      dev_containers: Vec::new(),
      build_presets: sanitize_build_presets(config.build_presets),
      run_presets: sanitize_run_presets(config.run_presets),
      compose_presets: sanitize_compose_presets(config.compose_presets),
      debug_presets: sanitize_debug_presets(config.debug_presets),
      workspace_debug_presets: Vec::new(),
   };
   let contents = serde_json::to_string_pretty(&saved_config)
      .map_err(|error| format!("Failed to encode Docker project config: {}", error))?;
   fs::write(&config_path, format!("{}\n", contents))
      .map_err(|error| format!("Failed to write Docker project config: {}", error))?;

   docker_get_project_config(Some(workspace_path.to_string_lossy().into_owned())).await
}

#[tauri::command]
pub async fn docker_read_env_file(workspace_path: String, path: String) -> Result<String, String> {
   let workspace_path = normalize_workspace_path(workspace_path)
      .ok_or_else(|| "Workspace path is required.".to_string())?;
   ensure_workspace_dir(&workspace_path)?;
   let path = resolve_workspace_file(&workspace_path, path)?;
   fs::read_to_string(&path).map_err(|error| format!("Failed to read env file: {}", error))
}

#[tauri::command]
pub async fn docker_write_env_file(
   workspace_path: String,
   path: String,
   content: String,
) -> Result<DockerEnvFile, String> {
   let workspace_path = normalize_workspace_path(workspace_path)
      .ok_or_else(|| "Workspace path is required.".to_string())?;
   ensure_workspace_dir(&workspace_path)?;
   let path = resolve_workspace_file(&workspace_path, path)?;
   if !is_env_file_path(&path) {
      return Err("Only .env files can be edited from Docker project settings.".to_string());
   }
   fs::write(&path, content).map_err(|error| format!("Failed to write env file: {}", error))?;
   inspect_env_file(&workspace_path, &path)
}

#[tauri::command]
pub async fn docker_open_dev_container(
   workspace_path: String,
   config_path: String,
) -> Result<DockerDevContainerOpenResult, String> {
   let workspace_path = normalize_workspace_path(workspace_path)
      .ok_or_else(|| "Workspace path is required.".to_string())?;
   ensure_workspace_dir(&workspace_path)?;
   let config_path = resolve_workspace_file(&workspace_path, config_path)?;
   let dev_container = read_dev_container(&workspace_path, &config_path)?;

   if !dev_container.docker_compose_files.is_empty() {
      return open_compose_dev_container(&workspace_path, &dev_container).await;
   }

   open_image_dev_container(&workspace_path, &dev_container).await
}

async fn docker_list_containers() -> Result<Vec<DockerContainer>, String> {
   let output = run_docker(&["ps", "--all", "--format", "{{json .}}"]).await?;
   let stats = docker_container_stats().await.unwrap_or_default();
   let health_details = docker_container_health_details().await.unwrap_or_default();
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

async fn docker_container_health_details()
-> Result<HashMap<String, DockerContainerHealthDetails>, String> {
   let ids = run_docker(&["ps", "--all", "--quiet"]).await?;
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
   let output = run_docker_owned(&args).await?;

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

fn discover_env_files(workspace_path: &PathBuf) -> Vec<DockerEnvFile> {
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

fn discover_dev_containers(workspace_path: &PathBuf) -> Vec<DockerDevContainer> {
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

fn discover_workspace_debug_presets(workspace_path: &PathBuf) -> Vec<DockerDebugPreset> {
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
   let command = match normalize_debug_runtime(&runtime).as_str() {
      "bun" => shell_join(
         ["bun", "--inspect-brk"]
            .into_iter()
            .map(ToString::to_string)
            .chain(program)
            .chain(args),
      ),
      "node" => shell_join(
         ["node", "--inspect-brk"]
            .into_iter()
            .map(ToString::to_string)
            .chain(program)
            .chain(args),
      ),
      "python" => shell_join(
         ["python", "-m", "pdb"]
            .into_iter()
            .map(ToString::to_string)
            .chain(program)
            .chain(args),
      ),
      "rust" => shell_join(
         ["cargo", "run"]
            .into_iter()
            .map(ToString::to_string)
            .chain(args),
      ),
      "go" => shell_join(
         ["dlv", "debug"]
            .into_iter()
            .map(ToString::to_string)
            .chain(program)
            .chain(std::iter::once("--".to_string()))
            .chain(args),
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

fn read_dev_container(
   workspace_path: &PathBuf,
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
      post_create_command: command_value(&value, "postCreateCommand"),
      post_start_command: command_value(&value, "postStartCommand"),
      features,
   })
}

async fn open_compose_dev_container(
   workspace_path: &PathBuf,
   dev_container: &DockerDevContainer,
) -> Result<DockerDevContainerOpenResult, String> {
   let service = dev_container
      .service
      .clone()
      .ok_or_else(|| "Dev Container Compose config is missing service.".to_string())?;
   let compose_files = dev_container
      .docker_compose_files
      .iter()
      .map(PathBuf::from)
      .collect::<Vec<_>>();
   let mut up_args = compose_path_args(&compose_files);
   up_args.extend(["up".to_string(), "--detach".to_string(), service.clone()]);
   let up_output = run_docker_in(&up_args, workspace_path).await?;

   let mut ps_args = compose_path_args(&compose_files);
   ps_args.extend(["ps".to_string(), "-q".to_string(), service.clone()]);
   let container_id = run_docker_in(&ps_args, workspace_path)
      .await?
      .lines()
      .next()
      .map(str::trim)
      .filter(|id| !id.is_empty())
      .map(ToString::to_string)
      .ok_or_else(|| format!("Docker Compose did not return a container for {}.", service))?;
   let lifecycle_output = run_devcontainer_lifecycle_commands(&container_id, dev_container, true)
      .await
      .map(|output| join_command_output(up_output.clone(), output))?;

   Ok(DockerDevContainerOpenResult {
      command: docker_exec_shell_command(
         &container_id,
         dev_container.workspace_folder.as_deref(),
         dev_container.remote_user.as_deref(),
         &dev_container.remote_env,
      ),
      name: format!("Dev Container: {}", dev_container.name),
      container_id,
      output: lifecycle_output,
   })
}

async fn open_image_dev_container(
   workspace_path: &PathBuf,
   dev_container: &DockerDevContainer,
) -> Result<DockerDevContainerOpenResult, String> {
   let image = match &dev_container.image {
      Some(image) => image.clone(),
      None if dev_container.docker_file.is_some() => {
         let tag = format!(
            "athas-devcontainer:{}",
            slugify(&format!(
               "{}-{}",
               workspace_path.display(),
               dev_container.name
            ))
         );
         let docker_file = dev_container.docker_file.clone().unwrap();
         let context = dev_container
            .context
            .clone()
            .unwrap_or_else(|| workspace_path.to_string_lossy().into_owned());
         run_docker_owned(&[
            "build".to_string(),
            "--file".to_string(),
            docker_file,
            "--tag".to_string(),
            tag.clone(),
            context,
         ])
         .await?;
         tag
      }
      None => {
         return Err(
            "Dev Container must specify image, dockerFile, build.dockerFile, or Docker Compose."
               .to_string(),
         );
      }
   };
   let container_name = format!(
      "athas-devcontainer-{}",
      slugify(&format!(
         "{}-{}",
         workspace_path.display(),
         dev_container.name
      ))
   );
   let workspace_folder = dev_container.workspace_folder.clone().unwrap_or_else(|| {
      format!(
         "/workspaces/{}",
         workspace_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace")
      )
   });
   let existing_container = docker_container_id_by_name(&container_name).await?;
   let output = if let Some(container_id) = existing_container {
      run_docker_owned(&["start".to_string(), container_id.clone()]).await?;
      String::new()
   } else {
      let mut args = vec![
         "run".to_string(),
         "--detach".to_string(),
         "--name".to_string(),
         container_name.clone(),
         "--workdir".to_string(),
         workspace_folder.clone(),
      ];
      if let Some(workspace_mount) = &dev_container.workspace_mount {
         args.push("--mount".to_string());
         args.push(resolve_workspace_mount(
            workspace_mount,
            workspace_path,
            &workspace_folder,
         ));
      } else {
         args.push("--volume".to_string());
         args.push(format!(
            "{}:{}",
            workspace_path.to_string_lossy(),
            workspace_folder
         ));
      }
      for env in &dev_container.container_env {
         args.push("--env".to_string());
         args.push(env.clone());
      }
      for mount in &dev_container.mounts {
         args.push("--mount".to_string());
         args.push(mount.clone());
      }
      for port in &dev_container.forward_ports {
         args.push("--publish".to_string());
         args.push(publish_port_arg(port));
      }
      args.extend(dev_container.run_args.clone());
      args.extend([
         image,
         "sh".to_string(),
         "-lc".to_string(),
         "sleep infinity".to_string(),
      ]);
      run_docker_owned(&args).await?
   };
   let container_id = docker_container_id_by_name(&container_name)
      .await?
      .unwrap_or(container_name);
   let lifecycle_output = run_devcontainer_lifecycle_commands(&container_id, dev_container, true)
      .await
      .map(|lifecycle_output| join_command_output(output, lifecycle_output))?;

   Ok(DockerDevContainerOpenResult {
      command: docker_exec_shell_command(
         &container_id,
         Some(&workspace_folder),
         dev_container.remote_user.as_deref(),
         &dev_container.remote_env,
      ),
      name: format!("Dev Container: {}", dev_container.name),
      container_id,
      output: lifecycle_output,
   })
}

fn inspect_env_file(workspace_path: &PathBuf, path: &Path) -> Result<DockerEnvFile, String> {
   let content =
      fs::read_to_string(path).map_err(|error| format!("Failed to read env file: {}", error))?;
   let keys = parse_env_keys(&content);
   Ok(DockerEnvFile {
      path: path.to_string_lossy().into_owned(),
      relative_path: path
         .strip_prefix(workspace_path)
         .unwrap_or(path)
         .to_string_lossy()
         .into_owned(),
      variable_count: keys.len(),
      keys,
   })
}

fn parse_env_keys(content: &str) -> Vec<String> {
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

fn is_env_file_path(path: &Path) -> bool {
   path
      .file_name()
      .and_then(|name| name.to_str())
      .is_some_and(|name| name == ".env" || name.starts_with(".env."))
}

fn project_config_path(workspace_path: &PathBuf) -> PathBuf {
   workspace_path.join(".athas").join("docker.json")
}

fn read_project_config(workspace_path: &PathBuf) -> Result<DockerProjectConfig, String> {
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

fn empty_project_config(workspace_path: Option<String>) -> DockerProjectConfig {
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

fn ensure_workspace_dir(workspace_path: &PathBuf) -> Result<(), String> {
   if workspace_path.is_dir() {
      Ok(())
   } else {
      Err(format!(
         "Workspace path does not exist: {}",
         workspace_path.display()
      ))
   }
}

fn resolve_workspace_file(workspace_path: &PathBuf, path: String) -> Result<PathBuf, String> {
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

fn sanitize_build_presets(presets: Vec<DockerBuildPreset>) -> Vec<DockerBuildPreset> {
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

fn sanitize_run_presets(presets: Vec<DockerRunPreset>) -> Vec<DockerRunPreset> {
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

fn sanitize_compose_presets(presets: Vec<DockerComposePreset>) -> Vec<DockerComposePreset> {
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

fn sanitize_debug_presets(presets: Vec<DockerDebugPreset>) -> Vec<DockerDebugPreset> {
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

async fn docker_container_id_by_name(container_name: &str) -> Result<Option<String>, String> {
   let output = run_docker_owned(&[
      "ps".to_string(),
      "--all".to_string(),
      "--quiet".to_string(),
      "--filter".to_string(),
      format!("name=^/{}$", container_name),
   ])
   .await?;
   Ok(output
      .lines()
      .next()
      .map(str::trim)
      .filter(|id| !id.is_empty())
      .map(ToString::to_string))
}

async fn run_devcontainer_lifecycle_commands(
   container_id: &str,
   dev_container: &DockerDevContainer,
   include_post_create: bool,
) -> Result<String, String> {
   let mut output = String::new();
   if include_post_create && let Some(command) = &dev_container.post_create_command {
      let marker_path = lifecycle_marker_path(dev_container);
      let marker_exists = run_docker_exec_shell(container_id, &format!("test -f {}", marker_path))
         .await
         .is_ok();
      if !marker_exists {
         output = join_command_output(
            output,
            run_docker_exec_command(container_id, command, dev_container).await?,
         );
         run_docker_exec_shell(
            container_id,
            &format!("mkdir -p /tmp && touch {}", marker_path),
         )
         .await?;
      }
   }
   if let Some(command) = &dev_container.post_start_command {
      output = join_command_output(
         output,
         run_docker_exec_command(container_id, command, dev_container).await?,
      );
   }
   Ok(output)
}

async fn run_docker_exec_command(
   container_id: &str,
   command: &str,
   dev_container: &DockerDevContainer,
) -> Result<String, String> {
   let command = shell_command_with_context(
      command,
      dev_container.workspace_folder.as_deref(),
      &dev_container.remote_env,
   );
   let mut args = vec!["exec".to_string()];
   if let Some(remote_user) = dev_container
      .remote_user
      .as_deref()
      .and_then(|user| normalize_optional_value(Some(user.to_string())))
   {
      args.push("--user".to_string());
      args.push(remote_user);
   }
   args.extend([
      container_id.to_string(),
      "sh".to_string(),
      "-lc".to_string(),
      command,
   ]);
   run_docker_owned(&args).await
}

async fn run_docker_exec_shell(container_id: &str, command: &str) -> Result<String, String> {
   run_docker_owned(&[
      "exec".to_string(),
      container_id.to_string(),
      "sh".to_string(),
      "-lc".to_string(),
      command.to_string(),
   ])
   .await
}

fn lifecycle_marker_path(dev_container: &DockerDevContainer) -> String {
   format!(
      "/tmp/.athas-devcontainer-post-create-{}",
      slugify(&dev_container.config_path)
   )
}

fn publish_port_arg(port: &str) -> String {
   if port.contains(':') {
      port.to_string()
   } else {
      let host_port = port.split('/').next().unwrap_or(port);
      format!("{}:{}", host_port, port)
   }
}

fn resolve_workspace_mount(
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

fn string_value(value: &serde_json::Value, key: &str) -> Option<String> {
   value
      .get(key)
      .and_then(|value| value.as_str())
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .map(ToString::to_string)
}

fn string_array_or_single(value: &serde_json::Value, key: &str) -> Vec<String> {
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

fn normalize_debug_runtime(value: &str) -> String {
   let normalized = value.to_lowercase();
   if normalized.contains("bun") {
      "bun"
   } else if normalized.contains("node") || normalized.contains("pwa-node") {
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
   .to_string()
}

fn resolve_debug_command_variables(value: &str) -> String {
   value
      .replace("${workspaceFolder}", "/workspace")
      .replace("${workspaceRoot}", "/workspace")
      .replace("${fileWorkspaceFolder}", "/workspace")
}

fn shell_join(values: impl IntoIterator<Item = String>) -> String {
   values
      .into_iter()
      .filter(|value| !value.trim().is_empty())
      .map(|value| shell_quote(&value))
      .collect::<Vec<_>>()
      .join(" ")
}

fn normalize_jsonc(input: &str) -> String {
   strip_json_trailing_commas(&strip_json_comments(input))
}

fn strip_json_comments(input: &str) -> String {
   let mut output = String::with_capacity(input.len());
   let mut chars = input.chars().peekable();
   let mut in_string = false;
   let mut escaped = false;

   while let Some(ch) = chars.next() {
      if in_string {
         output.push(ch);
         if escaped {
            escaped = false;
         } else if ch == '\\' {
            escaped = true;
         } else if ch == '"' {
            in_string = false;
         }
         continue;
      }

      if ch == '"' {
         in_string = true;
         output.push(ch);
         continue;
      }

      if ch == '/' {
         match chars.peek() {
            Some('/') => {
               chars.next();
               for next in chars.by_ref() {
                  if next == '\n' {
                     output.push('\n');
                     break;
                  }
               }
               continue;
            }
            Some('*') => {
               chars.next();
               let mut previous = '\0';
               for next in chars.by_ref() {
                  if next == '\n' {
                     output.push('\n');
                  }
                  if previous == '*' && next == '/' {
                     break;
                  }
                  previous = next;
               }
               continue;
            }
            _ => {}
         }
      }

      output.push(ch);
   }

   output
}

fn strip_json_trailing_commas(input: &str) -> String {
   let mut output = String::with_capacity(input.len());
   let mut chars = input.chars().peekable();
   let mut in_string = false;
   let mut escaped = false;

   while let Some(ch) = chars.next() {
      if in_string {
         output.push(ch);
         if escaped {
            escaped = false;
         } else if ch == '\\' {
            escaped = true;
         } else if ch == '"' {
            in_string = false;
         }
         continue;
      }

      if ch == '"' {
         in_string = true;
         output.push(ch);
         continue;
      }

      if ch == ',' {
         let mut lookahead = chars.clone();
         while matches!(lookahead.peek(), Some(next) if next.is_whitespace()) {
            lookahead.next();
         }
         if matches!(lookahead.peek(), Some('}' | ']')) {
            continue;
         }
      }

      output.push(ch);
   }

   output
}

fn docker_exec_shell_command(
   container_id: &str,
   workdir: Option<&str>,
   remote_user: Option<&str>,
   remote_env: &[String],
) -> String {
   let shell_probe = "if command -v bash >/dev/null 2>&1; then exec bash; elif command -v sh \
                      >/dev/null 2>&1; then exec sh; else echo \"No interactive shell found in \
                      this container.\" >&2; exit 127; fi";
   let command = shell_command_with_context(shell_probe, workdir, remote_env);
   let user_arg = remote_user
      .filter(|user| !user.trim().is_empty())
      .map(|user| format!(" --user {}", shell_quote(user)))
      .unwrap_or_default();
   format!(
      "docker exec -it{} {} sh -lc {}",
      user_arg,
      shell_quote(container_id),
      shell_quote(&command)
   )
}

fn shell_command_with_context(
   command: &str,
   workdir: Option<&str>,
   remote_env: &[String],
) -> String {
   let mut parts = remote_env
      .iter()
      .filter_map(|entry| entry.split_once('='))
      .map(|(key, value)| format!("export {}={}", key, shell_quote(value)))
      .collect::<Vec<_>>();
   if let Some(workdir) = workdir.filter(|workdir| !workdir.trim().is_empty()) {
      parts.push(format!("cd {}", shell_quote(workdir)));
   }
   parts.push(command.to_string());
   parts.join(" && ")
}

fn shell_quote(value: &str) -> String {
   format!("'{}'", value.replace('\'', "'\\''"))
}

fn slugify(value: &str) -> String {
   let mut slug = value
      .chars()
      .map(|ch| {
         if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
         } else {
            '-'
         }
      })
      .collect::<String>();
   while slug.contains("--") {
      slug = slug.replace("--", "-");
   }
   slug.trim_matches('-').chars().take(48).collect()
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
         health_details: None,
         stats: None,
      }
   }
}

impl From<DockerInspectContainerHealth> for DockerContainerHealthDetails {
   fn from(health: DockerInspectContainerHealth) -> Self {
      let last_log = health.log.last();
      Self {
         status: health.status,
         failing_streak: health.failing_streak,
         last_output: last_log
            .map(|log| log.output.trim().to_string())
            .filter(|output| !output.is_empty()),
         last_exit_code: last_log.map(|log| log.exit_code),
         last_started_at: last_log
            .map(|log| log.start.clone())
            .filter(|value| !value.trim().is_empty()),
         last_finished_at: last_log
            .map(|log| log.end.clone())
            .filter(|value| !value.trim().is_empty()),
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
      DockerComposeService, DockerContainerHealthDetails, DockerContainerRow,
      DockerInspectContainerRow, DockerRegistrySearchRow, DockerStatsRow, discover_dev_containers,
      discover_workspace_debug_presets, normalize_jsonc, parse_compose_ps_output,
      parse_container_file_archive, parse_env_keys, parse_health, parse_json_lines,
      resolve_workspace_mount,
   };
   use std::{fs, io::Cursor};

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
   fn parses_container_health_details() {
      let rows = parse_json_lines::<DockerInspectContainerRow>(
         r#"{"Id":"abc123","Name":"/web","State":{"Health":{"Status":"unhealthy","FailingStreak":2,"Log":[{"Start":"2026-06-27T10:00:00Z","End":"2026-06-27T10:00:01Z","ExitCode":1,"Output":"connection refused\n"}]}}}"#,
      )
      .expect("valid docker inspect json line");

      let health = rows[0].state.health.clone().expect("health state");
      let details = DockerContainerHealthDetails::from(health);

      assert_eq!(details.status, "unhealthy");
      assert_eq!(details.failing_streak, 2);
      assert_eq!(details.last_exit_code, Some(1));
      assert_eq!(details.last_output.as_deref(), Some("connection refused"));
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

   #[test]
   fn parses_env_file_keys() {
      let keys = parse_env_keys(
         r#"
         # comment
         DATABASE_URL=postgres://localhost
         export NODE_ENV=development
         EMPTY=
         BAD KEY=value
         NODE_ENV=production
         "#,
      );

      assert_eq!(keys, vec!["DATABASE_URL", "EMPTY", "NODE_ENV"]);
   }

   #[test]
   fn strips_devcontainer_json_comments_without_touching_strings() {
      let normalized = normalize_jsonc(
         r#"{
           // comment
           "name": "https://example.test",
           "image": "mcr.microsoft.com/devcontainers/rust:1",
           /* block
              comment */
           "runArgs": ["--label", "path=//tmp",],
         }"#,
      );
      let value: serde_json::Value = serde_json::from_str(&normalized).expect("jsonc normalized");

      assert_eq!(value["name"], "https://example.test");
      assert_eq!(value["runArgs"][1], "path=//tmp");
   }

   #[test]
   fn discovers_devcontainer_definitions() {
      let workspace = tempfile::tempdir().expect("workspace tempdir");
      let devcontainer_dir = workspace.path().join(".devcontainer");
      fs::create_dir_all(&devcontainer_dir).expect("devcontainer directory");
      fs::write(
         devcontainer_dir.join("devcontainer.json"),
         r#"{
           "name": "Rust",
           "build": { "dockerFile": "Dockerfile", "context": ".." },
           "workspaceFolder": "/workspaces/app",
           "workspaceMount": "source=${localWorkspaceFolder},target=${containerWorkspaceFolder},type=bind",
           "containerEnv": { "RUST_LOG": "debug", "PORT": 3000 },
           "remoteEnv": { "EDITOR": "athas" },
           "mounts": ["source=cache,target=/cache,type=volume"],
           "forwardPorts": [3000, "9229/tcp"],
           "postCreateCommand": "cargo fetch",
           "postStartCommand": ["cargo", "test"],
           "features": { "ghcr.io/devcontainers/features/node:1": {} }
         }"#,
      )
      .expect("devcontainer json");

      let definitions = discover_dev_containers(&workspace.path().to_path_buf());

      assert_eq!(definitions.len(), 1);
      assert_eq!(definitions[0].name, "Rust");
      assert_eq!(definitions[0].kind, "dockerfile");
      assert_eq!(
         definitions[0].workspace_folder.as_deref(),
         Some("/workspaces/app")
      );
      assert_eq!(definitions[0].features.len(), 1);
      assert_eq!(
         definitions[0].workspace_mount.as_deref(),
         Some("source=${localWorkspaceFolder},target=${containerWorkspaceFolder},type=bind")
      );
      assert_eq!(
         resolve_workspace_mount(
            definitions[0].workspace_mount.as_deref().unwrap(),
            workspace.path(),
            "/workspaces/app",
         ),
         format!(
            "source={},target=/workspaces/app,type=bind",
            workspace.path().display()
         )
      );
      assert_eq!(
         definitions[0].container_env,
         vec!["PORT=3000", "RUST_LOG=debug"]
      );
      assert_eq!(definitions[0].remote_env, vec!["EDITOR=athas"]);
      assert_eq!(
         definitions[0].mounts,
         vec!["source=cache,target=/cache,type=volume"]
      );
      assert_eq!(definitions[0].forward_ports, vec!["3000", "9229/tcp"]);
      assert_eq!(
         definitions[0].post_create_command.as_deref(),
         Some("cargo fetch")
      );
      assert_eq!(
         definitions[0].post_start_command.as_deref(),
         Some("'cargo' 'test'")
      );
   }

   #[test]
   fn discovers_workspace_debug_presets_from_launch_json() {
      let workspace = tempfile::tempdir().expect("workspace tempdir");
      let vscode_dir = workspace.path().join(".vscode");
      fs::create_dir_all(&vscode_dir).expect("vscode directory");
      fs::write(
         vscode_dir.join("launch.json"),
         r#"{
           "configurations": [
             {
               "name": "Debug server",
               "type": "node",
               "program": "${workspaceFolder}/server.js",
               "cwd": "${workspaceFolder}",
               "args": ["--port", "3000"]
             },
             {
               "name": "Custom",
               "type": "custom",
               "command": "echo ready"
             }
           ]
         }"#,
      )
      .expect("launch json");

      let presets = discover_workspace_debug_presets(&workspace.path().to_path_buf());

      assert_eq!(presets.len(), 2);
      assert_eq!(presets[0].name, "Debug server (1)");
      assert_eq!(
         presets[0].command,
         "'node' '--inspect-brk' '/workspace/server.js' '--port' '3000'"
      );
      assert_eq!(presets[0].workdir.as_deref(), Some("/workspace"));
      assert_eq!(presets[0].source.as_deref(), Some("launch.json"));
      assert_eq!(presets[1].command, "echo ready");
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
