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
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { fetchChanges, pullChanges, pushChanges } from "../api/git-remotes-api";
import { discardAllChanges, initRepository } from "../api/git-status-api";
import { useGitStore } from "../stores/git-store";
import {
  type GitActionsMenuAnchorRect,
  resolveGitActionsMenuPosition,
} from "../utils/git-actions-menu-position";

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
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isRefreshing } = useGitStore();
  const confirmBeforeDiscard = useSettingsStore((state) => state.settings.confirmBeforeDiscard);

  const updateMenuPosition = useCallback(() => {
    if (!anchorRect || !menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const resolved = resolveGitActionsMenuPosition({
      anchorRect,
      menuSize: { width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });

    setMenuPosition({
      left: resolved.left,
      top: resolved.top,
    });
  }, [anchorRect]);

  useLayoutEffect(() => {
    if (!isOpen || !anchorRect) {
      setMenuPosition(null);
      return;
    }

    const frame = window.requestAnimationFrame(updateMenuPosition);
    window.addEventListener("resize", updateMenuPosition);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [isOpen, anchorRect, updateMenuPosition, hasGitRepo, isLoading, isRefreshing]);

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
          icon: <FolderOpen size={12} />,
          disabled: isSelectingRepository,
          onClick: () => void handleSelectRepository(),
        },
        { id: "sep-1", label: "", separator: true, onClick: () => {} },
        {
          id: "push",
          label: "Push Changes",
          icon: <Upload size={12} />,
          disabled: isLoading,
          onClick: handlePush,
        },
        { id: "sep-2", label: "", separator: true, onClick: () => {} },
        {
          id: "pull",
          label: "Pull Changes",
          icon: <Download size={12} />,
          disabled: isLoading,
          onClick: handlePull,
        },
        {
          id: "fetch",
          label: "Fetch",
          icon: <GitPullRequest size={12} />,
          disabled: isLoading,
          onClick: handleFetch,
        },
        { id: "sep-3", label: "", separator: true, onClick: () => {} },
        {
          id: "manage-remotes",
          label: "Manage Remotes",
          icon: <Server size={12} />,
          onClick: handleRemoteManager,
        },
        {
          id: "manage-tags",
          label: "Manage Tags",
          icon: <Tag size={12} />,
          onClick: handleTagManager,
        },
        { id: "sep-4", label: "", separator: true, onClick: () => {} },
        {
          id: "refresh",
          label: "Refresh Status",
          icon: <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />,
          disabled: isRefreshing,
          onClick: () => void handleRefresh(),
        },
        { id: "sep-5", label: "", separator: true, onClick: () => {} },
        {
          id: "discard-all",
          label: "Discard All Changes",
          icon: <RotateCcw size={12} />,
          disabled: isLoading,
          className: "text-red-400",
          onClick: () => void handleDiscardAllChanges(),
        },
      ]
    : [
        {
          id: "init-repository",
          label: "Initialize Repository",
          icon: <Settings size={12} />,
          disabled: isLoading,
          onClick: handleInitRepository,
        },
        { id: "sep-1", label: "", separator: true, onClick: () => {} },
        {
          id: "refresh",
          label: "Refresh Status",
          icon: <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />,
          disabled: isRefreshing,
          onClick: () => void handleRefresh(),
        },
      ];

  return (
    <ContextMenu
      isOpen={isOpen}
      position={{
        x: menuPosition?.left ?? anchorRect.left,
        y: menuPosition?.top ?? anchorRect.bottom + 6,
      }}
      items={items}
      onClose={onClose}
      style={{
        visibility: menuPosition ? "visible" : "hidden",
      }}
    />
  );
};

export default GitActionsMenu;
