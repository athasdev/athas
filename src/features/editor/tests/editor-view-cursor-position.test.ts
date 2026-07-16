import { describe, expect, it } from "vite-plus/test";
import type { Position } from "@/features/editor/types/editor.types";
import { resolveEditorViewCursorPosition } from "@/features/editor/utils/editor-view-cursor-position";

const activePosition: Position = { line: 12, column: 4, offset: 120 };
const cachedPosition: Position = { line: 3, column: 8, offset: 38 };

describe("resolveEditorViewCursorPosition", () => {
  it("uses the current position for the active editor view", () => {
    expect(
      resolveEditorViewCursorPosition("view-a", "view-a", activePosition, cachedPosition),
    ).toBe(activePosition);
  });

  it("uses the cached position for an inactive editor view", () => {
    expect(
      resolveEditorViewCursorPosition("view-b", "view-a", activePosition, cachedPosition),
    ).toBe(cachedPosition);
  });

  it("falls back to the document start when an inactive view has no cached position", () => {
    expect(resolveEditorViewCursorPosition("view-b", "view-a", activePosition, null)).toEqual({
      line: 0,
      column: 0,
      offset: 0,
    });
  });

  it("uses the current position when no editor view key is available", () => {
    expect(resolveEditorViewCursorPosition(undefined, "view-a", activePosition)).toBe(
      activePosition,
    );
  });
});
