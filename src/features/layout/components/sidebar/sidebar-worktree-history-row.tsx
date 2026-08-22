import { removeWorktree } from "@/features/git/api/git-worktrees-api";
import type { GitWorktree } from "@/features/git/types/git.types";
import { openGitWorktreeWorkspace } from "@/features/git/utils/git-worktree-open";
import { useToast } from "@/features/layout/contexts/toast-context";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { showConfirmDialog } from "@/ui/dialog";
import { CopyIcon, NodesIcon, OpenExternalIcon, TrashIcon, WindowExpandIcon } from "@/ui/icons";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";
import { writeClipboardText } from "@/utils/clipboard";
import { getFolderName } from "@/utils/path-helpers";

interface SidebarWorktreeHistoryRowProps {
  repoPath: string;
  worktree: GitWorktree;
}

export function SidebarWorktreeHistoryRow({ repoPath, worktree }: SidebarWorktreeHistoryRowProps) {
  const { showToast } = useToast();
  const canRemove = !worktree.is_current;

  const openWorktree = () => {
    if (!worktree.is_current) void openGitWorktreeWorkspace(worktree.path);
  };

  const openWorktreeInNewWindow = () => {
    void openGitWorktreeWorkspace(worktree.path, { target: "new-window" });
  };

  const handleRemove = async () => {
    if (!canRemove) return;

    const confirmed = await showConfirmDialog(`Remove the worktree at "${worktree.path}"?`, {
      title: "Remove Worktree",
      confirmLabel: "Remove",
    });
    if (!confirmed) return;

    const removed = await removeWorktree(repoPath, worktree.path);
    showToast({
      type: removed ? "success" : "error",
      message: removed ? "Worktree removed" : "Failed to remove worktree",
      description: removed ? getFolderName(worktree.path) : worktree.path,
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block" onContextMenu={(event) => event.stopPropagation()}>
        <div className="group/sidebar-worktree relative flex w-full min-w-0 items-center">
          <SidebarListItem
            active={worktree.is_current}
            leading={<NodesIcon className="size-4" />}
            trailing={
              <span className="transition-opacity group-hover/sidebar-worktree:opacity-0 group-focus-within/sidebar-worktree:opacity-0">
                {worktree.branch}
              </span>
            }
            title={worktree.path}
            className="pr-12"
            onClick={openWorktree}
          >
            {getFolderName(worktree.path)}
          </SidebarListItem>

          <span className="pointer-events-none absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/sidebar-worktree:pointer-events-auto group-hover/sidebar-worktree:opacity-100 group-focus-within/sidebar-worktree:pointer-events-auto group-focus-within/sidebar-worktree:opacity-100">
            <SidebarIconButton
              tooltip="Open in New Window"
              tooltipSide="right"
              onClick={(event) => {
                event.stopPropagation();
                openWorktreeInNewWindow();
              }}
            >
              <WindowExpandIcon className="size-3" />
            </SidebarIconButton>
            {canRemove ? (
              <SidebarIconButton
                className="hover:text-destructive"
                tooltip="Remove Worktree"
                tooltipSide="right"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleRemove();
                }}
              >
                <TrashIcon className="size-3" />
              </SidebarIconButton>
            ) : null}
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem disabled={worktree.is_current} onClick={openWorktree}>
          <OpenExternalIcon />
          Open Worktree
        </ContextMenuItem>
        <ContextMenuItem onClick={openWorktreeInNewWindow}>
          <WindowExpandIcon />
          Open in New Window
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void writeClipboardText(worktree.path)}>
          <CopyIcon />
          Copy Path
        </ContextMenuItem>
        {canRemove ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => void handleRemove()}>
              <TrashIcon />
              Remove Worktree
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
