import {
  ArchiveIcon as Archive,
  DownloadIcon as Download,
  DotsThreeIcon,
  EyeIcon,
  GitBranchIcon as GitBranch,
  FolderOpenIcon as FolderOpen,
  GitPullRequestIcon as GitPullRequest,
  ArrowClockwiseIcon as RefreshCw,
  ArrowCounterClockwiseIcon as RotateCcw,
  HardDrivesIcon as Server,
  GearSixIcon as Settings,
  TagIcon as Tag,
  UploadIcon as Upload,
} from "@/ui/icons";
import { useState } from "react";
import {
  GIT_SIDEBAR_ITEM_IDS,
  GIT_SIDEBAR_TAB_IDS,
  type GitSidebarItemId,
  type GitSidebarTabId,
} from "@/features/layout/config/item-order";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { SidebarIconButton } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { showConfirmDialog } from "@/ui/dialog";
import { toast } from "sonner";
import {
  fetchChanges,
  pullChanges,
  pushChanges,
  type GitRemoteActionResult,
} from "../api/git-remotes-api";
import { discardAllChanges, initRepository } from "../api/git-status-api";
import { useGitStore } from "../stores/git.store";
import { SOURCE_CONTROL_ITEM_ICONS, SOURCE_CONTROL_ITEM_LABELS } from "./source-control-items";

interface GitActionsMenuProps {
  hasGitRepo: boolean;
  hiddenItemIds: GitSidebarItemId[];
  onItemVisibleChange: (itemId: GitSidebarItemId, visible: boolean) => void;
  repoPath?: string;
  onRefresh?: () => void;
  onOpenBranchManager?: () => void;
  onShowBranchDiff?: () => void;
  onOpenRemoteManager?: () => void;
  onOpenTagManager?: () => void;
  onViewStashes?: () => void;
  onSelectRepository?: () => Promise<void> | void;
  isSelectingRepository?: boolean;
  onInitializeRepository?: () => Promise<void> | void;
  isInitializingRepository?: boolean;
}

