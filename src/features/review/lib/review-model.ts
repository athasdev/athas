import type { GitCommit, GitDiff, GitDiffStat, GitStatus } from "@/features/git/types/git.types";
import type {
  ProjectReviewState,
  ReviewChangeSet,
  ReviewFileSummary,
  ReviewRiskLevel,
} from "../types/review.types";

const HIGH_RISK_PATTERNS = [
  /(^|\/)auth/i,
  /(^|\/)billing/i,
  /(^|\/)payment/i,
  /(^|\/)migration/i,
  /(^|\/)schema/i,
  /^\.github\/workflows\//,
  /(^|\/)release/i,
  /permission/i,
  /secret/i,
];

const CONFIG_PATTERNS = [
  /(^|\/)(package|bun|pnpm|yarn)-?lock/i,
  /(^|\/)Cargo\.(toml|lock)$/,
  /(^|\/)package\.json$/,
  /(^|\/)(vite|vitest|tsconfig|tauri)\./,
  /(^|\/)config\//,
];

export const EMPTY_PROJECT_REVIEW_STATE: ProjectReviewState = {
  reviewedThroughHash: null,
  reviewedCommitHashes: [],
  reviewedWorkingTreeFingerprint: null,
  viewMode: "queue",
  lastReviewedAt: null,
};

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function createWorkingTreeFingerprint(
  status: GitStatus | null,
  stats: GitDiffStat[],
): string | null {
  if (!status?.files.length) return null;

  const statsByKey = new Map(
    stats.map((stat) => [`${stat.staged ? "staged" : "unstaged"}:${stat.file_path}`, stat]),
  );
  const signature = status.files
    .map((file) => {
      const key = `${file.staged ? "staged" : "unstaged"}:${file.path}`;
      const stat = statsByKey.get(key);
      return `${key}:${file.status}:${stat?.additions ?? 0}:${stat?.deletions ?? 0}`;
    })
    .sort()
    .join("\n");

  return stableHash(signature);
}

export function getPendingCommits({
  commits,
  ahead,
  projectState,
}: {
  commits: GitCommit[];
  ahead: number;
  projectState: ProjectReviewState;
}): GitCommit[] {
  const reviewedHashes = new Set(projectState.reviewedCommitHashes);
  const baselineIndex = projectState.reviewedThroughHash
    ? commits.findIndex((commit) => commit.hash === projectState.reviewedThroughHash)
    : -1;
  const candidates =
    baselineIndex >= 0
      ? commits.slice(0, baselineIndex)
      : commits.slice(0, Math.max(0, Math.min(ahead, commits.length)));

  return candidates.filter((commit) => !reviewedHashes.has(commit.hash));
}

function summarizeDiffs(diffs: GitDiff[]): ReviewFileSummary[] {
  return diffs.map((diff) => ({
    path: diff.new_path || diff.old_path || diff.file_path,
    additions: diff.additions ?? diff.lines.filter((line) => line.line_type === "added").length,
    deletions: diff.deletions ?? diff.lines.filter((line) => line.line_type === "removed").length,
  }));
}

function getCategories(paths: string[]): string[] {
  const categories = new Set<string>();
  for (const path of paths) {
    if (/tests?\/|\.(test|spec)\./i.test(path)) categories.add("Tests");
    if (/\.rs$|src-tauri\/|crates\//i.test(path)) categories.add("Backend");
    if (/\.(tsx?|jsx?)$|src\/features\/|src\/ui\//i.test(path)) categories.add("UI");
    if (/\.github\/|Dockerfile|\.ya?ml$|scripts\//i.test(path)) categories.add("Infra");
    if (/\.md$|docs\//i.test(path)) categories.add("Docs");
    if (/migration|schema|\.sql$/i.test(path)) categories.add("Data");
  }
  return [...categories].slice(0, 3);
}

export function classifyReviewRisk(files: ReviewFileSummary[]): {
  level: ReviewRiskLevel;
  reasons: string[];
} {
  const paths = files.map((file) => file.path);
  const lines = files.reduce((total, file) => total + file.additions + file.deletions, 0);
  const reasons: string[] = [];

  if (paths.some((path) => HIGH_RISK_PATTERNS.some((pattern) => pattern.test(path)))) {
    reasons.push("Sensitive path");
  }
  if (paths.some((path) => CONFIG_PATTERNS.some((pattern) => pattern.test(path)))) {
    reasons.push("Dependency or config");
  }
  if (files.length >= 12) reasons.push("Wide change");
  if (lines >= 500) reasons.push("Large diff");

  if (reasons.includes("Sensitive path") || reasons.length >= 2) {
    return { level: "high", reasons };
  }
  if (reasons.length > 0 || files.length >= 6 || lines >= 180) {
    return {
      level: "medium",
      reasons: reasons.length > 0 ? reasons : [files.length >= 6 ? "Several files" : "Large diff"],
    };
  }
  return { level: "low", reasons: ["Focused change"] };
}

export function createCommitChangeSet(
  commit: GitCommit,
  diffs: GitDiff[],
  reviewed: boolean,
): ReviewChangeSet {
  const files = summarizeDiffs(diffs);
  const risk = classifyReviewRisk(files);
  return {
    id: `commit:${commit.hash}`,
    kind: "commit",
    title: commit.message,
    description: commit.description,
    author: commit.author,
    date: commit.date,
    commit,
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    risk: risk.level,
    riskReasons: risk.reasons,
    categories: getCategories(files.map((file) => file.path)),
    reviewed,
  };
}

export function createWorkingTreeChangeSet({
  status,
  stats,
  fingerprint,
  reviewed,
}: {
  status: GitStatus;
  stats: GitDiffStat[];
  fingerprint: string;
  reviewed: boolean;
}): ReviewChangeSet {
  const statsByKey = new Map(
    stats.map((stat) => [`${stat.staged ? "staged" : "unstaged"}:${stat.file_path}`, stat]),
  );
  const files = status.files.map((file) => {
    const stat = statsByKey.get(`${file.staged ? "staged" : "unstaged"}:${file.path}`);
    return {
      path: file.path,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
    };
  });
  const risk = classifyReviewRisk(files);
  return {
    id: `working-tree:${fingerprint}`,
    kind: "working-tree",
    title: "Working tree",
    description: "Live changes from your current agent or editor session",
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    risk: risk.level,
    riskReasons: risk.reasons,
    categories: getCategories(files.map((file) => file.path)),
    reviewed,
  };
}
