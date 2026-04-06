import { describe, expect, it } from "vite-plus/test";
import { parseGitHubEntityLink } from "./github-link-utils";

describe("parseGitHubEntityLink", () => {
  it("parses pull request links with extra path segments and fragments", () => {
    expect(
      parseGitHubEntityLink("https://github.com/athasdev/athas/pull/568/files#diff-123"),
    ).toMatchObject({
      kind: "pullRequest",
      owner: "athasdev",
      repo: "athas",
      number: 568,
    });
  });

  it("parses issue links with trailing slashes", () => {
    expect(parseGitHubEntityLink("https://github.com/athasdev/athas/issues/570/")).toMatchObject({
      kind: "issue",
      owner: "athasdev",
      repo: "athas",
      number: 570,
    });
  });

  it("parses action run links", () => {
    expect(
      parseGitHubEntityLink("https://github.com/athasdev/athas/actions/runs/23614391340"),
    ).toMatchObject({
      kind: "actionRun",
      owner: "athasdev",
      repo: "athas",
      runId: 23614391340,
    });
  });

  it("accepts www.github.com links", () => {
    expect(parseGitHubEntityLink("https://www.github.com/athasdev/athas/pull/568")).toMatchObject({
      kind: "pullRequest",
      owner: "athasdev",
      repo: "athas",
      number: 568,
    });
  });

  it("rejects non-GitHub hosts and malformed entity ids", () => {
    expect(parseGitHubEntityLink("https://example.com/athasdev/athas/pull/568")).toBeNull();
    expect(parseGitHubEntityLink("https://github.com/athasdev/athas/pull/not-a-number")).toBeNull();
  });
});
