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
  health?: string | null;
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

export type DockerContainerAction = "start" | "stop" | "restart" | "pause" | "unpause" | "remove";
