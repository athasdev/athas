export interface GitHubPullRequestLink {
  kind: "pullRequest";
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface GitHubIssueLink {
  kind: "issue";
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface GitHubActionRunLink {
  kind: "actionRun";
  owner: string;
  repo: string;
  runId: number;
  url: string;
}

export type GitHubEntityLink = GitHubPullRequestLink | GitHubIssueLink | GitHubActionRunLink;

export function parseGitHubEntityLink(value: string): GitHubEntityLink | null {
  try {
    const url = new URL(value);
    if (!isGitHubHost(url.hostname)) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 4) return null;

    const [owner, repo, section, id] = segments;

    if (section === "pull" && isNumericId(id)) {
      return {
        kind: "pullRequest",
        owner,
        repo,
        number: Number(id),
        url: url.toString(),
      };
    }

    if (section === "issues" && isNumericId(id)) {
      return {
        kind: "issue",
        owner,
        repo,
        number: Number(id),
        url: url.toString(),
      };
    }

    if (section === "actions" && segments[3] === "runs" && isNumericId(segments[4])) {
      return {
        kind: "actionRun",
        owner,
        repo,
        runId: Number(segments[4]),
        url: url.toString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

function isGitHubHost(hostname: string): boolean {
  return hostname === "github.com" || hostname === "www.github.com";
}

export function parseSelectedFilePathFromPRBufferPath(path: string): string | null {
  try {
    const url = new URL(path);
    return url.searchParams.get("file");
  } catch {
    return null;
  }
}

export function buildPRBufferPath(prNumber: number, selectedFilePath?: string | null): string {
  const base = `pr://${prNumber}`;
  if (!selectedFilePath) return base;
  return `${base}?file=${encodeURIComponent(selectedFilePath)}`;
}

function isNumericId(value: string | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}
