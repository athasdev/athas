import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getCommitDiff,
  getCommitFileContent,
  getFileDiff,
  getRefDiff,
  getStashDiff,
  getStatusDiffStats,
  invalidateGitDiffData,
} from "../api/git-diff-api";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";
import { emitGitChanged } from "../events/git-events";
import { gitDiffCache } from "../services/git-diff-cache";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;
let now: number;

function diff(filePath: string, lines: unknown[] = [{ line_type: "added", content: "x" }]) {
  return {
    file_path: filePath,
    old_path: null,
    new_path: filePath,
    is_binary: false,
    is_deleted: false,
    is_new: false,
    is_renamed: false,
    lines,
  };
}

function count(command: string) {
  return mockInvoke.mock.calls.filter(([name]) => name === command).length;
}

describe("git diff api caching", () => {
  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    clearRepositoryDiscoveryCache();
    invalidateGitDiffData();
    mockInvoke.mockReset();
    handlers = {
      git_discover_repo: ({ path }) => (path.startsWith("/repo") ? "/repo" : null),
      git_commit_diff: ({ commitHash }) => [diff(`${commitHash}.ts`)],
      git_ref_diff: ({ baseRef, targetRef }) => [diff(`${baseRef}-${targetRef}.ts`)],
      git_stash_diff: ({ stashIndex }) => [diff(`stash-${stashIndex}.ts`)],
      git_diff_file: ({ filePath, staged }) => diff(`${staged ? "s" : "u"}:${filePath}`),
      git_file_at_commit: ({ commitHash, filePath }) => `${commitHash}:${filePath}`,
      git_status_diff_stats: () => [
        { file_path: "a.ts", additions: 1, deletions: 2, staged: false },
      ],
    };
    mockInvoke.mockImplementation(async (command, args) => {
      const handler = handlers[command];
      if (!handler) return null;
      return handler((args ?? {}) as Record<string, any>);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches commit, ref and stash diffs per repository for 30 seconds", async () => {
    await expect(getCommitDiff("/repo/src", "abc")).resolves.toEqual([diff("abc.ts")]);
    await getCommitDiff("/repo", "abc");
    await expect(getRefDiff("/repo", "main", "dev")).resolves.toEqual([diff("main-dev.ts")]);
    await getRefDiff("/repo", "main", "dev");
    await expect(getStashDiff("/repo", 2)).resolves.toEqual([diff("stash-2.ts")]);
    await getStashDiff("/repo", 2);

    expect(count("git_commit_diff")).toBe(1);
    expect(count("git_ref_diff")).toBe(1);
    expect(count("git_stash_diff")).toBe(1);
    expect(mockInvoke).toHaveBeenCalledWith("git_commit_diff", {
      repoPath: "/repo",
      commitHash: "abc",
      filePath: null,
    });

    now += 30_001;
    await getCommitDiff("/repo", "abc");
    await getRefDiff("/repo", "main", "dev");
    await getStashDiff("/repo", 2);

    expect(count("git_commit_diff")).toBe(2);
    expect(count("git_ref_diff")).toBe(2);
    expect(count("git_stash_diff")).toBe(2);
  });

  it("drops multi-file diff caches when the repository changes", async () => {
    await getCommitDiff("/repo", "abc");
    await getStashDiff("/repo", 0);

    emitGitChanged({ repoPath: "/repo", scopes: ["history"] });
    await getCommitDiff("/repo", "abc");
    await getStashDiff("/repo", 0);

    expect(count("git_commit_diff")).toBe(2);
    expect(count("git_stash_diff")).toBe(2);
  });

  it("keeps multi-file diff caches when only one file changed", async () => {
    await getCommitDiff("/repo", "abc");

    invalidateGitDiffData("/repo", "src/a.ts");
    await getCommitDiff("/repo", "abc");

    expect(count("git_commit_diff")).toBe(1);
  });

  it("re-reads a history diff invalidated while it was loading", async () => {
    let calls = 0;
    handlers.git_ref_diff = async () => {
      calls += 1;
      const call = calls;
      await Promise.resolve();
      if (call === 1) invalidateGitDiffData("/repo");
      return [diff(`call-${call}.ts`)];
    };

    await expect(getRefDiff("/repo", "main", "dev")).resolves.toEqual([diff("call-2.ts")]);
  });

  it("returns null outside a repository or when the native diff fails", async () => {
    await expect(getCommitDiff("/elsewhere", "abc")).resolves.toBeNull();
    await expect(getRefDiff("/elsewhere", "a", "b")).resolves.toBeNull();
    await expect(getStashDiff("/elsewhere", 0)).resolves.toBeNull();

    handlers.git_commit_diff = () => {
      throw new Error("bad object abc");
    };
    handlers.git_ref_diff = () => {
      throw new Error("unknown revision");
    };
    handlers.git_stash_diff = () => {
      throw new Error("no stash");
    };
    await expect(getCommitDiff("/repo", "abc")).resolves.toBeNull();
    await expect(getRefDiff("/repo", "a", "b")).resolves.toBeNull();
    await expect(getStashDiff("/repo", 0)).resolves.toBeNull();
    expect(vi.mocked(console.error)).toHaveBeenCalledTimes(3);
  });

  it("reads file content at a commit and rejects outside a repository", async () => {
    await expect(getCommitFileContent("/repo", "abc", "src/a.ts")).resolves.toBe("abc:src/a.ts");
    await expect(getCommitFileContent("/elsewhere", "abc", "a.ts")).rejects.toThrow(
      "Repository not found",
    );
  });

  describe("file diffs", () => {
    it("serves repeat requests from cache and keys staged and unstaged separately", async () => {
      await expect(getFileDiff("/repo", "a.ts")).resolves.toEqual(diff("u:a.ts"));
      await expect(getFileDiff("/repo", "a.ts")).resolves.toEqual(diff("u:a.ts"));
      await expect(getFileDiff("/repo", "a.ts", true)).resolves.toEqual(diff("s:a.ts"));

      expect(count("git_diff_file")).toBe(2);
    });

    it("resolves absolute file paths relative to the discovered repository", async () => {
      await getFileDiff("/repo", "/repo/src/a.ts");

      expect(mockInvoke).toHaveBeenCalledWith("git_diff_file", {
        repoPath: "/repo",
        filePath: "src/a.ts",
        staged: false,
      });
    });

    it("misses the cache when the buffer content differs", async () => {
      await getFileDiff("/repo", "a.ts", false, "one");
      await getFileDiff("/repo", "a.ts", false, "one");
      await getFileDiff("/repo", "a.ts", false, "two");

      expect(count("git_diff_file")).toBe(2);
    });

    it("refetches after the file is saved", async () => {
      await getFileDiff("/repo", "a.ts");
      emitGitChanged({ repoPath: "/repo", filePath: "a.ts", scopes: ["working-tree"] });
      await getFileDiff("/repo", "a.ts");

      expect(count("git_diff_file")).toBe(2);
    });

    it("refetches after an invalidation by absolute path without a repository", async () => {
      await getFileDiff("/repo", "a.ts");
      invalidateGitDiffData(undefined, "/repo/a.ts");
      await getFileDiff("/repo", "a.ts");

      expect(count("git_diff_file")).toBe(2);
    });

    it("re-reads a diff invalidated while the native read is in flight", async () => {
      let calls = 0;
      handlers.git_diff_file = async () => {
        calls += 1;
        const call = calls;
        await Promise.resolve();
        if (call === 1) invalidateGitDiffData("/repo", "a.ts");
        return diff(`call-${call}`);
      };

      await expect(getFileDiff("/repo", "a.ts")).resolves.toEqual(diff("call-2"));
      expect(gitDiffCache.get("/repo", "a.ts", false)).toEqual(diff("call-2"));
    });

    it("returns null quietly for clean files and outside repositories", async () => {
      handlers.git_diff_file = () => {
        throw "No changes found for file: a.ts";
      };

      await expect(getFileDiff("/repo", "a.ts")).resolves.toBeNull();
      await expect(getFileDiff("/elsewhere", "a.ts")).resolves.toBeNull();
      expect(console.error).not.toHaveBeenCalled();
    });

    it("logs unexpected diff errors including object errors", async () => {
      handlers.git_diff_file = () => {
        throw { message: "index locked" };
      };

      await expect(getFileDiff("/repo", "a.ts")).resolves.toBeNull();
      expect(console.error).toHaveBeenCalledWith("Failed to get file diff:", {
        message: "index locked",
      });
    });

    it("returns null when repository discovery itself fails", async () => {
      handlers.git_discover_repo = () => {
        throw new Error("permission denied");
      };

      await expect(getFileDiff("/repo", "a.ts")).resolves.toBeNull();
      await expect(getStatusDiffStats("/repo")).resolves.toEqual([]);
      expect(console.error).toHaveBeenCalledTimes(2);
    });
  });

  it("returns no stats outside a repository and on native failure", async () => {
    await expect(getStatusDiffStats("/elsewhere")).resolves.toEqual([]);

    handlers.git_status_diff_stats = () => {
      throw new Error("boom");
    };
    await expect(getStatusDiffStats("/repo")).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to get status diff stats:",
      expect.any(Error),
    );
  });
});

