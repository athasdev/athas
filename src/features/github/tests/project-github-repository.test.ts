import { describe, expect, it, vi } from "vitest";
import {
  parseGitHubRepository,
  resolveProjectGitHubRepository,
} from "@/features/github/services/project-github-repository";

describe("project GitHub repository", () => {
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
});
