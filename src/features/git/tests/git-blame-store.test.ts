import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getResolvedGitBlame, type ResolvedGitBlame } from "../api/git-blame-api";
import { createGitBlameStore, getGitBlameCacheKey } from "../stores/git-blame.store";
import type { GitBlame } from "../types/git.types";

vi.mock("../api/git-blame-api", () => ({
  getResolvedGitBlame: vi.fn(),
}));

const mockGetGitBlame = vi.mocked(getResolvedGitBlame);

function createBlame(author: string): GitBlame {
  return {
    file_path: "src/app.ts",
    lines: [
      {
        line_number: 1,
        total_lines: 1,
        commit_hash: "abcdef123456",
        is_uncommitted: false,
        author,
        email: "author@example.com",
        time: 1_700_000_000,
        commit: "Update app",
      },
    ],
  };
}

function deferredBlame() {
  let resolve: (value: ResolvedGitBlame | null) => void = () => {};
  const promise = new Promise<ResolvedGitBlame | null>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("git blame store", () => {
  beforeEach(() => {
    mockGetGitBlame.mockReset();
  });

  it("reuses blame loaded for identical editor content", async () => {
    mockGetGitBlame.mockResolvedValue({
      blame: createBlame("Current"),
      repoPath: "/workspace",
      filePath: "src/app.ts",
    });
    const store = createGitBlameStore();

    await store.getState().actions.loadBlameForFile("/workspace", "src/app.ts", "current");
    await store.getState().actions.loadBlameForFile("/workspace", "src/app.ts", "current");

    expect(mockGetGitBlame).toHaveBeenCalledTimes(1);
    expect(store.getState().blameContent.get(getGitBlameCacheKey("/workspace", "src/app.ts"))).toBe(
      "current",
    );
  });

  it("reloads identical content after repository blame is cleared", async () => {
    mockGetGitBlame.mockResolvedValue({
      blame: createBlame("Current"),
      repoPath: "/workspace",
      filePath: "src/app.ts",
    });
    const store = createGitBlameStore();

    await store.getState().actions.loadBlameForFile("/workspace", "src/app.ts", "current");
    store.getState().actions.clearAllBlame();
    await store.getState().actions.loadBlameForFile("/workspace", "src/app.ts", "current");

    expect(mockGetGitBlame).toHaveBeenCalledTimes(2);
    expect(
      store.getState().blameData.get(getGitBlameCacheKey("/workspace", "src/app.ts"))?.lines[0]
        ?.author,
    ).toBe("Current");
  });

  it("does not let an older request replace blame for newer content", async () => {
    const older = deferredBlame();
    const newer = deferredBlame();
    mockGetGitBlame.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const store = createGitBlameStore();

    const olderRequest = store
      .getState()
      .actions.loadBlameForFile("/workspace", "src/app.ts", "older");
    const newerRequest = store
      .getState()
      .actions.loadBlameForFile("/workspace", "src/app.ts", "newer");

    newer.resolve({
      blame: createBlame("Newer"),
      repoPath: "/workspace",
      filePath: "src/app.ts",
    });
    await newerRequest;
    older.resolve({
      blame: createBlame("Older"),
      repoPath: "/workspace",
      filePath: "src/app.ts",
    });
    await olderRequest;

    const cacheKey = getGitBlameCacheKey("/workspace", "src/app.ts");
    expect(store.getState().blameContent.get(cacheKey)).toBe("newer");
    expect(store.getState().blameData.get(cacheKey)?.lines[0]?.author).toBe("Newer");
  });

  it("does not reuse blame for the same relative path in another repository", async () => {
    mockGetGitBlame
      .mockResolvedValueOnce({
        blame: createBlame("First"),
        repoPath: "/first",
        filePath: "src/app.ts",
      })
      .mockResolvedValueOnce({
        blame: createBlame("Second"),
        repoPath: "/second",
        filePath: "src/app.ts",
      });
    const store = createGitBlameStore();

    await store.getState().actions.loadBlameForFile("/first", "src/app.ts", "same");
    await store.getState().actions.loadBlameForFile("/second", "src/app.ts", "same");

    expect(mockGetGitBlame).toHaveBeenCalledTimes(2);
    expect(
      store.getState().blameData.get(getGitBlameCacheKey("/second", "src/app.ts"))?.lines[0]
        ?.author,
    ).toBe("Second");
  });
});
