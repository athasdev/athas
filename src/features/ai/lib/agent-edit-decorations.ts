import type { AgentEditLens } from "@/features/ai/lib/agent-edit-lenses";

/** How an editor shows one unreviewed agent hunk inline. */
export interface AgentEditDecoration {
  lens: AgentEditLens;
  /** The agent's lines, 1-based and inclusive; null when the hunk only removed lines. */
  addedLines: { start: number; end: number } | null;
  /** The lines the agent replaced or removed, shown struck out above the hunk. */
  removedLines: string[];
  /** The line the removed lines sit under; 0 puts them above the first line. */
  afterLineNumber: number;
}

export function agentEditDecorations(lenses: readonly AgentEditLens[]): AgentEditDecoration[] {
  return lenses.map((lens) => {
    const { hunk } = lens;
    const added = hunk.currentLines.length;
    return {
      lens,
      addedLines:
        added > 0 ? { start: hunk.currentStart + 1, end: hunk.currentStart + added } : null,
      removedLines: hunk.baseLines,
      afterLineNumber: hunk.currentStart,
    };
  });
}

function lensEnd(lens: AgentEditLens): number {
  return Math.max(lens.lineNumber, lens.hunk.currentStart + lens.hunk.currentLines.length);
}

/**
 * The hunk a "keep" or "reject" at `line` acts on: the one the line is in, else the next one
 * below it, else the last one above it.
 */
export function agentEditLensAtLine(
  lenses: readonly AgentEditLens[],
  line: number,
): AgentEditLens | null {
  const sorted = [...lenses].sort((a, b) => a.lineNumber - b.lineNumber);
  return (
    sorted.find((lens) => line >= lens.lineNumber && line <= lensEnd(lens)) ??
    sorted.find((lens) => lens.lineNumber > line) ??
    sorted[sorted.length - 1] ??
    null
  );
}
