import { FolderOpen, GitBranch, GitCommit, GitFork, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
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

  if (!embedded && !isOpen) {
    return null;
  }

  const content = (
    <div
      className={
        embedded ? "ui-font flex h-full min-h-0 flex-col" : "ui-font flex max-h-[70vh] flex-col"
      }
    >
      <div className="border-border/70 border-b px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-1.5">
          <Button
            onClick={() => setIsAddFormOpen((value) => !value)}
            variant="ghost"
            size="sm"
            className="h-7 justify-start px-2"
          >
            <Plus size={11} />
            <span>{isAddFormOpen ? "Hide Add Worktree" : "Add Worktree"}</span>
          </Button>
          <Button
            onClick={() => void handlePruneWorktrees()}
            disabled={isLoading}
            variant="ghost"
            size="sm"
            className="h-7 px-2"
          >
            Prune
          </Button>
        </div>

        {isAddFormOpen && (
          <div className="mt-2 space-y-2">
            <Input
              type="text"
              placeholder="Path to new worktree"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="w-full bg-primary-bg"
            />
            <Input
              type="text"
              placeholder={createBranch ? "New branch name" : "Branch or commit (optional)"}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full bg-primary-bg"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleAddWorktree();
                }
              }}
            />
            <div className="flex items-center gap-2 text-xs text-text-lighter">
              <Checkbox checked={createBranch} onChange={setCreateBranch} />
              <span>Create a new branch for this worktree</span>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => void handleAddWorktree()}
                disabled={isLoading || !path.trim() || (createBranch && !branch.trim())}
                size="sm"
                className="h-7 px-2"
              >
                {isLoading ? "Adding..." : "Create Worktree"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {isLoading && worktrees.length === 0 ? (
          <div className="p-4 text-center text-text-lighter text-xs">Loading worktrees...</div>
        ) : worktrees.length === 0 ? (
          <div className="p-4 text-center text-text-lighter text-xs">No worktrees found</div>
        ) : (
          worktrees.map((worktree) => {
            const isActionBusy = actionLoading.has(worktree.path);

            return (
              <div
                key={worktree.path}
                className="mb-1 rounded-lg px-2.5 py-1.5 last:mb-0 hover:bg-hover"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <FolderOpen size={12} className="text-text-lighter" />
                      <span className="truncate text-text text-xs">{worktree.path}</span>
                      {worktree.is_current && (
                        <span className="rounded-full bg-selected px-1.5 py-0.5 text-[9px] text-text">
                          Current
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-lighter">
                      <div className="flex items-center gap-1">
                        <GitBranch size={10} />
                        <span>
                          {worktree.branch || (worktree.is_detached ? "Detached" : "No branch")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <GitCommit size={10} />
                        <span>{worktree.head.slice(0, 7)}</span>
                      </div>
                      {worktree.prunable_reason && <span>Prunable</span>}
                      {worktree.locked_reason && <span>Locked</span>}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      onClick={() => onSelectWorktree?.(worktree.path)}
                      variant="ghost"
                      size="xs"
                      className="h-6 px-1.5"
                    >
                      Open
                    </Button>
                    {!worktree.is_current && (
                      <Button
                        onClick={() => void handleRemoveWorktree(worktree.path)}
                        disabled={isActionBusy}
                        variant="ghost"
                        size="xs"
                        className="h-6 px-1.5 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        title="Remove worktree"
                      >
                        <Trash2 size={10} />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-border/70 border-t bg-secondary-bg/40 px-2.5 py-1.5 text-[10px] text-text-lighter">
        {worktrees.length} worktree{worktrees.length !== 1 ? "s" : ""} available
      </div>
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
