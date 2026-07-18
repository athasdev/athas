import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getGitBlame } from "../api/git-blame-api";
import { createGitBlameStore } from "../stores/git-blame.store";
import type { GitBlame } from "../types/git.types";

vi.mock("../api/git-blame-api", () => ({
  getGitBlame: vi.fn(),
}));

const mockGetGitBlame = vi.mocked(getGitBlame);

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
  let resolve: (value: GitBlame | null) => void = () => {};
  const promise = new Promise<GitBlame | null>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("git blame store", () => {
  beforeEach(() => {
    mockGetGitBlame.mockReset();
  });

  it("reuses blame loaded for identical editor content", async () => {
    mockGetGitBlame.mockResolvedValue(createBlame("Current"));
    const store = createGitBlameStore();

    await store.getState().actions.loadBlameForFile("/workspace", "src/app.ts", "current");
    await store.getState().actions.loadBlameForFile("/workspace", "src/app.ts", "current");

    expect(mockGetGitBlame).toHaveBeenCalledTimes(1);
    expect(store.getState().blameContent.get("src/app.ts")).toBe("current");
  });

  it("reloads identical content after repository blame is cleared", async () => {
    mockGetGitBlame.mockResolvedValue(createBlame("Current"));
    const store = createGitBlameStore();

    await store.getState().actions.loadBlameForFile("/workspace", "src/app.ts", "current");
    store.getState().actions.clearAllBlame();
    await store.getState().actions.loadBlameForFile("/workspace", "src/app.ts", "current");

    expect(mockGetGitBlame).toHaveBeenCalledTimes(2);
    expect(store.getState().blameData.get("src/app.ts")?.lines[0]?.author).toBe("Current");
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

    newer.resolve(createBlame("Newer"));
    await newerRequest;
    older.resolve(createBlame("Older"));
    await olderRequest;

    expect(store.getState().blameContent.get("src/app.ts")).toBe("newer");
    expect(store.getState().blameData.get("src/app.ts")?.lines[0]?.author).toBe("Newer");
  });
});
