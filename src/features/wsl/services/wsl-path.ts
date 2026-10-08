export interface WslPathInfo {
  distro: string;
  linuxPath: string;
}

const WSL_PREFIX = "wsl://";

export function isWslPath(path: string | undefined | null): path is string {
  return typeof path === "string" && path.startsWith(WSL_PREFIX);
}

export function normalizeWslLinuxPath(path: string | undefined | null): string {
  const trimmed = (path ?? "").trim();
  if (!trimmed || trimmed === "~") return "/";

  let normalized = trimmed.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  while (normalized.includes("//")) {
    normalized = normalized.replace(/\/{2,}/g, "/");
  }

  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

export function parseWslPath(path: string): WslPathInfo | null {
  if (!isWslPath(path)) return null;

  const rest = path.slice(WSL_PREFIX.length);
  const separatorIndex = rest.indexOf("/");
  const distro = (separatorIndex === -1 ? rest : rest.slice(0, separatorIndex)).trim();

  if (!distro) return null;

  return {
    distro,
    linuxPath: normalizeWslLinuxPath(separatorIndex === -1 ? "/" : rest.slice(separatorIndex)),
  };
}

export function buildWslPath(distro: string, linuxPath = "/"): string {
  return `${WSL_PREFIX}${distro.trim()}${normalizeWslLinuxPath(linuxPath)}`;
}

export function getWslShellId(distro: string): string {
  return `wsl:${distro}`;
}

export function joinWslPath(path: string, segment: string): string {
  const info = parseWslPath(path);
  if (!info) return path;

  const cleanSegment = segment.replace(/^\/+|\/+$/g, "");
  if (!cleanSegment) return buildWslPath(info.distro, info.linuxPath);

  return buildWslPath(
    info.distro,
    info.linuxPath === "/" ? `/${cleanSegment}` : `${info.linuxPath}/${cleanSegment}`,
  );
}

export function resolveWslTargetPath(sourcePath: string, targetPath: string): string | null {
  const info = parseWslPath(sourcePath);
  if (!info) return null;

  const target = targetPath.trim();
  if (!target) return buildWslPath(info.distro, info.linuxPath);
  if (target.startsWith("/")) return buildWslPath(info.distro, target);

  const parentPath = info.linuxPath.slice(0, info.linuxPath.lastIndexOf("/")) || "/";
  return buildWslPath(info.distro, `${parentPath}/${target}`);
}

export function getWslDisplayPath(path: string): string {
  const info = parseWslPath(path);
  return info ? `${info.distro}:${info.linuxPath}` : path;
}
