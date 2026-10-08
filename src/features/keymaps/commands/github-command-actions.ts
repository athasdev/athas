import { openUrl } from "@tauri-apps/plugin-opener";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { GITHUB_CONNECTION_URL } from "@/features/github/services/github-token-service";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { showToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { emitAppEvent } from "@/utils/app-events";
import { useProjectStore } from "@/features/window/stores/project.store";

export type GitHubSidebarSection =
  | "pull-requests"
  | "issues"
  | "actions"
  | "releases"
  | "deployments";

export type GitHubSidebarAction =
  | { type: "show-section"; section: GitHubSidebarSection }
  | { type: "refresh" };

const settingBySection = {
  "pull-requests": "showGitHubPullRequests",
  issues: "showGitHubIssues",
  actions: "showGitHubActions",
  releases: "showGitHubReleases",
  deployments: "showGitHubDeployments",
} as const satisfies Record<GitHubSidebarSection, string>;

function getRepoPath(): string | null {
  return (
    useRepositoryStore.getState().activeRepoPath ??
    useProjectStore.getState().rootFolderPath ??
    null
  );
}

function showGitHubSidebar(): void {
  const state = useUIState.getState();
  state.setIsSidebarVisible(true);
  state.setActiveView("github-prs");
}

function dispatchGitHubSidebarAction(action: GitHubSidebarAction): void {
  window.setTimeout(() => {
    emitAppEvent("athas:github-palette-action", action);
  }, 0);
}

/** Turns the section on when it is hidden, then shows it in the GitHub sidebar. */
export async function openGitHubSection(section: GitHubSidebarSection): Promise<void> {
  const settingKey = settingBySection[section];
  const { settings, actions } = useSettingsStore.getState();

  if (!settings[settingKey]) {
    await actions.updateSetting(settingKey, true);
  }

  showGitHubSidebar();
  dispatchGitHubSidebarAction({ type: "show-section", section });
}

export function refreshGitHubView(): void {
  showGitHubSidebar();
  dispatchGitHubSidebarAction({ type: "refresh" });
}

export function openGitHubForm(formKind: "pull-request" | "issue" | "action"): void {
  const repoPath = getRepoPath();
  if (!repoPath) {
    showToast({ message: "No repository open", type: "error" });
    return;
  }

  useBufferStore.getState().actions.openGitHubFormBuffer({ repoPath, formKind });
}

export function openGitHubReleaseDraft(): void {
  const repoPath = getRepoPath();
  if (!repoPath) {
    showToast({ message: "No repository open", type: "error" });
    return;
  }

  useBufferStore
    .getState()
    .actions.openContent({ type: "githubDelivery", kind: "releases", repoPath });
}

export async function checkGitHubAuthentication(): Promise<void> {
  try {
    await useGitHubStore.getState().actions.checkAuth({ force: true });
    showToast({ message: "GitHub authentication checked", type: "success" });
  } catch (error) {
    showToast({ message: `GitHub authentication failed: ${error}`, type: "error" });
  }
}

export function connectGitHubAccount(): void {
  void openUrl(GITHUB_CONNECTION_URL);
}
