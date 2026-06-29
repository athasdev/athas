export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  command: string;
  status: string;
  state: string;
  ports: string;
  networks: string;
  createdAt: string;
  size: string;
  health?: string | null;
  healthDetails?: DockerContainerHealthDetails | null;
  stats?: DockerContainerStats | null;
}

export interface DockerContainerHealthDetails {
  status: string;
  failingStreak: number;
  lastOutput?: string | null;
  lastExitCode?: number | null;
  lastStartedAt?: string | null;
  lastFinishedAt?: string | null;
}

export interface DockerContainerStats {
  cpuPercent: string;
  memoryUsage: string;
  memoryPercent: string;
  networkIo: string;
  blockIo: string;
  pids: string;
}

export interface DockerContainerFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified?: number | null;
  mode?: string | null;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  digest: string;
  size: string;
  createdSince: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
  scope: string;
  mountpoint: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: string;
  ipv6: string;
}

export interface DockerInventory {
  containers: DockerContainer[];
  images: DockerImage[];
  volumes: DockerVolume[];
  networks: DockerNetwork[];
}

export interface DockerComposeService {
  name: string;
  state: string;
  status: string;
  health?: string | null;
  containerId?: string | null;
  containerName?: string | null;
  ports: string;
}

export interface DockerComposeProject {
  workspacePath?: string | null;
  files: string[];
  services: DockerComposeService[];
}

export interface DockerLogEvent {
  streamId: string;
  containerId: string;
  stream: "stdout" | "stderr";
  line: string;
}

export interface DockerLogExitEvent {
  streamId: string;
  containerId: string;
  code?: number | null;
  error?: string | null;
}

export interface DockerBuildImageRequest {
  contextPath: string;
  dockerfilePath?: string;
  tag?: string;
  buildArgs?: string[];
}

export interface DockerRunImageRequest {
  image: string;
  name?: string;
  ports?: string[];
  volumes?: string[];
  env?: string[];
  envFiles?: string[];
  command?: string;
  detach?: boolean;
}

export interface DockerRegistryLoginRequest {
  registry?: string;
  username: string;
  password: string;
}

export interface DockerRegistrySearchResult {
  name: string;
  description: string;
  starCount: string;
  official: string;
  automated: string;
}

export interface DockerEnvFile {
  path: string;
  relativePath: string;
  variableCount: number;
  keys: string[];
}

export interface DockerEnvFileContent {
  file: DockerEnvFile;
  content: string;
}

export interface DockerDevContainer {
  name: string;
  configPath: string;
  relativePath: string;
  kind: "image" | "dockerfile" | "compose" | "unsupported";
  image?: string | null;
  dockerFile?: string | null;
  context?: string | null;
  dockerComposeFiles: string[];
  service?: string | null;
  workspaceFolder?: string | null;
  remoteUser?: string | null;
  runArgs: string[];
  containerEnv: string[];
  remoteEnv: string[];
  workspaceMount?: string | null;
  mounts: string[];
  forwardPorts: string[];
  onCreateCommand?: string | null;
  postCreateCommand?: string | null;
  postStartCommand?: string | null;
  postAttachCommand?: string | null;
  features: string[];
}

export interface DockerDevContainerOpenResult {
  containerId: string;
  command: string;
  name: string;
  output: string;
}

export interface DockerBuildPreset {
  name: string;
  contextPath: string;
  dockerfilePath?: string | null;
  tag?: string | null;
  buildArgs: string[];
}

export interface DockerRunPreset {
  name: string;
  image: string;
  containerName?: string | null;
  ports: string[];
  volumes: string[];
  env: string[];
  envFiles: string[];
  command?: string | null;
}

export interface DockerComposePreset {
  name: string;
  files: string[];
  service?: string | null;
  action: DockerComposeAction;
  envFiles: string[];
}

export interface DockerDebugPreset {
  name: string;
  command: string;
  workdir?: string | null;
  target: "container" | "devcontainer" | string;
  source?: string | null;
}

export interface DockerProjectConfig {
  workspacePath?: string | null;
  buildPresets: DockerBuildPreset[];
  runPresets: DockerRunPreset[];
  composePresets: DockerComposePreset[];
  debugPresets: DockerDebugPreset[];
  workspaceDebugPresets: DockerDebugPreset[];
  envFiles: DockerEnvFile[];
  devContainers: DockerDevContainer[];
}

export type DockerContainerAction = "start" | "stop" | "restart" | "pause" | "unpause" | "remove";

export type DockerComposeAction = "up" | "stop" | "restart" | "down" | "build" | "rebuild";

export type DockerImageAction = "remove";

export type DockerPruneTarget = "containers" | "images" | "volumes" | "networks" | "system";
