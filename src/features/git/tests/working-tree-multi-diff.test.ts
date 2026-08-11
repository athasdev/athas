import { describe, expect, test } from "vite-plus/test";
import type { GitDiff, GitFile, GitStatus } from "../types/git.types";
import {
  buildWorkingTreeMultiDiff,
  createSingleFileWorkingTreeDiff,
  getDiffableWorkingTreeFiles,
  reconcileWorkingTreeFiles,
} from "../utils/working-tree-multi-diff";

const createFile = (
  path: string,
  staged: boolean,
  status: GitFile["status"] = "modified",
): GitFile => ({
  path,
  staged,
  status,
});

describe("working-tree multi diff helpers", () => {
  test("creates a one-file working-tree selection", () => {
    const diff: GitDiff = {
      file_path: "src/selected.ts",
      is_new: false,
      is_deleted: false,
      is_renamed: false,
      is_image: false,
      additions: 4,
      deletions: 2,
      lines: [],
    };

    expect(
      createSingleFileWorkingTreeDiff({
        repoPath: "/repo",
        fileKey: "unstaged:src/selected.ts",
        diff,
      }),
    ).toMatchObject({
      title: "Uncommitted Changes",
      repoPath: "/repo",
      commitHash: "working-tree",
      files: [diff],
      fileKeys: ["unstaged:src/selected.ts"],
      initiallyExpandedFileKey: "unstaged:src/selected.ts",
      totalFiles: 1,
      totalAdditions: 4,
      totalDeletions: 2,
      isLoading: false,
    });
  });

  test("filters out untracked files and duplicate entries", () => {
    const status: GitStatus = {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [
        createFile("src/a.ts", false),
        createFile("src/a.ts", false),
        createFile("src/b.ts", true),
        createFile("src/c.ts", false, "untracked"),
      ],
    };

    expect(getDiffableWorkingTreeFiles(status)).toEqual([
      createFile("src/a.ts", false),
      createFile("src/b.ts", true),
    ]);
  });

  test("preserves order and swaps a missing unstaged entry to the staged counterpart", () => {
    const nextFiles = reconcileWorkingTreeFiles(
      [createFile("src/a.ts", true), createFile("src/b.ts", false), createFile("src/c.ts", false)],
      ["unstaged:src/a.ts", "unstaged:src/b.ts"],
    );

    expect(nextFiles).toEqual([
      createFile("src/a.ts", true),
      createFile("src/b.ts", false),
      createFile("src/c.ts", false),
    ]);
  });

  test("builds a working-tree diff using reconciled file keys", async () => {
    const status: GitStatus = {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [createFile("src/a.ts", true), createFile("src/b.ts", false)],
    };

    const loadDiff = async (
      _repoPath: string,
      filePath: string,
      staged?: boolean,
    ): Promise<GitDiff | null> => ({
      file_path: filePath,
      is_new: false,
      is_deleted: false,
      is_renamed: false,
      is_image: false,
      lines: [
        { line_type: "header", content: "@@ -1,1 +1,1 @@" },
        {
          line_type: staged ? "removed" : "added",
          content: staged ? "-old" : "+new",
          old_line_number: 1,
          new_line_number: 1,
        },
      ],
    });

    const result = await buildWorkingTreeMultiDiff({
      repoPath: "/repo",
      status,
      previousFileKeys: ["unstaged:src/a.ts"],
      loadDiff,
    });

    expect(result.commitHash).toBe("working-tree");
    expect(result.repoPath).toBe("/repo");
    expect(result.fileKeys).toEqual(["staged:src/a.ts", "unstaged:src/b.ts"]);
    expect(result.totalFiles).toBe(2);
    expect(result.totalAdditions).toBe(1);
    expect(result.totalDeletions).toBe(1);
  });

  test("keeps non-image binary changes in the working-tree diff", async () => {
    const status: GitStatus = {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [createFile("payload.bin", false)],
    };

    const result = await buildWorkingTreeMultiDiff({
      repoPath: "/repo",
      status,
      loadDiff: async () => ({
        file_path: "payload.bin",
        is_new: false,
        is_deleted: false,
        is_renamed: false,
        is_binary: true,
        is_image: false,
        lines: [],
      }),
    });

    expect(result.fileKeys).toEqual(["unstaged:payload.bin"]);
    expect(result.totalFiles).toBe(1);
  });
});
