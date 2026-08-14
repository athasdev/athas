import { getGitLog } from "../../api/git-commits-api";
import { getFileDiff } from "../../api/git-diff-api";
import type { GitDiff, GitFile } from "../../types/git.types";

const MAX_STAGED_FILES_FOR_AI_CONTEXT = 120;
const MAX_RECENT_COMMITS_FOR_AI_CONTEXT = 24;
const MAX_DIFF_FILES_FOR_AI_CONTEXT = 10;
const MAX_DIFF_LINES_PER_FILE_FOR_AI_CONTEXT = 80;
const MAX_COMMIT_AI_CONTEXT_CHARS = 11_000;

export type CommitMessageMode = "title" | "body";

const getRepoLabel = (repoPath: string): string => {
  const normalized = repoPath.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || "repository";
};

const countDiffLines = (diff: GitDiff | null) => {
  if (!diff) return { additions: 0, deletions: 0 };

  return diff.lines.reduce(
    (totals, line) => {
      if (line.line_type === "added") totals.additions += 1;
      if (line.line_type === "removed") totals.deletions += 1;
      return totals;
    },
    { additions: 0, deletions: 0 },
  );
};

const formatDiffExcerpt = (file: GitFile, diff: GitDiff | null): string => {
  if (!diff) return `### ${file.path}\n(no staged text diff available)`;
  if (diff.is_binary || diff.is_image) return `### ${file.path}\n(binary or image change)`;

  const changedLines: string[] = [];
  let changedLineCount = 0;

  for (const line of diff.lines) {
    if (line.line_type !== "added" && line.line_type !== "removed") continue;

    changedLineCount++;
    if (changedLines.length < MAX_DIFF_LINES_PER_FILE_FOR_AI_CONTEXT) {
      changedLines.push(`${line.line_type === "added" ? "+" : "-"}${line.content}`);
    }
  }

  const omittedCount = Math.max(changedLineCount - MAX_DIFF_LINES_PER_FILE_FOR_AI_CONTEXT, 0);

  return [
    `### ${file.path}`,
    changedLines.join("\n") || "(metadata-only change)",
    omittedCount > 0 ? `... ${omittedCount} more changed lines omitted` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const truncateContext = (context: string): string => {
  if (context.length <= MAX_COMMIT_AI_CONTEXT_CHARS) return context;
  return `${context.slice(0, MAX_COMMIT_AI_CONTEXT_CHARS)}\n\n[context truncated]`;
};

export async function buildCommitMessageContext({
  repoPath,
  currentBranch,
  stagedFiles,
  existingDraftHint,
}: {
  repoPath: string;
  currentBranch?: string;
  stagedFiles: GitFile[];
  existingDraftHint: string;
}): Promise<string> {
  const stagedFilesForContext = stagedFiles.slice(0, MAX_STAGED_FILES_FOR_AI_CONTEXT);
  const diffFilesForContext = stagedFiles.slice(0, MAX_DIFF_FILES_FOR_AI_CONTEXT);
  const [recentCommits, stagedDiffs] = await Promise.all([
    getGitLog(repoPath, MAX_RECENT_COMMITS_FOR_AI_CONTEXT, 0),
    Promise.all(diffFilesForContext.map((file) => getFileDiff(repoPath, file.path, true))),
  ]);
  const overflowCount = Math.max(stagedFiles.length - stagedFilesForContext.length, 0);
  const diffOverflowCount = Math.max(stagedFiles.length - diffFilesForContext.length, 0);
  const totals = stagedDiffs.reduce(
    (sum, diff) => {
      const counts = countDiffLines(diff);
      return {
        additions: sum.additions + counts.additions,
        deletions: sum.deletions + counts.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );

  const recentCommitLines = recentCommits
    .map((commit) => commit.message.trim())
    .filter(Boolean)
    .slice(0, MAX_RECENT_COMMITS_FOR_AI_CONTEXT)
    .map((message) => `- ${message}`)
    .join("\n");
  const stagedLines = stagedFilesForContext
    .map((file) => `- ${file.status}${file.staged ? " staged" : ""}: ${file.path}`)
    .join("\n");
  const diffExcerpt = diffFilesForContext
    .map((file, index) => formatDiffExcerpt(file, stagedDiffs[index]))
    .join("\n\n");

  return truncateContext(
    [
      `Repository: ${getRepoLabel(repoPath)}`,
      `Branch: ${currentBranch || "unknown"}`,
      "",
      "Recent commit subjects for style:",
      recentCommitLines || "- none",
      "",
      `Staged files (${stagedFiles.length}):`,
      stagedLines || "- none",
      overflowCount > 0 ? `- ...and ${overflowCount} more staged files` : "",
      "",
      `Staged diff summary for sampled files: +${totals.additions} -${totals.deletions}`,
      diffOverflowCount > 0
        ? `Diff excerpts include ${diffFilesForContext.length} of ${stagedFiles.length} staged files.`
        : "",
      diffExcerpt ? `\nStaged patch excerpts:\n${diffExcerpt}` : "",
      existingDraftHint ? `\nCurrent draft:\n${existingDraftHint}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function normalizeGeneratedCommitMessage(message: string, mode: CommitMessageMode): string {
  const trimmed = message
    .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  if (mode === "body") return trimmed;

  return (
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}
