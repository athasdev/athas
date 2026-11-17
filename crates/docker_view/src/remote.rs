//! The web's `athas_docker`: the crate's types, compiled from its sources with both serde
//! directions (`build.rs`), and its calls asked of the workspace server (`relay`).

use std::ffi::OsString;

use serde::{Serialize, de::DeserializeOwned};

use crate::relay::{DockerCall, call_value};

#[allow(dead_code)]
mod types {
    include!(concat!(env!("OUT_DIR"), "/docker_types.rs"));
}

pub use types::*;

fn call<T: DeserializeOwned>(call: DockerCall) -> Result<T, String> {
    serde_json::from_value(call_value(call)?).map_err(|error| format!("The workspace server's Docker answer could not be read: {error}"))
}

fn to_json(value: impl Serialize) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or_default()
}

/// The server's Docker CLI.
#[derive(Debug, Clone)]
pub struct Docker;

impl Docker {
    pub fn with_program(_program: impl Into<OsString>) -> Self {
        Docker
    }

    pub async fn inventory(&self) -> Result<DockerInventory, String> {
        call(DockerCall::Inventory)
    }

    pub async fn container_action(&self, container_id: String, action: String, force: Option<bool>) -> Result<(), String> {
        call(DockerCall::ContainerAction { container_id, action, force })
    }

    pub async fn build_image(&self, request: DockerBuildImageRequest) -> Result<String, String> {
        call(DockerCall::BuildImage { request: to_json(request) })
    }

    pub async fn run_image(&self, request: DockerRunImageRequest) -> Result<String, String> {
        call(DockerCall::RunImage { request: to_json(request) })
    }

    pub async fn image_action(&self, image_id: String, action: String, force: Option<bool>) -> Result<String, String> {
        call(DockerCall::ImageAction { image_id, action, force })
    }

    pub async fn prune_resources(&self, target: String, include_volumes: Option<bool>) -> Result<String, String> {
        call(DockerCall::PruneResources { target, include_volumes })
    }

    pub async fn list_container_files(&self, container_id: String, path: Option<String>) -> Result<Vec<DockerContainerFileEntry>, String> {
        call(DockerCall::ListContainerFiles { container_id, path })
    }

    pub async fn copy_from_container(&self, container_id: String, container_path: String, host_path: String) -> Result<String, String> {
        call(DockerCall::CopyFromContainer { container_id, container_path, host_path })
    }

    pub async fn copy_to_container(&self, container_id: String, host_path: String, container_path: String) -> Result<String, String> {
        call(DockerCall::CopyToContainer { container_id, host_path, container_path })
    }

    pub async fn registry_search(&self, query: String, limit: Option<u16>) -> Result<Vec<DockerRegistrySearchResult>, String> {
        call(DockerCall::RegistrySearch { query, limit })
    }

    pub async fn registry_login(&self, request: DockerRegistryLoginRequest) -> Result<String, String> {
        call(DockerCall::RegistryLogin { request: to_json(request) })
    }

    pub async fn registry_pull(&self, image: String) -> Result<String, String> {
        call(DockerCall::RegistryPull { image })
    }

    pub async fn registry_push(&self, image: String) -> Result<String, String> {
        call(DockerCall::RegistryPush { image })
    }

    pub async fn tag_image(&self, source: String, target: String) -> Result<String, String> {
        call(DockerCall::TagImage { source, target })
    }

    pub async fn compose_project(&self, workspace_path: Option<String>) -> Result<DockerComposeProject, String> {
        call(DockerCall::ComposeProject { workspace_path })
    }

    pub async fn compose_action(
        &self,
        workspace_path: String,
        files: Vec<String>,
        service: Option<String>,
        action: String,
        env_files: Option<Vec<String>>,
    ) -> Result<String, String> {
        call(DockerCall::ComposeAction { workspace_path, files, service, action, env_files })
    }

    pub async fn open_dev_container(&self, workspace_path: String, config_path: String) -> Result<DockerDevContainerOpenResult, String> {
        call(DockerCall::OpenDevContainer { workspace_path, config_path })
    }
}

pub fn project_config(workspace_path: Option<String>) -> Result<DockerProjectConfig, String> {
    call(DockerCall::ProjectConfig { workspace_path })
}

pub fn save_project_config(workspace_path: String, config: DockerProjectConfig) -> Result<DockerProjectConfig, String> {
    call(DockerCall::SaveProjectConfig { workspace_path, config: to_json(config) })
}

pub fn open_env_file(workspace_path: String, path: String) -> Result<DockerEnvFileContent, String> {
    call(DockerCall::OpenEnvFile { workspace_path, path })
}

pub fn delete_env_file(workspace_path: String, path: String) -> Result<(), String> {
    call(DockerCall::DeleteEnvFile { workspace_path, path })
}
