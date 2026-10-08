// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { GitHubNotification } from "@/features/github/types/github.types";
import { githubNotificationListCache } from "@/features/github/services/github-data-cache";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openUrl: vi.fn(),
  checkAuth: vi.fn(() => Promise.resolve()),
  isAuthenticated: true,
  openPRBuffer: vi.fn(),
  openGitHubIssueBuffer: vi.fn(),
  openGitHubActionBuffer: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/features/github/stores/github.store", () => ({
  useGitHubStore: {
    use: {
      isAuthenticated: () => mocks.isAuthenticated,
      actions: () => ({ checkAuth: mocks.checkAuth }),
    },
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    use: {
      actions: () => ({
        openPRBuffer: mocks.openPRBuffer,
        openGitHubIssueBuffer: mocks.openGitHubIssueBuffer,
        openGitHubActionBuffer: mocks.openGitHubActionBuffer,
      }),
    },
  },
}));

const { useGitHubNotifications } = await import("../hooks/use-github-notifications");

type Model = ReturnType<typeof useGitHubNotifications>;

let container: HTMLDivElement;
let root: Root;
let model: Model;
let visibility: DocumentVisibilityState = "visible";

function notification(overrides: Partial<GitHubNotification> = {}): GitHubNotification {
  return {
    id: "1",
    title: "Fix the build",
    subjectType: "PullRequest",
    reason: "review_requested",
    unread: true,
    updatedAt: "2026-06-15T12:00:00Z",
    lastReadAt: null,
    repositoryFullName: "athasdev/athas",
    url: "https://github.com/athasdev/athas/pull/42",
    subjectUrl: "https://api.github.com/repos/athasdev/athas/pulls/42",
    ...overrides,
  };
}

function Harness() {
  model = useGitHubNotifications();
  return null;
}

async function mount() {
  await act(async () => root.render(<Harness />));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  githubNotificationListCache.clear();
  mocks.isAuthenticated = true;
  mocks.invoke.mockReset().mockResolvedValue([notification()]);
  for (const mock of [
    mocks.openUrl,
    mocks.checkAuth,
    mocks.openPRBuffer,
    mocks.openGitHubIssueBuffer,
    mocks.openGitHubActionBuffer,
  ]) {
    mock.mockClear();
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("GitHub notifications", () => {
  it("checks auth and loads unread notifications on mount", async () => {
    await mount();

    expect(mocks.checkAuth).toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("github_list_notifications");
    expect(model.notifications.map((item) => item.id)).toEqual(["1"]);
    expect(model.isLoading).toBe(false);
    expect(model.error).toBeNull();
  });

  it("does not fetch while signed out", async () => {
    mocks.isAuthenticated = false;

    await mount();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(model.notifications).toEqual([]);
  });

  it("reuses fresh cached results unless a refresh is forced", async () => {
    await mount();
    mocks.invoke.mockResolvedValue([notification({ id: "2" })]);

    await act(async () => model.refresh());
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(model.notifications.map((item) => item.id)).toEqual(["1"]);

    await act(async () => model.refresh(true));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(model.notifications.map((item) => item.id)).toEqual(["2"]);
  });

  it("surfaces fetch errors as a message", async () => {
    mocks.invoke.mockRejectedValue("GitHub CLI is not installed");

    await mount();

    expect(model.error).toBe("GitHub CLI is not installed");
    expect(model.isLoading).toBe(false);
  });

  it("polls every minute only while the window is visible", async () => {
    await mount();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(60_000));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);

    visibility = "hidden";
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("refreshes stale results when the window becomes visible again", async () => {
    await mount();
    visibility = "hidden";
    await act(async () => vi.advanceTimersByTime(61_000));

    visibility = "visible";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("opens pull requests and issues in Athas and other subjects in the browser", async () => {
    await mount();

    model.openNotification(notification());
    expect(mocks.openPRBuffer).toHaveBeenCalledWith(42, {
      repoPath: "github://athasdev/athas",
      title: "Fix the build",
    });

    model.openNotification(
      notification({ subjectType: "Issue", url: "https://github.com/athasdev/athas/issues/7" }),
    );
    expect(mocks.openGitHubIssueBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 7, repoPath: "github://athasdev/athas" }),
    );

    model.openNotification(notification({ subjectType: "Release", url: "" }));
    expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/athasdev/athas/releases");
  });
});
