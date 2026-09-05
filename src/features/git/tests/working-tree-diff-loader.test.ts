import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff } from "../types/git.types";

const mocks = vi.hoisted(() => ({ getState: vi.fn(), getFileDiff: vi.fn() }));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: mocks.getState },
}));
vi.mock("../api/git-diff-api", () => ({ getFileDiff: mocks.getFileDiff }));

import { loadWorkingTreeDiffsProgressively } from "../services/working-tree-diff-loader";
import * as helpers from "../utils/git-diff-helpers";

describe("progressive working tree diffs", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("counts each loaded batch once and preserves the current selection", async () => {
    const count = vi.spyOn(helpers, "countDiffStats");
    let data: Partial<MultiFileDiff> = {
      repoPath: "/repo",
      commitHash: "working-tree",
      files: [],
      selectedFileKey: "unstaged:1.ts",
    };
    const update = vi.fn((id: string, content: string, dirty: boolean, next: MultiFileDiff) => {
      data = next;
    });
    mocks.getState.mockImplementation(() => ({
      buffers: [{ id: "review", type: "diff", diffData: data }],
      actions: { updateBufferContent: update },
    }));
    mocks.getFileDiff.mockImplementation(async (repo: string, path: string): Promise<GitDiff> => ({
      file_path: path,
      is_new: false,
      is_deleted: false,
      is_renamed: false,
      additions: 2,
      deletions: 1,
      lines: [{ line_type: "added", content: "+line" }],
    }));
    await loadWorkingTreeDiffsProgressively({
      repoPath: "/repo",
      bufferId: "review",
      title: "Changes",
      diffEntries: Array.from({ length: 24 }, (_, index) => [
        `unstaged:${index}.ts`,
        { path: `${index}.ts`, staged: false, status: "modified" },
      ]),
    });
    expect(count.mock.calls.map(([diffs]) => diffs.length)).toEqual([0, 8, 8, 8]);
    expect(data).toMatchObject({
      totalFiles: 24,
      totalAdditions: 48,
      totalDeletions: 24,
      selectedFileKey: "unstaged:1.ts",
      isLoading: false,
      indexingProgress: { processed: 24, total: 24 },
    });
  });
});
