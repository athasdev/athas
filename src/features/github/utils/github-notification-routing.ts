import type { GitHubActionNotificationTarget, GitHubNotification } from "../types/github.types";
import {
  isGitHubEntityLinkForRepository,
  parseGitHubCheckSuiteId,
  parseGitHubEntityLink,
} from "./github-link-utils";

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

export type GitHubNotificationTarget =
  | { type: "pullRequest"; number: number; repoPath: string }
  | { type: "issue"; number: number; repoPath: string }
  | { type: "action"; runId: number; repoPath: string }
  | { type: "actionNotification"; notification: GitHubActionNotificationTarget; repoPath: string }
  | { type: "external"; url: string };

export function getGitHubNotificationTarget(
  notification: GitHubNotification,
): GitHubNotificationTarget {
  const repoPath = buildGitHubRepositoryRef(notification.repositoryFullName);
  const repositoryUrl = `https://github.com/${notification.repositoryFullName}`;
  const link = parseGitHubEntityLink(notification.url);
  const canOpenEntity = repoPath && link && isGitHubEntityLinkForRepository(link, repositoryUrl);

  if (canOpenEntity && link.kind === "pullRequest") {
    return { type: "pullRequest", number: link.number, repoPath };
  }
  if (canOpenEntity && link.kind === "issue") {
    return { type: "issue", number: link.number, repoPath };
  }
  if (canOpenEntity && link.kind === "actionRun") {
    return { type: "action", runId: link.runId, repoPath };
  }
  if (repoPath && notification.subjectType === "CheckSuite") {
    return {
      type: "actionNotification",
      repoPath,
      notification: {
        id: notification.id,
        repositoryFullName: notification.repositoryFullName,
        checkSuiteId: parseGitHubCheckSuiteId(notification.subjectUrl),
        title: notification.title,
        updatedAt: notification.updatedAt,
      },
    };
  }

  return { type: "external", url: getGitHubNotificationFallbackUrl(notification) };
}
