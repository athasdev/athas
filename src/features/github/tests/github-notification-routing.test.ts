import { describe, expect, it, vi } from "vite-plus/test";
import {
  buildGitHubRepositoryRef,
  resolveGitHubNotificationRepoPath,
} from "../utils/github-notification-routing";

describe("GitHub notification repository routing", () => {
  it("uses the matching local workspace repository", async () => {
    const loadRemotes = vi.fn(async (repoPath: string) => [
      {
        name: "origin",
        url:
          repoPath === "/workspace/www"
            ? "git@github.com:athasdev/www.git"
            : "https://github.com/athasdev/athas.git",
      },
    ]);

    await expect(
      resolveGitHubNotificationRepoPath(
        "athasdev/www",
        ["/workspace/athas", "/workspace/www"],
        loadRemotes,
      ),
    ).resolves.toBe("/workspace/www");
  });

  it("uses an API-backed repository reference when the repo is not local", async () => {
    const loadRemotes = vi.fn(async () => [
      { name: "origin", url: "https://github.com/athasdev/athas.git" },
    ]);

    await expect(
      resolveGitHubNotificationRepoPath("indent-com/neo", ["/workspace/athas"], loadRemotes),
    ).resolves.toBe("github://indent-com/neo");
  });

  it("rejects malformed repository names", async () => {
    expect(buildGitHubRepositoryRef("athasdev/athas/extra")).toBeNull();
    await expect(resolveGitHubNotificationRepoPath("../athas", [], vi.fn())).resolves.toBeNull();
  });
});
