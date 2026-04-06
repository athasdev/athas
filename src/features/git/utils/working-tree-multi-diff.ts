import { getFileDiff } from "../api/git-diff-api";
import type { MultiFileDiff } from "../types/git-diff-types";
import type { GitDiff, GitFile, GitStatus } from "../types/git-types";
import { countDiffStats } from "./git-diff-helpers";

const WORKING_TREE_TITLE = "Uncommitted Changes";

const getWorkingTreeFileKey = (file: Pick<GitFile, "path" | "staged">): string =>
  `${file.staged ? "staged" : "unstaged"}:${file.path}`;

const parseWorkingTreeFileKey = (fileKey: string): { path: string; staged: boolean } | null => {
  const match = fileKey.match(/^(staged|unstaged):(.+)$/);
  if (!match) return null;

  return {
    staged: match[1] === "staged",
    path: match[2],
  };
};

export const getDiffableWorkingTreeFiles = (status: GitStatus | null): GitFile[] => {
  if (!status) return [];

  const seen = new Set<string>();
  const files: GitFile[] = [];

  for (const file of status.files) {
    if (file.status === "untracked") continue;

    const fileKey = getWorkingTreeFileKey(file);
    if (seen.has(fileKey)) continue;

    seen.add(fileKey);
    files.push(file);
  }

  return files;
};

export const reconcileWorkingTreeFiles = (
  statusFiles: GitFile[],
  previousFileKeys: string[] = [],
): GitFile[] => {
  const fileByKey = new Map(statusFiles.map((file) => [getWorkingTreeFileKey(file), file]));
  const filesByPath = new Map<string, GitFile[]>();

  for (const file of statusFiles) {
    const existing = filesByPath.get(file.path);
    if (existing) {
      existing.push(file);
    } else {
      filesByPath.set(file.path, [file]);
    }
  }

  const nextFiles: GitFile[] = [];
  const includedKeys = new Set<string>();

  for (const previousFileKey of previousFileKeys) {
    const exactMatch = fileByKey.get(previousFileKey);
    if (exactMatch) {
      nextFiles.push(exactMatch);
      includedKeys.add(previousFileKey);
      continue;
    }

    const parsed = parseWorkingTreeFileKey(previousFileKey);
    if (!parsed) continue;

    const candidate = (filesByPath.get(parsed.path) ?? []).find(
      (file) => !includedKeys.has(getWorkingTreeFileKey(file)),
    );
    if (!candidate) continue;

    const candidateKey = getWorkingTreeFileKey(candidate);
    nextFiles.push(candidate);
    includedKeys.add(candidateKey);
  }

  for (const file of statusFiles) {
    const fileKey = getWorkingTreeFileKey(file);
    if (includedKeys.has(fileKey)) continue;
    nextFiles.push(file);
    includedKeys.add(fileKey);
  }

  return nextFiles;
};

export const buildWorkingTreeMultiDiff = async ({
  repoPath,
  status,
  previousFileKeys = [],
  loadDiff = getFileDiff,
}: {
  repoPath: string;
  status: GitStatus | null;
  previousFileKeys?: string[];
  loadDiff?: (repoPath: string, filePath: string, staged?: boolean) => Promise<GitDiff | null>;
}): Promise<MultiFileDiff> => {
  const statusFiles = getDiffableWorkingTreeFiles(status);
  const orderedFiles = reconcileWorkingTreeFiles(statusFiles, previousFileKeys);

  const diffResults = await Promise.all(
    orderedFiles.map(async (file) => ({
      fileKey: getWorkingTreeFileKey(file),
      diff: await loadDiff(repoPath, file.path, file.staged),
    })),
  );

  const resolvedDiffs = diffResults.filter(
    (
      entry,
    ): entry is {
      fileKey: string;
      diff: GitDiff;
    } => !!entry.diff && (entry.diff.lines.length > 0 || entry.diff.is_image === true),
  );

  const stats = countDiffStats(resolvedDiffs.map((entry) => entry.diff));

  return {
    title: WORKING_TREE_TITLE,
    commitHash: "working-tree",
    files: resolvedDiffs.map((entry) => entry.diff),
    totalFiles: resolvedDiffs.length,
    totalAdditions: stats.additions,
    totalDeletions: stats.deletions,
    fileKeys: resolvedDiffs.map((entry) => entry.fileKey),
    initiallyExpandedFileKey: resolvedDiffs[0]?.fileKey,
    isLoading: false,
  };
};
