import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  openGitHubFormBuffer: vi.fn(() => "github-form"),
  openContent: vi.fn(),
  showToast: vi.fn(),
  repo: { activeRepoPath: "/repo" as string | null },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/github/services/github-token-service", () => ({
  GITHUB_CONNECTION_URL: "https://example.test/integrations",
}));
vi.mock("@/features/github/stores/github.store", () => ({
  useGitHubStore: { getState: () => ({ actions: { checkAuth: vi.fn() } }) },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: { openGitHubFormBuffer: mocks.openGitHubFormBuffer, openContent: mocks.openContent },
    }),
  },
}));
vi.mock("@/features/git/stores/git-repository.store", () => ({
  useRepositoryStore: { getState: () => mocks.repo },
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({}) },
}));
vi.mock("@/utils/toast", () => ({ showToast: mocks.showToast }));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: {}, actions: { updateSetting: vi.fn() } }) },
}));
vi.mock("@/features/layout/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ setIsSidebarVisible: vi.fn(), setActiveView: vi.fn() }) },
}));

const { githubCommands } = await import("../commands/github-commands");

function command(id: string) {
  const found = githubCommands.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing command ${id}`);
  return found;
}

describe("GitHub commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repo.activeRepoPath = "/repo";
  });

  it("exposes every native GitHub creation surface and both delivery sections", () => {
    expect(githubCommands.map((candidate) => candidate.title)).toEqual(
      expect.arrayContaining([
        "GitHub: New Issue",
        "GitHub: New Pull Request",
        "GitHub: Run Workflow",
        "GitHub: Show Releases",
        "GitHub: Show Deployments",
      ]),
    );
  });

  it.each([
    ["github.newIssue", "issue"],
    ["github.newPullRequest", "pull-request"],
    ["github.runWorkflow", "action"],
  ] as const)("opens %s in a native form buffer", async (id, formKind) => {
    await command(id).execute();

    expect(mocks.openGitHubFormBuffer).toHaveBeenCalledWith({ repoPath: "/repo", formKind });
  });

  it("opens a release draft for the active repository", async () => {
    await command("github.newRelease").execute();

    expect(mocks.openContent).toHaveBeenCalledWith({
      type: "githubDelivery",
      kind: "releases",
      repoPath: "/repo",
    });
  });

  it.each(["github.newRelease", "github.newIssue"])(
    "reports when %s has no repository",
    async (id) => {
      mocks.repo.activeRepoPath = null;

      await command(id).execute();

      expect(mocks.openContent).not.toHaveBeenCalled();
      expect(mocks.openGitHubFormBuffer).not.toHaveBeenCalled();
      expect(mocks.showToast).toHaveBeenCalledWith({
        message: "No repository open",
        type: "error",
      });
    },
  );
});
