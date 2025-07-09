import {
  Archive,
  Download,
  GitPullRequest,
  RefreshCw,
  RotateCcw,
  Server,
  Settings,
  Tag,
  Upload,
} from "lucide-react";
import { useState } from "react";
import {
  discardAllChanges,
  fetchChanges,
  initRepository,
  pullChanges,
  pushChanges,
} from "../../utils/git";

interface GitActionsMenuProps {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  onClose: () => void;
  hasGitRepo: boolean;
  repoPath?: string;
  onRefresh?: () => void;
  onOpenStashManager?: () => void;
  onOpenRemoteManager?: () => void;
  onOpenTagManager?: () => void;
}

const GitActionsMenu = ({
  isOpen,
  position,
  onClose,
  hasGitRepo,
  repoPath,
  onRefresh,
  onOpenStashManager,
  onOpenRemoteManager,
  onOpenTagManager,
}: GitActionsMenuProps) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleAction = async (action: () => Promise<boolean>, actionName: string) => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const success = await action();
      if (success) {
        console.log(`${actionName} completed successfully`);
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

    const confirmed = confirm(
      "Are you sure you want to discard all changes? This cannot be undone.",
    );
    if (!confirmed) {
      onClose();
      return;
    }

    handleAction(() => discardAllChanges(repoPath!), "Discard all changes");
  };

  const handleInitRepository = () => {
    handleAction(() => initRepository(repoPath!), "Initialize repository");
  };

  const handleRefresh = () => {
    onRefresh?.();
    onClose();
  };

  const handleStashManager = () => {
    onOpenStashManager?.();
    onClose();
  };

  const handleRemoteManager = () => {
    onOpenRemoteManager?.();
    onClose();
  };

  const handleTagManager = () => {
    onOpenTagManager?.();
    onClose();
  };

  if (!isOpen || !position) {
    return null;
  }

  return (
    <div
      className="fixed bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 py-1 min-w-[180px]"
      style={{
        left: position.x,
        top: position.y,
      }}
      onMouseDown={e => {
        e.stopPropagation();
      }}
    >
      {hasGitRepo ? (
        <>
          {/* Basic Git Operations */}
          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handlePush();
            }}
            disabled={isLoading}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2 disabled:opacity-50"
          >
            <Upload size={12} />
            Push Changes
          </button>

          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handlePull();
            }}
            disabled={isLoading}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2 disabled:opacity-50"
          >
            <Download size={12} />
            Pull Changes
          </button>

          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleFetch();
            }}
            disabled={isLoading}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2 disabled:opacity-50"
          >
            <GitPullRequest size={12} />
            Fetch
          </button>

          <div className="border-t border-[var(--border-color)] my-1"></div>

          {/* Advanced Operations */}
          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleStashManager();
            }}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
          >
            <Archive size={12} />
            Manage Stashes
          </button>

          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleRemoteManager();
            }}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
          >
            <Server size={12} />
            Manage Remotes
          </button>

          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleTagManager();
            }}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
          >
            <Tag size={12} />
            Manage Tags
          </button>

          <div className="border-t border-[var(--border-color)] my-1"></div>

          {/* Refresh */}
          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleRefresh();
            }}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
          >
            <RefreshCw size={12} />
            Refresh Status
          </button>

          <div className="border-t border-[var(--border-color)] my-1"></div>

          {/* Destructive Operations */}
          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleDiscardAllChanges();
            }}
            disabled={isLoading}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-red-400 hover:bg-[var(--hover-color)] flex items-center gap-2 disabled:opacity-50"
          >
            <RotateCcw size={12} />
            Discard All Changes
          </button>
        </>
      ) : (
        <>
          {/* No Git Repository */}
          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleInitRepository();
            }}
            disabled={isLoading}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2 disabled:opacity-50"
          >
            <Settings size={12} />
            Initialize Repository
          </button>

          <div className="border-t border-[var(--border-color)] my-1"></div>

          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleRefresh();
            }}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
          >
            <RefreshCw size={12} />
            Refresh Status
          </button>
        </>
      )}
    </div>
  );
};

export default GitActionsMenu;
