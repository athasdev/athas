import { describe, expect, it } from "vite-plus/test";
import type { FffSearchHit } from "../lib/file-search-api";
import {
  categorizeFileSearchHits,
  categorizeFuzzyFileSearch,
  indexRecentSearchFiles,
} from "../utils/categorize-file-search-results";

const context = {
  activeBufferPath: "/workspace/active.ts",
  openBufferPaths: new Set(["/workspace/open.ts"]),
  recentFilePaths: new Set(["/workspace/recent.ts"]),
  recentFileIndices: new Map([["/workspace/recent.ts", 0]]),
};

describe("file search result categorization", () => {
  it("indexes recent files while excluding the active buffer from the recent bucket", () => {
    const indexed = indexRecentSearchFiles(
      [{ path: "/workspace/active.ts" }, { path: "/workspace/recent.ts" }],
      "/workspace/active.ts",
    );

    expect([...indexed.recentFilePaths]).toEqual(["/workspace/recent.ts"]);
    expect([...indexed.recentFileIndices]).toEqual([
      ["/workspace/active.ts", 0],
      ["/workspace/recent.ts", 1],
    ]);
  });

  it("categorizes backend hits by open and recent state", () => {
    const hits = [
      { name: "open.ts", path: "/workspace/open.ts" },
      { name: "recent.ts", path: "/workspace/recent.ts" },
      { name: "other.ts", path: "/workspace/other.ts" },
      { name: "active.ts", path: "/workspace/active.ts" },
    ] as FffSearchHit[];

    expect(categorizeFileSearchHits(hits, context)).toEqual({
      openBufferFiles: [{ name: "open.ts", path: "/workspace/open.ts", isDir: false }],
      recentFilesInResults: [{ name: "recent.ts", path: "/workspace/recent.ts", isDir: false }],
      otherFiles: [{ name: "other.ts", path: "/workspace/other.ts", isDir: false }],
    });
  });

  it("uses the owning surface scorer while preserving category priority", () => {
    const files = [
      { name: "other.ts", path: "/workspace/other.ts", isDir: false },
      { name: "recent.ts", path: "/workspace/recent.ts", isDir: false },
      { name: "open.ts", path: "/workspace/open.ts", isDir: false },
    ];
    const scoreText = (text: string) => (text.endsWith(".ts") ? 10 : 0);

    expect(categorizeFuzzyFileSearch(files, "ts", scoreText, context)).toEqual({
      openBufferFiles: [files[2]],
      recentFilesInResults: [files[1]],
      otherFiles: [files[0]],
    });
  });
});
