import { describe, expect, it } from "vite-plus/test";
import {
  createVisibleWhitespaceMask,
  splitVisibleWhitespaceSegments,
} from "../utils/visible-whitespace";

function visibleIndexes(line: string, mode: "none" | "boundary" | "trailing" | "all"): number[] {
  const mask = createVisibleWhitespaceMask(line, mode);
  if (!mask) return [];

  return Array.from(mask.entries())
    .filter(([, marker]) => marker > 0)
    .map(([index]) => index);
}

describe("visible whitespace", () => {
  it("marks every space and tab in all mode", () => {
    expect(visibleIndexes("a b\tc", "all")).toEqual([1, 3]);
  });

  it("marks only trailing whitespace in trailing mode", () => {
    expect(visibleIndexes("  a b\t  ", "trailing")).toEqual([5, 6, 7]);
  });

  it("marks leading, trailing, tab, and repeated internal whitespace in boundary mode", () => {
    expect(visibleIndexes("  a b  c\td ", "boundary")).toEqual([0, 1, 5, 6, 8, 10]);
  });

  it("splits visible whitespace without changing text content", () => {
    const line = "a b\tc";
    const mask = createVisibleWhitespaceMask(line, "all");
    const segments = splitVisibleWhitespaceSegments(line, 0, line.length, mask);

    expect(segments.map((segment) => segment.text).join("")).toBe(line);
    expect(segments.map((segment) => segment.kind)).toEqual([null, "space", null, "tab", null]);
  });
});
