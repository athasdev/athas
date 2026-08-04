import { invoke } from "@tauri-apps/api/core";
import type { PullRequest, PullRequestDetails, PullRequestFile } from "../types/github.types";
import type { GitHubTokenSyncStatus } from "./github-token-service";

export const PR_LIST_CACHE_TTL_MS = 5 * 60_000;
export const PR_DETAILS_CACHE_TTL_MS = 120_000;
export const AUTH_CACHE_TTL_MS = 2 * 60_000;

export function getPRListCacheKey(repoPath: string, filter: string): string {
  return `${repoPath}::${filter}`;
}

export function getPRDetailsCacheKey(repoPath: string, prNumber: number): string {
  return `${repoPath}::${prNumber}`;
}

export function isFresh(timestamp: number, ttlMs: number): boolean {
  return Date.now() - timestamp < ttlMs;
}

export function getGitHubAccountStatus(syncStatus: GitHubTokenSyncStatus) {
  if (syncStatus === "synced") return "connected" as const;
  if (syncStatus === "notSignedIn") return "notSignedIn" as const;
  return "notConnected" as const;
}

export function getGitHubErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export function normalizePullRequestFiles(files: unknown): PullRequestFile[] {
  if (!Array.isArray(files)) return [];

  return files
    .map((file) => {
      if (!file || typeof file !== "object") return null;
      const record = file as Record<string, unknown>;
      const path = typeof record.path === "string" ? record.path.trim() : "";
      if (!path) return null;

      return {
        path,
        additions: typeof record.additions === "number" ? record.additions : 0,
        deletions: typeof record.deletions === "number" ? record.deletions : 0,
      };
    })
    .filter((file): file is PullRequestFile => !!file);
}

function getStringValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "";
}

export function normalizePullRequest(pr: PullRequest): PullRequest {
  const record = pr as PullRequest & Record<string, unknown>;
  const headRef = getStringValue(record, ["headRef", "headRefName", "head_ref"]);
  const baseRef = getStringValue(record, ["baseRef", "baseRefName", "base_ref"]);

  if (!headRef || !baseRef) {
    console.warn("GitHub PR list item is missing branch refs", {
      number: pr.number,
      title: pr.title,
      headRef,
      baseRef,
      rawKeys: Object.keys(record),
    });
  }

  return {
    ...pr,
    headRef,
    baseRef,
  };
}

export function normalizePullRequestDetails(details: PullRequestDetails): PullRequestDetails {
  const record = details as PullRequestDetails & Record<string, unknown>;
  const statusChecks =
    details.statusChecks ??
    (Array.isArray(record.statusCheckRollup)
      ? (record.statusCheckRollup as PullRequestDetails["statusChecks"])
      : []);
  const linkedIssues =
    details.linkedIssues ??
    (Array.isArray(record.closingIssuesReferences)
      ? (record.closingIssuesReferences as PullRequestDetails["linkedIssues"])
      : []);

  return {
    ...details,
    headRef: getStringValue(record, ["headRef", "headRefName", "head_ref"]),
    baseRef: getStringValue(record, ["baseRef", "baseRefName", "base_ref"]),
    statusChecks,
    linkedIssues,
  };
}

export async function fetchNormalizedPRDetails(
  repoPath: string,
  prNumber: number,
): Promise<PullRequestDetails> {
  const detailsResponse = await invoke<PullRequestDetails>("github_get_pr_details", {
    repoPath,
    prNumber,
  });

  return normalizePullRequestDetails(detailsResponse);
}
