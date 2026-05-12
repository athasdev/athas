import { describe, expect, it } from "vite-plus/test";
import type { Position, Range } from "../types/editor";
import {
  buildSelectionFromAnchor,
  getSelectionAnchorForCursor,
  getSmartSelectionRanges,
  resolveExpandSelection,
  resolveShrinkSelection,
} from "../utils/selection-ranges";

const position = (offset: number): Position => ({ line: 0, column: offset, offset });

describe("selection range helpers", () => {
  it("keeps the opposite edge anchored when extending an existing selection", () => {
    const selection: Range = {
      start: position(10),
      end: position(20),
    };

    expect(getSelectionAnchorForCursor(selection, position(20))).toEqual(position(10));
    expect(getSelectionAnchorForCursor(selection, position(10))).toEqual(position(20));
  });

  it("drops empty extended selections", () => {
    expect(buildSelectionFromAnchor(position(10), position(10))).toBeUndefined();
    expect(buildSelectionFromAnchor(position(10), position(12))).toEqual({
      start: position(10),
      end: position(12),
    });
  });

  it("builds smart selection ranges from word to bracket, line, and document", () => {
    const content = "const value = call(alpha);\nnext();";

    expect(
      getSmartSelectionRanges({
        content,
        cursorOffset: "const value = call(al".length,
      }),
    ).toEqual([
      { start: "const value = call(".length, end: "const value = call(alpha".length },
      { start: "const value = call".length, end: "const value = call(alpha)".length },
      { start: 0, end: "const value = call(alpha);".length },
      { start: 0, end: content.length },
    ]);
  });

  it("expands to the next larger smart range", () => {
    const content = "const value = call(alpha);";

    expect(
      resolveExpandSelection({
        content,
        cursorOffset: "const value = call(al".length,
      }),
    ).toEqual({ start: "const value = call(".length, end: "const value = call(alpha".length });

    expect(
      resolveExpandSelection({
        content,
        cursorOffset: "const value = call(al".length,
        selectionStart: "const value = call(".length,
        selectionEnd: "const value = call(alpha".length,
      }),
    ).toEqual({ start: "const value = call".length, end: "const value = call(alpha)".length });
  });

  it("shrinks to the nearest smaller smart range", () => {
    const content = "const value = call(alpha);\nnext();";

    expect(
      resolveShrinkSelection({
        content,
        cursorOffset: "const value = call(al".length,
        selectionStart: "const value = call".length,
        selectionEnd: "const value = call(alpha)".length,
      }),
    ).toEqual({ start: "const value = call(".length, end: "const value = call(alpha".length });
  });
});
