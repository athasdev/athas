import { ArrowUp, GitBranch, GitCommit, RefreshCw } from "lucide-react";
import type { Action } from "../../models/action.types";

interface GitActionsParams {
  rootFolderPath: string | null | undefined;
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
    pushChanges: (path: string) => Promise<boolean>;
    pullChanges: (path: string) => Promise<boolean>;
    fetchChanges: (path: string) => Promise<boolean>;
    discardAllChanges: (path: string) => Promise<boolean>;
  };
  setIsBranchManagerVisible: (v: boolean) => void;
  onClose: () => void;
}

export const createGitActions = (params: GitActionsParams): Action[] => {
  const { rootFolderPath, showToast, gitStore, gitOperations, setIsBranchManagerVisible, onClose } =
    params;

  return [
    {
      id: "git-branch-manager",
      label: "Git: Open Branch Manager",
      description: "Show branch manager dialog",
      icon: <GitBranch size={14} />,
      category: "Git",
      action: () => {
        onClose();
        setIsBranchManagerVisible(true);
      },
    },
    {
      id: "git-stage-all",
      label: "Git: Stage All Changes",
      description: "Stage all modified files",
      icon: <GitBranch size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const success = await gitOperations.stageAllFiles(rootFolderPath);
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
      icon: <GitBranch size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const success = await gitOperations.unstageAllFiles(rootFolderPath);
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
      icon: <GitCommit size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
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
          const success = await gitOperations.commitChanges(rootFolderPath, message);
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
      icon: <ArrowUp size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          showToast({ message: "Pushing changes...", type: "info" });
          const success = await gitOperations.pushChanges(rootFolderPath);
          if (success) {
            showToast({ message: "Changes pushed successfully", type: "success" });
          } else {
            showToast({ message: "Failed to push changes", type: "error" });
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
      icon: <RefreshCw size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          showToast({ message: "Pulling changes...", type: "info" });
          const success = await gitOperations.pullChanges(rootFolderPath);
          if (success) {
            showToast({ message: "Changes pulled successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to pull changes", type: "error" });
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
      icon: <RefreshCw size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const success = await gitOperations.fetchChanges(rootFolderPath);
          if (success) {
            showToast({ message: "Fetched successfully", type: "success" });
          } else {
            showToast({ message: "Failed to fetch", type: "error" });
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
      icon: <GitBranch size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        if (!confirm("Are you sure you want to discard all changes? This cannot be undone.")) {
          onClose();
          return;
        }
        try {
          const success = await gitOperations.discardAllChanges(rootFolderPath);
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
      icon: <RefreshCw size={14} />,
      category: "Git",
      action: () => {
        gitStore.actions.setIsRefreshing(true);
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
