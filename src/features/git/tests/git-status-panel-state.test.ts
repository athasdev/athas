import { describe, expect, test } from "vite-plus/test";
import type { GitFile } from "../types/git-types";
import {
  applyOptimisticStageMap,
  getGitFileDiffStats,
  getGitFileRowKey,
} from "../utils/git-status-panel-state";

const createFile = (
  path: string,
  staged: boolean,
  status: GitFile["status"] = "modified",
): GitFile => ({
  path,
  staged,
  status,
});

describe("git status panel state", () => {
  test("resolves row keys by staged state and path", () => {
    expect(getGitFileRowKey(createFile("src/a.ts", true))).toBe("staged:src/a.ts");
    expect(getGitFileRowKey(createFile("src/a.ts", false))).toBe("unstaged:src/a.ts");
  });

  test("prefers exact diff stats for a row before falling back to the sibling entry", () => {
    const file = createFile("src/a.ts", false);

    expect(
      getGitFileDiffStats(file, {
        "staged:src/a.ts": { additions: 1, deletions: 2 },
        "unstaged:src/a.ts": { additions: 3, deletions: 4 },
      }),
    ).toEqual({ additions: 3, deletions: 4 });
  });

  test("falls back to the sibling diff stats when the exact row is missing", () => {
    expect(
      getGitFileDiffStats(createFile("src/a.ts", true), {
        "unstaged:src/a.ts": { additions: 3, deletions: 4 },
      }),
    ).toEqual({ additions: 3, deletions: 4 });
  });

  test("applies optimistic state for a file that only has one row", () => {
    expect(
      applyOptimisticStageMap([createFile("src/a.ts", false)], {
        "unstaged:src/a.ts": true,
      }),
    ).toEqual([createFile("src/a.ts", true)]);
  });

  test("does not collapse mixed staged and unstaged rows for the same path", () => {
    expect(
      applyOptimisticStageMap([createFile("src/a.ts", true), createFile("src/a.ts", false)], {
        "unstaged:src/a.ts": true,
      }),
    ).toEqual([createFile("src/a.ts", true), createFile("src/a.ts", false)]);
  });
});
