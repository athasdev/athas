import { queryOptions } from "@tanstack/react-query";
import { getDockerComposeProject, getDockerInventory, getDockerProjectConfig } from "./docker-api";

/**
 * Inventory is daemon-wide; Compose services and project presets belong to a workspace, so their
 * keys carry the workspace root and a switch never shows the previous workspace's data.
 */
export const dockerKeys = {
  inventory: ["docker", "inventory"] as const,
  compose: (workspacePath: string | null) => ["docker", workspacePath, "compose"] as const,
  projectConfig: (workspacePath: string | null) =>
    ["docker", workspacePath, "project-config"] as const,
};

// The daemon answers locally and its errors (not running, no permission) do not go away on retry.
const DOCKER_QUERY_DEFAULTS = { retry: false, staleTime: 10_000 } as const;

export function dockerInventoryQuery() {
  return queryOptions({
    queryKey: dockerKeys.inventory,
    queryFn: getDockerInventory,
    ...DOCKER_QUERY_DEFAULTS,
  });
}

export function dockerComposeProjectQuery(workspacePath: string | null) {
  return queryOptions({
    queryKey: dockerKeys.compose(workspacePath),
    queryFn: () => getDockerComposeProject(workspacePath ?? undefined),
    ...DOCKER_QUERY_DEFAULTS,
  });
}

export function dockerProjectConfigQuery(workspacePath: string | null) {
  return queryOptions({
    queryKey: dockerKeys.projectConfig(workspacePath),
    queryFn: () => getDockerProjectConfig(workspacePath ?? undefined),
    ...DOCKER_QUERY_DEFAULTS,
  });
}
