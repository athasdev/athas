import {
  Download,
  FolderOpen,
  GitPullRequest,
  RefreshCw,
  RotateCcw,
  Server,
  Settings,
  Tag,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/utils/cn";
import { fetchChanges, pullChanges, pushChanges } from "../api/remotes";
import { discardAllChanges, initRepository } from "../api/status";
import { useGitStore } from "../stores/git-store";

interface GitActionsMenuProps {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  onClose: () => void;
  hasGitRepo: boolean;
  repoPath?: string;
  onRefresh?: () => void;
  onOpenRemoteManager?: () => void;
  onOpenTagManager?: () => void;
  onSelectRepository?: () => Promise<void> | void;
  isSelectingRepository?: boolean;
}

const GitActionsMenu = ({
  isOpen,
  position,
  onClose,
  hasGitRepo,
  repoPath,
  onRefresh,
  onOpenRemoteManager,
  onOpenTagManager,
  onSelectRepository,
  isSelectingRepository,
}: GitActionsMenuProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const { isRefreshing } = useGitStore();

  const handleAction = async (action: () => Promise<boolean>, actionName: string) => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const success = await action();
      if (success) {
        onRefresh?.();
      } else {
        console.error(`${actionName} failed`);
      }
    } catch (error) {
      console.error(`${actionName} error:`, error);
    } finally {
      setIsLoading(false);
    }
    onClose();
  };

  const handlePush = () => {
    handleAction(() => pushChanges(repoPath!), "Push");
  };

  const handlePull = () => {
    handleAction(() => pullChanges(repoPath!), "Pull");
  };

  const handleFetch = () => {
    handleAction(() => fetchChanges(repoPath!), "Fetch");
  };

  const handleDiscardAllChanges = async () => {
    if (!repoPath) return;
    handleAction(() => discardAllChanges(repoPath!), "Discard all changes");
  };

  const handleInitRepository = () => {
    handleAction(() => initRepository(repoPath!), "Initialize repository");
  };

  const handleRefresh = async () => {
    await onRefresh?.();
  };

  const handleRemoteManager = () => {
    onOpenRemoteManager?.();
    onClose();
  };

  const handleTagManager = () => {
    onOpenTagManager?.();
    onClose();
  };

  const handleSelectRepository = async () => {
    await onSelectRepository?.();
    onClose();
  };

  if (!isOpen || !position) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed z-50 min-w-[180px] rounded-md",
        "border border-border bg-secondary-bg py-1 shadow-lg",
      )}
      style={{
        left: position.x,
        top: position.y,
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      {hasGitRepo ? (
        <>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSelectRepository();
            }}
            disabled={isSelectingRepository}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <FolderOpen size={12} />
            {isSelectingRepository ? "Selecting..." : "Select Repository"}
          </button>

          <div className="my-1 border-border border-t"></div>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handlePush();
            }}
            disabled={isLoading}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <Upload size={12} />
            Push Changes
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSelectRepository();
            }}
            disabled={isSelectingRepository}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <FolderOpen size={12} />
            {isSelectingRepository ? "Selecting..." : "Select Repository"}
          </button>

          <div className="my-1 border-border border-t"></div>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handlePull();
            }}
            disabled={isLoading}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <Download size={12} />
            Pull Changes
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFetch();
            }}
            disabled={isLoading}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <GitPullRequest size={12} />
            Fetch
          </button>

          <div className="my-1 border-border border-t"></div>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleRemoteManager();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover",
            )}
          >
            <Server size={12} />
            Manage Remotes
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleTagManager();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover",
            )}
          >
            <Tag size={12} />
            Manage Tags
          </button>

          <div className="my-1 border-border border-t"></div>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleRefresh();
            }}
            disabled={isRefreshing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
            Refresh Status
          </button>

          <div className="my-1 border-border border-t"></div>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleDiscardAllChanges();
            }}
            disabled={isLoading}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-red-400 text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <RotateCcw size={12} />
            Discard All Changes
          </button>
        </>
      ) : (
        <>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleInitRepository();
            }}
            disabled={isLoading}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <Settings size={12} />
            Initialize Repository
          </button>

          <div className="my-1 border-border border-t"></div>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleRefresh();
            }}
            disabled={isRefreshing}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5",
              "ui-font text-left text-text text-xs hover:bg-hover disabled:opacity-50",
            )}
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
            Refresh Status
          </button>
        </>
      )}
    </div>
  );
};

export default GitActionsMenu;