describe("git diff cache", () => {
  let now: number;

  beforeEach(() => {
    now = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    gitDiffCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("expires entries after the TTL", () => {
    gitDiffCache.set("/r", "a.ts", false, diff("a.ts") as never);
    expect(gitDiffCache.get("/r", "a.ts", false)).not.toBeNull();

    now += 30_001;
    expect(gitDiffCache.get("/r", "a.ts", false)).toBeNull();
    expect(gitDiffCache.getStats().size).toBe(0);
  });

  it("refuses writes from a stale generation", () => {
    const generation = gitDiffCache.getGeneration("/r");
    gitDiffCache.invalidate("/r");

    expect(
      gitDiffCache.set("/r", "a.ts", false, diff("a.ts") as never, undefined, generation),
    ).toBe(false);
    expect(gitDiffCache.get("/r", "a.ts", false)).toBeNull();
  });

  it("invalidates every file of one repository but not others", () => {
    gitDiffCache.set("/r", "a.ts", false, diff("a.ts") as never);
    gitDiffCache.set("/r", "b.ts", true, diff("b.ts") as never);
    gitDiffCache.set("/other", "a.ts", false, diff("a.ts") as never);

    gitDiffCache.invalidate("/r");

    expect(gitDiffCache.get("/r", "a.ts", false)).toBeNull();
    expect(gitDiffCache.get("/r", "b.ts", true)).toBeNull();
    expect(gitDiffCache.get("/other", "a.ts", false)).not.toBeNull();
  });

  it("evicts expired then oldest entries once it reaches 100 entries", () => {
    for (let index = 0; index < 100; index++) {
      now += 1;
      gitDiffCache.set("/r", `f${index}.ts`, false, diff(`f${index}.ts`) as never);
    }
    expect(gitDiffCache.getStats().size).toBe(100);

    gitDiffCache.set("/r", "new.ts", false, diff("new.ts") as never);

    const stats = gitDiffCache.getStats();
    expect(stats.size).toBe(71);
    expect(gitDiffCache.get("/r", "f0.ts", false)).toBeNull();
    expect(gitDiffCache.get("/r", "f99.ts", false)).not.toBeNull();
    expect(gitDiffCache.get("/r", "new.ts", false)).not.toBeNull();
  });
});
