import { describe, expect, it } from "vitest";
import type { EditorContent, TerminalContent } from "@/features/panes/types/pane-content.types";
import { getNativeMenuState } from "@/features/window/utils/native-menu-state";

const editorBuffer = (overrides: Partial<EditorContent> = {}): EditorContent => ({
  id: "editor",
  type: "editor",
  path: "/workspace/main.ts",
  name: "main.ts",
  content: "",
  savedContent: "",
  isDirty: false,
  isVirtual: false,
  isPinned: false,
  isPreview: false,
  isActive: true,
  tokens: [],
  ...overrides,
});

const defaults = {
  hasOpenFolder: true,
  activityBarVisible: true,
  sidebarVisible: true,
  terminalVisible: false,
  minimapVisible: false,
  wordWrap: false,
  lineNumbers: true,
  renderWhitespace: "none" as const,
};

describe("getNativeMenuState", () => {
  it("enables save actions for a dirty writable editor", () => {
    expect(
      getNativeMenuState({ ...defaults, activeBuffer: editorBuffer({ isDirty: true }) }),
    ).toMatchObject({
      closeFolderEnabled: true,
      saveEnabled: true,
      saveAsEnabled: true,
      lineNumbers: true,
      whitespaceVisible: false,
    });
  });

  it("disables document actions for a non-editor surface", () => {
    const terminal: TerminalContent = {
      id: "terminal",
      type: "terminal",
      path: "terminal:1",
      name: "Terminal",
      sessionId: "session",
      isPinned: false,
      isPreview: false,
      isActive: true,
    };

    expect(getNativeMenuState({ ...defaults, activeBuffer: terminal })).toMatchObject({
      saveEnabled: false,
      saveAsEnabled: false,
    });
  });

  it("maps visible editor options to native checkmarks", () => {
    expect(
      getNativeMenuState({
        ...defaults,
        activeBuffer: editorBuffer(),
        minimapVisible: true,
        wordWrap: true,
        lineNumbers: false,
        renderWhitespace: "all",
      }),
    ).toMatchObject({
      minimapVisible: true,
      wordWrap: true,
      lineNumbers: false,
      whitespaceVisible: true,
    });
  });
});
