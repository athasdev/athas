import { describe, expect, it } from "vite-plus/test";
import { isGitChangeRelevant, isPassiveGitChange } from "../events/git-events";

describe("git change relevance", () => {
  it("distinguishes passive file refreshes from explicit Git mutations", () => {
    expect(isPassiveGitChange({ source: "save" })).toBe(true);
    expect(isPassiveGitChange({ source: "external-file-change" })).toBe(true);
    expect(isPassiveGitChange({ source: "stage-hunk" })).toBe(false);
  });

  it("matches a workspace opened inside its containing repository", () => {
    expect(
      isGitChangeRelevant(
        { repoPath: "/repo/packages/app", filePath: "/repo/packages/app/src/main.ts" },
        "/repo",
      ),
    ).toBe(true);
  });

  it("does not refresh unrelated repositories", () => {
    expect(
      isGitChangeRelevant({ repoPath: "/repo-a", filePath: "/repo-a/src/main.ts" }, "/repo-b"),
    ).toBe(false);
  });

  it("matches relative and absolute forms of the same file", () => {
    expect(
      isGitChangeRelevant(
        { repoPath: "/repo", filePath: "src/main.ts" },
        "/repo",
        "/repo/src/main.ts",
      ),
    ).toBe(true);
  });
});
