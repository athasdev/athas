use athas_docker::{Docker, DockerLogEvent, DockerLogExitEvent, DockerLogSink};
pub use athas_docker::{
   DockerBuildImageRequest, DockerComposeProject, DockerContainerFileEntry,
   DockerDevContainerOpenResult, DockerEnvFile, DockerEnvFileContent, DockerInventory,
   DockerLogStreams, DockerProjectConfig, DockerRegistryLoginRequest, DockerRegistrySearchResult,
   DockerRunImageRequest,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

struct AppLogSink(AppHandle);

impl DockerLogSink for AppLogSink {
   fn line(&self, event: DockerLogEvent) {
      let _ = self.0.emit("docker-container-log", event);
   }

   fn exit(&self, event: DockerLogExitEvent) {
      let _ = self.0.emit("docker-container-log-exit", event);
   }
}

#[tauri::command]
#[specta::specta]
pub async fn docker_get_inventory() -> Result<DockerInventory, String> {
   Docker::default().inventory().await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_container_action(
   container_id: String,
   action: String,
   force: Option<bool>,
) -> Result<(), String> {
   Docker::default()
      .container_action(container_id, action, force)
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_get_container_logs(
   container_id: String,
   tail: Option<u16>,
) -> Result<String, String> {
   Docker::default().container_logs(container_id, tail).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_start_container_log_stream(
   container_id: String,
   tail: Option<u16>,
   app_handle: AppHandle,
   streams: State<'_, DockerLogStreams>,
) -> Result<String, String> {
   streams
      .start(
         Docker::default(),
         container_id,
         tail,
         Arc::new(AppLogSink(app_handle)),
      )
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_stop_container_log_stream(
   stream_id: String,
   streams: State<'_, DockerLogStreams>,
) -> Result<(), String> {
   streams.stop(&stream_id).await;
   Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn docker_get_compose_project(
   workspace_path: Option<String>,
) -> Result<DockerComposeProject, String> {
   Docker::default().compose_project(workspace_path).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_compose_action(
   workspace_path: String,
   files: Vec<String>,
   service: Option<String>,
   action: String,
   env_files: Option<Vec<String>>,
) -> Result<String, String> {
   Docker::default()
      .compose_action(workspace_path, files, service, action, env_files)
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_build_image(request: DockerBuildImageRequest) -> Result<String, String> {
   Docker::default().build_image(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_run_image(request: DockerRunImageRequest) -> Result<String, String> {
   Docker::default().run_image(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_image_action(
   image_id: String,
   action: String,
   force: Option<bool>,
) -> Result<String, String> {
   Docker::default()
      .image_action(image_id, action, force)
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_prune_resources(
   target: String,
   include_volumes: Option<bool>,
) -> Result<String, String> {
   Docker::default()
      .prune_resources(target, include_volumes)
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_list_container_files(
   container_id: String,
   path: Option<String>,
) -> Result<Vec<DockerContainerFileEntry>, String> {
   Docker::default()
      .list_container_files(container_id, path)
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_copy_from_container(
   container_id: String,
   container_path: String,
   host_path: String,
) -> Result<String, String> {
   Docker::default()
      .copy_from_container(container_id, container_path, host_path)
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_copy_to_container(
   container_id: String,
   host_path: String,
   container_path: String,
) -> Result<String, String> {
   Docker::default()
      .copy_to_container(container_id, host_path, container_path)
      .await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_registry_search(
   query: String,
   limit: Option<u16>,
) -> Result<Vec<DockerRegistrySearchResult>, String> {
   Docker::default().registry_search(query, limit).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_registry_login(request: DockerRegistryLoginRequest) -> Result<String, String> {
   Docker::default().registry_login(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_registry_pull(image: String) -> Result<String, String> {
   Docker::default().registry_pull(image).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_registry_push(image: String) -> Result<String, String> {
   Docker::default().registry_push(image).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_tag_image(source: String, target: String) -> Result<String, String> {
   Docker::default().tag_image(source, target).await
}

#[tauri::command]
#[specta::specta]
pub async fn docker_get_project_config(
   workspace_path: Option<String>,
) -> Result<DockerProjectConfig, String> {
   athas_docker::project_config(workspace_path)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_save_project_config(
   workspace_path: String,
   config: DockerProjectConfig,
) -> Result<DockerProjectConfig, String> {
   athas_docker::save_project_config(workspace_path, config)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_read_env_file(workspace_path: String, path: String) -> Result<String, String> {
   athas_docker::read_env_file(workspace_path, path)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_open_env_file(
   workspace_path: String,
   path: String,
) -> Result<DockerEnvFileContent, String> {
   athas_docker::open_env_file(workspace_path, path)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_write_env_file(
   workspace_path: String,
   path: String,
   content: String,
) -> Result<DockerEnvFile, String> {
   athas_docker::write_env_file(workspace_path, path, content)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_delete_env_file(workspace_path: String, path: String) -> Result<(), String> {
   athas_docker::delete_env_file(workspace_path, path)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_open_dev_container(
   workspace_path: String,
   config_path: String,
) -> Result<DockerDevContainerOpenResult, String> {
   Docker::default()
      .open_dev_container(workspace_path, config_path)
      .await
}
