import { describe, expect, it } from "vite-plus/test";
import {
  agentEditDecorations,
  agentEditLensAtLine,
} from "@/features/ai/services/agent-edit-decorations";
import { agentEditLenses } from "@/features/ai/services/agent-edit-lenses";

const baseline = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
// Line 2 replaced, line 4 removed, a line added after the last one.
const current = ["a", "B", "c", "e", "f", "g", "h"].join("\n");
const byChat = {
  chat: { "/f": { path: "/f", baseline, current, created: false, revision: 1 } },
};

describe("agent edit decorations", () => {
  const lenses = agentEditLenses(byChat, "/f", current);

  it("marks added lines and shows replaced lines above them", () => {
    const shown = agentEditDecorations(lenses).map((item) => ({
      addedLines: item.addedLines,
      removedLines: item.removedLines,
      afterLineNumber: item.afterLineNumber,
    }));
    expect(shown).toEqual([
      { addedLines: { start: 2, end: 2 }, removedLines: ["b"], afterLineNumber: 1 },
      { addedLines: null, removedLines: ["d"], afterLineNumber: 3 },
      { addedLines: { start: 7, end: 7 }, removedLines: [], afterLineNumber: 6 },
    ]);
  });

  it("acts on the hunk at the cursor, else the next one, else the last", () => {
    expect(agentEditLensAtLine(lenses, 2)?.lineNumber).toBe(2);
    expect(agentEditLensAtLine(lenses, 3)?.lineNumber).toBe(4);
    expect(agentEditLensAtLine(lenses, 5)?.lineNumber).toBe(7);
    expect(agentEditLensAtLine(lenses.slice(0, 1), 6)?.lineNumber).toBe(2);
    expect(agentEditLensAtLine([], 1)).toBeNull();
  });
});
