import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  access: { accepted: true } as { accepted: boolean; error?: string },
  status: null as null | { branch: string; files: Array<{ status: string }> },
  checkout: vi.fn(async () => {}),
  fetchQuery: vi.fn(async () => ({ body: "Body text" })),
  launch: vi.fn(() => "chat-1"),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/features/ai/lib/agent-message-access", () => ({
  getAgentMessageAccess: () => mocks.access,
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: { getState: () => ({ selectedAgentId: "claude-code", hasApiKey: true }) },
}));
vi.mock("@/features/ai/services/agent-project-navigation", () => ({
  launchAgentInProject: mocks.launch,
}));
vi.mock("@/features/git/api/git-status-api", () => ({ getGitStatus: async () => mocks.status }));
vi.mock("@/features/github/services/github-pull-request-actions", () => ({
  checkoutPullRequest: mocks.checkout,
}));
vi.mock("@/utils/query-client", () => ({ queryClient: { fetchQuery: mocks.fetchQuery } }));

import { startGitHubWork } from "@/features/ai/services/start-github-work";

const issue = {
  kind: "issue" as const,
  number: 9,
  title: "Fix it",
  url: "https://github.com/o/r/issues/9",
  updatedAt: "2026-10-10T00:00:00Z",
};
const pullRequest = {
  kind: "pull-request" as const,
  number: 4,
  title: "Tidy",
  url: "https://github.com/o/r/pull/4",
  updatedAt: "2026-10-10T00:00:00Z",
  headRef: "tidy",
  baseRef: "main",
};

const launchedPrompt = () =>
  (mocks.launch.mock.calls[0] as unknown as [string | null, { prompt: string }])[1].prompt;

describe("startGitHubWork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access = { accepted: true };
    mocks.status = { branch: "main", files: [] };
  });

  it("starts the agent in the chosen project with the issue as its first message", async () => {
    await startGitHubWork("project-b", "/repo", issue);

    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.launch).toHaveBeenCalledWith(
      "project-b",
      expect.objectContaining({ agentId: "claude-code", selectedFilesPaths: [] }),
    );
    expect(launchedPrompt()).toContain("Work on issue #9: Fix it");
    expect(launchedPrompt()).toContain("Body text");
  });

  it("checks out a pull request branch on a clean working tree", async () => {
    mocks.status = { branch: "main", files: [{ status: "untracked" }] };
    await startGitHubWork(null, "/repo", pullRequest);

    expect(mocks.checkout).toHaveBeenCalledWith("/repo", 4);
    expect(launchedPrompt()).toContain("Athas checked out `tidy`");
  });

  it("leaves the branch alone when tracked files have uncommitted changes", async () => {
    mocks.status = { branch: "main", files: [{ status: "modified" }] };
    await startGitHubWork(null, "/repo", pullRequest);

    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(launchedPrompt()).toContain("did not switch to it");
  });

  it("does not check out a branch the repository is already on", async () => {
    mocks.status = { branch: "tidy", files: [{ status: "modified" }] };
    await startGitHubWork(null, "/repo", pullRequest);

    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(launchedPrompt()).toContain("already on `tidy`");
  });

  it("still starts the agent when the checkout or description fails", async () => {
    mocks.checkout.mockRejectedValueOnce(new Error("conflict"));
    mocks.fetchQuery.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await startGitHubWork(null, "/repo", pullRequest);

    expect(mocks.toastError).toHaveBeenCalled();
    expect(launchedPrompt()).toContain("`gh pr checkout 4`");
    expect(launchedPrompt()).not.toContain("Description:");
  });

  it("does nothing when the agent is not ready", async () => {
    mocks.access = { accepted: false, error: "Sign in first" };
    expect(await startGitHubWork(null, "/repo", issue)).toBeNull();
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Sign in first");
  });
});
