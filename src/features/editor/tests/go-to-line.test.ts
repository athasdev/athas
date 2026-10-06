import { describe, expect, it } from "vite-plus/test";
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
});
