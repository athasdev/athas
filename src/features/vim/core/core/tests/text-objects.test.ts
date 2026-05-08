import { describe, expect, it, vi } from "vite-plus/test";

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

import { getTextObject } from "../text-objects";

describe("text objects", () => {
  it("iw selects inner word", () => {
    const obj = getTextObject("w");
    expect(obj).toBeDefined();
    const lines = ["hello world"];
    const range = obj!.calculate({ line: 0, column: 0, offset: 0 }, lines, "inner");
    expect(range).toEqual({
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 5, offset: 5 },
      inclusive: false,
    });
  });

  it("aw selects around word with trailing space", () => {
    const obj = getTextObject("w");
    expect(obj).toBeDefined();
    const lines = ["hello world"];
    const range = obj!.calculate({ line: 0, column: 0, offset: 0 }, lines, "around");
    // aw should include the trailing space when there is one
    expect(range).toEqual({
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 6, offset: 6 },
      inclusive: false,
    });
  });

  it("aw falls back to leading space when no trailing space", () => {
    const obj = getTextObject("w");
    expect(obj).toBeDefined();
    const lines = ["hello world"];
    const range = obj!.calculate({ line: 0, column: 6, offset: 6 }, lines, "around");
    // "world" has no trailing space, so aw should include leading space
    expect(range).toEqual({
      start: { line: 0, column: 5, offset: 5 },
      end: { line: 0, column: 11, offset: 11 },
      inclusive: false,
    });
  });

  it("i( selects inside parentheses", () => {
    const obj = getTextObject("(");
    expect(obj).toBeDefined();
    const lines = ["foo (bar) baz"];
    const range = obj!.calculate({ line: 0, column: 5, offset: 5 }, lines, "inner");
    expect(range).toEqual({
      start: { line: 0, column: 5, offset: 5 },
      end: { line: 0, column: 8, offset: 8 },
      inclusive: false,
    });
  });

  it("a( selects around parentheses", () => {
    const obj = getTextObject("(");
    expect(obj).toBeDefined();
    const lines = ["foo (bar) baz"];
    const range = obj!.calculate({ line: 0, column: 5, offset: 5 }, lines, "around");
    expect(range).toEqual({
      start: { line: 0, column: 4, offset: 4 },
      end: { line: 0, column: 9, offset: 9 },
      inclusive: false,
    });
  });
});
