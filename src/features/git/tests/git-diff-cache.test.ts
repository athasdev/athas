import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { GitDiff } from "../types/git.types";
import { gitDiffCache } from "../utils/git-diff-cache";

const diff: GitDiff = {
  file_path: "src/app.ts",
  old_path: "src/app.ts",
  new_path: "src/app.ts",
  is_new: false,
  is_deleted: false,
  is_renamed: false,
  is_binary: false,
  is_image: false,
  lines: [],
};

describe("git diff cache", () => {
  beforeEach(() => gitDiffCache.clear());

  it("fingerprints the full buffer instead of only its prefix", () => {
    const prefix = "a".repeat(1_000);
    const first = `${prefix}:first`;
    const second = `${prefix}:second`;

    gitDiffCache.set("/repo", "src/app.ts", false, diff, first);

    expect(gitDiffCache.get("/repo", "src/app.ts", false, first)).toBe(diff);
    expect(gitDiffCache.get("/repo", "src/app.ts", false, second)).toBeNull();
  });

  it("rejects stale results after repository invalidation", () => {
    const generation = gitDiffCache.getGeneration("/repo");
    gitDiffCache.invalidate("/repo");

    expect(gitDiffCache.set("/repo", "src/app.ts", false, diff, undefined, generation)).toBe(false);
    expect(gitDiffCache.get("/repo", "src/app.ts", false)).toBeNull();
  });
});
