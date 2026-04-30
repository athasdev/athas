import {
  ArrowUp,
  Archive,
  ClockCounterClockwise,
  FolderOpen,
  GitBranch,
  GitCommit,
  HardDrives as Server,
  Tag,
  TreeStructure,
  ArrowClockwise as RefreshCw,
} from "@phosphor-icons/react";
import type { GitRemoteActionResult } from "@/features/git/api/git-remotes-api";
import type { Action } from "../models/action.types";

interface GitActionsParams {
  rootFolderPath: string | null | undefined;
  activeRepoPath?: string | null;
  setIsSidebarVisible: (v: boolean) => void;
  setActiveView: (view: "files" | "git" | "github-prs" | "debugger") => void;
  showToast: (params: { message: string; type: "success" | "error" | "info" }) => void;
  gitStore: {
    actions: {
      setIsRefreshing: (v: boolean) => void;
    };
  };
  gitOperations: {
    stageAllFiles: (path: string) => Promise<boolean>;
    unstageAllFiles: (path: string) => Promise<boolean>;
    commitChanges: (path: string, message: string) => Promise<boolean>;
    pushChanges: (path: string) => Promise<GitRemoteActionResult>;
    pullChanges: (path: string) => Promise<GitRemoteActionResult>;
    fetchChanges: (path: string) => Promise<GitRemoteActionResult>;
    discardAllChanges: (path: string) => Promise<boolean>;
  };
  onClose: () => void;
}

export const createGitActions = (params: GitActionsParams): Action[] => {
  const {
    rootFolderPath,
    activeRepoPath,
    setIsSidebarVisible,
    setActiveView,
    showToast,
    gitStore,
    gitOperations,
    onClose,
  } = params;
  const repoPath = activeRepoPath ?? rootFolderPath;

  const openGitAction = (detail: unknown) => {
    setIsSidebarVisible(true);
    setActiveView("git");
    onClose();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("athas:git-palette-action", { detail }));
    }, 0);
  };

  const openGitCommandSurface = (detail: unknown) => {
    onClose();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("athas:git-palette-action", { detail }));
    }, 0);
  };

  return [
    {
      id: "git-branch-manager",
      label: "Git: Open Branch Manager",
      description: "Open branch manager dropdown",
      icon: <GitBranch />,
      category: "Git",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("git");
        onClose();
        window.setTimeout(() => {
          window.dispatchEvent(new Event("athas:open-branch-manager"));
        }, 0);
      },
    },
    {
      id: "git-select-repository",
      label: "Git: Select Repository",
      description: "Browse and select a repository",
      icon: <FolderOpen />,
      category: "Git",
      action: () => openGitAction({ type: "select-repository" }),
    },
    {
      id: "git-show-changes",
      label: "Git: Show Changes",
      description: "Open source control changes",
      icon: <GitBranch />,
      category: "Git",
      commandId: "workbench.showSourceControl",
      action: () => openGitAction({ type: "show-tab", tab: "changes" }),
    },
    {
      id: "git-show-history",
      label: "Git: Show History",
      description: "Open commit history",
      icon: <ClockCounterClockwise />,
      category: "Git",
      action: () => openGitAction({ type: "show-tab", tab: "history" }),
    },
    {
      id: "git-show-worktrees",
      label: "Git: Show Worktrees",
      description: "Open worktree manager",
      icon: <TreeStructure />,
      category: "Git",
      action: () => openGitAction({ type: "show-tab", tab: "worktrees" }),
    },
    {
      id: "git-manage-remotes",
      label: "Git: Manage Remotes",
      description: "Open remote manager",
      icon: <Server />,
      category: "Git",
      action: () => openGitAction({ type: "manage-remotes" }),
    },
    {
      id: "git-manage-tags",
      label: "Git: Manage Tags",
      description: "Open tag manager",
      icon: <Tag />,
      category: "Git",
      action: () => openGitAction({ type: "manage-tags" }),
    },
    {
      id: "git-view-stashes",
      label: "Git: View Stashes",
      description: "Open stash list",
      icon: <Archive />,
      category: "Git",
      action: () => openGitCommandSurface({ type: "view-stashes" }),
    },
    {
      id: "git-stage-all",
      label: "Git: Stage All Changes",
      description: "Stage all modified files",
      icon: <GitBranch />,
      category: "Git",
      action: async () => {
        if (!repoPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const success = await gitOperations.stageAllFiles(repoPath);
          if (success) {
            showToast({ message: "All files staged successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to stage files", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-unstage-all",
      label: "Git: Unstage All Changes",
      description: "Unstage all staged files",
      icon: <GitBranch />,
      category: "Git",
      action: async () => {
        if (!repoPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const success = await gitOperations.unstageAllFiles(repoPath);
          if (success) {
            showToast({ message: "All files unstaged successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to unstage files", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-commit",
      label: "Git: Commit Changes",
      description: "Commit staged changes",
      icon: <GitCommit />,
      category: "Git",
      action: async () => {
        if (!repoPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        const message = prompt("Enter commit message:");
        if (!message) {
          onClose();
          return;
        }
        try {
          const success = await gitOperations.commitChanges(repoPath, message);
          if (success) {
            showToast({ message: "Changes committed successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to commit changes", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-push",
      label: "Git: Push",
      description: "Push changes to remote",
      icon: <ArrowUp />,
      category: "Git",
      action: async () => {
        if (!repoPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          showToast({ message: "Pushing changes...", type: "info" });
          const result = await gitOperations.pushChanges(repoPath);
          if (result.success) {
            showToast({ message: "Changes pushed successfully", type: "success" });
          } else {
            showToast({
              message: result.error || "Failed to push changes",
              type: "error",
            });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-pull",
      label: "Git: Pull",
      description: "Pull changes from remote",
      icon: <RefreshCw />,
      category: "Git",
      action: async () => {
        if (!repoPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          showToast({ message: "Pulling changes...", type: "info" });
          const result = await gitOperations.pullChanges(repoPath);
          if (result.success) {
            showToast({ message: "Changes pulled successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({
              message: result.error || "Failed to pull changes",
              type: "error",
            });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-fetch",
      label: "Git: Fetch",
      description: "Fetch changes from remote",
      icon: <RefreshCw />,
      category: "Git",
      action: async () => {
        if (!repoPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const result = await gitOperations.fetchChanges(repoPath);
          if (result.success) {
            showToast({ message: "Fetched successfully", type: "success" });
          } else {
            showToast({
              message: result.error || "Failed to fetch",
              type: "error",
            });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-discard-all",
      label: "Git: Discard All Changes",
      description: "Discard all uncommitted changes",
      icon: <GitBranch />,
      category: "Git",
      action: async () => {
        if (!repoPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        if (!confirm("Are you sure you want to discard all changes? This cannot be undone.")) {
          onClose();
          return;
        }
        try {
          const success = await gitOperations.discardAllChanges(repoPath);
          if (success) {
            showToast({ message: "All changes discarded", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to discard changes", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-refresh",
      label: "Git: Refresh Status",
      description: "Refresh Git status",
      icon: <RefreshCw />,
      category: "Git",
      action: () => {
        gitStore.actions.setIsRefreshing(true);
        window.dispatchEvent(
          new CustomEvent("athas:git-palette-action", { detail: { type: "refresh" } }),
        );
        window.dispatchEvent(new Event("refresh-git-data"));
        showToast({ message: "Refreshing Git status...", type: "info" });
        setTimeout(() => {
          gitStore.actions.setIsRefreshing(false);
          showToast({ message: "Git status refreshed", type: "success" });
        }, 1000);
        onClose();
      },
    },
  ];
};
