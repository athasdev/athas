import { getRemotes } from "@/features/git/api/git-remotes-api";

export interface GitHubRepository {
  owner: string;
  repo: string;
}

export function parseGitHubRepository(value: unknown): GitHubRepository | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const projectMatch = normalized.match(/^github:\/\/([^/]+)\/([^/]+)\/?$/i);
  const httpsMatch = normalized.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  const match = projectMatch ?? httpsMatch ?? sshMatch;

  if (!match) return null;
  const owner = match[1]?.trim();
  const repo = match[2]?.trim();
  if (!owner || !repo || owner === "." || owner === ".." || repo === "." || repo === "..") {
    return null;
  }

  return { owner, repo };
}

export async function resolveProjectGitHubRepository(
  projectPath: string,
  loadRemotes: typeof getRemotes = getRemotes,
): Promise<GitHubRepository | null> {
  const repositoryRef = parseGitHubRepository(projectPath);
  if (repositoryRef) return repositoryRef;

  const remotes = await loadRemotes(projectPath);
  const orderedRemotes = [
    ...remotes.filter((remote) => remote.name === "origin"),
    ...remotes.filter((remote) => remote.name !== "origin"),
  ];

  for (const remote of orderedRemotes) {
    const repository = parseGitHubRepository(remote.url);
    if (repository) return repository;
  }

  return null;
}

export function buildProjectGitHubApiUrl(
  repository: GitHubRepository,
  endpointPath: string,
): string {
  const normalizedPath = endpointPath.trim();
  if (
    !normalizedPath.startsWith("/") ||
    normalizedPath.startsWith("//") ||
    normalizedPath.includes("..") ||
    /[\r\n]/.test(normalizedPath)
  ) {
    throw new Error("GitHub source returned an invalid endpoint path");
  }

  return `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}${normalizedPath}`;
}
