// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { GitHubNotification } from "@/features/github/types/github.types";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { queryClient } from "@/utils/query-client";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/github/services/github-token-service", () => ({
  syncGitHubTokenFromAccount: vi.fn(async () => ({ status: "notConnected" })),
}));
// The store clears the shared client on sign-out, so the shared client is a fresh test client.
vi.mock("@/utils/query-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/query-client")>();
  return { ...actual, queryClient: actual.createQueryClient({ queries: { retry: false } }) };
});
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { use: { actions: () => ({}) } },
}));

const { useGitHubNotifications } = await import("@/features/github/hooks/use-github-notifications");

const notification: GitHubNotification = {
  id: "1",
  title: "Review requested",
  subjectType: "PullRequest",
  reason: "review_requested",
  unread: true,
  updatedAt: "2026-06-15T12:00:00Z",
  lastReadAt: null,
  repositoryFullName: "athasdev/athas",
  url: "https://github.com/athasdev/athas/pull/42",
  subjectUrl: "https://api.github.com/repos/athasdev/athas/pulls/42",
};

let container: HTMLDivElement;
let root: Root;
let model: ReturnType<typeof useGitHubNotifications>;

function Harness() {
  model = useGitHubNotifications();
  return null;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  useGitHubStore.getState().actions.reset();
});

describe("GitHub notifications on sign-out", () => {
  it("drops the inbox and ignores a request that finishes after sign-out", async () => {
    let finishRequest!: (value: GitHubNotification[]) => void;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "github_list_notifications") {
        return new Promise<GitHubNotification[]>((resolve) => {
          finishRequest = resolve;
        });
      }
      // The auth check on mount: keep the signed-in state the test sets up.
      return new Promise(() => {});
    });
    useGitHubStore.setState({ isAuthenticated: true, currentUser: "alice" });

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      ),
    );
    await flush();
    expect(mocks.invoke).toHaveBeenCalledWith("github_list_notifications");

    await act(async () => {
      useGitHubStore.setState({ isAuthenticated: false, currentUser: null });
    });
    finishRequest([notification]);
    await flush();

    expect(model.notifications).toEqual([]);
    expect(queryClient.getQueryData(["github", "notifications", "alice"])).toBeUndefined();

    // Signing back in starts from an empty inbox rather than the response that raced sign-out.
    mocks.invoke.mockImplementation((command: string) =>
      command === "github_list_notifications" ? Promise.resolve([]) : new Promise(() => {}),
    );
    await act(async () => {
      useGitHubStore.setState({ isAuthenticated: true, currentUser: "alice" });
    });
    await flush();
    expect(model.notifications).toEqual([]);
  });
});
