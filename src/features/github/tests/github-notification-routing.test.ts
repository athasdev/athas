import { describe, expect, it } from "vite-plus/test";
import {
  buildGitHubRepositoryRef,
  getGitHubNotificationFallbackUrl,
} from "../utils/github-notification-routing";

describe("GitHub notification repository routing", () => {
  it("rejects malformed repository names", () => {
    expect(buildGitHubRepositoryRef("athasdev/athas/extra")).toBeNull();
    expect(buildGitHubRepositoryRef("../athas")).toBeNull();
  });

  it("routes workflow and release fallbacks to their GitHub surfaces", () => {
    expect(
      getGitHubNotificationFallbackUrl({
        repositoryFullName: "athasdev/athas",
        subjectType: "CheckSuite",
        url: "https://github.com/athasdev/athas",
      }),
    ).toBe("https://github.com/athasdev/athas/actions");
    expect(
      getGitHubNotificationFallbackUrl({
        repositoryFullName: "athasdev/athas",
        subjectType: "Release",
        url: "https://github.com/athasdev/athas",
      }),
    ).toBe("https://github.com/athasdev/athas/releases");
  });

  it("preserves specific notification URLs", () => {
    expect(
      getGitHubNotificationFallbackUrl({
        repositoryFullName: "athasdev/athas",
        subjectType: "Discussion",
        url: "https://github.com/athasdev/athas/discussions/42",
      }),
    ).toBe("https://github.com/athasdev/athas/discussions/42");
  });
});
