import { invoke } from "@tauri-apps/api/core";
import type { DockerContainerAction, DockerInventory } from "@/features/docker/types/docker.types";

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
