import {
  Copy,
  GitBranch,
  GitCommit,
  GitFork,
  ArrowSquareOut,
  Plus,
  ArrowClockwise as RefreshCw,
  Trash as Trash2,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import { primitiveConfirm } from "@/ui/primitive-dialog-service";
import { SidebarListItem } from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import {
  addWorktree,
  getWorktrees,
  pruneWorktrees,
  removeWorktree,
} from "../api/git-worktrees-api";
import type { GitWorktree } from "../types/git-types";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/sidebar-resource-drag";
import GitSidebarSectionHeader, {
  gitSidebarSectionActionButtonClassName,
} from "./git-sidebar-section-header";

interface GitWorktreeManagerProps {
  isOpen?: boolean;
  onClose?: () => void;
  repoPath?: string;
  onRefresh?: () => void;
  onSelectWorktree?: (repoPath: string) => void | Promise<void>;
  onOpenWorktreeInNewWindow?: (repoPath: string) => void | Promise<void>;
  embedded?: boolean;
}

interface WorktreeContextMenuData {
  path: string;
  isCurrent: boolean;
}

const GitWorktreeManager = ({
  isOpen = true,
  onClose,
  repoPath,
  onRefresh,
  onSelectWorktree,
  onOpenWorktreeInNewWindow,
  embedded = false,
}: GitWorktreeManagerProps) => {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const contextMenu = useContextMenu<WorktreeContextMenuData>();

  useEffect(() => {
    if (isOpen) {
      void loadWorktrees();
    }
  }, [isOpen, repoPath]);

  useEffect(() => {
    if (!isOpen) {
      setIsAddFormOpen(false);
    }
  }, [isOpen]);

  const loadWorktrees = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const nextWorktrees = await getWorktrees(repoPath);
      setWorktrees(nextWorktrees);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddWorktree = async () => {
    if (!repoPath || !path.trim()) return;

    setIsLoading(true);
    try {
      const success = await addWorktree(
        repoPath,
        path.trim(),
        branch.trim() || undefined,
        createBranch,
      );
      if (success) {
        setPath("");
        setBranch("");
        setCreateBranch(false);
        setIsAddFormOpen(false);
        await loadWorktrees();
        onRefresh?.();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveWorktree = async (worktreePath: string, force = false) => {
    if (!repoPath) return;
    const confirmed = await primitiveConfirm(
      force
        ? `Force remove worktree at "${worktreePath}"? This can discard uncommitted changes in that checkout.`
        : `Remove worktree at "${worktreePath}"?`,
      {
        title: force ? "Force Remove Worktree" : "Remove Worktree",
        confirmLabel: force ? "Force Remove" : "Remove",
      },
    );
    if (!confirmed) return;

    setActionLoading((prev) => new Set(prev).add(worktreePath));
    try {
      const success = await removeWorktree(repoPath, worktreePath, force);
      if (success) {
        await loadWorktrees();
        onRefresh?.();
      }
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(worktreePath);
        return next;
      });
    }
  };

  const handlePruneWorktrees = async () => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      const success = await pruneWorktrees(repoPath);
      if (success) {
        await loadWorktrees();
        onRefresh?.();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyPath = async (worktreePath: string) => {
    try {
      await navigator.clipboard.writeText(worktreePath);
    } catch (error) {
      console.error("Failed to copy worktree path:", error);
    }
  };

  if (!embedded && !isOpen) {
    return null;
  }

  const contextMenuItems: ContextMenuItem[] = contextMenu.data
    ? [
        {
          id: "open-worktree",
          label: "Open Workspace",
          icon: <GitFork />,
          onClick: () => onSelectWorktree?.(contextMenu.data!.path),
        },
        ...(onOpenWorktreeInNewWindow
          ? [
              {
                id: "open-worktree-new-window",
                label: "Open in New Window",
                icon: <ArrowSquareOut />,
                onClick: () => onOpenWorktreeInNewWindow(contextMenu.data!.path),
              },
            ]
          : []),
        {
          id: "copy-worktree-path",
          label: "Copy Path",
          icon: <Copy />,
          onClick: () => void handleCopyPath(contextMenu.data!.path),
        },
        ...(!contextMenu.data.isCurrent
          ? [
              {
                id: "sep-1",
                label: "",
                separator: true,
                onClick: () => {},
              },
              {
                id: "remove-worktree",
                label: "Remove",
                icon: <Trash2 />,
                className: "text-error hover:!bg-error/10 hover:!text-error",
                onClick: () => void handleRemoveWorktree(contextMenu.data!.path),
              },
              {
                id: "force-remove-worktree",
                label: "Force Remove",
                icon: <Trash2 />,
                className: "text-error hover:!bg-error/10 hover:!text-error",
                onClick: () => void handleRemoveWorktree(contextMenu.data!.path, true),
              },
            ]
          : []),
      ]
    : [];
  const hasPrunableWorktrees = worktrees.some((worktree) => Boolean(worktree.prunable_reason));

  const content = (
    <div
      className={
        embedded ? "ui-font flex h-full min-h-0 flex-col" : "ui-font flex max-h-[70vh] flex-col"
      }
    >
      <div className="shrink-0 px-1 py-1">
        <GitSidebarSectionHeader
          title="Worktrees"
          actions={
            <>
              <Button
                onClick={() => setIsAddFormOpen((value) => !value)}
                variant="ghost"
                compact
                className={cn(
                  gitSidebarSectionActionButtonClassName(),
                  isAddFormOpen && "bg-hover text-text",
                )}
                data-active={isAddFormOpen}
                aria-label={isAddFormOpen ? "Hide add form" : "Add worktree"}
                tooltip={isAddFormOpen ? "Hide add form" : "Add worktree"}
              >
                <Plus />
              </Button>
              {hasPrunableWorktrees ? (
                <Button
                  onClick={() => void handlePruneWorktrees()}
                  disabled={isLoading}
                  variant="ghost"
                  compact
                  className={gitSidebarSectionActionButtonClassName("disabled:opacity-50")}
                  aria-label="Prune worktrees"
                  tooltip="Prune prunable worktrees"
                >
                  {isLoading ? (
                    <LoadingIndicator label="Pruning worktrees" compact />
                  ) : (
                    <RefreshCw />
                  )}
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      {isAddFormOpen && (
        <div className="mx-1 mb-1 rounded-lg border border-border/60 bg-secondary-bg/25 px-2.5 py-2">
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Path to new worktree"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="w-full"
            />
            <Input
              type="text"
              placeholder={createBranch ? "New branch name" : "Branch or commit (optional)"}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleAddWorktree();
                }
              }}
            />
            <label className="ui-text-sm flex items-center gap-2 rounded-lg px-1 py-0.5 text-text-lighter">
              <Checkbox checked={createBranch} onChange={setCreateBranch} />
              <span>Create a new branch for this worktree</span>
            </label>
            <div className="flex justify-end gap-1.5">
              <Button
                type="button"
                onClick={() => setIsAddFormOpen(false)}
                variant="ghost"
                compact
                className="h-7 px-2"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleAddWorktree()}
                disabled={isLoading || !path.trim() || (createBranch && !branch.trim())}
                variant="default"
                compact
                className="h-7 px-2"
              >
                {isLoading ? "Adding..." : "Create Worktree"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {isLoading && worktrees.length === 0 ? (
          <div className="ui-text-sm flex h-full min-h-[160px] items-center justify-center px-4 text-center text-text-lighter">
            <LoadingIndicator label="Loading worktrees" showLabel compact />
          </div>
        ) : worktrees.length === 0 ? (
          <div className="ui-text-sm flex h-full min-h-[160px] items-center justify-center px-4 text-center text-text-lighter">
            No worktrees found
          </div>
        ) : (
          worktrees.map((worktree) => {
            const isActionBusy = actionLoading.has(worktree.path);
            const relativePath = getRelativePath(worktree.path, repoPath);
            const worktreeName = getFolderName(worktree.path);
            const branchLabel =
              worktree.branch || (worktree.is_detached ? "Detached HEAD" : "No branch");
            const statusLabel = worktree.locked_reason
              ? "Locked"
              : worktree.prunable_reason
                ? "Prunable"
                : worktree.is_bare
                  ? "Bare"
                  : null;

            return (
              <SidebarListItem
                key={worktree.path}
                onClick={() => onSelectWorktree?.(worktree.path)}
                onContextMenu={(e) =>
                  contextMenu.open(e, { path: worktree.path, isCurrent: worktree.is_current })
                }
                draggable
                onDragStart={(event) => {
                  writeSidebarResourceDragData(event.dataTransfer, {
                    type: "git-worktree",
                    path: worktree.path,
                    branch: worktree.branch,
                    name: worktreeName,
                  });
                }}
                className={cn(
                  "mb-px items-start rounded-md border border-transparent px-2 py-2 transition-[transform,background-color,border-color,opacity]",
                  worktree.is_current && "border-border/60",
                )}
                active={worktree.is_current}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate ui-text-sm text-text leading-4" title={worktree.path}>
                      {worktreeName}
                    </span>
                    {worktree.is_current && (
                      <span className="ui-text-xs shrink-0 rounded-md bg-secondary-bg/80 px-1.5 py-0.5 text-text-lighter">
                        Current
                      </span>
                    )}
                    {statusLabel && (
                      <span className="ui-text-xs shrink-0 rounded-md bg-secondary-bg/80 px-1.5 py-0.5 text-text-lighter">
                        {statusLabel}
                      </span>
                    )}
                    {isActionBusy ? (
                      <span className="ui-text-xs shrink-0 text-text-lighter">Removing...</span>
                    ) : null}
                  </div>

                  <div className="mt-1 flex min-w-0 items-center gap-2 text-text-lighter/90">
                    <span className="ui-text-xs inline-flex min-w-0 flex-1 items-center gap-1 editor-font">
                      <GitBranch className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{branchLabel}</span>
                    </span>
                    <span className="ui-text-xs inline-flex shrink-0 items-center gap-1 editor-font">
                      <GitCommit className="size-3.5 shrink-0" />
                      <span>{worktree.head.slice(0, 7)}</span>
                    </span>
                  </div>

                  <div className="ui-text-xs mt-1 truncate text-text-lighter/70">
                    {relativePath === worktree.path ? worktree.path : relativePath}
                  </div>
                </div>
              </SidebarListItem>
            );
          })
        )}
      </div>

      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={contextMenuItems}
        onClose={contextMenu.close}
      />
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <Dialog
      onClose={onClose ?? (() => {})}
      title="Worktrees"
      icon={GitFork}
      size="lg"
      classNames={{ content: "p-0" }}
    >
      {content}
    </Dialog>
  );
};

export default GitWorktreeManager;
