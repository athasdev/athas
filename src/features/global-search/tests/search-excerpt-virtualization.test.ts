import { describe, expect, it } from "vite-plus/test";
import type { SearchExcerpt } from "../utils/search-excerpts";
import {
  estimateSearchExcerptHeight,
  shouldVirtualizeSearchExcerpts,
} from "../utils/search-excerpt-virtualization";

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

describe("search excerpt virtualization", () => {
  it("keeps small result sets in normal document flow", () => {
    expect(shouldVirtualizeSearchExcerpts([createExcerpt("small.ts", 20)])).toBe(false);
  });

  it("virtualizes many files or a few line-heavy excerpts", () => {
    const manyFiles = Array.from({ length: 13 }, (_, index) =>
      createExcerpt(`file-${index}.ts`, 5),
    );
    const lineHeavy = [createExcerpt("large.ts", 241)];

    expect(shouldVirtualizeSearchExcerpts(manyFiles)).toBe(true);
    expect(shouldVirtualizeSearchExcerpts(lineHeavy)).toBe(true);
  });

  it("calculates a stable height from the editor line height and section chrome", () => {
    expect(estimateSearchExcerptHeight(createExcerpt("file.ts", 5), 20)).toBe(146);
    expect(estimateSearchExcerptHeight(createExcerpt("file.ts", 5), 24)).toBe(166);
  });
});
