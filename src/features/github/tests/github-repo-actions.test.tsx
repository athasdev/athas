// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  openUrl: vi.fn(async () => {}),
  openResourceInDetachedWindow: vi.fn(async () => {}),
  writeClipboardText: vi.fn(async () => {}),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: harness.openUrl }));
vi.mock("sonner", () => ({ toast: harness.toast }));
vi.mock("@/features/window/detached/services/detached-resource-service", () => ({
  openResourceInDetachedWindow: harness.openResourceInDetachedWindow,
}));
vi.mock("@/utils/clipboard", () => ({ writeClipboardText: harness.writeClipboardText }));
vi.mock("@/features/github/services/github-token-service", () => ({
  syncGitHubTokenFromAccount: vi.fn(async () => ({ status: "notConnected" })),
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { use: { actions: () => ({}) } },
}));

import { commands } from "@/bindings/commands";
import { getLinkedAccount } from "@/features/auth/services/linked-accounts";
import { subscribeToGitChanges, type GitChange } from "@/features/git/events/git-events";
import { queryClient } from "@/utils/query-client";
import * as actionsApi from "../api/github-actions-api";
import * as issuesApi from "../api/github-issues-api";
import * as pullRequestsApi from "../api/github-pull-requests-api";
import * as deliveryApi from "../delivery/api/github-delivery-api";
import { useNow } from "../hooks/use-now";
import { registerGitHubLinkedAccount } from "../services/github-linked-account";
import {
  checkoutPullRequest,
  openPullRequestInBrowser,
} from "../services/github-pull-request-actions";
import { githubKeys } from "../services/github-queries";
import { copyToClipboard, getRepositoryDisplayName } from "../services/github-viewer-utils";
import { useGitHubStore } from "../stores/github.store";
import { openGitHubContentInNewWindow } from "../utils/open-in-new-window";
import type { PullRequestDetails } from "../types/github.types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Commands = typeof commands;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  queryClient.clear();
  useGitHubStore.getState().actions.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GitHub native command wrappers", () => {
  const calls: Array<[string, () => unknown, keyof Commands, unknown[]]> = [
    [
      "createPullRequest",
      () =>
        pullRequestsApi.createPullRequest("/r", "T", "B", "feat", "main", true, ["bug"], ["me"]),
      "githubCreatePullRequest",
      ["/r", "T", "B", "feat", "main", true, ["bug"], ["me"]],
    ],
    [
      "updatePullRequest",
      () => pullRequestsApi.updatePullRequest("/r", 4, "T", "B", ["l"], ["a"]),
      "githubUpdatePullRequest",
      ["/r", 4, "T", "B", ["l"], ["a"]],
    ],
    [
      "addPullRequestComment",
      () => pullRequestsApi.addPullRequestComment("/r", 4, "hi"),
      "githubAddPrComment",
      ["/r", 4, "hi"],
    ],
    [
      "submitPullRequestReview",
      () => pullRequestsApi.submitPullRequestReview("/r", 4, "APPROVE", "lgtm"),
      "githubSubmitPrReview",
      ["/r", 4, "APPROVE", "lgtm"],
    ],
    [
      "mergePullRequest",
      () => pullRequestsApi.mergePullRequest("/r", 4, "squash"),
      "githubMergePullRequest",
      ["/r", 4, "squash"],
    ],
    [
      "closePullRequestOnGitHub",
      () => pullRequestsApi.closePullRequestOnGitHub("/r", 4),
      "githubClosePullRequest",
      ["/r", 4],
    ],
    ["listIssues", () => issuesApi.listIssues("/r", null), "githubListIssues", ["/r", null]],
    [
      "fetchIssueDetails",
      () => issuesApi.fetchIssueDetails("/r", 9),
      "githubGetIssueDetails",
      ["/r", 9],
    ],
    [
      "listRepositoryLabels",
      () => issuesApi.listRepositoryLabels("/r"),
      "githubListLabels",
      ["/r"],
    ],
    [
      "listRepositoryMilestones",
      () => issuesApi.listRepositoryMilestones("/r"),
      "githubListMilestones",
      ["/r"],
    ],
    [
      "listRepositoryIssueTypes",
      () => issuesApi.listRepositoryIssueTypes("/r"),
      "githubListIssueTypes",
      ["/r"],
    ],
    [
      "createIssue",
      () => issuesApi.createIssue("/r", "T", "B", ["l"], ["a"], 2, "Bug"),
      "githubCreateIssue",
      ["/r", "T", "B", ["l"], ["a"], 2, "Bug"],
    ],
    [
      "editIssue",
      () => issuesApi.editIssue("/r", 9, "T", "B", [], [], null, null),
      "githubUpdateIssue",
      ["/r", 9, "T", "B", [], [], null, null],
    ],
    [
      "setIssueState",
      () => issuesApi.setIssueState("/r", 9, "closed", "completed"),
      "githubUpdateIssueState",
      ["/r", 9, "closed", "completed"],
    ],
    ["lockIssue", () => issuesApi.lockIssue("/r", 9, "spam"), "githubLockIssue", ["/r", 9, "spam"]],
    ["unlockIssue", () => issuesApi.unlockIssue("/r", 9), "githubUnlockIssue", ["/r", 9]],
    [
      "addIssueComment",
      () => issuesApi.addIssueComment("/r", 9, "c"),
      "githubAddIssueComment",
      ["/r", 9, "c"],
    ],
    [
      "updateIssueComment",
      () => issuesApi.updateIssueComment("/r", 77, "c2"),
      "githubUpdateIssueComment",
      ["/r", 77, "c2"],
    ],
    [
      "deleteIssueComment",
      () => issuesApi.deleteIssueComment("/r", 77),
      "githubDeleteIssueComment",
      ["/r", 77],
    ],
    ["listWorkflows", () => actionsApi.listWorkflows("/r"), "githubListWorkflows", ["/r"]],
    [
      "dispatchWorkflow",
      () => actionsApi.dispatchWorkflow("/r", 3, "main"),
      "githubDispatchWorkflow",
      ["/r", 3, "main"],
    ],
    [
      "fetchWorkflowRunDetails",
      () => actionsApi.fetchWorkflowRunDetails("/r", 11),
      "githubGetWorkflowRunDetails",
      ["/r", 11],
    ],
    [
      "fetchWorkflowJobLogs",
      () => actionsApi.fetchWorkflowJobLogs("/r", 12),
      "githubGetWorkflowJobLogs",
      ["/r", 12],
    ],
    [
      "resolveNotificationWorkflowRun",
      () => actionsApi.resolveNotificationWorkflowRun("o/r", null, "CI failed", "2026-01-01"),
      "githubResolveNotificationWorkflowRun",
      ["o/r", null, "CI failed", "2026-01-01"],
    ],
    [
      "rerunWorkflowRun",
      () => actionsApi.rerunWorkflowRun("/r", 11, true),
      "githubRerunWorkflowRun",
      ["/r", 11, true],
    ],
    [
      "cancelWorkflowRun",
      () => actionsApi.cancelWorkflowRun("/r", 11),
      "githubCancelWorkflowRun",
      ["/r", 11],
    ],
    [
      "saveRelease",
      () => deliveryApi.saveRelease("/r", null, { tag: "v1" } as never),
      "githubSaveRelease",
      ["/r", null, { tag: "v1" }],
    ],
    [
      "publishRelease",
      () => deliveryApi.publishRelease("/r", 5, true),
      "githubPublishRelease",
      ["/r", 5, true],
    ],
    ["deleteRelease", () => deliveryApi.deleteRelease("/r", 5), "githubDeleteRelease", ["/r", 5]],
    [
      "generateReleaseNotes",
      () => deliveryApi.generateReleaseNotes("/r", "v2", "main", "v1"),
      "githubGenerateReleaseNotes",
      ["/r", "v2", "main", "v1"],
    ],
    [
      "uploadReleaseAsset",
      () => deliveryApi.uploadReleaseAsset("/r", 5, "/tmp/app.dmg"),
      "githubUploadReleaseAsset",
      ["/r", 5, "/tmp/app.dmg"],
    ],
    [
      "deleteReleaseAsset",
      () => deliveryApi.deleteReleaseAsset("/r", 8),
      "githubDeleteReleaseAsset",
      ["/r", 8],
    ],
    [
      "deactivateDeployment",
      () => deliveryApi.deactivateDeployment("/r", 6),
      "githubDeactivateDeployment",
      ["/r", 6],
    ],
  ];

  const cases = calls.map(([name, call, command, args]) => ({ name, call, command, args }));

  it.each(cases)("$name forwards its arguments in order", async ({ call, command, args }) => {
    const result = { ok: command };
    const nativeCommands = commands as unknown as Record<string, () => Promise<unknown>>;
    const spy = vi.spyOn(nativeCommands, command).mockResolvedValue(result);

    await expect(call()).resolves.toBe(result);
    expect(spy).toHaveBeenCalledWith(...args);
  });
});

