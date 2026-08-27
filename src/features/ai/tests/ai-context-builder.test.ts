import { describe, expect, it } from "vite-plus/test";
import { buildContextPrompt } from "@/features/ai/utils/ai-context-builder";

describe("AI context builder", () => {
  it("includes selected editor text with its file location", () => {
    const prompt = buildContextPrompt({
      projectRoot: "/workspace",
      editorSelections: [
        {
          id: "selection-1",
          bufferId: "buffer-1",
          filePath: "/workspace/src/app.ts",
          fileName: "app.ts",
          languageId: "typescript",
          selectedText: "const answer = 42;",
          startLine: 4,
          startColumn: 1,
          endLine: 4,
          endColumn: 19,
        },
      ],
    });

    expect(prompt).toContain("Selected editor context:");
    expect(prompt).toContain("src/app.ts:4");
    expect(prompt).toContain("```typescript\nconst answer = 42;\n```");
  });
});
