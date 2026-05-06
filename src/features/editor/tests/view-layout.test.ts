import { describe, expect, it } from "vite-plus/test";
import { EDITOR_CONSTANTS } from "../config/constants";
import { buildEditorViewLayout } from "../view-model/view-layout";

const measureText = (text: string) => text.length * 10;
const contentWidthForColumns = (columns: number) =>
  EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + EDITOR_CONSTANTS.EDITOR_PADDING_RIGHT + columns * 10;

describe("buildEditorViewLayout", () => {
  it("keeps one view line per model line when word wrap is off", () => {
    const layout = buildEditorViewLayout({
      lines: ["abcdef", "gh"],
      lineHeight: 20,
      wordWrap: false,
      contentWidth: contentWidthForColumns(3),
      measureText,
    });

    expect(layout.totalViewLines).toBe(2);
    expect(layout.modelLineViewLineCounts).toEqual([1, 1]);
    expect(
      layout.segments.map(({ modelLine, startColumn, endColumn }) => ({
        modelLine,
        startColumn,
        endColumn,
      })),
    ).toEqual([
      { modelLine: 0, startColumn: 0, endColumn: 6 },
      { modelLine: 1, startColumn: 0, endColumn: 2 },
    ]);
  });

  it("projects a wrapped model line into multiple view lines", () => {
    const layout = buildEditorViewLayout({
      lines: ["abcdefg", "hi"],
      lineHeight: 20,
      wordWrap: true,
      contentWidth: contentWidthForColumns(3),
      measureText,
    });

    expect(layout.totalViewLines).toBe(4);
    expect(layout.modelLineStartViewLines).toEqual([0, 3]);
    expect(layout.modelLineViewLineCounts).toEqual([3, 1]);
    expect(
      layout.segments.map(({ viewLine, modelLine, startColumn, endColumn }) => ({
        viewLine,
        modelLine,
        startColumn,
        endColumn,
      })),
    ).toEqual([
      { viewLine: 0, modelLine: 0, startColumn: 0, endColumn: 3 },
      { viewLine: 1, modelLine: 0, startColumn: 3, endColumn: 6 },
      { viewLine: 2, modelLine: 0, startColumn: 6, endColumn: 7 },
      { viewLine: 3, modelLine: 1, startColumn: 0, endColumn: 2 },
    ]);
  });

  it("prefers soft wraps at whitespace before character wraps", () => {
    const layout = buildEditorViewLayout({
      lines: ["abc def"],
      lineHeight: 20,
      wordWrap: true,
      contentWidth: contentWidthForColumns(5),
      measureText,
    });

    expect(
      layout.segments.map(({ startColumn, endColumn }) => ({
        startColumn,
        endColumn,
      })),
    ).toEqual([
      { startColumn: 0, endColumn: 4 },
      { startColumn: 4, endColumn: 7 },
    ]);
  });

  it("converts model positions to wrapped view positions", () => {
    const layout = buildEditorViewLayout({
      lines: ["abcdefg"],
      lineHeight: 20,
      wordWrap: true,
      contentWidth: contentWidthForColumns(3),
      measureText,
    });

    const position = layout.modelPositionToViewPosition(0, 4);

    expect(position.viewLine).toBe(1);
    expect(position.segment).toMatchObject({ startColumn: 3, endColumn: 6 });
    expect(position.left).toBe(EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + 10);
    expect(position.top).toBe(EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20);
  });

  it("keeps empty model lines addressable", () => {
    const layout = buildEditorViewLayout({
      lines: [""],
      lineHeight: 20,
      wordWrap: true,
      contentWidth: contentWidthForColumns(3),
      measureText,
    });

    expect(layout.totalViewLines).toBe(1);
    expect(layout.modelPositionToViewPosition(0, 0)).toMatchObject({
      viewLine: 0,
      left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
    });
  });
});
