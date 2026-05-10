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

  it("uses sparse segment lookups in compact non-wrapped layouts", () => {
    const layout = buildEditorViewLayout({
      lines: ["alpha", "beta", "gamma"],
      lineHeight: 20,
      wordWrap: false,
      contentWidth: contentWidthForColumns(10),
      measureText,
      compact: true,
    });

    expect(layout.segments).toEqual([]);
    expect(layout.totalViewLines).toBe(3);
    expect(layout.totalHeight).toBe(60);
    expect(layout.getSegmentForModelPosition(2, 2)).toMatchObject({
      viewLine: 2,
      modelLine: 2,
      startColumn: 0,
      endColumn: 5,
      top: 48,
    });
    expect(layout.modelPositionToViewPosition(1, 3)).toMatchObject({
      viewLine: 1,
      modelLine: 1,
      column: 3,
      left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + 30,
    });
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

  it("converts editor points on wrapped view lines back to model positions", () => {
    const layout = buildEditorViewLayout({
      lines: ["abcdefg"],
      lineHeight: 20,
      wordWrap: true,
      contentWidth: contentWidthForColumns(3),
      measureText,
    });

    const position = layout.editorPointToModelPosition(
      EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + 11,
      EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 21,
    );

    expect(position.viewLine).toBe(1);
    expect(position.modelLine).toBe(0);
    expect(position.column).toBe(4);
    expect(position.left).toBe(EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + 10);
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

  it("reserves vertical space for view zones after model lines", () => {
    const layout = buildEditorViewLayout({
      lines: ["first", "second"],
      lineHeight: 20,
      wordWrap: false,
      contentWidth: contentWidthForColumns(10),
      measureText,
      zones: [{ id: "inline-diff", afterLine: 0, height: 48 }],
    });

    expect(layout.totalZoneHeight).toBe(48);
    expect(layout.totalHeight).toBe(88);
    expect(layout.zones[0]).toMatchObject({
      id: "inline-diff",
      afterLine: 0,
      top: EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20,
      height: 48,
    });
    expect(layout.modelPositionToViewPosition(1, 0).top).toBe(
      EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20 + 48,
    );
  });

  it("stacks multiple view zones deterministically after the same model line", () => {
    const layout = buildEditorViewLayout({
      lines: ["first", "second"],
      lineHeight: 20,
      wordWrap: false,
      contentWidth: contentWidthForColumns(10),
      measureText,
      zones: [
        { id: "inline-edit", afterLine: 0, height: 96 },
        { id: "inline-diff", afterLine: 0, height: 42 },
      ],
    });

    expect(layout.totalZoneHeight).toBe(138);
    expect(layout.zones.map((zone) => zone.id)).toEqual(["inline-diff", "inline-edit"]);
    expect(layout.zones.map((zone) => zone.top)).toEqual([
      EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20,
      EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20 + 42,
    ]);
    expect(layout.modelPositionToViewPosition(1, 0).top).toBe(
      EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20 + 138,
    );
  });

  it("hit-tests editor points after a view zone against shifted model lines", () => {
    const layout = buildEditorViewLayout({
      lines: ["first", "second"],
      lineHeight: 20,
      wordWrap: false,
      contentWidth: contentWidthForColumns(10),
      measureText,
      zones: [{ id: "inline-diff", afterLine: 0, height: 48 }],
    });

    const position = layout.editorPointToModelPosition(
      EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20 + 48 + 1,
    );

    expect(position.modelLine).toBe(1);
  });
});
