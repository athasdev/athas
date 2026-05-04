import { describe, expect, it } from "vite-plus/test";
import type {
  EditorContent,
  PaneContent,
  TerminalContent,
} from "@/features/panes/types/pane-content";
import {
  getDirtyEditorBuffers,
  getUnsavedProjectTransitionMessage,
} from "../controllers/workspace-project-transition";

const createEditorBuffer = (overrides: Partial<EditorContent>): EditorContent => ({
  id: "editor-1",
  type: "editor",
  path: "/workspace/src/app.ts",
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
});

const createTerminalBuffer = (overrides: Partial<TerminalContent>): TerminalContent => ({
  id: "terminal-1",
  type: "terminal",
  path: "terminal://terminal-1",
  name: "Terminal",
  isPinned: false,
  isPreview: false,
  isActive: false,
  sessionId: "terminal-1",
  ...overrides,
});

describe("workspace project transition guards", () => {
  it("returns dirty editor buffers and ignores clean or non-editor buffers", () => {
    const buffers: PaneContent[] = [
      createEditorBuffer({ id: "clean", name: "clean.ts", isDirty: false }),
      createTerminalBuffer({ id: "terminal" }),
      createEditorBuffer({ id: "dirty", name: "dirty.ts", isDirty: true }),
    ];

    expect(getDirtyEditorBuffers(buffers).map((buffer) => buffer.id)).toEqual(["dirty"]);
  });

  it("builds a specific save prompt for one dirty buffer", () => {
    const buffers: PaneContent[] = [
      createEditorBuffer({ id: "dirty", name: "settings.json", isDirty: true }),
    ];

    expect(getUnsavedProjectTransitionMessage("switching projects", buffers)).toBe(
      'Save changes to "settings.json" before switching projects?',
    );
  });

  it("builds a count based save prompt for multiple dirty buffers", () => {
    const buffers: PaneContent[] = [
      createEditorBuffer({ id: "dirty-1", name: "one.ts", isDirty: true }),
      createEditorBuffer({ id: "dirty-2", name: "two.ts", isDirty: true }),
    ];

    expect(getUnsavedProjectTransitionMessage("closing this project", buffers)).toBe(
      "Save changes to 2 files before closing this project?",
    );
  });

  it("does not block when there are no dirty editor buffers", () => {
    const buffers: PaneContent[] = [
      createEditorBuffer({ id: "clean", isDirty: false }),
      createTerminalBuffer({ id: "terminal" }),
    ];

    expect(getUnsavedProjectTransitionMessage("switching projects", buffers)).toBeNull();
  });
});
