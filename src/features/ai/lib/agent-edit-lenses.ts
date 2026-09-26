import { computeAgentHunks } from "@/features/ai/lib/agent-edit-hunks";
import type { AgentEditEntry, AgentEditHunk } from "@/features/ai/types/agent-edits.types";

/** Where the editor offers Keep and Reject for one unreviewed agent hunk. */
export interface AgentEditLens {
  chatId: string;
  path: string;
  hunk: AgentEditHunk;
  /** 1-based line the actions sit above: the hunk's first line, or where its lines were. */
  lineNumber: number;
}

/**
 * The Keep and Reject spots for `path` in an editor showing `text`. Hunks line up with the
 * editor only while it shows what the agent's log last saw, so an editor whose text differs
 * (unsaved edits, or a change the log has not caught up with) gets none rather than actions
 * on the wrong lines.
 */
export function agentEditLenses(
  byChat: Readonly<Record<string, Readonly<Record<string, AgentEditEntry>>>>,
  path: string,
  text: string,
): AgentEditLens[] {
  const lineCount = text.split("\n").length;
  const lenses: AgentEditLens[] = [];
  for (const [chatId, entries] of Object.entries(byChat)) {
    const entry = entries[path];
    if (!entry || entry.current !== text) continue;
    for (const hunk of computeAgentHunks(entry.baseline, entry.current)) {
      lenses.push({
        chatId,
        path,
        hunk,
        lineNumber: Math.min(hunk.currentStart + 1, lineCount),
      });
    }
  }
  return lenses;
}
