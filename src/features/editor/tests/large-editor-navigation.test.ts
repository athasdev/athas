import { describe, expect, it } from "vite-plus/test";
import {
  resolveLargeEditorDeletion,
  resolveLargeEditorNavigation,
} from "../utils/large-editor-navigation";
import type { Position } from "../types/editor";

const cursor = (line: number, column: number, offset: number): Position => ({
  line,
  column,
  offset,
});

function resolve(overrides: Partial<Parameters<typeof resolveLargeEditorNavigation>[0]> = {}) {
  return resolveLargeEditorNavigation({
    key: "ArrowRight",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    cursorPosition: cursor(2, 3, 23),
    desiredColumn: undefined,
    selectedRange: null,
    content: "alpha beta\ngamma delta\nthird_line",
    visualLineCount: 3,
    lineHeight: 20,
    viewportHeight: 100,
    getLineText: (line) => ["alpha beta", "gamma delta", "third_line"][line] ?? "",
    getOffsetForPosition: (line, column) => line * 10 + column,
    ...overrides,
  });
}

function resolveDeletion(
  overrides: Partial<Parameters<typeof resolveLargeEditorDeletion>[0]> = {},
) {
  return resolveLargeEditorDeletion({
    key: "Backspace",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    cursorPosition: cursor(1, 5, "alpha beta\ngamma".length),
    selectedRange: null,
    content: "alpha beta\ngamma delta\nthird_line",
    visualLineCount: 3,
    getLineText: (line) => ["alpha beta", "gamma delta", "third_line"][line] ?? "",
    getOffsetForPosition: (line, column) => [0, 11, 23][line] + column,
    ...overrides,
  });
}

describe("resolveLargeEditorNavigation", () => {
  it("collapses selected ranges for plain horizontal movement", () => {
    expect(resolve({ key: "ArrowLeft", selectedRange: { start: 5, end: 12 } })).toMatchObject({
      offset: 5,
      extendSelection: false,
    });
    expect(resolve({ key: "ArrowRight", selectedRange: { start: 5, end: 12 } })).toMatchObject({
      offset: 12,
      extendSelection: false,
    });
  });

  it("extends selection for shift navigation", () => {
    expect(resolve({ key: "ArrowDown", shiftKey: true })).toMatchObject({
      offset: 23,
      extendSelection: true,
    });
  });

  it("handles mac and ctrl document navigation", () => {
    expect(resolve({ key: "ArrowUp", metaKey: true })).toMatchObject({
      offset: 0,
      stopPropagation: true,
    });
    expect(resolve({ key: "End", ctrlKey: true })).toMatchObject({
      offset: "alpha beta\ngamma delta\nthird_line".length,
      stopPropagation: true,
    });
  });

  it("handles word and page movement", () => {
    expect(resolve({ key: "ArrowLeft", altKey: true })?.offset).toBe("alpha beta\ngamma ".length);
    expect(resolve({ key: "PageUp" })).toMatchObject({
      offset: 3,
      extendSelection: false,
    });
  });

  it("preserves desired column across vertical movement", () => {
    expect(resolve({ key: "ArrowUp", desiredColumn: 8 })).toMatchObject({
      offset: 18,
      desiredColumn: 8,
    });
    expect(resolve({ key: "PageUp", desiredColumn: 8 })).toMatchObject({
      offset: 8,
      desiredColumn: 8,
    });
  });

  it("resolves selected, word, and line deletion ranges", () => {
    expect(resolveDeletion({ selectedRange: { start: 2, end: 8 } })).toMatchObject({
      start: 2,
      end: 8,
    });

    expect(resolveDeletion({ altKey: true })).toMatchObject({
      start: "alpha beta\n".length,
      end: "alpha beta\ngamma".length,
    });

    expect(resolveDeletion({ key: "Delete", ctrlKey: true })).toMatchObject({
      start: "alpha beta\ngamma".length,
      end: "alpha beta\ngamma ".length,
    });

    expect(resolveDeletion({ metaKey: true })).toMatchObject({
      start: "alpha beta\n".length,
      end: "alpha beta\ngamma".length,
      stopPropagation: true,
    });

    expect(resolveDeletion({ key: "Delete", metaKey: true })).toMatchObject({
      start: "alpha beta\ngamma".length,
      end: "alpha beta\ngamma delta".length,
      stopPropagation: true,
    });
  });

  it("still handles no-op deletion at document boundaries", () => {
    expect(resolveDeletion({ cursorPosition: cursor(0, 0, 0) })).toMatchObject({
      start: 0,
      end: 0,
      handled: true,
    });
    expect(
      resolveDeletion({
        key: "Delete",
        cursorPosition: cursor(
          2,
          "third_line".length,
          "alpha beta\ngamma delta\nthird_line".length,
        ),
      }),
    ).toMatchObject({
      start: "alpha beta\ngamma delta\nthird_line".length,
      end: "alpha beta\ngamma delta\nthird_line".length,
      handled: true,
    });
  });
});
