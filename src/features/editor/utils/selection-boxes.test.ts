import { describe, expect, it } from "vite-plus/test";
import { EDITOR_CONSTANTS } from "../config/constants";
import { buildLineOffsetMap } from "./html";
import { calculateSelectionBoxes } from "./selection-boxes";

const measureText = (text: string) => text.length * 8;

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
});
