import type { GitHubNotification } from "../types/github.types";

function parseRepositoryFullName(value: string): { owner: string; repo: string } | null {
  const match = value.trim().match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!match || match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..") {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

export function buildGitHubRepositoryRef(repositoryFullName: string): string | null {
  const repository = parseRepositoryFullName(repositoryFullName);
  return repository ? `github://${repository.owner}/${repository.repo}` : null;
}

export function getGitHubNotificationFallbackUrl(
  notification: Pick<GitHubNotification, "repositoryFullName" | "subjectType" | "url">,
): string {
  const repositoryUrl = `https://github.com/${notification.repositoryFullName}`;
  if (notification.subjectType === "CheckSuite") return `${repositoryUrl}/actions`;
  if (notification.subjectType === "Release") return `${repositoryUrl}/releases`;
  return notification.url || repositoryUrl;
}
