// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { GITHUB_CONNECTION_URL } from "@/features/github/services/github-token-service";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { selectDockLayout, useDockLayoutStore } from "@/features/layout/stores/dock-layout.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { onAppEvent } from "@/utils/app-events";
import {
  checkGitHubAuthentication,
  connectGitHubAccount,
  openGitHubSection,
  refreshGitHubView,
} from "../commands/github-command-actions";

const mocks = vi.hoisted(() => ({ openUrl: vi.fn(), toast: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/utils/toast", () => ({ showToast: mocks.toast }));

const actions: unknown[] = [];
const githubPaneOpen = () =>
  selectDockLayout(useDockLayoutStore.getState(), {
    kind: "project",
    id: "/work/site",
  }).panes.includes("view:github-prs");
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  workspaceRuntimeRegistry.resetForTests();
  actions.length = 0;
  stop = onAppEvent("github:palette-action", (action) => actions.push(action));
  useProjectStore.setState({ rootFolderPath: "/work/site" });
  useDockLayoutStore.setState({ layouts: {}, hidden: false, currentOwner: null });
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("GitHub palette actions", () => {
  it("turns a hidden section on, opens GitHub in the dock and scrolls to the section", async () => {
    await useSettingsStore.getState().actions.updateSetting("showGitHubReleases", false);

    await openGitHubSection("releases");

    expect(useSettingsStore.getState().settings.showGitHubReleases).toBe(true);
    expect(githubPaneOpen()).toBe(true);
    expect(actions).toEqual([]);
    vi.runAllTimers();
    expect(actions).toEqual([{ type: "show-section", section: "releases" }]);
  });

  it("refreshes the GitHub view", () => {
    refreshGitHubView();
    vi.runAllTimers();
    expect(githubPaneOpen()).toBe(true);
    expect(actions).toEqual([{ type: "refresh" }]);
  });

  it("rechecks authentication and reports the outcome", async () => {
    const checkAuth = vi
      .spyOn(useGitHubStore.getState().actions, "checkAuth")
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce("token expired");

    await checkGitHubAuthentication();
    expect(checkAuth).toHaveBeenCalledWith({ force: true });
    expect(mocks.toast).toHaveBeenLastCalledWith({
      message: "GitHub authentication checked",
      type: "success",
    });

    await checkGitHubAuthentication();
    expect(mocks.toast).toHaveBeenLastCalledWith({
      message: "GitHub authentication failed: token expired",
      type: "error",
    });
  });

  it("opens the GitHub connection page", () => {
    mocks.openUrl.mockResolvedValue(undefined);
    connectGitHubAccount();
    expect(mocks.openUrl).toHaveBeenCalledWith(GITHUB_CONNECTION_URL);
  });
});
