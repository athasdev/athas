import { Check, GitBranch, GitFork, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxActionItem,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/ui/combobox";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { addWorktree, getWorktrees } from "../api/git-worktrees-api";
import type { GitWorktree } from "../types/git-types";

interface GitWorktreeSwitcherProps {
  repoPath?: string;
  onWorktreeChange?: (repoPath: string) => void;
  placement?: "up" | "down";
}

const WORKTREE_SWITCHER_DROPDOWN_WIDTH = 380;

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
}: GitWorktreeSwitcherProps) => {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [worktreeQuery, setWorktreeQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRepoPath = repoPath ?? "";
  const activeWorktree = worktrees.find((worktree) => worktree.path === activeRepoPath);
  const triggerText = isDropdownOpen
    ? worktreeQuery || getWorktreeLabel(activeWorktree, activeRepoPath)
    : getWorktreeLabel(activeWorktree, activeRepoPath);
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
    }
  }, [isDropdownOpen]);

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

  return (
    <Combobox
      items={filteredWorktrees.map((worktree) => worktree.path)}
      value={repoPath}
      inputValue={isDropdownOpen ? worktreeQuery : getWorktreeLabel(activeWorktree, repoPath)}
      open={isDropdownOpen}
      filter={null}
      itemToStringLabel={(worktreePath) =>
        getWorktreeLabel(
          worktrees.find((worktree) => worktree.path === worktreePath),
          worktreePath,
        )
      }
      itemToStringValue={(worktreePath) => worktreePath}
      onInputValueChange={(value) => {
        setWorktreeQuery(value);
        if (!isDropdownOpen) {
          void handleOpenDropdown();
        }
      }}
      onOpenChange={(open) => {
        setIsDropdownOpen(open);
        if (open) {
          void loadWorktrees();
        }
      }}
      onValueChange={(value) => {
        if (typeof value === "string") {
          handleWorktreeChange(value);
        }
      }}
    >
      <ComboboxInput
        ref={inputRef}
        onFocus={() => void handleOpenDropdown()}
        onClick={() => void handleOpenDropdown()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsDropdownOpen(false);
          }
        }}
        disabled={isLoading}
        readOnly={!isDropdownOpen}
        leftIcon={GitFork}
        variant="ghost"
        showTrigger={false}
        showClear={false}
        className={cn(
          "inline-flex w-fit max-w-[360px] shrink-0 hover:bg-hover/80",
          isDropdownOpen ? "bg-hover/80" : "cursor-pointer",
        )}
        inputClassName={cn(
          "truncate pr-0 pl-7 font-normal",
          isDropdownOpen ? "cursor-text text-text" : "cursor-pointer text-text-lighter",
        )}
        containerStyle={{ width: "fit-content", maxWidth: "360px" }}
        inputStyle={{ width: `calc(${triggerTextWidthCh}ch + 1.75rem)`, flex: "0 0 auto" }}
        placeholder={getWorktreeLabel(activeWorktree, repoPath)}
        aria-label="Search worktrees"
      />

      <ComboboxContent
        side={placement === "up" ? "top" : "bottom"}
        className="flex flex-col rounded-2xl p-0"
        style={{
          width: `min(${WORKTREE_SWITCHER_DROPDOWN_WIDTH}px, calc(100vw - 16px))`,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "260px",
        }}
      >
        <ComboboxList className="min-h-0 flex-1 p-2">
          {filteredWorktrees.length === 0 ? (
            <ComboboxEmpty>
              {isLoading ? "Loading worktrees..." : "No worktrees found"}
            </ComboboxEmpty>
          ) : null}
          {worktrees.length > 0 ? (
            <div className="space-y-1">
              {createWorktreePath ? (
                <ComboboxActionItem
                  type="button"
                  onClick={() => void handleCreateWorktree(createWorktreePath)}
                  disabled={isLoading}
                  className={filteredWorktrees.length === 0 ? "bg-hover" : undefined}
                >
                  <Plus className="shrink-0 text-text-lighter" />
                  <span className="min-w-0 flex-1 truncate">
                    Create worktree "{createWorktreePath}"
                  </span>
                </ComboboxActionItem>
              ) : null}
              {filteredWorktrees.map((worktree) => (
                <WorktreeRow
                  key={worktree.path}
                  worktree={worktree}
                  repoPath={repoPath}
                  isCurrent={worktree.path === repoPath}
                />
              ))}
            </div>
          ) : null}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
};

function WorktreeRow({
  worktree,
  repoPath,
  isCurrent,
}: {
  worktree: GitWorktree;
  repoPath: string;
  isCurrent: boolean;
}) {
  const relativePath = getRelativePath(worktree.path, repoPath);

  return (
    <ComboboxItem
      value={worktree.path}
      showIndicator={false}
      className={cn(
        "group",
        isCurrent ? "font-medium text-text" : "text-text-lighter hover:text-text",
      )}
    >
      {isCurrent ? (
        <Check className="shrink-0 text-success" />
      ) : (
        <GitFork className="shrink-0 text-text-lighter" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{getFolderName(worktree.path)}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-text-lighter/80 ui-text-sm">
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate">{getBranchLabel(worktree)}</span>
          <span className="shrink-0 text-text-lighter/50">/</span>
          <span className="truncate">
            {relativePath === worktree.path ? worktree.path : relativePath}
          </span>
        </span>
      </span>
      {isCurrent ? <span className="ui-text-sm ml-auto shrink-0 text-success">current</span> : null}
    </ComboboxItem>
  );
}

export default GitWorktreeSwitcher;
