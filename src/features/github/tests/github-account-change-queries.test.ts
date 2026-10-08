import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { queryClient } from "@/utils/query-client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/github/services/github-token-service", () => ({
  syncGitHubTokenFromAccount: vi.fn(async () => ({ status: "notConnected" })),
}));
vi.mock("@/utils/query-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/query-client")>();
  return { ...actual, queryClient: actual.createQueryClient({ queries: { retry: false } }) };
});
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { use: { actions: () => ({}) } },
}));

const { useGitHubStore } = await import("@/features/github/stores/github.store");
const { githubKeys } = await import("@/features/github/services/github-queries");
const { deliveryKeys } =
  await import("@/features/github/delivery/services/github-delivery-service");

function seedAccountData() {
  queryClient.setQueryData(githubKeys.pullRequestList("/repo", "all"), ["pr"]);
  queryClient.setQueryData(githubKeys.issue("/repo", 1), { number: 1 });
  queryClient.setQueryData(githubKeys.metadata("/repo"), { labels: [] });
  queryClient.setQueryData(githubKeys.workflowRuns("/repo"), ["run"]);
  queryClient.setQueryData(deliveryKeys.list("releases", "/repo"), ["release"]);
  queryClient.setQueryData(githubKeys.notifications("ada"), ["notification"]);
}

const cachedGitHubQueries = () => queryClient.getQueryCache().findAll({ queryKey: githubKeys.all });

afterEach(() => {
  queryClient.clear();
  useGitHubStore.getState().actions.reset();
});

describe("GitHub data across account changes", () => {
  it("drops repository data and notifications on sign-out", () => {
    useGitHubStore.setState({ currentUser: "ada", isAuthenticated: true });
    seedAccountData();
    expect(cachedGitHubQueries()).toHaveLength(6);

    useGitHubStore.setState({ currentUser: null, isAuthenticated: false });

    expect(cachedGitHubQueries()).toHaveLength(0);
  });

  it("drops them when another account signs in", () => {
    useGitHubStore.setState({ currentUser: "ada", isAuthenticated: true });
    seedAccountData();

    useGitHubStore.setState({ currentUser: "grace" });

    expect(cachedGitHubQueries()).toHaveLength(0);
  });

  it("keeps them while the same account stays signed in", () => {
    useGitHubStore.setState({ currentUser: "ada", isAuthenticated: true });
    seedAccountData();

    useGitHubStore.setState({ currentUser: "ada", authError: null });

    expect(cachedGitHubQueries()).toHaveLength(6);
  });
});
