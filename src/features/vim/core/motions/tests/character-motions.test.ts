import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

import {
  charLeft,
  charRight,
  createFindCharMotion,
  repeatFindChar,
  repeatFindCharReverse,
  resetFindChar,
} from "../character-motions";

describe("charLeft (h)", () => {
  it("moves one column left", () => {
    const lines = ["hello"];
    const range = charLeft.calculate({ line: 0, column: 2, offset: 2 }, lines);
    expect(range.end.column).toBe(1);
  });

  it("stops at column 0", () => {
    const lines = ["hello"];
    const range = charLeft.calculate({ line: 0, column: 0, offset: 0 }, lines);
    expect(range.end.column).toBe(0);
  });
});

describe("charRight (l)", () => {
  it("moves one column right", () => {
    const lines = ["hello"];
    const range = charRight.calculate({ line: 0, column: 2, offset: 2 }, lines);
    expect(range.end.column).toBe(3);
  });

  it("does not move past last character", () => {
    const lines = ["hi"];
    const range = charRight.calculate({ line: 0, column: 1, offset: 1 }, lines);
    expect(range.end.column).toBe(1);
  });
});

describe("find char motions", () => {
  beforeEach(() => {
    resetFindChar();
  });

  it("finds char forward (f)", () => {
    const motion = createFindCharMotion("o", "forward", "find");
    const lines = ["hello world"];
    const range = motion.calculate({ line: 0, column: 0, offset: 0 }, lines);
    expect(range.end.column).toBe(4);
  });

  it("finds char backward (F)", () => {
    const motion = createFindCharMotion("o", "backward", "find");
    const lines = ["hello world"];
    const range = motion.calculate({ line: 0, column: 7, offset: 7 }, lines);
    expect(range.end.column).toBe(4);
  });

  it("repeats last find with ;", () => {
    const motion = createFindCharMotion("o", "forward", "find");
    const lines = ["hello world"];
    motion.calculate({ line: 0, column: 0, offset: 0 }, lines);

    const range = repeatFindChar.calculate({ line: 0, column: 4, offset: 4 }, lines);
    expect(range.end.column).toBe(7);
  });

  it("repeats last find reverse with ,", () => {
    const motion = createFindCharMotion("o", "forward", "find");
    const lines = ["hello world"];
    motion.calculate({ line: 0, column: 0, offset: 0 }, lines);

    const range = repeatFindCharReverse.calculate({ line: 0, column: 4, offset: 4 }, lines);
    expect(range.end.column).toBe(4); // No previous 'o' before column 4
  });

  it("does not corrupt ; direction after using ,", () => {
    const motion = createFindCharMotion("o", "forward", "find");
    const lines = ["hello world"];
    motion.calculate({ line: 0, column: 0, offset: 0 }, lines);

    // First ; finds second 'o'
    const firstSemi = repeatFindChar.calculate({ line: 0, column: 4, offset: 4 }, lines);
    expect(firstSemi.end.column).toBe(7);

    // , should go backward
    const firstComma = repeatFindCharReverse.calculate({ line: 0, column: 7, offset: 7 }, lines);
    expect(firstComma.end.column).toBe(4);

    // ; should still go forward, not backward
    const secondSemi = repeatFindChar.calculate({ line: 0, column: 4, offset: 4 }, lines);
    expect(secondSemi.end.column).toBe(7);
  });
});
