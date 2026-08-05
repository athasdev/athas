import { describe, expect, it, vi } from "vite-plus/test";
import { createGitHubActions } from "../constants/github-actions";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

function createParams(repoPath: string | null = "/repo") {
  return {
    repoPath,
    setIsSidebarVisible: vi.fn(),
    setActiveView: vi.fn(),
    settings: {
      showGitHubPullRequests: true,
      showGitHubIssues: true,
      showGitHubActions: true,
    },
    updateSetting: vi.fn(),
    checkAuth: vi.fn(async () => undefined),
    showToast: vi.fn(),
    openGitHubFormBuffer: vi.fn(() => "github-form"),
    onClose: vi.fn(),
  };
}

describe("createGitHubActions", () => {
  it("exposes every native GitHub creation surface", () => {
    const actions = createGitHubActions(createParams());

    expect(actions.map((action) => action.label)).toEqual(
      expect.arrayContaining([
        "GitHub: New Issue",
        "GitHub: New Pull Request",
        "GitHub: Run Workflow",
      ]),
    );
  });

  it.each([
    ["github-new-issue", "issue"],
    ["github-new-pull-request", "pull-request"],
    ["github-run-workflow", "action"],
  ] as const)("opens %s in a native form buffer", (actionId, formKind) => {
    const params = createParams();
    const actions = createGitHubActions(params);

    actions.find((action) => action.id === actionId)?.action();

    expect(params.openGitHubFormBuffer).toHaveBeenCalledWith({ repoPath: "/repo", formKind });
    expect(params.onClose).toHaveBeenCalledOnce();
  });

  it("reports when a creation command has no repository", () => {
    const params = createParams(null);

    createGitHubActions(params)
      .find((action) => action.id === "github-new-issue")
      ?.action();

    expect(params.openGitHubFormBuffer).not.toHaveBeenCalled();
    expect(params.showToast).toHaveBeenCalledWith({
      message: "No repository open",
      type: "error",
    });
  });
});
