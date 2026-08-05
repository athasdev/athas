interface GitHubPullRequestLink {
  kind: "pullRequest";
  owner: string;
  repo: string;
  number: number;
  url: string;
}

interface GitHubIssueLink {
  kind: "issue";
  owner: string;
  repo: string;
  number: number;
  url: string;
}

interface GitHubActionRunLink {
  kind: "actionRun";
  owner: string;
  repo: string;
  runId: number;
  url: string;
}

interface GitHubCommitLink {
  kind: "commit";
  owner: string;
  repo: string;
  sha: string;
  url: string;
}

export type GitHubEntityLink =
  | GitHubPullRequestLink
  | GitHubIssueLink
  | GitHubActionRunLink
  | GitHubCommitLink;

export function isGitHubEntityLinkForRepository(
  entityLink: GitHubEntityLink,
  repositoryUrl?: string,
): boolean {
  if (!repositoryUrl) return false;

  const repository = parseGitHubRepositoryUrl(repositoryUrl);
  return (
    repository?.owner.toLowerCase() === entityLink.owner.toLowerCase() &&
    repository.repo.toLowerCase() === entityLink.repo.toLowerCase()
  );
}

export function parseGitHubRepositoryUrl(value: string): { owner: string; repo: string } | null {
  const normalized = value.trim();
  const httpsMatch = normalized.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

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

    if (section === "commit" && isCommitSha(id)) {
      return {
        kind: "commit",
        owner,
        repo,
        sha: id,
        url: url.toString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function parseGitHubCheckSuiteId(value: string): number | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/check-suites\/(\d+)(?:\/|$)/);
    return match ? Number(match[1]) : null;
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

export function isPRFilesViewPath(path: string): boolean {
  try {
    const url = new URL(path);
    return url.searchParams.has("file") || url.searchParams.get("view") === "files";
  } catch {
    return false;
  }
}

export function buildPRBufferPath(
  prNumber: number,
  selectedFilePath?: string | null,
  view: "activity" | "files" = selectedFilePath ? "files" : "activity",
): string {
  const base = `pr://${prNumber}`;
  if (selectedFilePath) return `${base}?file=${encodeURIComponent(selectedFilePath)}`;
  return view === "files" ? `${base}?view=files` : base;
}

function isNumericId(value: string | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isCommitSha(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value);
}
