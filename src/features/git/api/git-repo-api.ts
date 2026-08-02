import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { readDirectory } from "@/features/file-system/controllers/platform";

interface RepositoryDiscoveryCacheEntry {
  discoveredAt: number;
  repoPath: string | null;
}

const repoDiscoveryCache = new Map<string, RepositoryDiscoveryCacheEntry>();
const workspaceRepoDiscoveryCache = new Map<string, { discoveredAt: number; repos: string[] }>();
const inFlightRepoDiscoveries = new Map<string, Promise<string | null>>();
const inFlightWorkspaceDiscoveries = new Map<string, Promise<string[]>>();
let discoveryGeneration = 0;

const NOT_REPO_PATTERNS = [
  "failed to open repository",
  "not a git repository",
  "could not find repository",
  "class=repository",
  "code=notfound",
];

const WORKSPACE_REPO_CACHE_TTL_MS = 5 * 60_000;
const REPO_CACHE_TTL_MS = 5 * 60_000;
const NEGATIVE_REPO_CACHE_TTL_MS = 5_000;
const MAX_REPO_SCAN_DIRECTORIES = 10_000;
const MAX_REPO_SCAN_DEPTH = 8;
const REPO_SCAN_SKIP_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  ".bzr",
  "node_modules",
  ".next",
  ".nuxt",
  ".turbo",
  ".yarn",
  ".pnpm",
  ".cache",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

function normalizePath(path: string): string {
  if (path.startsWith("wsl://") || path.startsWith("remote://")) {
    const [scheme, rest] = path.split("://");
    const collapsedRest = (rest ?? "").replace(/\/{2,}/g, "/");
    const normalized = `${scheme}://${collapsedRest}`;
    return normalized.length > `${scheme}://`.length + 1
      ? normalized.replace(/\/+$/, "")
      : normalized;
  }

  const unixPath = path.replace(/\\/g, "/");
  const collapsed = unixPath.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("wsl://") ||
    path.startsWith("remote://") ||
    /^[A-Za-z]:\//.test(path.replace(/\\/g, "/"))
  );
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

function sortWorkspaceRepositories(repoPaths: string[], workspaceRoot: string): string[] {
  const normalizedRoot = normalizePath(workspaceRoot);

  return [...new Set(repoPaths.map((path) => normalizePath(path)))].sort((a, b) => {
    const aIsRoot = a === normalizedRoot;
    const bIsRoot = b === normalizedRoot;
    if (aIsRoot && !bIsRoot) return -1;
    if (!aIsRoot && bIsRoot) return 1;

    const aIsInsideWorkspace = a.startsWith(`${normalizedRoot}/`);
    const bIsInsideWorkspace = b.startsWith(`${normalizedRoot}/`);
    if (aIsInsideWorkspace && !bIsInsideWorkspace) return -1;
    if (!aIsInsideWorkspace && bIsInsideWorkspace) return 1;

    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    if (depthA !== depthB) return depthA - depthB;

    return a.localeCompare(b);
  });
}

export function normalizeRepositoryPath(path: string): string {
  return normalizePath(path);
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
  const cached = repoDiscoveryCache.get(normalizedPath);
  if (cached) {
    const ttl = cached.repoPath ? REPO_CACHE_TTL_MS : NEGATIVE_REPO_CACHE_TTL_MS;
    if (Date.now() - cached.discoveredAt < ttl) {
      return cached.repoPath;
    }
    repoDiscoveryCache.delete(normalizedPath);
  }

  const existingRequest = inFlightRepoDiscoveries.get(normalizedPath);
  if (existingRequest) return existingRequest;

  const generation = discoveryGeneration;
  const request = tauriInvoke<string | null>("git_discover_repo", {
    path: normalizedPath,
  })
    .then((discovered) => {
      const repoPath = discovered ? normalizePath(discovered) : null;
      if (generation === discoveryGeneration) {
        repoDiscoveryCache.set(normalizedPath, {
          discoveredAt: Date.now(),
          repoPath,
        });
      }
      return repoPath;
    })
    .catch((error) => {
      if (isNotGitRepositoryError(error)) {
        if (generation === discoveryGeneration) {
          repoDiscoveryCache.set(normalizedPath, {
            discoveredAt: Date.now(),
            repoPath: null,
          });
        }
        return null;
      }
      throw error;
    })
    .finally(() => {
      if (inFlightRepoDiscoveries.get(normalizedPath) === request) {
        inFlightRepoDiscoveries.delete(normalizedPath);
      }
    });

  inFlightRepoDiscoveries.set(normalizedPath, request);
  return request;
}

