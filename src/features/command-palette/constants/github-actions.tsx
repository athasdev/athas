import { TagIcon, RocketIcon } from "@/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwiseIcon,
  BoltIcon,
  ChatBubbleTextIcon,
  GitPullRequestIcon,
  LinkIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import type { Settings } from "@/features/settings/types/settings.types";
import { GITHUB_CONNECTION_URL } from "@/features/github/services/github-token-service";
import type { Action } from "../types/action.types";

type GitHubSidebarSection = "pull-requests" | "issues" | "actions" | "releases" | "deployments";

interface GitHubActionsParams {
  repoPath: string | null;
  setIsSidebarVisible: (v: boolean) => void;
  setActiveView: (view: "files" | "git" | "github-prs") => void;
  settings: Pick<
    Settings,
    | "showGitHubPullRequests"
    | "showGitHubIssues"
    | "showGitHubActions"
    | "showGitHubReleases"
    | "showGitHubDeployments"
  >;
  updateSetting: (key: string, value: any) => void | Promise<void>;
  checkAuth: (options?: { force?: boolean }) => Promise<void>;
  showToast: (params: { message: string; type: "success" | "error" | "info" }) => void;
  openGitHubFormBuffer: (options: {
    repoPath: string;
    formKind: "pull-request" | "issue" | "action";
  }) => string;
  openReleaseDraft: (repoPath: string) => void;
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
    repoPath,
    openGitHubFormBuffer,
    openReleaseDraft,
    onClose,
  } = params;

  const openGitHubSection = async (section: GitHubSidebarSection) => {
    const settingBySection: Record<GitHubSidebarSection, keyof typeof settings> = {
      "pull-requests": "showGitHubPullRequests",
      issues: "showGitHubIssues",
      actions: "showGitHubActions",
      releases: "showGitHubReleases",
      deployments: "showGitHubDeployments",
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

  const openGitHubForm = (formKind: "pull-request" | "issue" | "action") => {
    onClose();
    if (!repoPath) {
      showToast({ message: "No repository open", type: "error" });
      return;
    }
    openGitHubFormBuffer({ repoPath, formKind });
  };

  return [
    {
      id: "github-show-releases",
      label: "GitHub: Show Releases",
      description: "Browse release notes, drafts, and assets",
      icon: <TagIcon />,
      category: "GitHub",
      action: () => void openGitHubSection("releases"),
    },
    {
      id: "github-show-deployments",
      label: "GitHub: Show Deployments",
      description: "Inspect environments and deployment status history",
      icon: <RocketIcon />,
      category: "GitHub",
      action: () => void openGitHubSection("deployments"),
    },
    {
      id: "github-new-release",
      label: "GitHub: New Release",
      description: "Draft a release in the active repository",
      icon: <TagIcon />,
      category: "GitHub",
      action: () => {
        onClose();
        if (!repoPath) {
          showToast({ message: "No repository open", type: "error" });
          return;
        }
        openReleaseDraft(repoPath);
      },
    },
    {
      id: "github-new-issue",
      label: "GitHub: New Issue",
      description: "Create an issue in the active repository",
      icon: <ChatBubbleTextIcon />,
      category: "GitHub",
      action: () => openGitHubForm("issue"),
    },
    {
      id: "github-new-pull-request",
      label: "GitHub: New Pull Request",
      description: "Create a pull request in the active repository",
      icon: <GitPullRequestIcon />,
      category: "GitHub",
      action: () => openGitHubForm("pull-request"),
    },
    {
      id: "github-run-workflow",
      label: "GitHub: Run Workflow",
      description: "Dispatch a workflow in the active repository",
      icon: <BoltIcon />,
      category: "GitHub",
      action: () => openGitHubForm("action"),
    },
    {
      id: "github-show-pull-requests",
      label: "GitHub: Show Pull Requests",
      description: "Open GitHub pull requests",
      icon: <GitPullRequestIcon />,
      category: "GitHub",
      commandId: "workbench.showGitHub",
      action: () => void openGitHubSection("pull-requests"),
    },
    {
      id: "github-show-issues",
      label: "GitHub: Show Issues",
      description: "Open GitHub issues",
      icon: <WarningCircleIcon />,
      category: "GitHub",
      action: () => void openGitHubSection("issues"),
    },
    {
      id: "github-show-actions",
      label: "GitHub: Show Actions",
      description: "Open GitHub workflow runs",
      icon: <BoltIcon />,
      category: "GitHub",
      action: () => void openGitHubSection("actions"),
    },
    {
      id: "github-refresh",
      label: "GitHub: Refresh Current View",
      description: "Refresh the active GitHub sidebar section",
      icon: <ArrowClockwiseIcon />,
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
      icon: <ArrowClockwiseIcon />,
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
      icon: <LinkIcon />,
      category: "GitHub",
      action: () => {
        onClose();
        void openUrl(GITHUB_CONNECTION_URL);
      },
    },
  ];
};
