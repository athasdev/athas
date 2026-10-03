import { commands } from "@/bindings/commands";
import type { DockerProjectConfig as BindingDockerProjectConfig } from "@/bindings/commands";
import type {
  DockerBuildImageRequest,
  DockerComposeAction,
  DockerComposeProject,
  DockerContainerAction,
  DockerContainerFileEntry,
  DockerDevContainerOpenResult,
  DockerEnvFileContent,
  DockerImageAction,
  DockerInventory,
  DockerPruneTarget,
  DockerProjectConfig,
  DockerRegistryLoginRequest,
  DockerRegistrySearchResult,
  DockerRunImageRequest,
} from "@/features/docker/types/docker.types";

export function getDockerInventory(): Promise<DockerInventory> {
  return commands.dockerGetInventory();
}

export function runDockerContainerAction(
  containerId: string,
  action: DockerContainerAction,
  force = false,
): Promise<void> {
  return commands.dockerContainerAction(containerId, action, force).then(() => undefined);
}

export function startDockerContainerLogStream(containerId: string, tail = 300): Promise<string> {
  return commands.dockerStartContainerLogStream(containerId, tail);
}

export function stopDockerContainerLogStream(streamId: string): Promise<void> {
  return commands.dockerStopContainerLogStream(streamId).then(() => undefined);
}

export function getDockerComposeProject(
  workspacePath: string | undefined,
): Promise<DockerComposeProject> {
  return commands.dockerGetComposeProject(workspacePath ?? null);
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
  return commands.dockerComposeAction(
    workspacePath,
    files,
    service ?? null,
    action,
    envFiles ?? null,
  );
}

export function buildDockerImage(request: DockerBuildImageRequest): Promise<string> {
  return commands.dockerBuildImage({
    contextPath: request.contextPath,
    dockerfilePath: request.dockerfilePath ?? null,
    tag: request.tag ?? null,
    buildArgs: request.buildArgs ?? null,
  });
}

export function runDockerImage(request: DockerRunImageRequest): Promise<string> {
  return commands.dockerRunImage({
    image: request.image,
    name: request.name ?? null,
    ports: request.ports ?? null,
    volumes: request.volumes ?? null,
    env: request.env ?? null,
    envFiles: request.envFiles ?? null,
    command: request.command ?? null,
    detach: request.detach ?? null,
  });
}

export function runDockerImageAction(
  imageId: string,
  action: DockerImageAction,
  force = false,
): Promise<string> {
  return commands.dockerImageAction(imageId, action, force);
}

export function pruneDockerResources(
  target: DockerPruneTarget,
  includeVolumes = false,
): Promise<string> {
  return commands.dockerPruneResources(target, includeVolumes);
}

export function listDockerContainerFiles(
  containerId: string,
  path = "/",
): Promise<DockerContainerFileEntry[]> {
  return commands.dockerListContainerFiles(containerId, path);
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
  return commands.dockerCopyFromContainer(containerId, containerPath, hostPath);
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
  return commands.dockerCopyToContainer(containerId, hostPath, containerPath);
}

export function searchDockerRegistry(
  query: string,
  limit = 25,
): Promise<DockerRegistrySearchResult[]> {
  return commands.dockerRegistrySearch(query, limit);
}

export function loginDockerRegistry(request: DockerRegistryLoginRequest): Promise<string> {
  return commands.dockerRegistryLogin({ ...request, registry: request.registry ?? null });
}

export function pullDockerRegistryImage(image: string): Promise<string> {
  return commands.dockerRegistryPull(image);
}

export function pushDockerRegistryImage(image: string): Promise<string> {
  return commands.dockerRegistryPush(image);
}

export function tagDockerImage(source: string, target: string): Promise<string> {
  return commands.dockerTagImage(source, target);
}

export function getDockerProjectConfig(
  workspacePath: string | undefined,
): Promise<DockerProjectConfig> {
  return commands.dockerGetProjectConfig(workspacePath ?? null) as Promise<DockerProjectConfig>;
}

export function saveDockerProjectConfig(
  workspacePath: string,
  config: DockerProjectConfig,
): Promise<DockerProjectConfig> {
  return commands.dockerSaveProjectConfig(
    workspacePath,
    config as BindingDockerProjectConfig,
  ) as Promise<DockerProjectConfig>;
}

export function openDockerEnvFile(
  workspacePath: string,
  path: string,
): Promise<DockerEnvFileContent> {
  return commands
    .dockerOpenEnvFile(workspacePath, path)
    .then((result) => ({ ...result, file: { ...result.file, keys: result.file.keys ?? [] } }));
}

export function deleteDockerEnvFile(workspacePath: string, path: string): Promise<void> {
  return commands.dockerDeleteEnvFile(workspacePath, path).then(() => undefined);
}

export function openDockerDevContainer(
  workspacePath: string,
  configPath: string,
): Promise<DockerDevContainerOpenResult> {
  return commands.dockerOpenDevContainer(workspacePath, configPath);
}
