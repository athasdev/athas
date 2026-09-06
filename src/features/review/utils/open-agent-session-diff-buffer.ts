import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff } from "@/features/git/types/git.types";
import { countDiffStats } from "@/features/git/utils/git-diff-helpers";
import { buildGitDiffLines } from "@/features/git/utils/line-diff";
import type { AgentChangeSession } from "../types/review.types";

function toWorkspaceRelativePath(path: string, workspacePath: string | null): string {
  if (!workspacePath) return path;
  const prefix = workspacePath.endsWith("/") ? workspacePath : `${workspacePath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function getAgentSessionDiffs(session: AgentChangeSession): GitDiff[] {
  return Object.values(session.files)
    .map((file) => {
      const displayPath = toWorkspaceRelativePath(file.path, session.workspacePath);
      const isNew = file.oldText.length === 0 && file.newText.length > 0;
      const isDeleted = file.oldText.length > 0 && file.newText.length === 0;

      return {
        file_path: displayPath,
        old_path: isNew ? undefined : displayPath,
        new_path: isDeleted ? undefined : displayPath,
        is_new: isNew,
        is_deleted: isDeleted,
        is_renamed: false,
        lines: buildGitDiffLines(file.oldText, file.newText),
      } satisfies GitDiff;
    })
    .filter((diff) => diff.lines.length > 0)
    .sort((left, right) => left.file_path.localeCompare(right.file_path));
}

/**
 * Open everything an agent session changed as one reviewable diff, wired to
 * the same hunk-by-hunk flow the working tree and commits already use.
 */
export function openAgentSessionDiffBuffer({
  session,
  repoPath,
}: {
  session: AgentChangeSession;
  repoPath?: string | null;
}): string | null {
  const diffs = getAgentSessionDiffs(session);
  if (diffs.length === 0) return null;

  const { additions, deletions } = countDiffStats(diffs);
  const multiDiff: MultiFileDiff = {
    title: session.title,
    repoPath: repoPath ?? session.workspacePath ?? undefined,
    commitHash: `agent-session:${session.sessionId}`,
    files: diffs,
    totalFiles: diffs.length,
    totalAdditions: additions,
    totalDeletions: deletions,
    fileKeys: diffs.map((diff) => diff.file_path),
    initiallyExpandedFileKey: diffs[0]?.file_path,
    reviewSession: {
      id: `agent-session:${session.sessionId}`,
      sourceKind: "agent-session",
    },
  };

  return useBufferStore
    .getState()
    .actions.openBuffer(
      `diff://agent-session/${session.sessionId}`,
      `${session.title} (${diffs.length})`,
      "",
      false,
      undefined,
      true,
      true,
      multiDiff,
    );
}
