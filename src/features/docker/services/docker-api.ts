import { invoke } from "@tauri-apps/api/core";
import type {
  DockerBuildImageRequest,
  DockerComposeAction,
  DockerComposeProject,
  DockerContainerAction,
  DockerContainerFileEntry,
  DockerDevContainerOpenResult,
  DockerEnvFile,
  DockerImageAction,
  DockerInventory,
  DockerPruneTarget,
  DockerProjectConfig,
  DockerRegistryLoginRequest,
  DockerRegistrySearchResult,
  DockerRunImageRequest,
} from "@/features/docker/types/docker.types";

export function getDockerInventory(): Promise<DockerInventory> {
  return invoke<DockerInventory>("docker_get_inventory");
}

export function runDockerContainerAction(
  containerId: string,
  action: DockerContainerAction,
  force = false,
): Promise<void> {
  return invoke("docker_container_action", {
    containerId,
    action,
    force,
  });
}

export function getDockerContainerLogs(containerId: string, tail = 500): Promise<string> {
  return invoke<string>("docker_get_container_logs", {
    containerId,
    tail,
  });
}

export function startDockerContainerLogStream(containerId: string, tail = 300): Promise<string> {
  return invoke<string>("docker_start_container_log_stream", {
    containerId,
    tail,
  });
}

export function stopDockerContainerLogStream(streamId: string): Promise<void> {
  return invoke("docker_stop_container_log_stream", {
    streamId,
  });
}

export function getDockerComposeProject(
  workspacePath: string | undefined,
): Promise<DockerComposeProject> {
  return invoke<DockerComposeProject>("docker_get_compose_project", {
    workspacePath,
  });
}

export function runDockerComposeAction({
  workspacePath,
  files,
  service,
  action,
  envFiles,
}: {
  workspacePath: string;
  files: string[];
  service?: string;
  action: DockerComposeAction;
  envFiles?: string[];
}): Promise<string> {
  return invoke<string>("docker_compose_action", {
    workspacePath,
    files,
    service,
    action,
    envFiles,
  });
}

export function buildDockerImage(request: DockerBuildImageRequest): Promise<string> {
  return invoke<string>("docker_build_image", {
    request,
  });
}

export function runDockerImage(request: DockerRunImageRequest): Promise<string> {
  return invoke<string>("docker_run_image", {
    request,
  });
}

export function runDockerImageAction(
  imageId: string,
  action: DockerImageAction,
  force = false,
): Promise<string> {
  return invoke<string>("docker_image_action", {
    imageId,
    action,
    force,
  });
}

export function pruneDockerResources(
  target: DockerPruneTarget,
  includeVolumes = false,
): Promise<string> {
  return invoke<string>("docker_prune_resources", {
    target,
    includeVolumes,
  });
}

export function listDockerContainerFiles(
  containerId: string,
  path = "/",
): Promise<DockerContainerFileEntry[]> {
  return invoke<DockerContainerFileEntry[]>("docker_list_container_files", {
    containerId,
    path,
  });
}

export function copyFromDockerContainer({
  containerId,
  containerPath,
  hostPath,
}: {
  containerId: string;
  containerPath: string;
  hostPath: string;
}): Promise<string> {
  return invoke<string>("docker_copy_from_container", {
    containerId,
    containerPath,
    hostPath,
  });
}

export function copyToDockerContainer({
  containerId,
  hostPath,
  containerPath,
}: {
  containerId: string;
  hostPath: string;
  containerPath: string;
}): Promise<string> {
  return invoke<string>("docker_copy_to_container", {
    containerId,
    hostPath,
    containerPath,
  });
}

export function searchDockerRegistry(
  query: string,
  limit = 25,
): Promise<DockerRegistrySearchResult[]> {
  return invoke<DockerRegistrySearchResult[]>("docker_registry_search", {
    query,
    limit,
  });
}

export function loginDockerRegistry(request: DockerRegistryLoginRequest): Promise<string> {
  return invoke<string>("docker_registry_login", {
    request,
  });
}

export function pullDockerRegistryImage(image: string): Promise<string> {
  return invoke<string>("docker_registry_pull", {
    image,
  });
}

export function pushDockerRegistryImage(image: string): Promise<string> {
  return invoke<string>("docker_registry_push", {
    image,
  });
}

export function tagDockerImage(source: string, target: string): Promise<string> {
  return invoke<string>("docker_tag_image", {
    source,
    target,
  });
}

export function getDockerProjectConfig(
  workspacePath: string | undefined,
): Promise<DockerProjectConfig> {
  return invoke<DockerProjectConfig>("docker_get_project_config", {
    workspacePath,
  });
}

export function saveDockerProjectConfig(
  workspacePath: string,
  config: DockerProjectConfig,
): Promise<DockerProjectConfig> {
  return invoke<DockerProjectConfig>("docker_save_project_config", {
    workspacePath,
    config,
  });
}

export function readDockerEnvFile(workspacePath: string, path: string): Promise<string> {
  return invoke<string>("docker_read_env_file", {
    workspacePath,
    path,
  });
}

export function writeDockerEnvFile(
  workspacePath: string,
  path: string,
  content: string,
): Promise<DockerEnvFile> {
  return invoke<DockerEnvFile>("docker_write_env_file", {
    workspacePath,
    path,
    content,
  });
}

export function openDockerDevContainer(
  workspacePath: string,
  configPath: string,
): Promise<DockerDevContainerOpenResult> {
  return invoke<DockerDevContainerOpenResult>("docker_open_dev_container", {
    workspacePath,
    configPath,
  });
}
