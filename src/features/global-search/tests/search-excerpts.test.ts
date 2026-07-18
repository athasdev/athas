import { describe, expect, it } from "vite-plus/test";
import type { FileSearchResult } from "@/features/file-search/lib/file-search-api";
import { buildSearchExcerpts } from "../utils/search-excerpts";

const result: FileSearchResult = {
  file_path: "/project/src/search.ts",
  total_matches: 2,
  matches: [
    {
      line_number: 3,
      line_content: "const needle = needleValue;",
      column_start: 6,
      column_end: 12,
      match_ranges: [
        { start: 6, end: 12 },
        { start: 15, end: 21 },
      ],
      context_before: ["import value from 'value';", ""],
      context_after: ["export default needle;"],
    },
    {
      line_number: 8,
      line_content: "needle();",
      column_start: 0,
      column_end: 6,
      match_ranges: [{ start: 0, end: 6 }],
      context_before: [""],
      context_after: [],
    },
  ],
};

describe("global search excerpts", () => {
  it("builds stable paths, line mappings, and multiple highlights per matching line", () => {
    const [excerpt] = buildSearchExcerpts([result], "/project", 10);

    expect(excerpt?.displayPath).toBe("src/search.ts");
    expect(excerpt?.lineNumberMap).toEqual([1, 2, 3, 4, null, 7, 8]);
    expect(excerpt?.highlights).toHaveLength(3);
    expect(excerpt?.matches[0]?.highlightIndexes).toEqual([0, 1]);
    expect(excerpt?.matches[0]?.targetColumn).toBe(7);
  });

  it("limits rendered matching lines without discarding the backend count", () => {
    const [excerpt] = buildSearchExcerpts([result], "/project", 1);

    expect(excerpt?.matches).toHaveLength(1);
    expect(excerpt?.matchCount).toBe(2);
    expect(excerpt?.content).not.toContain("needle();");
  });

  it("uses fresh source content when context is expanded", () => {
    const sourceContent = [
      "line 1",
      "line 2",
      "const needle = needleValue;",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "needle();",
      "line 9",
    ].join("\n");
    const [excerpt] = buildSearchExcerpts([result], "/project", 10, {
      contextLinesByFile: { [result.file_path]: 2 },
      sourceContentByPath: { [result.file_path]: sourceContent },
    });

    expect(excerpt?.content).toContain("line 5\nline 6\nline 7\nneedle();\nline 9");
  });

  it("adds a navigator-prioritized file without rendering every preceding match", () => {
    const prioritizedResult: FileSearchResult = {
      file_path: "/project/src/other.ts",
      total_matches: 1,
      matches: [
        {
          line_number: 1,
          line_content: "needle();",
          column_start: 0,
          column_end: 6,
          match_ranges: [{ start: 0, end: 6 }],
        },
      ],
    };
    const excerpts = buildSearchExcerpts([result, prioritizedResult], "/project", 1, {
      prioritizedFilePath: prioritizedResult.file_path,
      prioritizedMatchLimit: 1,
    });

    expect(excerpts.map((excerpt) => excerpt.filePath)).toEqual([
      result.file_path,
      prioritizedResult.file_path,
    ]);
    expect(excerpts).toHaveLength(2);
  });
});
