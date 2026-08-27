import { describe, expect, it } from "vite-plus/test";
import { createEditorSelectionContext } from "@/features/editor/utils/editor-agent-context";
import type { EditorContent } from "@/features/panes/types/pane-content.types";

const buffer: EditorContent = {
  id: "buffer-1",
  type: "editor",
  path: "/workspace/src/app.ts",
  name: "app.ts",
  content: "first line\nsecond line\n",
  savedContent: "first line\nsecond line\n",
  isDirty: false,
  isVirtual: false,
  isPinned: false,
  isPreview: false,
  isActive: true,
  tokens: [],
};

describe("editor agent context", () => {
  it("captures a normalized editor selection with one-based source locations", () => {
    const context = createEditorSelectionContext(
      buffer,
      {
        start: { line: 1, column: 6, offset: 17 },
        end: { line: 0, column: 0, offset: 0 },
      },
      "typescript",
    );

    expect(context).toMatchObject({
      bufferId: "buffer-1",
      filePath: "/workspace/src/app.ts",
      languageId: "typescript",
      selectedText: "first line\nsecond",
      startLine: 1,
      startColumn: 1,
      endLine: 2,
      endColumn: 7,
    });
  });

  it("ignores collapsed selections", () => {
    expect(
      createEditorSelectionContext(
        buffer,
        {
          start: { line: 0, column: 2, offset: 2 },
          end: { line: 0, column: 2, offset: 2 },
        },
        "typescript",
      ),
    ).toBeNull();
  });
});
