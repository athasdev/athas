import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useEditorDecorationsStore } from "../stores/decorations.store";
import type { Decoration, Position, Range } from "../types/editor.types";

const position = (line: number, column: number): Position => ({ line, column, offset: 0 });
const range = (
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): Range => ({
  start: position(startLine, startColumn),
  end: position(endLine, endColumn),
});

describe("editor decorations store", () => {
  beforeEach(() => {
    useEditorDecorationsStore.setState({ decorations: new Map() });
  });

  it("queries decorations by overlap, position, and line", () => {
    const decoration: Decoration = {
      range: range(2, 3, 4, 8),
      className: "highlight",
      type: "inline",
    };
    const { actions } = useEditorDecorationsStore.getState();
    const id = actions.addDecoration(decoration);

    expect(actions.getDecorations()).toHaveLength(1);
    expect(actions.getDecorationsInRange(range(4, 8, 5, 1))).toHaveLength(1);
    expect(actions.getDecorationsAtPosition(position(3, 1))).toHaveLength(1);
    expect(actions.getDecorationsForLine(4)).toHaveLength(1);
    expect(actions.getDecorationsForLine(5)).toHaveLength(0);

    actions.updateDecoration(id, { className: "updated" });
    expect(actions.getDecorations()[0]?.className).toBe("updated");
  });

  it("ignores stale removals and removes only requested decorations", () => {
    const { actions } = useEditorDecorationsStore.getState();
    const ids = actions.addDecorations([
      { range: range(1, 1, 1, 2), type: "inline" },
      { range: range(2, 1, 2, 2), type: "line" },
    ]);

    actions.removeDecorations(["missing", ids[0]!]);
    expect(actions.getDecorations()).toHaveLength(1);

    actions.removeDecoration(ids[1]!);
    expect(actions.getDecorations()).toEqual([]);
  });
});
