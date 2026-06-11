import {
  CheckIcon as Check,
  GitBranchIcon as GitBranch,
  GitForkIcon as GitFork,
  PlusIcon as Plus,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandItem, CommandList } from "@/ui/command";
import { LoadingIndicator } from "@/ui/loading";
import { cn } from "@/utils/cn";
import { getFolderName } from "@/utils/path-helpers";
import { addWorktree, getWorktrees } from "../api/git-worktrees-api";
import type { GitWorktree } from "../types/git.types";
import GitCommandSurface from "./git-command-surface";

interface GitWorktreeSwitcherProps {
  repoPath?: string;
  onWorktreeChange?: (repoPath: string) => void;
  placement?: "up" | "down";
  triggerIconSize?: number;
  triggerClassName?: string;
  triggerInputClassName?: string;
}

function getWorktreeLabel(worktree: GitWorktree | undefined, fallbackPath: string) {
  return getFolderName(worktree?.path ?? fallbackPath);
}

function getBranchLabel(worktree: GitWorktree) {
  return worktree.branch || (worktree.is_detached ? "Detached HEAD" : "No branch");
}

function getFilteredWorktrees(worktrees: GitWorktree[], repoPath: string, query: string) {
  const sorted = [...worktrees].sort((a, b) => {
    if (a.path === repoPath) return -1;
    if (b.path === repoPath) return 1;
    return getFolderName(a.path).localeCompare(getFolderName(b.path));
  });

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return sorted;

  return sorted.filter((worktree) => {
    const searchable = [
      getFolderName(worktree.path),
      worktree.path,
      worktree.branch,
      worktree.head.slice(0, 7),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(normalizedQuery);
  });
}

function getCreateWorktreePath(worktrees: GitWorktree[], query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return null;
  if (worktrees.some((worktree) => worktree.path === trimmedQuery)) return null;

  return trimmedQuery;
}

const GitWorktreeSwitcher = ({
  repoPath,
  onWorktreeChange,
  placement = "down",
  triggerIconSize,
  triggerClassName,
  triggerInputClassName,
}: GitWorktreeSwitcherProps) => {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [worktreeQuery, setWorktreeQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const activeRepoPath = repoPath ?? "";
  const activeWorktree = worktrees.find((worktree) => worktree.path === activeRepoPath);
  const triggerText = getWorktreeLabel(activeWorktree, activeRepoPath);
  const triggerTextWidthCh = Math.min(Math.max(triggerText.length + 1, 6), 38);
  const filteredWorktrees = useMemo(
    () => getFilteredWorktrees(worktrees, activeRepoPath, worktreeQuery),
    [activeRepoPath, worktreeQuery, worktrees],
  );
  const createWorktreePath = useMemo(
    () => getCreateWorktreePath(worktrees, worktreeQuery),
    [worktreeQuery, worktrees],
  );

  const loadWorktrees = useCallback(async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const nextWorktrees = await getWorktrees(repoPath);
      setWorktrees(nextWorktrees);
    } finally {
      setIsLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    if (repoPath && isDropdownOpen) {
      void loadWorktrees();
    }
  }, [isDropdownOpen, loadWorktrees, repoPath]);

  useEffect(() => {
    if (!isDropdownOpen) {
      setWorktreeQuery("");
      setSelectedIndex(0);
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [worktreeQuery]);

  if (!repoPath) {
    return null;
  }

  const handleOpenDropdown = async () => {
    if (isDropdownOpen) return;
    setIsDropdownOpen(true);
    await loadWorktrees();
  };

  const handleWorktreeChange = (worktreePath: string) => {
    if (!worktreePath || worktreePath === repoPath) {
      setIsDropdownOpen(false);
      return;
    }

    setIsDropdownOpen(false);
    onWorktreeChange?.(worktreePath);
  };

  const handleCreateWorktree = async (worktreePath: string) => {
    if (!repoPath || !worktreePath.trim()) return;

    setIsLoading(true);
    try {
      const success = await addWorktree(repoPath, worktreePath.trim());
      if (!success) return;

      await loadWorktrees();
      setWorktreeQuery("");
      setIsDropdownOpen(false);
      onWorktreeChange?.(worktreePath.trim());
    } finally {
      setIsLoading(false);
    }
  };

  const commandEntries = [
    ...(createWorktreePath ? [{ type: "create" as const, value: createWorktreePath }] : []),
    ...filteredWorktrees.map((worktree) => ({ type: "worktree" as const, value: worktree.path })),
  ];

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(commandEntries.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectedEntry = commandEntries[selectedIndex];
      if (!selectedEntry) return;
      if (selectedEntry.type === "create") {
        void handleCreateWorktree(selectedEntry.value);
      } else {
        handleWorktreeChange(selectedEntry.value);
      }
    }
  };

  return (
    <>
      <Button
        onClick={() => void handleOpenDropdown()}
        disabled={isLoading}
        variant="ghost"
        className={cn(
          "inline-flex max-w-full shrink-0 overflow-hidden px-2 text-text-lighter hover:bg-hover/80",
          isDropdownOpen ? "bg-hover/80" : "cursor-pointer",
          triggerClassName,
        )}
        aria-label="Search worktrees"
      >
        <GitFork size={triggerIconSize} className="shrink-0" />
        <span
          className={cn("ui-text-sm min-w-0 truncate font-normal", triggerInputClassName)}
          style={{ maxWidth: `${triggerTextWidthCh}ch` }}
        >
          {triggerText}
        </span>
      </Button>

      <GitCommandSurface
        isOpen={isDropdownOpen}
        onClose={() => setIsDropdownOpen(false)}
        query={worktreeQuery}
        onQueryChange={setWorktreeQuery}
        onInputKeyDown={handleCommandKeyDown}
        placeholder="Search worktrees..."
        meta={`${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}`}
        placement={placement === "up" ? "bottom" : "top"}
      >
        <CommandList>
          {filteredWorktrees.length === 0 ? (
            <CommandEmpty>
              {isLoading ? (
                <LoadingIndicator label="Loading worktrees" showLabel compact />
              ) : (
                "No worktrees found"
              )}
            </CommandEmpty>
          ) : null}
          {worktrees.length > 0 ? (
            <div className="space-y-1">
              {createWorktreePath ? (
                <CommandItem
                  type="button"
                  onClick={() => void handleCreateWorktree(createWorktreePath)}
                  disabled={isLoading}
                  isSelected={selectedIndex === 0}
                  onMouseEnter={() => setSelectedIndex(0)}
                  className="ui-font"
                >
                  <Plus size={14} className="shrink-0 text-text-lighter" />
                  <span className="ui-text-xs min-w-0 flex-1 truncate text-text">
                    Create worktree "{createWorktreePath}"
                  </span>
                </CommandItem>
              ) : null}
              {filteredWorktrees.map((worktree, index) => (
                <WorktreeRow
                  key={worktree.path}
                  worktree={worktree}
                  isCurrent={worktree.path === repoPath}
                  isSelected={selectedIndex === index + (createWorktreePath ? 1 : 0)}
                  onMouseEnter={() => setSelectedIndex(index + (createWorktreePath ? 1 : 0))}
                  onSelect={() => handleWorktreeChange(worktree.path)}
                />
              ))}
            </div>
          ) : null}
        </CommandList>
      </GitCommandSurface>
    </>
  );
};

function WorktreeRow({
  worktree,
  isCurrent,
  isSelected,
  onMouseEnter,
  onSelect,
}: {
  worktree: GitWorktree;
  isCurrent: boolean;
  isSelected: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      isSelected={isSelected}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      className={cn("group ui-font", isCurrent ? "text-text" : "text-text-lighter hover:text-text")}
    >
      {isCurrent ? (
        <Check size={14} className="shrink-0 text-success" />
      ) : (
        <GitFork size={14} className="shrink-0 text-text-lighter" />
      )}
      <span className="ui-text-xs min-w-0 flex-1 truncate text-text">
        {getFolderName(worktree.path)}
      </span>
      <span className="ui-text-xs flex max-w-[45%] shrink min-w-0 items-center gap-1.5 text-text-lighter/80">
        <GitBranch className="size-3.5 shrink-0" />
        <span className="truncate">{getBranchLabel(worktree)}</span>
      </span>
      {isCurrent ? <span className="ui-text-xs ml-auto shrink-0 text-success">current</span> : null}
    </CommandItem>
  );
}

export default GitWorktreeSwitcher;
