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

import { wordForward, wordBackward, wordEnd, wordPreviousEnd } from "../word-motions";

describe("wordForward (w)", () => {
  it("moves to start of next word", () => {
    const lines = ["hello world"];
    const range = wordForward.calculate({ line: 0, column: 0, offset: 0 }, lines);
    expect(range.end).toEqual({ line: 0, column: 6, offset: 6 });
  });

  it("moves across multiple words", () => {
    const lines = ["hello world foo"];
    const range = wordForward.calculate({ line: 0, column: 0, offset: 0 }, lines, 2);
    expect(range.end).toEqual({ line: 0, column: 12, offset: 12 });
  });

  it("wraps to next line", () => {
    const lines = ["hello", "world"];
    const range = wordForward.calculate({ line: 0, column: 4, offset: 4 }, lines);
    expect(range.end).toEqual({ line: 1, column: 0, offset: 6 });
  });
});

describe("wordBackward (b)", () => {
  it("moves to start of previous word", () => {
    const lines = ["hello world"];
    const range = wordBackward.calculate({ line: 0, column: 6, offset: 6 }, lines);
    expect(range.end).toEqual({ line: 0, column: 0, offset: 0 });
  });

  it("wraps to previous line", () => {
    const lines = ["hello", "world"];
    const range = wordBackward.calculate({ line: 1, column: 0, offset: 6 }, lines);
    expect(range.end).toEqual({ line: 0, column: 0, offset: 0 });
  });
});

describe("wordEnd (e)", () => {
  it("moves to end of current word", () => {
    const lines = ["hello world"];
    const range = wordEnd.calculate({ line: 0, column: 0, offset: 0 }, lines);
    expect(range.end).toEqual({ line: 0, column: 4, offset: 4 });
  });

  it("moves to end of next word", () => {
    const lines = ["hello world"];
    const range = wordEnd.calculate({ line: 0, column: 6, offset: 6 }, lines);
    expect(range.end).toEqual({ line: 0, column: 10, offset: 10 });
  });
});

describe("wordPreviousEnd (ge)", () => {
  it("moves to end of previous word", () => {
    const lines = ["hello world"];
    const range = wordPreviousEnd.calculate({ line: 0, column: 6, offset: 6 }, lines);
    expect(range.end).toEqual({ line: 0, column: 4, offset: 4 });
  });
});
