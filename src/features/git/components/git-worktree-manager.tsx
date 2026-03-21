import { Copy, GitBranch, GitCommit, GitFork, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useContextMenu } from "@/hooks/use-context-menu";
import Button from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { paneHeaderClassName, paneTitleClassName } from "@/ui/pane";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import {
  addWorktree,
  getWorktrees,
  pruneWorktrees,
  removeWorktree,
} from "../api/git-worktrees-api";
import type { GitWorktree } from "../types/git-types";

interface GitWorktreeManagerProps {
  isOpen?: boolean;
  onClose?: () => void;
  repoPath?: string;
  onRefresh?: () => void;
  onSelectWorktree?: (repoPath: string) => void;
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

  const handleRemoveWorktree = async (worktreePath: string) => {
    if (!repoPath) return;
    const confirmed = confirm(`Remove worktree at "${worktreePath}"?`);
    if (!confirmed) return;

    setActionLoading((prev) => new Set(prev).add(worktreePath));
    try {
      const success = await removeWorktree(repoPath, worktreePath, true);
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
          label: "Open",
          onClick: () => onSelectWorktree?.(contextMenu.data!.path),
        },
        {
          id: "copy-worktree-path",
          label: "Copy Path",
          icon: <Copy size={12} />,
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
                icon: <Trash2 size={12} />,
                className: "text-error hover:!bg-error/10 hover:!text-error",
                onClick: () => void handleRemoveWorktree(contextMenu.data!.path),
              },
            ]
          : []),
      ]
    : [];

  const content = (
    <div
      className={
        embedded ? "ui-font flex h-full min-h-0 flex-col" : "ui-font flex max-h-[70vh] flex-col"
      }
    >
      <div className="border-border/70 border-b">
        <div className={paneHeaderClassName("justify-between px-2 py-1.5")}>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={paneTitleClassName()}>Worktrees</span>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip content={isAddFormOpen ? "Hide add form" : "Add worktree"} side="bottom">
              <Button
                onClick={() => setIsAddFormOpen((value) => !value)}
                variant={isAddFormOpen ? "subtle" : "ghost"}
                size="icon-sm"
                active={isAddFormOpen}
                aria-label={isAddFormOpen ? "Hide add form" : "Add worktree"}
              >
                <Plus size={11} />
              </Button>
            </Tooltip>
            <Tooltip content="Prune worktrees" side="bottom">
              <Button
                onClick={() => void handlePruneWorktrees()}
                disabled={isLoading}
                variant="ghost"
                size="icon-sm"
                aria-label="Prune worktrees"
              >
                <RefreshCw size={11} className={cn(isLoading && "animate-spin")} />
              </Button>
            </Tooltip>
          </div>
        </div>

        {isAddFormOpen && (
          <div className="border-border/70 border-t bg-secondary-bg/35 px-2 py-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="ui-font font-medium text-text text-xs">Create worktree</div>
                <div className="text-text-lighter text-[11px]">
                  Add another checkout for this repository.
                </div>
              </div>
            </div>
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
              <label className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-xs text-text-lighter">
                <Checkbox checked={createBranch} onChange={setCreateBranch} />
                <span>Create a new branch for this worktree</span>
              </label>
              <div className="flex justify-end gap-1.5">
                <Button
                  type="button"
                  onClick={() => setIsAddFormOpen(false)}
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleAddWorktree()}
                  disabled={isLoading || !path.trim() || (createBranch && !branch.trim())}
                  variant="subtle"
                  size="sm"
                  className="h-7 px-2"
                >
                  {isLoading ? "Adding..." : "Create Worktree"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading && worktrees.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-dashed border-border/70 bg-secondary-bg/20 px-4 text-center text-text-lighter text-xs">
            Loading worktrees...
          </div>
        ) : worktrees.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-dashed border-border/70 bg-secondary-bg/20 px-4 text-center text-text-lighter text-xs">
            No worktrees found
          </div>
        ) : (
          worktrees.map((worktree) => {
            const isActionBusy = actionLoading.has(worktree.path);
            const relativePath = getRelativePath(worktree.path, repoPath);
            const worktreeName = getFolderName(worktree.path);
            const branchLabel =
              worktree.branch || (worktree.is_detached ? "Detached HEAD" : "No branch");

            return (
              <div
                key={worktree.path}
                onContextMenu={(e) =>
                  contextMenu.open(e, { path: worktree.path, isCurrent: worktree.is_current })
                }
                className={cn(
                  "mb-1.5 rounded-xl border border-border/70 bg-secondary-bg/35 px-2.5 py-2 last:mb-0",
                  "transition-colors hover:bg-hover/60",
                  worktree.is_current && "border-border-strong/80 bg-hover/50",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSelectWorktree?.(worktree.path)}
                        className="min-w-0 truncate text-left font-medium text-text text-xs hover:text-text"
                        title={worktree.path}
                      >
                        {worktreeName}
                      </button>
                      {worktree.is_current && (
                        <span className="shrink-0 rounded-full border border-border/70 bg-primary-bg px-1.5 py-0.5 text-[10px] text-text">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-text-lighter">
                      {relativePath === worktree.path ? worktree.path : relativePath}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-lighter">
                      <div className="inline-flex items-center gap-1 rounded-md bg-primary-bg/70 px-1.5 py-1">
                        <GitBranch size={10} />
                        <span>{branchLabel}</span>
                      </div>
                      <div className="inline-flex items-center gap-1 rounded-md bg-primary-bg/70 px-1.5 py-1">
                        <GitCommit size={10} />
                        <span>{worktree.head.slice(0, 7)}</span>
                      </div>
                      {worktree.prunable_reason && (
                        <span className="rounded-md bg-primary-bg/70 px-1.5 py-1">Prunable</span>
                      )}
                      {worktree.locked_reason && (
                        <span className="rounded-md bg-primary-bg/70 px-1.5 py-1">Locked</span>
                      )}
                    </div>
                    <Button
                      onClick={() => onSelectWorktree?.(worktree.path)}
                      variant="ghost"
                      size="xs"
                      className="mt-1 h-6 px-1.5 text-text-lighter hover:text-text"
                    >
                      Open
                    </Button>
                  </div>
                  {!worktree.is_current && (
                    <Tooltip content="Remove worktree" side="left">
                      <Button
                        onClick={() => void handleRemoveWorktree(worktree.path)}
                        disabled={isActionBusy}
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-text-lighter hover:text-red-300"
                        aria-label="Remove worktree"
                      >
                        <Trash2 size={10} />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </div>
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
