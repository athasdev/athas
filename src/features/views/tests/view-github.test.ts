import { describe, expect, it, vi } from "vitest";
import {
  buildProjectGitHubApiUrl,
  parseGitHubRepository,
  resolveProjectGitHubRepository,
} from "@/features/views/lib/view-github";

describe("custom view GitHub integration", () => {
  it.each([
    ["https://github.com/athasdev/athas.git", { owner: "athasdev", repo: "athas" }],
    ["git@github.com:athasdev/athas.git", { owner: "athasdev", repo: "athas" }],
    ["github://athasdev/athas", { owner: "athasdev", repo: "athas" }],
  ])("parses GitHub repository references", (value, expected) => {
    expect(parseGitHubRepository(value)).toEqual(expected);
  });

  it("ignores remotes without a usable URL", () => {
    expect(parseGitHubRepository(undefined)).toBeNull();
    expect(parseGitHubRepository("")).toBeNull();
  });

  it("prefers the origin GitHub remote", async () => {
    const loadRemotes = vi.fn().mockResolvedValue([
      { name: "backup", url: "https://github.com/example/backup.git" },
      { name: "origin", url: "git@github.com:athasdev/athas.git" },
    ]);

    await expect(resolveProjectGitHubRepository("/projects/athas", loadRemotes)).resolves.toEqual({
      owner: "athasdev",
      repo: "athas",
    });
  });

  it("builds project-scoped API URLs and rejects unsafe paths", () => {
    const repository = { owner: "athasdev", repo: "athas" };

    expect(buildProjectGitHubApiUrl(repository, "/releases?per_page=100")).toBe(
      "https://api.github.com/repos/athasdev/athas/releases?per_page=100",
    );
    expect(() => buildProjectGitHubApiUrl(repository, "https://example.com/data")).toThrow(
      "invalid endpoint path",
    );
    expect(() => buildProjectGitHubApiUrl(repository, "/../other-repo")).toThrow(
      "invalid endpoint path",
    );
  });
});
