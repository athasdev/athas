use serde::{Deserialize, Serialize};

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
   pub size: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerEnvFileContent {
   pub file: DockerEnvFile,
   pub content: String,
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
   pub on_create_command: Option<String>,
   pub post_create_command: Option<String>,
   pub post_start_command: Option<String>,
   pub post_attach_command: Option<String>,
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
