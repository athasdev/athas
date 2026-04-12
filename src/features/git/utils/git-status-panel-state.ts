import type { GitFile } from "../types/git-types";

interface GitFileDiffStats {
  additions: number;
  deletions: number;
}

export const getGitFileRowKey = (file: Pick<GitFile, "path" | "staged">): string =>
  `${file.staged ? "staged" : "unstaged"}:${file.path}`;

const getPathEntryCounts = (files: GitFile[]) => {
  const counts = new Map<string, number>();

  for (const file of files) {
    counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
  }

  return counts;
};

export const applyOptimisticStageMap = (
  files: GitFile[],
  optimisticStageMap: Record<string, boolean>,
): GitFile[] => {
  const pathEntryCounts = getPathEntryCounts(files);

  return files.map((file) => {
    const rowKey = getGitFileRowKey(file);
    const optimisticStage = optimisticStageMap[rowKey];

    if (optimisticStage === undefined) {
      return file;
    }

    // When a file appears in both staged and unstaged groups, keep the server
    // state until refresh so we do not collapse both rows into the same state.
    if ((pathEntryCounts.get(file.path) ?? 0) > 1) {
      return file;
    }

    return {
      ...file,
      staged: optimisticStage,
    };
  });
};

export const getGitFileDiffStats = (
  file: Pick<GitFile, "path" | "staged">,
  fileDiffStats?: Record<string, GitFileDiffStats>,
): GitFileDiffStats | undefined => {
  if (!fileDiffStats) return undefined;

  const exactKey = getGitFileRowKey(file);
  if (fileDiffStats[exactKey]) {
    return fileDiffStats[exactKey];
  }

  const fallbackKey = `${file.staged ? "unstaged" : "staged"}:${file.path}`;
  return fileDiffStats[fallbackKey];
};
