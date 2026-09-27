import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  head: vi.fn<(repo: string, commit: string, path: string) => Promise<string>>(),
}));

vi.mock("@/features/file-system/controllers/file-operations", () => ({
  readFileContent: (path: string) => {
    const content = mocks.files.get(path);
    return content === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(content);
  },
}));
vi.mock("@/features/git/api/git-diff-api", () => ({ getCommitFileContent: mocks.head }));
vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: "/repo" }) },
}));

import { resolveToolEditDiff, snapshotToolEdit } from "@/features/ai/lib/edit-diff-capture";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";

const edit = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: "call-1",
  name: "Edit",
  kind: "edit",
  input: { file_path: "src/a.ts" },
  timestamp: new Date(0),
  ...overrides,
});

describe("edit diff capture", () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.head.mockReset();
  });

  it("diffs the file before and after an edit the agent did not describe", async () => {
    mocks.files.set("/repo/src/a.ts", "old\n");
    await snapshotToolEdit(edit());
    mocks.files.set("/repo/src/a.ts", "new\n");

    await expect(resolveToolEditDiff(edit({ isComplete: true }))).resolves.toEqual([
      { type: "diff", path: "/repo/src/a.ts", oldText: "old\n", newText: "new\n" },
    ]);
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it("falls back to HEAD when the call was reported after the fact", async () => {
    mocks.files.set("/repo/src/a.ts", "new\n");
    mocks.head.mockResolvedValue("committed\n");

    await expect(resolveToolEditDiff(edit({ id: "call-2" }))).resolves.toEqual([
      { type: "diff", path: "/repo/src/a.ts", oldText: "committed\n", newText: "new\n" },
    ]);
    expect(mocks.head).toHaveBeenCalledWith("/repo", "HEAD", "src/a.ts");
  });

  it("leaves calls alone when the agent already sent a diff or nothing changed", async () => {
    const provided = edit({
      id: "call-3",
      output: [{ type: "diff", path: "/repo/src/a.ts", oldText: "", newText: "x" }],
    });
    await expect(resolveToolEditDiff(provided)).resolves.toBeNull();

    mocks.files.set("/repo/src/a.ts", "same\n");
    mocks.head.mockResolvedValue("same\n");
    await expect(resolveToolEditDiff(edit({ id: "call-4" }))).resolves.toBeNull();
    await expect(resolveToolEditDiff(edit({ id: "call-5", kind: "read" }))).resolves.toBeNull();
  });
});