export async function resolveRepositoryPath(repoPath: string): Promise<string | null> {
  return discoverRepo(repoPath);
}

export async function resolveRepositoryPathOrThrow(repoPath: string): Promise<string> {
  const resolvedRepoPath = await resolveRepositoryPath(repoPath);
  if (!resolvedRepoPath) {
    throw new Error("Not a Git repository");
  }
  return resolvedRepoPath;
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

export async function discoverWorkspaceRepositories(
  workspacePath: string,
  options?: { force?: boolean },
): Promise<string[]> {
  const normalizedWorkspacePath = normalizePath(workspacePath);
  if (!normalizedWorkspacePath) return [];

  const force = options?.force ?? false;
  if (!force) {
    const cached = workspaceRepoDiscoveryCache.get(normalizedWorkspacePath);
    if (cached && Date.now() - cached.discoveredAt < WORKSPACE_REPO_CACHE_TTL_MS) {
      return cached.repos;
    }

    const existingRequest = inFlightWorkspaceDiscoveries.get(normalizedWorkspacePath);
    if (existingRequest) {
      return existingRequest;
    }
  }

  const generation = discoveryGeneration;
  const request = scanWorkspaceRepositories(normalizedWorkspacePath, generation).finally(() => {
    if (inFlightWorkspaceDiscoveries.get(normalizedWorkspacePath) === request) {
      inFlightWorkspaceDiscoveries.delete(normalizedWorkspacePath);
    }
  });
  inFlightWorkspaceDiscoveries.set(normalizedWorkspacePath, request);
  return request;
}

async function scanWorkspaceRepositories(
  normalizedWorkspacePath: string,
  generation: number,
): Promise<string[]> {
  const discoveredRepos = new Set<string>();
  const visitedDirectories = new Set<string>();
  const queue: string[] = [normalizedWorkspacePath];
  let queueCursor = 0;
  const containingRepoPath = await discoverRepo(normalizedWorkspacePath);

  if (containingRepoPath) {
    discoveredRepos.add(containingRepoPath);
  }

  while (queueCursor < queue.length) {
    if (visitedDirectories.size >= MAX_REPO_SCAN_DIRECTORIES) {
      break;
    }

    const batchEnd = Math.min(queueCursor + 8, queue.length);
    const batch = queue.slice(queueCursor, batchEnd);
    queueCursor = batchEnd;
    const directoryResults = await Promise.all(
      batch.map(async (currentPath) => {
        const directoryPath = normalizePath(currentPath);
        if (visitedDirectories.has(directoryPath)) {
          return null;
        }
        visitedDirectories.add(directoryPath);

        try {
          return { directoryPath, entries: await readDirectory(directoryPath) };
        } catch {
          return null;
        }
      }),
    );

    for (const result of directoryResults) {
      if (!result) {
        continue;
      }

      const hasGitMetadata = result.entries.some((entry) => entry?.name === ".git");
      if (hasGitMetadata) {
        discoveredRepos.add(result.directoryPath);
      }

      for (const entry of result.entries) {
        const isDirectory = entry?.isDirectory ?? entry?.is_dir;
        if (!isDirectory || !entry.name) {
          continue;
        }

        const directoryName = entry.name.toLowerCase();
        if (REPO_SCAN_SKIP_DIRS.has(directoryName)) {
          continue;
        }

        const childPath = normalizePath(`${result.directoryPath}/${entry.name}`);
        const relativeChildPath = toRelativePath(normalizedWorkspacePath, childPath);
        const childDepth = relativeChildPath.split("/").filter(Boolean).length;
        if (childDepth > MAX_REPO_SCAN_DEPTH) {
          continue;
        }

        if (!visitedDirectories.has(childPath)) {
          queue.push(childPath);
        }
      }
    }
  }

  let repositories = sortWorkspaceRepositories(
    Array.from(discoveredRepos),
    normalizedWorkspacePath,
  );

  if (containingRepoPath) {
    repositories = [
      containingRepoPath,
      ...repositories.filter((repoPath) => repoPath !== containingRepoPath),
    ];
  }

  if (generation === discoveryGeneration) {
    workspaceRepoDiscoveryCache.set(normalizedWorkspacePath, {
      discoveredAt: Date.now(),
      repos: repositories,
    });
  }

  return repositories;
}

export function clearRepositoryDiscoveryCache(): void {
  discoveryGeneration += 1;
  repoDiscoveryCache.clear();
  workspaceRepoDiscoveryCache.clear();
  inFlightRepoDiscoveries.clear();
  inFlightWorkspaceDiscoveries.clear();
}
