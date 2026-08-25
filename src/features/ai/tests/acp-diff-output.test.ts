import { describe, expect, it } from "vite-plus/test";
import {
  createAcpDiffViewNode,
  getAcpDiffOutputs,
  stripAcpDiffOutputs,
} from "@/features/ai/lib/acp-diff-output";
import { EXTENSION_VIEW_LIMITS } from "@/extensions/ui/services/extension-view-schema";

describe("ACP diff output", () => {
  it("turns ACP changes into a canonical compact diff view", () => {
    const [diff] = getAcpDiffOutputs({
      type: "diff",
      path: "/workspace/src/main.ts",
      oldText: "const ready = false;",
      newText: "const ready = true;",
    });

    expect(createAcpDiffViewNode(diff, "/workspace")).toEqual({
      type: "diff",
      filePath: "src/main.ts",
      language: "ts",
      lines: [
        { type: "header", content: "-1,1 +1,1" },
        { type: "removed", content: "const ready = false;", oldLine: 1 },
        { type: "added", content: "const ready = true;", newLine: 1 },
      ],
      truncated: false,
    });
  });

  it("preserves non-diff output and balances bounded previews", () => {
    const oldText = Array.from({ length: 600 }, (_, index) => `old ${index}`).join("\n");
    const newText = Array.from({ length: 600 }, (_, index) => `new ${index}`).join("\n");
    const diff = { type: "diff", path: "large.ts", oldText, newText };
    const content = { type: "content", content: { type: "text", text: "Done" } };
    const view = createAcpDiffViewNode(getAcpDiffOutputs([content, diff])[0]);

    expect(view.lines).toHaveLength(EXTENSION_VIEW_LIMITS.maxDiffLines);
    expect(view.lines.some((line) => line.type === "removed")).toBe(true);
    expect(view.lines.some((line) => line.type === "added")).toBe(true);
    expect(view.truncated).toBe(true);
    expect(stripAcpDiffOutputs([content, diff])).toEqual([content]);
    expect(stripAcpDiffOutputs(diff)).toBeUndefined();
  });
});
