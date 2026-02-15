import { invoke as tauriInvoke } from "@tauri-apps/api/core";

const repoDiscoveryCache = new Map<string, string | null>();

const NOT_REPO_PATTERNS = [
  "failed to open repository",
  "not a git repository",
  "could not find repository",
  "class=repository",
  "code=notfound",
];

function normalizePath(path: string): string {
  const unixPath = path.replace(/\\/g, "/");
  const collapsed = unixPath.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path.replace(/\\/g, "/"));
}

function joinPath(basePath: string, childPath: string): string {
  if (!basePath) return normalizePath(childPath);
  const base = normalizePath(basePath);
  const child = childPath.replace(/^[/\\]+/, "");
  return normalizePath(`${base}/${child}`);
}

function toRelativePath(from: string, to: string): string {
  const normalizedFrom = normalizePath(from);
  const normalizedTo = normalizePath(to);
  const prefix = `${normalizedFrom}/`;
  if (normalizedTo.startsWith(prefix)) {
    return normalizedTo.slice(prefix.length);
  }
  if (normalizedTo === normalizedFrom) {
    return "";
  }
  return normalizedTo;
}

export function isNotGitRepositoryError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();

  const normalized = message.toLowerCase();
  return NOT_REPO_PATTERNS.some((pattern) => normalized.includes(pattern));
}

async function discoverRepo(path: string): Promise<string | null> {
  const normalizedPath = normalizePath(path);
  if (repoDiscoveryCache.has(normalizedPath)) {
    return repoDiscoveryCache.get(normalizedPath) ?? null;
  }

  try {
    const discovered = await tauriInvoke<string | null>("git_discover_repo", {
      path: normalizedPath,
    });
    const normalizedRepo = discovered ? normalizePath(discovered) : null;
    repoDiscoveryCache.set(normalizedPath, normalizedRepo);
    return normalizedRepo;
  } catch {
    repoDiscoveryCache.set(normalizedPath, null);
    return null;
  }
}

export async function resolveRepositoryPath(repoPath: string): Promise<string | null> {
  return discoverRepo(repoPath);
}

export async function resolveRepositoryForFile(
  repoPath: string,
  filePath: string,
): Promise<{ repoPath: string; filePath: string } | null> {
  const absoluteFilePath = isAbsolutePath(filePath) ? filePath : joinPath(repoPath, filePath);
  const discoveredRepo = await discoverRepo(absoluteFilePath);

  if (!discoveredRepo) {
    return null;
  }

  const normalizedAbsoluteFile = normalizePath(absoluteFilePath);
  let relativePath = normalizePath(toRelativePath(discoveredRepo, normalizedAbsoluteFile));

  if (!relativePath || relativePath === ".") {
    relativePath = normalizePath(filePath);
  }

  return {
    repoPath: discoveredRepo,
    filePath: relativePath,
  };
}

export function clearRepositoryDiscoveryCache(): void {
  repoDiscoveryCache.clear();
}
