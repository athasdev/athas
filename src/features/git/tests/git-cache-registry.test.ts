import { describe, expect, it, vi } from "vite-plus/test";
import { invalidateGitCaches, registerGitCacheInvalidator } from "../runtime/git-cache-registry";

describe("git cache registry", () => {
  it("replaces an invalidator registered again under the same id", () => {
    const first = vi.fn();
    const reloaded = vi.fn();
    registerGitCacheInvalidator("test-cache", first);
    const unregister = registerGitCacheInvalidator("test-cache", reloaded);

    invalidateGitCaches({ repoPath: "/repo" });
    expect(first).not.toHaveBeenCalled();
    expect(reloaded).toHaveBeenCalledWith({ repoPath: "/repo" });

    unregister();
    invalidateGitCaches({});
    expect(reloaded).toHaveBeenCalledTimes(1);
  });
});
