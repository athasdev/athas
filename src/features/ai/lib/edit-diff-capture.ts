import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { getCommitFileContent } from "@/features/git/api/git-diff-api";
import { useProjectStore } from "@/features/window/stores/project.store";
import { joinPath } from "@/utils/path-helpers";
import { getAcpDiffOutputs, toRelativeDisplayPath } from "./acp-diff-output";
import { inferToolKind, resolveToolCallPath } from "./tool-call-summary";

/**
 * Agents that edit files through their own tools rarely report what changed,
 * so the transcript would only say "Edited foo.ts". This remembers the file
 * as it was when such a call starts and diffs it against the result when the
 * call finishes; a call that arrives already finished is compared to HEAD.
 */
const snapshots = new Map<string, { path: string; before: string | null }>();

const EDIT_KINDS = new Set(["edit", "delete", "move"]);

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("remote://");
}

function resolveAbsolutePath(path: string): string {
  if (isAbsolutePath(path)) return path;
  const root = useProjectStore.getState().rootFolderPath;
  return root ? joinPath(root, path) : path;
}

function isEditCall(toolCall: ToolCall): boolean {
  const kind =
    toolCall.kind && toolCall.kind !== "other" ? toolCall.kind : inferToolKind(toolCall.name);
  return EDIT_KINDS.has(kind);
}

function editTarget(toolCall: ToolCall): string | null {
  if (!toolCall.id || !isEditCall(toolCall)) return null;
  const path = resolveToolCallPath(toolCall);
  return path ? resolveAbsolutePath(path) : null;
}

export async function snapshotToolEdit(toolCall: ToolCall): Promise<void> {
  const path = editTarget(toolCall);
  if (!path || !toolCall.id || snapshots.has(toolCall.id)) return;
  const before = await readFileContent(path).catch(() => null);
  if (!snapshots.has(toolCall.id)) snapshots.set(toolCall.id, { path, before });
}

export function discardToolEditSnapshot(toolId: string | undefined): void {
  if (toolId) snapshots.delete(toolId);
}

/** Returns the call's output with a diff appended, or null when there is nothing to add. */
export async function resolveToolEditDiff(toolCall: ToolCall): Promise<unknown[] | null> {
  const snapshot = toolCall.id ? snapshots.get(toolCall.id) : undefined;
  discardToolEditSnapshot(toolCall.id);
  if (getAcpDiffOutputs(toolCall.output).length > 0) return null;

  const path = snapshot?.path ?? editTarget(toolCall);
  if (!path) return null;

  const after = (await readFileContent(path).catch(() => null)) ?? "";
  let before = snapshot?.before ?? "";
  if (!snapshot || before === after) {
    // Either the call was reported after the fact or the file was read too
    // late; the committed version is the best remaining reference.
    const root = useProjectStore.getState().rootFolderPath;
    if (!root) return null;
    const head = await getCommitFileContent(root, "HEAD", toRelativeDisplayPath(path, root)).catch(
      () => null,
    );
    if (head === null) return null;
    before = head;
  }
  if (before === after) return null;

  const existing =
    toolCall.output === undefined || toolCall.output === null
      ? []
      : Array.isArray(toolCall.output)
        ? toolCall.output
        : [toolCall.output];
  return [...existing, { type: "diff", path, oldText: before, newText: after }];
}
