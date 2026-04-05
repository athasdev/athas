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
import { useSettingsStore } from "@/features/settings/store";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { fetchChanges, pullChanges, pushChanges } from "../api/git-remotes-api";
import { discardAllChanges, initRepository } from "../api/git-status-api";
import { useGitStore } from "../stores/git-store";
import { type GitActionsMenuAnchorRect } from "../utils/git-actions-menu-position";

interface GitActionsMenuProps {
  isOpen: boolean;
  anchorRect: GitActionsMenuAnchorRect | null;
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
  anchorRect,
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
  const confirmBeforeDiscard = useSettingsStore((state) => state.settings.confirmBeforeDiscard);

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
    if (
      confirmBeforeDiscard &&
      !window.confirm("Discard all unstaged changes? This cannot be undone.")
    ) {
      return;
    }
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

  if (!isOpen || !anchorRect) {
    return null;
  }

  const items: ContextMenuItem[] = hasGitRepo
    ? [
        {
          id: "select-repository",
          label: isSelectingRepository ? "Selecting..." : "Select Repository",
          icon: <FolderOpen />,
          disabled: isSelectingRepository,
          onClick: () => void handleSelectRepository(),
        },
        { id: "sep-1", label: "", separator: true, onClick: () => {} },
        {
          id: "push",
          label: "Push Changes",
          icon: <Upload />,
          disabled: isLoading,
          onClick: handlePush,
        },
        { id: "sep-2", label: "", separator: true, onClick: () => {} },
        {
          id: "pull",
          label: "Pull Changes",
          icon: <Download />,
          disabled: isLoading,
          onClick: handlePull,
        },
        {
          id: "fetch",
          label: "Fetch",
          icon: <GitPullRequest />,
          disabled: isLoading,
          onClick: handleFetch,
        },
        { id: "sep-3", label: "", separator: true, onClick: () => {} },
        {
          id: "manage-remotes",
          label: "Manage Remotes",
          icon: <Server />,
          onClick: handleRemoteManager,
        },
        {
          id: "manage-tags",
          label: "Manage Tags",
          icon: <Tag />,
          onClick: handleTagManager,
        },
        { id: "sep-4", label: "", separator: true, onClick: () => {} },
        {
          id: "refresh",
          label: "Refresh Status",
          icon: <RefreshCw className={isRefreshing ? "animate-spin" : ""} />,
          disabled: isRefreshing,
          onClick: () => void handleRefresh(),
        },
        { id: "sep-5", label: "", separator: true, onClick: () => {} },
        {
          id: "discard-all",
          label: "Discard All Changes",
          icon: <RotateCcw />,
          disabled: isLoading,
          className: "text-red-400",
          onClick: () => void handleDiscardAllChanges(),
        },
      ]
    : [
        {
          id: "init-repository",
          label: "Initialize Repository",
          icon: <Settings />,
          disabled: isLoading,
          onClick: handleInitRepository,
        },
        { id: "sep-1", label: "", separator: true, onClick: () => {} },
        {
          id: "refresh",
          label: "Refresh Status",
          icon: <RefreshCw className={isRefreshing ? "animate-spin" : ""} />,
          disabled: isRefreshing,
          onClick: () => void handleRefresh(),
        },
      ];

  return (
    <ContextMenu
      isOpen={isOpen}
      position={{
        x: anchorRect.right,
        y: anchorRect.bottom + 6,
      }}
      items={items}
      onClose={onClose}
    />
  );
};

export default GitActionsMenu;
