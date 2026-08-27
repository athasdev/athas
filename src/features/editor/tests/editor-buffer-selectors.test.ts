import { describe, expect, it } from "vite-plus/test";
import type {
  EditorContent,
  PaneContent,
  TerminalContent,
} from "@/features/panes/types/pane-content.types";
import {
  findDirtyEditorBuffer,
  getDirtyEditorBuffers,
  getDirtyWritableEditorBuffers,
} from "../utils/editor-buffer-selectors";

function createEditorBuffer(overrides: Partial<EditorContent>): EditorContent {
  return {
    id: "editor",
    type: "editor",
    path: "/workspace/app.ts",
    name: "app.ts",
    isPinned: false,
    isPreview: false,
    isActive: true,
    content: "changed",
    savedContent: "saved",
    isDirty: false,
    isVirtual: false,
    tokens: [],
    ...overrides,
  };
}

function createTerminalBuffer(): TerminalContent {
  return {
    id: "terminal",
    type: "terminal",
    path: "terminal://terminal",
    name: "Terminal",
    isPinned: false,
    isPreview: false,
    isActive: false,
    sessionId: "terminal",
  };
}

describe("editor buffer selectors", () => {
  it("finds dirty editors without including clean or non-editor content", () => {
    const buffers: PaneContent[] = [
      createTerminalBuffer(),
      createEditorBuffer({ id: "clean" }),
      createEditorBuffer({ id: "dirty", isDirty: true }),
    ];

    expect(findDirtyEditorBuffer(buffers)?.id).toBe("dirty");
    expect(getDirtyEditorBuffers(buffers).map((buffer) => buffer.id)).toEqual(["dirty"]);
  });

  it("keeps read-only dirty editors out of writable save operations", () => {
    const buffers: PaneContent[] = [
      createEditorBuffer({ id: "read-only", isDirty: true, readOnly: true }),
      createEditorBuffer({ id: "writable", isDirty: true, readOnly: false }),
    ];

    expect(getDirtyEditorBuffers(buffers).map((buffer) => buffer.id)).toEqual([
      "read-only",
      "writable",
    ]);
    expect(getDirtyWritableEditorBuffers(buffers).map((buffer) => buffer.id)).toEqual(["writable"]);
  });
});
