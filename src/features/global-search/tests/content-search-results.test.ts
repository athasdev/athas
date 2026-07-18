import { describe, expect, it } from "vite-plus/test";
import { buildFileSearchResult, mergeSearchResults } from "../utils/content-search-results";

describe("global content search results", () => {
  it("counts matching lines while retaining every highlight on a line", () => {
    const result = buildFileSearchResult(
      "/project/src/file.ts",
      "needle and needle\nother\nneedle",
      /needle/g,
      1,
    );

    expect(result?.total_matches).toBe(2);
    expect(result?.matches[0]?.match_ranges).toEqual([
      { start: 0, end: 6 },
      { start: 11, end: 17 },
    ]);
    expect(result?.matches[0]?.context_after).toEqual(["other"]);
    expect(result?.matches[1]?.context_before).toEqual(["other"]);
  });

  it("skips binary content", () => {
    expect(buildFileSearchResult("/project/image.bin", "before\0after", /after/g, 2)).toBeNull();
  });

  it("merges paged results for the same file without reordering files", () => {
    const firstPage = buildFileSearchResult("/project/a.ts", "needle", /needle/g, 0);
    const secondPage = buildFileSearchResult("/project/a.ts", "needle\nneedle", /needle/g, 0);
    const otherFile = buildFileSearchResult("/project/b.ts", "needle", /needle/g, 0);

    const merged = mergeSearchResults([firstPage!], [secondPage!, otherFile!]);

    expect(merged.map((result) => result.file_path)).toEqual(["/project/a.ts", "/project/b.ts"]);
    expect(merged[0]?.total_matches).toBe(3);
    expect(merged[0]?.matches).toHaveLength(3);
  });
});
