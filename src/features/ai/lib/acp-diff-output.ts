import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { EXTENSION_VIEW_LIMITS } from "@/extensions/ui/services/extension-view-schema";
import type { ExtensionViewNode } from "@/extensions/ui/types/extension-view";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff, GitDiffLine } from "@/features/git/types/git.types";
import { countDiffStats } from "@/features/git/utils/git-diff-helpers";
import { useProjectStore } from "@/features/window/stores/project.store";

export interface AcpDiffOutput {
  path: string;
  oldText: string;
  newText: string;
}

type ExtensionDiffNode = Extract<ExtensionViewNode, { type: "diff" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isAcpDiffOutput(value: unknown): value is Record<string, unknown> & { path: string } {
  return isRecord(value) && value.type === "diff" && typeof value.path === "string";
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^file:\/\//, "");
}

function toRelativeDisplayPath(path: string, rootFolderPath?: string | null): string {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = rootFolderPath ? normalizePath(rootFolderPath) : "";
  const prefix = `${normalizedRoot}/`;
  return normalizedRoot && normalizedPath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : normalizedPath;
}

function getBaseName(path: string): string {
  return path.split("/").pop() || path;
}

function getLanguageHint(path: string): string | undefined {
  const fileName = getBaseName(path);
  const separator = fileName.lastIndexOf(".");
  return separator > 0 && separator < fileName.length - 1
    ? fileName.slice(separator + 1)
    : undefined;
}

export function getAcpDiffOutputs(output: unknown): AcpDiffOutput[] {
  const items = Array.isArray(output) ? output : [output];

  return items.filter(isAcpDiffOutput).map((item) => ({
    path: item.path as string,
    oldText: typeof item.oldText === "string" ? item.oldText : "",
    newText: typeof item.newText === "string" ? item.newText : "",
  }));
}

export function stripAcpDiffOutputs(output: unknown): unknown {
  if (isAcpDiffOutput(output)) return undefined;
  if (!Array.isArray(output)) return output;
  const remaining = output.filter((item) => !isAcpDiffOutput(item));
  return remaining.length > 0 ? remaining : undefined;
}

function createHunkHeader(oldLines: string[], newLines: string[]): GitDiffLine {
  const oldCount = Math.max(oldLines.length, 1);
  const newCount = Math.max(newLines.length, 1);
  return {
    line_type: "header",
    content: `@@ -1,${oldCount} +1,${newCount} @@`,
  };
}

function createDiffLines(oldText: string, newText: string): GitDiffLine[] {
  const oldLines = oldText.length > 0 ? oldText.split("\n") : [];
  const newLines = newText.length > 0 ? newText.split("\n") : [];
  const lines: GitDiffLine[] = [createHunkHeader(oldLines, newLines)];

  for (let index = 0; index < oldLines.length; index += 1) {
    lines.push({
      line_type: "removed",
      content: oldLines[index],
      old_line_number: index + 1,
    });
  }

  for (let index = 0; index < newLines.length; index += 1) {
    lines.push({
      line_type: "added",
      content: newLines[index],
      new_line_number: index + 1,
    });
  }

  return lines;
}

function previewLineBudget(removedCount: number, addedCount: number) {
  const contentBudget = EXTENSION_VIEW_LIMITS.maxDiffLines - 1;
  if (removedCount + addedCount <= contentBudget) {
    return { removed: removedCount, added: addedCount };
  }

  let removed = Math.min(removedCount, Math.floor(contentBudget / 2));
  let added = Math.min(addedCount, contentBudget - removed);
  const unused = contentBudget - removed - added;
  if (unused > 0) {
    const extraRemoved = Math.min(unused, removedCount - removed);
    removed += extraRemoved;
    added += Math.min(unused - extraRemoved, addedCount - added);
  }
  return { removed, added };
}

export function createAcpDiffViewNode(
  diff: AcpDiffOutput,
  rootFolderPath?: string | null,
): ExtensionDiffNode {
  const oldLines = diff.oldText.length > 0 ? diff.oldText.split("\n") : [];
  const newLines = diff.newText.length > 0 ? diff.newText.split("\n") : [];
  const budget = previewLineBudget(oldLines.length, newLines.length);
  const lines: ExtensionDiffNode["lines"] = [
    {
      type: "header",
      content: `-1,${Math.max(oldLines.length, 1)} +1,${Math.max(newLines.length, 1)}`,
    },
    ...oldLines.slice(0, budget.removed).map((content, index) => ({
      type: "removed" as const,
      content,
      oldLine: index + 1,
    })),
    ...newLines.slice(0, budget.added).map((content, index) => ({
      type: "added" as const,
      content,
      newLine: index + 1,
    })),
  ];

  return {
    type: "diff",
    filePath: toRelativeDisplayPath(diff.path, rootFolderPath),
    language: getLanguageHint(diff.path),
    lines,
    truncated: budget.removed < oldLines.length || budget.added < newLines.length,
  };
}

function toGitDiff(diff: AcpDiffOutput, rootFolderPath?: string | null): GitDiff {
  const displayPath = toRelativeDisplayPath(diff.path, rootFolderPath);
  const isNew = diff.oldText.length === 0 && diff.newText.length > 0;
  const isDeleted = diff.oldText.length > 0 && diff.newText.length === 0;

  return {
    file_path: displayPath,
    old_path: isNew ? undefined : displayPath,
    new_path: isDeleted ? undefined : displayPath,
    is_new: isNew,
    is_deleted: isDeleted,
    is_renamed: false,
    lines: createDiffLines(diff.oldText, diff.newText),
  };
}

export function openAcpDiffOutput(output: unknown): string | null {
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  const diffs = getAcpDiffOutputs(output).map((diff) => toGitDiff(diff, rootFolderPath));
  if (diffs.length === 0) return null;

  const { additions, deletions } = countDiffStats(diffs);
  const multiDiff: MultiFileDiff = {
    title: "ACP Tool Changes",
    repoPath: rootFolderPath ?? undefined,
    commitHash: "acp-tool-output",
    files: diffs,
    totalFiles: diffs.length,
    totalAdditions: additions,
    totalDeletions: deletions,
    fileKeys: diffs.map((diff) => diff.file_path),
    initiallyExpandedFileKey: diffs[0]?.file_path,
  };

  const firstFile = getBaseName(diffs[0]?.file_path || "changes");
  const displayName = diffs.length === 1 ? `${firstFile}.diff` : `ACP changes (${diffs.length})`;
  const virtualPath = `diff://acp-tool-output/${Date.now()}`;

  return useBufferStore
    .getState()
    .actions.openBuffer(virtualPath, displayName, "", false, undefined, true, true, multiDiff);
}
