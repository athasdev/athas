import { describe, expect, it } from "vite-plus/test";
import {
  buildGitHubRepositoryRef,
  getGitHubNotificationFallbackUrl,
  getGitHubNotificationTarget,
} from "../utils/github-notification-routing";

const workflowNotification = {
  id: "notification-1",
  title: "CI workflow run",
  subjectType: "CheckSuite",
  reason: "ci_activity",
  unread: true,
  updatedAt: "2026-08-14T12:00:00Z",
  lastReadAt: null,
  repositoryFullName: "athasdev/athas",
  url: "https://github.com/athasdev/athas",
  subjectUrl: "https://api.github.com/repos/athasdev/athas/check-suites/501857806",
};

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

  it("routes unresolved workflow notifications to the native action viewer", () => {
    expect(getGitHubNotificationTarget(workflowNotification)).toEqual({
      type: "actionNotification",
      repoPath: "github://athasdev/athas",
      notification: {
        id: "notification-1",
        repositoryFullName: "athasdev/athas",
        checkSuiteId: 501857806,
        title: "CI workflow run",
        updatedAt: "2026-08-14T12:00:00Z",
      },
    });
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