const GitActionsMenu = ({
  hasGitRepo,
  hiddenItemIds,
  onItemVisibleChange,
  repoPath,
  onRefresh,
  onOpenBranchManager,
  onShowBranchDiff,
  onOpenRemoteManager,
  onOpenTagManager,
  onViewStashes,
  onSelectRepository,
  isSelectingRepository,
  onInitializeRepository,
  isInitializingRepository,
}: GitActionsMenuProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const isRefreshing = useGitStore((state) => state.isRefreshing);
  const confirmBeforeDiscard = useSettingsStore((state) => state.settings.confirmBeforeDiscard);

  const handleAction = async (
    action: () => Promise<boolean | GitRemoteActionResult>,
    actionName: string,
    messages?: {
      loading?: string;
      success?: string;
      error?: string;
    },
  ) => {
    if (!repoPath) return;

    let toastId: string | number | null = null;
    setIsLoading(true);
    try {
      if (messages?.loading) {
        toastId = toast.info(messages.loading, {
          duration: 0,
        });
      }

      const result = await action();
      const remoteResult =
        typeof result === "boolean" ? { success: result, error: undefined } : result;

      if (remoteResult.success) {
        if (toastId) toast.dismiss(toastId);
        toast.success(messages?.success ?? `${actionName} completed.`);
        onRefresh?.();
      } else {
        const errorMessage = remoteResult.error || messages?.error || `${actionName} failed.`;
        if (toastId) toast.dismiss(toastId);
        toast.error(errorMessage);
        console.error(`${actionName} failed`, remoteResult.error);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : messages?.error || `${actionName} failed.`;
      if (toastId) toast.dismiss(toastId);
      toast.error(errorMessage);
      console.error(`${actionName} error:`, error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePush = () => {
    handleAction(() => pushChanges(repoPath!), "Push", {
      loading: "Pushing changes...",
      success: "Changes pushed successfully.",
      error: "Failed to push changes.",
    });
  };

  const handlePull = () => {
    handleAction(() => pullChanges(repoPath!), "Pull", {
      loading: "Pulling changes...",
      success: "Changes pulled successfully.",
      error: "Failed to pull changes.",
    });
  };

  const handleFetch = () => {
    handleAction(() => fetchChanges(repoPath!), "Fetch", {
      loading: "Fetching changes...",
      success: "Fetched successfully.",
      error: "Failed to fetch changes.",
    });
  };

  const handleDiscardAllChanges = async () => {
    if (!repoPath) return;
    if (
      confirmBeforeDiscard &&
      !(await showConfirmDialog("Discard all unstaged changes? This cannot be undone.", {
        title: "Discard Changes",
        confirmLabel: "Discard",
      }))
    ) {
      return;
    }
    handleAction(() => discardAllChanges(repoPath!), "Discard all changes");
  };

  const handleInitRepository = () => {
    if (onInitializeRepository) {
      void onInitializeRepository();
      return;
    }

    handleAction(() => initRepository(repoPath!), "Initialize repository");
  };

  const handleRefresh = async () => {
    await onRefresh?.();
  };

  const handleRemoteManager = () => {
    onOpenRemoteManager?.();
  };

  const handleBranchManager = () => {
    onOpenBranchManager?.();
  };

  const handleShowBranchDiff = () => {
    onShowBranchDiff?.();
  };

  const handleTagManager = () => {
    onOpenTagManager?.();
  };

  const handleViewStashes = () => {
    onViewStashes?.();
  };

  const handleSelectRepository = async () => {
    await onSelectRepository?.();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarIconButton tooltip="Git actions" aria-label="Git actions" />}
      >
        <DotsThreeIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {hasGitRepo ? (
          <>
            <DropdownMenuItem
              disabled={isSelectingRepository}
              onClick={() => void handleSelectRepository()}
            >
              <FolderOpen />
              {isSelectingRepository ? "Selecting..." : "Select repository"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBranchManager}>
              <GitBranch />
              Manage branches
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleShowBranchDiff}>
              <GitPullRequest />
              Show branch diff
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isLoading} onClick={handlePush}>
              <Upload />
              Push changes
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLoading} onClick={handlePull}>
              <Download weight="fill" />
              Pull changes
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLoading} onClick={handleFetch}>
              <GitPullRequest />
              Fetch
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleRemoteManager}>
              <Server />
              Manage remotes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleTagManager}>
              <Tag />
              Manage tags
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleViewStashes}>
              <Archive />
              View stashes
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : (
          <>
            <DropdownMenuItem
              disabled={isLoading || isInitializingRepository}
              onClick={handleInitRepository}
            >
              <Settings />
              {isInitializingRepository ? "Initializing..." : "Initialize repository"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <EyeIcon />
            Visibility
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Views</DropdownMenuLabel>
              {GIT_SIDEBAR_TAB_IDS.map((itemId) => (
                <DropdownMenuCheckboxItem
                  key={itemId}
                  checked={!hiddenItemIds.includes(itemId)}
                  closeOnClick={false}
                  onCheckedChange={(checked) => onItemVisibleChange(itemId, checked)}
                >
                  {SOURCE_CONTROL_ITEM_ICONS[itemId]}
                  {SOURCE_CONTROL_ITEM_LABELS[itemId]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Repository</DropdownMenuLabel>
              {GIT_SIDEBAR_ITEM_IDS.filter(
                (itemId): itemId is Extract<GitSidebarItemId, "remotes" | "tags" | "stashes"> =>
                  !GIT_SIDEBAR_TAB_IDS.includes(itemId as GitSidebarTabId),
              ).map((itemId) => (
                <DropdownMenuCheckboxItem
                  key={itemId}
                  checked={!hiddenItemIds.includes(itemId)}
                  closeOnClick={false}
                  onCheckedChange={(checked) => onItemVisibleChange(itemId, checked)}
                >
                  {SOURCE_CONTROL_ITEM_ICONS[itemId]}
                  {SOURCE_CONTROL_ITEM_LABELS[itemId]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem disabled={isRefreshing} onClick={() => void handleRefresh()}>
          {isRefreshing ? <Spinner label="Refreshing status" compact /> : <RefreshCw />}
          Refresh status
        </DropdownMenuItem>
        {hasGitRepo ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isLoading}
              onClick={() => void handleDiscardAllChanges()}
            >
              <RotateCcw />
              Discard all changes
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default GitActionsMenu;
