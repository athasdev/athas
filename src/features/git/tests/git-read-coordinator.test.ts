import { describe, expect, it, vi } from "vite-plus/test";
import { invalidateGitCaches } from "../runtime/git-cache-registry";
import { runGitRead } from "../runtime/git-read-coordinator";

describe("git read coordinator", () => {
  it("shares concurrent reads for the same repository query", async () => {
    const read = vi.fn().mockResolvedValue(["main"]);

    const [first, second] = await Promise.all([
      runGitRead("/repo", "branches", read),
      runGitRead("/repo", "branches", read),
    ]);

    expect(first).toEqual(["main"]);
    expect(second).toEqual(["main"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries a read invalidated while it is in flight", async () => {
    let resolveFirst: (value: string[]) => void = () => {};
    const first = new Promise<string[]>((resolve) => {
      resolveFirst = resolve;
    });
    const read = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(["new"]);

    const request = runGitRead("/changed-repo", "branches", read);
    invalidateGitCaches({ repoPath: "/changed-repo" });
    resolveFirst(["old"]);

    await expect(request).resolves.toEqual(["new"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate ref and history reads for working-tree-only changes", async () => {
    let resolveRead: (value: string[]) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const request = runGitRead("/working-tree-repo", "branches", read);
    invalidateGitCaches({
      repoPath: "/working-tree-repo",
      scopes: ["working-tree"],
    });
    resolveRead(["main"]);

    await expect(request).resolves.toEqual(["main"]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
