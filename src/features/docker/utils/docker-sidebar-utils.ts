import type { DockerImage } from "../types/docker.types";

export function getDockerErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isDockerConnectionError(message: string) {
  const normalizedMessage = message.toLowerCase();
  return [
    "cannot connect to the docker daemon",
    "docker cli was not found",
    "error during connect",
    "failed to connect",
    "is the docker daemon running",
    "permission denied while trying to connect to the docker api",
    "connection refused",
  ].some((fragment) => normalizedMessage.includes(fragment));
}

export function getDockerUnavailableCopy(error: string) {
  if (error.toLowerCase().includes("docker cli was not found")) {
    return {
      title: "Docker CLI isn't available",
      description: "Install Docker or make sure the Docker CLI is available in Athas.",
    };
  }

  if (isDockerConnectionError(error)) {
    return {
      title: "Docker isn't running",
      description: "Athas can't connect to the active Docker context.",
    };
  }

  return {
    title: "Docker is unavailable",
    description: "Athas couldn't load Docker resources.",
  };
}

export function includesDockerQuery(values: Array<string | null | undefined>, query: string) {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

function quoteShellArg(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function getDockerExecCommand(containerId: string) {
  const shellProbe =
    "if command -v bash >/dev/null 2>&1; then exec bash; " +
    "elif command -v sh >/dev/null 2>&1; then exec sh; " +
    'else echo "No interactive shell found in this container." >&2; exit 127; fi';
  return `docker exec -it ${quoteShellArg(containerId)} sh -lc ${quoteShellArg(shellProbe)}`;
}

export function getDockerDebugCommand(
  containerId: string,
  command: string,
  workdir?: string | null,
) {
  const debugCommand = workdir?.trim()
    ? `cd ${quoteShellArg(workdir.trim())} && ${command}`
    : command;
  return `docker exec -it ${quoteShellArg(containerId)} sh -lc ${quoteShellArg(debugCommand)}`;
}

export function isDockerErrorLogLine(line: string) {
  return /\b(error|exception|fatal|panic|failed|unhealthy|crash)\b/i.test(line);
}

export function getPublishedDockerTcpUrl(ports: string) {
  const match = ports.match(
    /(?:^|[\s,])(?:0\.0\.0\.0|127\.0\.0\.1|localhost|\[::\]|::)?(?::)?(\d+)->\d+\/tcp/,
  );
  if (!match?.[1]) return null;
  return `http://localhost:${match[1]}`;
}

export function splitDockerConfigLines(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getDockerImageReference(image: DockerImage) {
  if (image.repository === "<none>" || image.tag === "<none>") return image.id;
  return `${image.repository}:${image.tag}`;
}

export function getParentContainerPath(path: string) {
  const normalized = path.trim().replace(/\/+$/, "") || "/";
  if (normalized === "/") return "/";
  const parent = normalized.slice(0, normalized.lastIndexOf("/")) || "/";
  return parent.startsWith("/") ? parent : `/${parent}`;
}

export function formatDockerFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function getDockerFileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
