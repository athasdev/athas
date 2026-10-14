import type { AcpDiffOutput } from "@/features/ai/lib/acp-diff-output";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function changeKind(value: unknown): string {
  if (typeof value === "string") return value;
  return isRecord(value) && typeof value.type === "string" ? value.type : "update";
}

/** The old and new text of a unified diff's hunks, enough to count and show the change. */
function hunksToTexts(diff: string): { oldText: string; newText: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) newLines.push(line.slice(1));
    else if (line.startsWith("-")) oldLines.push(line.slice(1));
    else {
      const context = line.startsWith(" ") ? line.slice(1) : line;
      oldLines.push(context);
      newLines.push(context);
    }
  }
  return { oldText: oldLines.join("\n"), newText: newLines.join("\n") };
}

/**
 * The files a Codex `fileChange` item changed, as old and new text. Codex sends a unified diff for
 * an update and the whole file for an added or deleted one.
 */
export function getCodexFileChangeDiffs(item: unknown): AcpDiffOutput[] {
  if (!isRecord(item) || item.type !== "fileChange" || !Array.isArray(item.changes)) return [];
  return item.changes.flatMap((change): AcpDiffOutput[] => {
    if (!isRecord(change) || typeof change.path !== "string") return [];
    const diff = typeof change.diff === "string" ? change.diff : "";
    const kind = changeKind(change.kind);
    if (kind === "add" && !diff.includes("\n@@")) {
      return [{ path: change.path, oldText: "", newText: diff }];
    }
    if (kind === "delete" && !diff.includes("\n@@")) {
      return [{ path: change.path, oldText: diff, newText: "" }];
    }
    return [{ path: change.path, ...hunksToTexts(diff) }];
  });
}
