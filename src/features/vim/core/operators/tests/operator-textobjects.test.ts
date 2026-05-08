import { describe, expect, it, vi } from "vite-plus/test";
import { enableMapSet } from "immer";

enableMapSet();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(),
    onDragDropEvent: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(),
  }),
}));

import type { VimEditorFacade } from "../../editor-facade";
import { deleteOperator } from "../delete-operator";
import { yankOperator } from "../yank-operator";
import { changeOperator } from "../change-operator";
import { getTextObject } from "../../core/text-objects";

const createMockFacade = (overrides?: Partial<VimEditorFacade>): VimEditorFacade => ({
  getContent: vi.fn(() => ""),
  setContent: vi.fn(),
  getLines: vi.fn(() => []),
  getCursorPosition: vi.fn(() => ({ line: 0, column: 0, offset: 0 })),
  setCursorPosition: vi.fn(),
  setSelection: vi.fn(),
  collapseSelection: vi.fn(),
  focus: vi.fn(),
  blur: vi.fn(),
  getViewportMetrics: vi.fn(() => ({ topLine: 0, bottomLine: 0, visibleLines: 1 })),
  saveUndoState: vi.fn(),
  setReadOnly: vi.fn(),
  setDataVimMode: vi.fn(),
  setCaretColor: vi.fn(),
  getActiveElement: vi.fn(() => null),
  isFocused: vi.fn(() => false),
  ...overrides,
});

describe("operator + text object execution", () => {
  it("diw deletes inner word", () => {
    const setCursorPosition = vi.fn();
    const setContent = vi.fn();
    const lines = ["hello world"];
    const content = lines.join("\n");

    const textObj = getTextObject("w");
    expect(textObj).toBeDefined();

    const range = textObj!.calculate({ line: 0, column: 0, offset: 0 }, lines, "inner");

    const context = {
      lines,
      content,
      cursor: { line: 0, column: 0, offset: 0 },
      activeBufferId: "test",
      updateContent: setContent,
      setCursorPosition,
      tabSize: 2,
      facade: createMockFacade({ getLines: () => lines }),
    };

    deleteOperator.execute(range!, context);

    // Should have deleted "hello" (first word)
    expect(setContent).toHaveBeenCalledWith(" world");
  });

  it("daw deletes around word with trailing space", () => {
    const setCursorPosition = vi.fn();
    const setContent = vi.fn();
    const lines = ["hello world"];
    const content = lines.join("\n");

    const textObj = getTextObject("w");
    const range = textObj!.calculate({ line: 0, column: 0, offset: 0 }, lines, "around");

    const context = {
      lines,
      content,
      cursor: { line: 0, column: 0, offset: 0 },
      activeBufferId: "test",
      updateContent: setContent,
      setCursorPosition,
      tabSize: 2,
      facade: createMockFacade({ getLines: () => lines }),
    };

    deleteOperator.execute(range!, context);

    // Should have deleted "hello " (word + trailing space)
    expect(setContent).toHaveBeenCalledWith("world");
  });

  it("ciw delegates to delete for character-wise", () => {
    const setCursorPosition = vi.fn();
    const setContent = vi.fn();
    const lines = ["hello world"];
    const content = lines.join("\n");

    const textObj = getTextObject("w");
    const range = textObj!.calculate({ line: 0, column: 2, offset: 2 }, lines, "inner");

    const context = {
      lines,
      content,
      cursor: { line: 0, column: 2, offset: 2 },
      activeBufferId: "test",
      updateContent: setContent,
      setCursorPosition,
      tabSize: 2,
      facade: createMockFacade({ getLines: () => lines }),
    };

    // ciw on "hello world" at column 2 (inside "hello")
    changeOperator.execute(range!, context);

    // Should delete "hello" and position cursor at start of word
    expect(setContent).toHaveBeenCalledWith(" world");
  });
});
