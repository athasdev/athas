import { describe, expect, it } from "vite-plus/test";
import { agentEditLenses } from "@/features/ai/lib/agent-edit-lenses";
import type { AgentEditEntry } from "@/features/ai/types/agent-edits.types";

const PATH = "/repo/a.ts";
const lines = (...values: string[]) => values.join("\n");

function entry(baseline: string, current: string): AgentEditEntry {
  return { path: PATH, baseline, current, created: false, revision: 1 };
}

describe("agentEditLenses", () => {
  it("puts Keep and Reject above each unreviewed hunk of every chat", () => {
    const current = lines("A", "b", "c");
    const byChat = {
      "chat-1": { [PATH]: entry(lines("a", "b", "c"), current) },
      "chat-2": { [PATH]: entry(lines("A", "b", "c", "d"), current) },
      "chat-3": { "/repo/other.ts": entry("x", "y") },
    };

    expect(
      agentEditLenses(byChat, PATH, current).map(({ chatId, lineNumber }) => ({
        chatId,
        lineNumber,
      })),
    ).toEqual([
      { chatId: "chat-1", lineNumber: 1 },
      // A deleted last line has no line of its own; its actions sit on the last line left.
      { chatId: "chat-2", lineNumber: 3 },
    ]);
  });

  it("offers nothing while the editor shows other text than the log", () => {
    const byChat = { "chat-1": { [PATH]: entry("a", "A") } };
    expect(agentEditLenses(byChat, PATH, "A with unsaved edits")).toEqual([]);
  });
});
