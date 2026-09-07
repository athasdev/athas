import { describe, expect, it } from "vite-plus/test";
import {
  getGitHubBranchUrl,
  getGitHubCommitUrl,
  getGitHubCompareUrl,
  getGitHubLabelUrl,
  getGitHubMilestoneUrl,
  getGitHubUserUrl,
  getGitHubWorkflowRunsUrl,
  getRepositoryUrlFromEntityUrl,
} from "../utils/github-link-utils";

describe("GitHub entity URLs", () => {
  it("reduces entity links to their repository", () => {
    expect(getRepositoryUrlFromEntityUrl("https://github.com/athasdev/athas/pull/12")).toBe(
      "https://github.com/athasdev/athas",
    );
    expect(
      getRepositoryUrlFromEntityUrl("https://github.com/athasdev/athas/actions/runs/4242/job/1"),
    ).toBe("https://github.com/athasdev/athas");
    expect(getRepositoryUrlFromEntityUrl("https://example.com/a/b")).toBeNull();
    expect(getRepositoryUrlFromEntityUrl("not a url")).toBeNull();
    expect(getRepositoryUrlFromEntityUrl(null)).toBeNull();
  });

  it("builds links for users, branches, commits, labels and milestones", () => {
    const repo = "https://github.com/athasdev/athas/";
    expect(getGitHubUserUrl("mehmet ozgul")).toBe("https://github.com/mehmet%20ozgul");
    expect(getGitHubBranchUrl(repo, "feature/split panes")).toBe(
      "https://github.com/athasdev/athas/tree/feature/split%20panes",
    );
    expect(getGitHubCommitUrl(repo, "bb423c6")).toBe(
      "https://github.com/athasdev/athas/commit/bb423c6",
    );
    expect(getGitHubLabelUrl(repo, "bug", "pulls")).toBe(
      "https://github.com/athasdev/athas/pulls?q=is%3Aopen%20label%3A%22bug%22",
    );
    expect(getGitHubMilestoneUrl(repo, 3)).toBe("https://github.com/athasdev/athas/milestone/3");
    expect(getGitHubWorkflowRunsUrl(repo, "CI")).toBe(
      "https://github.com/athasdev/athas/actions?query=workflow%3A%22CI%22",
    );
    expect(getGitHubCompareUrl(repo, "main", "feat/x")).toBe(
      "https://github.com/athasdev/athas/compare/main...feat%2Fx",
    );
  });
});