describe("pull request actions", () => {
  it("opens the cached pull request URL without asking GitHub again", async () => {
    const details = vi.spyOn(commands, "githubGetPrDetails");
    queryClient.setQueryData(githubKeys.pullRequest("/repo", 3), {
      url: "https://github.com/o/r/pull/3",
    } as PullRequestDetails);

    await openPullRequestInBrowser("/repo", 3);

    expect(harness.openUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/3");
    expect(details).not.toHaveBeenCalled();
  });

  it("fetches the URL when it is not cached and only opens GitHub links", async () => {
    vi.spyOn(commands, "githubGetPrDetails")
      .mockResolvedValueOnce({ url: "https://github.com/o/r/pull/4" } as never)
      .mockResolvedValueOnce({ url: "javascript:alert(1)" } as never)
      .mockRejectedValueOnce(new Error("not found"));

    await openPullRequestInBrowser("/repo", 4);
    await openPullRequestInBrowser("/repo", 5);
    await openPullRequestInBrowser("/repo", 6);

    expect(harness.openUrl).toHaveBeenCalledOnce();
    expect(harness.openUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/4");
    expect(console.error).toHaveBeenCalledWith("Failed to open PR:", new Error("not found"));
  });

  it("announces the working tree change after checking out a pull request", async () => {
    vi.spyOn(commands, "githubCheckoutPr").mockResolvedValue(null);
    const changes: GitChange[] = [];
    const unsubscribe = subscribeToGitChanges((change) => changes.push(change));

    await checkoutPullRequest("/repo", 7);
    unsubscribe();

    expect(commands.githubCheckoutPr).toHaveBeenCalledWith("/repo", 7);
    expect(changes).toEqual([
      {
        repoPath: "/repo",
        scopes: ["working-tree", "history", "refs"],
        source: "checkout-pull-request",
      },
    ]);
  });

  it("does not announce a checkout that failed", async () => {
    vi.spyOn(commands, "githubCheckoutPr").mockRejectedValue(new Error("dirty tree"));
    const changes: GitChange[] = [];
    const unsubscribe = subscribeToGitChanges((change) => changes.push(change));

    await expect(checkoutPullRequest("/repo", 7)).rejects.toThrow("dirty tree");
    unsubscribe();

    expect(changes).toEqual([]);
  });
});

describe("GitHub linked account", () => {
  it("reflects the connected account and keeps a stable snapshot", () => {
    registerGitHubLinkedAccount();
    const account = getLinkedAccount("github")!;
    const listener = vi.fn();
    const unsubscribe = account.subscribe(listener);

    const signedOut = account.getState();
    expect(signedOut).toEqual({ connected: false, login: null });
    expect(account.getState()).toBe(signedOut);

    useGitHubStore.setState({ githubAccountStatus: "connected", currentUser: "octocat" });
    expect(listener).toHaveBeenCalled();
    expect(account.getState()).toEqual({ connected: true, login: "octocat" });
    expect(account.getAvatarUrl("octocat", 40)).toContain("octocat");
    unsubscribe();
  });

  it("refreshes by checking GitHub authentication", async () => {
    registerGitHubLinkedAccount();
    vi.spyOn(commands, "githubCheckAuth").mockResolvedValue("authenticated");
    vi.spyOn(commands, "githubGetCurrentUser").mockResolvedValue("hubot");

    await getLinkedAccount("github")!.refresh();

    expect(getLinkedAccount("github")!.getState()).toEqual({ connected: true, login: "hubot" });
  });
});

describe("GitHub viewer helpers", () => {
  it("opens resources in their own window only for local repositories", () => {
    const spec = { type: "pullRequest", prNumber: 1 } as never;

    openGitHubContentInNewWindow(null, spec);
    openGitHubContentInNewWindow("remote://ssh/repo", spec);
    expect(harness.toast.error).toHaveBeenCalledTimes(2);
    expect(harness.openResourceInDetachedWindow).not.toHaveBeenCalled();

    openGitHubContentInNewWindow("/repo", spec);
    expect(harness.openResourceInDetachedWindow).toHaveBeenCalledWith(spec, "/repo");
  });

  it("names repositories by their folder", () => {
    expect(getRepositoryDisplayName("/Users/me/code/athas/")).toBe("athas");
    expect(getRepositoryDisplayName("C:\\code\\athas")).toBe("athas");
    expect(getRepositoryDisplayName("/")).toBe("/");
  });

  it("copies values and reports the outcome", async () => {
    await copyToClipboard("#12", "Copied number");
    expect(harness.writeClipboardText).toHaveBeenCalledWith("#12");
    expect(harness.toast.success).toHaveBeenCalledWith("Copied number");

    harness.writeClipboardText.mockRejectedValueOnce(new Error("denied"));
    await copyToClipboard("x", "Copied");
    expect(harness.toast.error).toHaveBeenCalledWith("Failed to copy: Error: denied");
  });
});

describe("useNow", () => {
  function renderNow(intervalMs: number, enabled: boolean) {
    const result = { current: 0 };
    function Probe(props: { enabled: boolean }) {
      result.current = useNow(intervalMs, props.enabled);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe, { enabled })));
    return {
      result,
      rerender: (next: boolean) => act(() => root.render(createElement(Probe, { enabled: next }))),
      unmount: () => act(() => root.unmount()),
    };
  }

  it("ticks on the interval while enabled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { result, rerender, unmount } = renderNow(1_000, true);
    const start = result.current;

    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(start + 3_000);

    rerender(false);
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(start + 3_000);
    unmount();
  });
});
