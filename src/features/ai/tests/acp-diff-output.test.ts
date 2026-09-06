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

  it("shows only the touched region of a large file", () => {
    const oldText = Array.from({ length: 600 }, (_, index) => `line ${index}`).join("\n");
    const newText = oldText.replace("line 300", "line 300 changed");
    const [diff] = getAcpDiffOutputs({ type: "diff", path: "large.ts", oldText, newText });

    const view = createAcpDiffViewNode(diff);

    expect(view.truncated).toBe(false);
    expect(view.lines.filter((line) => line.type === "removed")).toHaveLength(1);
    expect(view.lines.filter((line) => line.type === "added")).toHaveLength(1);
    // one hunk header, three lines of context either side, one -/+ pair
    expect(view.lines).toHaveLength(9);
  });

  it("preserves non-diff output and bounds a whole-file rewrite", () => {
    const oldText = Array.from({ length: 600 }, (_, index) => `old ${index}`).join("\n");
    const newText = Array.from({ length: 600 }, (_, index) => `new ${index}`).join("\n");
    const diff = { type: "diff", path: "large.ts", oldText, newText };
    const content = { type: "content", content: { type: "text", text: "Done" } };
    const view = createAcpDiffViewNode(getAcpDiffOutputs([content, diff])[0]);

    expect(view.lines).toHaveLength(EXTENSION_VIEW_LIMITS.maxDiffLines);
    expect(view.truncated).toBe(true);
    expect(stripAcpDiffOutputs([content, diff])).toEqual([content]);
    expect(stripAcpDiffOutputs(diff)).toBeUndefined();
  });

  it("reports a no-op edit as no changes rather than a full rewrite", () => {
    const [diff] = getAcpDiffOutputs({
      type: "diff",
      path: "same.ts",
      oldText: "const ready = true;",
      newText: "const ready = true;",
    });

    expect(createAcpDiffViewNode(diff).lines).toEqual([{ type: "header", content: "No changes" }]);
  });
});
