import { describe, expect, it } from "vite-plus/test";
import { EDITOR_CONSTANTS } from "../config/constants";
import { buildLineOffsetMap } from "../utils/html";
import { calculateSelectionBoxes } from "../utils/selection-boxes";
import { buildEditorViewLayout } from "../view-model/view-layout";

const measureText = (text: string) => text.length * 8;
const measureWideText = (text: string) => text.length * 10;
const contentWidthForColumns = (columns: number) =>
  EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + EDITOR_CONSTANTS.EDITOR_PADDING_RIGHT + columns * 10;

describe("calculateSelectionBoxes", () => {
  it("renders a visible box for selected empty middle lines", () => {
    const content = "first\n\nthird";
    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: 0, end: content.length },
      lines: content.split("\n"),
      lineOffsets: buildLineOffsetMap(content),
      contentLength: content.length,
      lineHeight: 20,
      measureText,
    });

    expect(boxes).toHaveLength(3);
    expect(boxes[1]).toMatchObject({
      top: 20 + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      width: 8,
      height: 20,
    });
  });

  it("does not render the final line when selection ends at its start", () => {
    const content = "first\nsecond";
    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: 0, end: "first\n".length },
      lines: content.split("\n"),
      lineOffsets: buildLineOffsetMap(content),
      contentLength: content.length,
      lineHeight: 20,
      measureText,
    });

    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.width).toBe("first".length * 8);
  });

  it("fills the rest of the row when a selected line break is visible", () => {
    const content = "first\nsecond";
    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: 0, end: "first\n".length },
      lines: content.split("\n"),
      lineOffsets: buildLineOffsetMap(content),
      contentLength: content.length,
      lineHeight: 20,
      lineBreakFillWidth: 320,
      measureText,
    });

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({
      left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      width: 320 - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
    });
  });

  it("only rounds the outside corners of a multiline selection", () => {
    const content = "first\nsecond\nthird";
    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: 1, end: "first\nsecond\nth".length },
      lines: content.split("\n"),
      lineOffsets: buildLineOffsetMap(content),
      contentLength: content.length,
      lineHeight: 20,
      measureText,
    });

    expect(boxes).toHaveLength(3);
    expect(boxes[0]?.corners).toEqual({
      topLeft: true,
      topRight: true,
      bottomRight: false,
      bottomLeft: false,
    });
    expect(boxes[1]?.corners).toEqual({
      topLeft: false,
      topRight: false,
      bottomRight: false,
      bottomLeft: false,
    });
    expect(boxes[2]?.corners).toEqual({
      topLeft: false,
      topRight: false,
      bottomRight: true,
      bottomLeft: true,
    });
  });

  it("splits selections across wrapped view lines", () => {
    const content = "abcdefg";
    const lines = content.split("\n");
    const viewLayout = buildEditorViewLayout({
      lines,
      lineHeight: 20,
      wordWrap: true,
      contentWidth: contentWidthForColumns(3),
      measureText: measureWideText,
    });

    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: 1, end: content.length },
      lines,
      lineOffsets: buildLineOffsetMap(content),
      contentLength: content.length,
      lineHeight: 20,
      measureText: measureWideText,
      viewLayout,
    });

    expect(boxes).toHaveLength(3);
    expect(boxes.map(({ top, left, width, height }) => ({ top, left, width, height }))).toEqual([
      {
        top: EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
        left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + 10,
        width: 20,
        height: 20,
      },
      {
        top: EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20,
        left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        width: 30,
        height: 20,
      },
      {
        top: EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 40,
        left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        width: 10,
        height: 20,
      },
    ]);
  });

  it("places selection boxes after view zones using shifted layout positions", () => {
    const content = "first\nsecond";
    const lines = content.split("\n");
    const viewLayout = buildEditorViewLayout({
      lines,
      lineHeight: 20,
      wordWrap: false,
      contentWidth: contentWidthForColumns(10),
      measureText: measureWideText,
      zones: [{ id: "inline-diff", afterLine: 0, height: 48 }],
    });

    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: "first\n".length, end: "first\nsec".length },
      lines,
      lineOffsets: buildLineOffsetMap(content),
      contentLength: content.length,
      lineHeight: 20,
      measureText: measureWideText,
      viewLayout,
    });

    expect(boxes[0]).toMatchObject({
      top: EDITOR_CONSTANTS.EDITOR_PADDING_TOP + 20 + 48,
      left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      width: 30,
      height: 20,
    });
  });

  it("measures selected tabs from their line column instead of substring column zero", () => {
    const content = "ab\tcd";
    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: 2, end: 3 },
      lines: [content],
      lineOffsets: buildLineOffsetMap(content),
      contentLength: content.length,
      lineHeight: 20,
      measureText: (text) => {
        let width = 0;
        let column = 0;
        for (const char of text) {
          if (char === "\t") {
            const spaces = 4 - (column % 4 || 4);
            const tabWidth = spaces === 0 ? 4 : spaces;
            width += tabWidth * 10;
            column += tabWidth;
          } else {
            width += 10;
            column++;
          }
        }
        return width;
      },
    });

    expect(boxes[0]).toMatchObject({
      left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + 20,
      width: 20,
    });
  });

  it("measures wrapped tab selections from their full-line column", () => {
    const content = "ab\tcd";
    const lines = [content];
    const tabAwareMeasure = (text: string) => {
      let width = 0;
      let column = 0;
      for (const char of text) {
        if (char === "\t") {
          const remainder = column % 4;
          const spaces = remainder === 0 ? 4 : 4 - remainder;
          width += spaces * 10;
          column += spaces;
        } else {
          width += 10;
          column++;
        }
      }
      return width;
    };
    const segment = {
      viewLine: 0,
      modelLine: 0,
      startColumn: 2,
      endColumn: 5,
      top: EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      height: 20,
    };
    const viewLayout = {
      segments: [segment],
      zones: [],
      modelLineStartViewLines: [0],
      modelLineViewLineCounts: [1],
      totalViewLines: 1,
      totalHeight: 20,
      totalZoneHeight: 0,
      getModelLineViewLineCount: () => 1,
      getSegmentForModelPosition: () => segment,
      modelPositionToViewPosition: () => ({
        ...segment,
        column: 2,
        left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        segment,
      }),
      editorPointToModelPosition: () => ({
        ...segment,
        column: 2,
        left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        segment,
      }),
      viewLineToSegment: () => segment,
    };

    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: 2, end: 3 },
      lines,
      lineOffsets: buildLineOffsetMap(content),
      contentLength: content.length,
      lineHeight: 20,
      measureText: tabAwareMeasure,
      viewLayout,
    });

    expect(boxes[0]).toMatchObject({
      top: EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      width: 20,
    });
  });

  it("renders only viewport selection boxes when line text is resolved lazily", () => {
    const lineCount = 100_000;
    const lineOffsets = Array.from({ length: lineCount }, (_, index) => index * 11);
    const boxes = calculateSelectionBoxes({
      selectionOffsets: { start: 0, end: lineOffsets[lineCount - 1] + 10 },
      lines: [],
      lineOffsets,
      contentLength: lineOffsets[lineCount - 1] + 10,
      lineHeight: 20,
      measureText,
      lineTextResolver: (lineIndex) => `line-${String(lineIndex).padStart(5, "0")}`,
      viewportRange: { startLine: 500, endLine: 503 },
    });

    expect(boxes).toHaveLength(3);
    expect(boxes.map((box) => box.top)).toEqual([
      500 * 20 + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      501 * 20 + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      502 * 20 + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
    ]);
  });
});
