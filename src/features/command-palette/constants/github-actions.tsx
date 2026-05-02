import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwise as RefreshCw,
  GitPullRequest,
  Lightning,
  Link,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Settings } from "@/features/settings/types/settings";
import { GITHUB_CONNECTION_URL } from "@/features/github/services/github-token-service";
import type { Action } from "../models/action.types";

type GitHubSidebarSection = "pull-requests" | "issues" | "actions";

interface GitHubActionsParams {
  setIsSidebarVisible: (v: boolean) => void;
  setActiveView: (view: "files" | "git" | "github-prs" | "debugger") => void;
  settings: Pick<Settings, "showGitHubPullRequests" | "showGitHubIssues" | "showGitHubActions">;
  updateSetting: (key: string, value: any) => void | Promise<void>;
  checkAuth: (options?: { force?: boolean }) => Promise<void>;
  showToast: (params: { message: string; type: "success" | "error" | "info" }) => void;
  onClose: () => void;
}

export const createGitHubActions = (params: GitHubActionsParams): Action[] => {
  const {
    setIsSidebarVisible,
    setActiveView,
    settings,
    updateSetting,
    checkAuth,
    showToast,
    onClose,
  } = params;

  const openGitHubSection = async (section: GitHubSidebarSection) => {
    const settingBySection: Record<GitHubSidebarSection, keyof typeof settings> = {
      "pull-requests": "showGitHubPullRequests",
      issues: "showGitHubIssues",
      actions: "showGitHubActions",
    };
    const settingKey = settingBySection[section];

    if (!settings[settingKey]) {
      await updateSetting(settingKey, true);
    }

    setIsSidebarVisible(true);
    setActiveView("github-prs");
    onClose();

    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("athas:github-palette-action", {
          detail: { type: "show-section", section },
        }),
      );
    }, 0);
  };

  return [
    {
      id: "github-show-pull-requests",
      label: "GitHub: Show Pull Requests",
      description: "Open GitHub pull requests",
      icon: <GitPullRequest />,
      category: "GitHub",
      commandId: "workbench.showGitHub",
      action: () => void openGitHubSection("pull-requests"),
    },
    {
      id: "github-show-issues",
      label: "GitHub: Show Issues",
      description: "Open GitHub issues",
      icon: <WarningCircle />,
      category: "GitHub",
      action: () => void openGitHubSection("issues"),
    },
    {
      id: "github-show-actions",
      label: "GitHub: Show Actions",
      description: "Open GitHub workflow runs",
      icon: <Lightning />,
      category: "GitHub",
      action: () => void openGitHubSection("actions"),
    },
    {
      id: "github-refresh",
      label: "GitHub: Refresh Current View",
      description: "Refresh the active GitHub sidebar section",
      icon: <RefreshCw />,
      category: "GitHub",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("github-prs");
        onClose();
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("athas:github-palette-action", {
              detail: { type: "refresh" },
            }),
          );
        }, 0);
      },
    },
    {
      id: "github-check-auth",
      label: "GitHub: Check Authentication",
      description: "Refresh GitHub account authentication",
      icon: <RefreshCw />,
      category: "GitHub",
      action: async () => {
        onClose();
        try {
          await checkAuth({ force: true });
          showToast({ message: "GitHub authentication checked", type: "success" });
        } catch (error) {
          showToast({ message: `GitHub authentication failed: ${error}`, type: "error" });
        }
      },
    },
    {
      id: "github-connect-account",
      label: "GitHub: Connect Account",
      description: "Open GitHub integration settings",
      icon: <Link />,
      category: "GitHub",
      action: () => {
        onClose();
        void openUrl(GITHUB_CONNECTION_URL);
      },
    },
  ];
};
