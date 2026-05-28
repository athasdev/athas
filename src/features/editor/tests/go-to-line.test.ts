import { describe, expect, it } from "vite-plus/test";
import { getLargeEditorModeInfo } from "../utils/large-file";
import { resolveGoToLineTarget } from "../utils/go-to-line";

describe("resolveGoToLineTarget", () => {
  it("clamps one-based line and column requests", () => {
    const content = "alpha\nbeta";

    expect(
      resolveGoToLineTarget({
        content,
        lineNumber: 99,
        columnNumber: 99,
        lineCount: 2,
      }),
    ).toEqual({
      line: 1,
      column: 4,
      offset: content.length,
    });
  });

  it("uses line offsets for large content without scanning from the start", () => {
    const content = Array.from({ length: 80_000 }, (_, index) => `line-${index}`).join("\n");
    const info = getLargeEditorModeInfo(content);

    expect(
      resolveGoToLineTarget({
        content,
        lineNumber: 75_000,
        columnNumber: 5,
        lineCount: info.lineCount,
        lineOffsets: info.lineOffsets,
      }),
    ).toEqual({
      line: 74_999,
      column: 4,
      offset: (info.lineOffsets?.[74_999] ?? 0) + 4,
    });
  });
});
