import { describe, expect, it } from "vite-plus/test";
import { buildGitHubWorkPrompt } from "@/features/ai/lib/github-work-prompt";

const issue = {
  kind: "issue" as const,
  number: 123,
  title: "Crash when opening a remote folder",
  url: "https://github.com/athasdev/athas/issues/123",
  updatedAt: "2026-10-10T00:00:00Z",
};
const pullRequest = {
  kind: "pull-request" as const,
  number: 45,
  title: "Cache agent models",
  url: "https://github.com/athasdev/athas/pull/45",
  updatedAt: "2026-10-10T00:00:00Z",
  headRef: "cache-models",
  baseRef: "main",
};

describe("buildGitHubWorkPrompt", () => {
  it("names the issue, links it and includes its description", () => {
    expect(buildGitHubWorkPrompt(issue, { body: "  Steps to reproduce  " })).toBe(
      [
        "Work on issue #123: Crash when opening a remote folder",
        "https://github.com/athasdev/athas/issues/123",
        "",
        "Description:",
        "Steps to reproduce",
      ].join("\n"),
    );
  });

  it("leaves the description out when there is none", () => {
    expect(buildGitHubWorkPrompt(issue, { body: "" })).toBe(
      "Work on issue #123: Crash when opening a remote folder\nhttps://github.com/athasdev/athas/issues/123",
    );
  });

  it("tells the agent where the pull request branch stands", () => {
    expect(buildGitHubWorkPrompt(pullRequest, { branch: "checked-out" })).toContain(
      "Athas checked out `cache-models` (into `main`)",
    );
    expect(buildGitHubWorkPrompt(pullRequest, { branch: "dirty" })).toContain(
      "did not switch to it; ask before switching branches",
    );
    expect(buildGitHubWorkPrompt(pullRequest, { branch: "failed" })).toContain(
      "`gh pr checkout 45`",
    );
  });

  it("shortens very long descriptions", () => {
    const prompt = buildGitHubWorkPrompt(issue, { body: "x".repeat(5000) });
    expect(prompt).toContain("[Description shortened; read the rest at the link above.]");
    expect(prompt.length).toBeLessThan(4300);
  });
});
