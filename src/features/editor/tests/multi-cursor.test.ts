import { describe, expect, it } from "vite-plus/test";
import type { Cursor } from "../types/editor";
import {
  applyMultiCursorBackspace,
  applyMultiCursorEdit,
  resolveCursorPositionsAtLineEndsForSelection,
  resolveMultiCursorKeyEdit,
} from "../utils/multi-cursor";

function cursor(id: string, line: number, column: number, offset: number): Cursor {
  return {
    id,
    position: { line, column, offset },
  };
}

describe("multi-cursor editing", () => {
  it("applies inserts against original offsets and shifts later cursors", () => {
    const result = applyMultiCursorEdit(
      "ab\ncd",
      [cursor("a", 0, 1, 1), cursor("b", 1, 1, 4)],
      "X",
    );

    expect(result.newContent).toBe("aXb\ncXd");
    expect(result.newCursors.map((entry) => entry.position)).toEqual([
      { line: 0, column: 2, offset: 2 },
      { line: 1, column: 2, offset: 6 },
    ]);
  });

  it("applies backspace at multiple cursors without repeated line splits", () => {
    const result = applyMultiCursorBackspace("ab\ncd", [
      cursor("a", 0, 2, 2),
      cursor("b", 1, 2, 5),
    ]);

    expect(result.newContent).toBe("a\nc");
    expect(result.newCursors.map((entry) => entry.position)).toEqual([
      { line: 0, column: 1, offset: 1 },
      { line: 1, column: 1, offset: 3 },
    ]);
  });

  it("replaces selections and clears cursor selections", () => {
    const result = applyMultiCursorEdit(
      "alpha beta",
      [
        {
          ...cursor("a", 0, 5, 5),
          selection: {
            start: { line: 0, column: 0, offset: 0 },
            end: { line: 0, column: 5, offset: 5 },
          },
        },
        {
          ...cursor("b", 0, 10, 10),
          selection: {
            start: { line: 0, column: 6, offset: 6 },
            end: { line: 0, column: 10, offset: 10 },
          },
        },
      ],
      "x",
    );

    expect(result.newContent).toBe("x x");
    expect(result.newCursors.map((entry) => entry.selection)).toEqual([undefined, undefined]);
    expect(result.newCursors.map((entry) => entry.position.offset)).toEqual([1, 3]);
  });

  it("resolves key edits and returns the primary cursor", () => {
    const result = resolveMultiCursorKeyEdit({
      content: "ab\ncd",
      key: "x",
      multiCursorState: {
        primaryCursorId: "b",
        cursors: [cursor("a", 0, 1, 1), cursor("b", 1, 1, 4)],
      },
    });

    expect(result?.newContent).toBe("axb\ncxd");
    expect(result?.primaryCursor?.id).toBe("b");
    expect(result?.primaryCursor?.position).toEqual({ line: 1, column: 2, offset: 6 });
  });

  it("does not resolve blocked modifier edits", () => {
    expect(
      resolveMultiCursorKeyEdit({
        content: "ab",
        key: "b",
        multiCursorState: {
          primaryCursorId: "a",
          cursors: [cursor("a", 0, 1, 1), cursor("b", 0, 2, 2)],
        },
        hasBlockedModifier: true,
      }),
    ).toBeNull();
  });

  it("resolves cursor positions at selected line ends", () => {
    expect(
      resolveCursorPositionsAtLineEndsForSelection({
        content: "one\ntwo\nthree",
        selection: {
          start: { line: 0, column: 1, offset: 1 },
          end: { line: 2, column: 2, offset: "one\ntwo\nth".length },
        },
      }),
    ).toEqual([
      { line: 0, column: 3, offset: 3 },
      { line: 1, column: 3, offset: "one\ntwo".length },
      { line: 2, column: 2, offset: "one\ntwo\nth".length },
    ]);
  });

  it("excludes the final line when selection ends at the next line start", () => {
    expect(
      resolveCursorPositionsAtLineEndsForSelection({
        content: "one\ntwo\nthree",
        selection: {
          start: { line: 0, column: 0, offset: 0 },
          end: { line: 1, column: 0, offset: "one\n".length },
        },
      }),
    ).toEqual([{ line: 0, column: 3, offset: 3 }]);
  });
});
