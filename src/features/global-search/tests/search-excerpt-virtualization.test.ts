import { describe, expect, it } from "vite-plus/test";
import type { SearchExcerpt } from "../utils/search-excerpts";
import { estimateSearchExcerptHeight } from "../utils/search-excerpt-virtualization";

function createExcerpt(id: string, lineCount: number): SearchExcerpt {
  return {
    id,
    filePath: id,
    displayPath: id,
    fileName: id,
    directoryPath: "",
    content: Array.from({ length: lineCount }, () => "line").join("\n"),
    lineNumberMap: Array.from({ length: lineCount }, (_, index) => index + 1),
    matches: [],
    matchCount: 0,
    highlights: [],
  };
}

describe("search excerpt sizing", () => {
  it("calculates a stable height from the editor line height and section chrome", () => {
    expect(estimateSearchExcerptHeight(createExcerpt("file.ts", 5), 20)).toBe(146);
    expect(estimateSearchExcerptHeight(undefined, 20)).toBe(66);
  });
});
