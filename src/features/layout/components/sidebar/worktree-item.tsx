import { removeWorktree } from "@/features/git/api/git-worktrees-api";
import type { GitWorktree } from "@/features/git/types/git.types";
import { openGitWorktreeWorkspace } from "@/features/git/utils/git-worktree-open";
import { useToast } from "@/features/layout/contexts/toast-context";
import { showConfirmDialog } from "@/ui/dialog";
import { CopyIcon, NodesIcon, TrashIcon, WindowExpandIcon } from "@/ui/icons";
import { SidebarIconButton, SidebarListActionRow, SidebarListItem } from "@/ui/sidebar";
import { writeClipboardText } from "@/utils/clipboard";
import { getFolderName } from "@/utils/path-helpers";

interface WorktreeItemProps {
  repoPath: string;
  worktree: GitWorktree;
}

export function WorktreeItem({ repoPath, worktree }: WorktreeItemProps) {
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
    <SidebarListActionRow
      actions={[
        <SidebarIconButton
          key="new-window"
          tooltip="Open in New Window"
          tooltipSide="top"
          onClick={(event) => {
            event.stopPropagation();
            openWorktreeInNewWindow();
          }}
        >
          <WindowExpandIcon className="size-3" />
        </SidebarIconButton>,
        <SidebarIconButton
          key="copy"
          tooltip="Copy Path"
          tooltipSide="top"
          onClick={(event) => {
            event.stopPropagation();
            void writeClipboardText(worktree.path);
          }}
        >
          <CopyIcon className="size-3" />
        </SidebarIconButton>,
        canRemove ? (
          <SidebarIconButton
            key="remove"
            className="hover:text-destructive"
            tooltip="Remove Worktree"
            tooltipSide="top"
            onClick={(event) => {
              event.stopPropagation();
              void handleRemove();
            }}
          >
            <TrashIcon className="size-3" />
          </SidebarIconButton>
        ) : null,
      ]}
    >
      <SidebarListItem
        active={worktree.is_current}
        appearance="activity"
        leading={<NodesIcon className="size-4" />}
        title={worktree.path}
        onClick={openWorktree}
      >
        {getFolderName(worktree.path)}
      </SidebarListItem>
    </SidebarListActionRow>
  );
}
