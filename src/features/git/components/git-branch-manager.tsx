import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckIcon as Check,
  FolderOpenIcon as FolderOpen,
  GitBranchIcon as GitBranch,
  GitForkIcon as GitFork,
  PlusIcon as Plus,
  ArrowClockwiseIcon as RefreshCw,
  TrashIcon as Trash2,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { Tab, type TabsItem } from "@/ui/tabs";
import { showConfirmDialog } from "@/features/dialogs/services/dialog-service";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { matchesSearchQuery } from "@/utils/search-match";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../api/git-branches-api";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { createStash } from "../api/git-stash-api";
import { addWorktree, getWorktrees } from "../api/git-worktrees-api";
import { useRepositoryStore } from "../stores/git-repository.store";
import type { GitWorktree } from "../types/git.types";
import GitCommandSurface from "./git-command-surface";

interface GitBranchManagerProps {
  currentBranch?: string;
  repoPath?: string;
  onBranchChange?: () => void;
  onWorktreeChange?: (repoPath: string) => void;
  onRepositoryChange?: (repoPath: string | null) => void;
  paletteTarget?: boolean;
  openEventName?: string;
  triggerClassName?: string;
  triggerInputClassName?: string;
}

type GitBranchManagerTab = "branches" | "worktrees" | "repositories";

const gitCommandIconClassName = "size-[length:var(--app-ui-icon-size-md)] shrink-0";

function getFilteredBranches(branches: string[], currentBranch: string, query: string) {
  const sorted = [...branches].sort((a, b) => {
    if (a === currentBranch) return -1;
    if (b === currentBranch) return 1;
    return a.localeCompare(b);
  });

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return sorted;

  return sorted.filter((branch) => matchesSearchQuery(normalizedQuery, [branch]));
}

function getCreateBranchName(branches: string[], currentBranch: string, query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || trimmedQuery === currentBranch) return null;
  if (branches.some((branch) => branch.toLowerCase() === trimmedQuery.toLowerCase())) {
    return null;
  }

  return trimmedQuery;
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

  return sorted.filter((worktree) =>
    matchesSearchQuery(normalizedQuery, [
      getFolderName(worktree.path),
      worktree.path,
      worktree.branch ?? "",
      worktree.head.slice(0, 7),
    ]),
  );
}

function getCreateWorktreePath(worktrees: GitWorktree[], query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return null;
  if (worktrees.some((worktree) => worktree.path === trimmedQuery)) return null;

  return trimmedQuery;
}

function getFilteredRepositoryPaths(
  repoPaths: string[],
  activeRepoPath: string | null,
  query: string,
) {
  const sorted = [...repoPaths].sort((a, b) => {
    if (a === activeRepoPath) return -1;
    if (b === activeRepoPath) return 1;
    return getFolderName(a).localeCompare(getFolderName(b));
  });

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return sorted;

  return sorted.filter((repoPath) =>
    matchesSearchQuery(normalizedQuery, [getFolderName(repoPath), repoPath]),
  );
}

const GitBranchManager = ({
  currentBranch,
  repoPath,
  onBranchChange,
  onWorktreeChange,
  onRepositoryChange,
  paletteTarget = false,
  openEventName = "athas:open-branch-manager",
  triggerClassName,
  triggerInputClassName,
}: GitBranchManagerProps) => {
  const [branches, setBranches] = useState<string[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [branchQuery, setBranchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<GitBranchManagerTab>("branches");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingWorktrees, setIsLoadingWorktrees] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const workspaceRootPath = useRepositoryStore.use.workspaceRootPath();
  const availableRepoPaths = useRepositoryStore.use.availableRepoPaths();
  const manualRepoPaths = useRepositoryStore.use.manualRepoPaths();
  const isDiscoveringRepos = useRepositoryStore.use.isDiscovering();
  const {
    selectRepository,
    setManualRepository,
    clearManualRepository,
    refreshWorkspaceRepositories,
  } = useRepositoryStore.use.actions();
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );
  const { showToast } = useToast();
  const activeBranch = currentBranch ?? "";
  const triggerText = activeBranch;
  const triggerTextWidthCh = Math.min(Math.max(triggerText.length + 1, 6), 40);
  const filteredBranches = useMemo(
    () => getFilteredBranches(branches, activeBranch, branchQuery),
    [activeBranch, branchQuery, branches],
  );
  const createBranchName = useMemo(
    () => getCreateBranchName(branches, activeBranch, branchQuery),
    [activeBranch, branchQuery, branches],
  );
  const filteredWorktrees = useMemo(
    () => getFilteredWorktrees(worktrees, repoPath ?? "", branchQuery),
    [branchQuery, repoPath, worktrees],
  );
  const createWorktreePath = useMemo(
    () => getCreateWorktreePath(worktrees, branchQuery),
    [branchQuery, worktrees],
  );
  const filteredRepoPaths = useMemo(
    () => getFilteredRepositoryPaths(availableRepoPaths, activeRepoPath, branchQuery),
    [activeRepoPath, availableRepoPaths, branchQuery],
  );

  const loadBranches = useCallback(async () => {
    if (!repoPath) return;

    try {
      const branchList = await getBranches(repoPath);
      setBranches(branchList);
    } catch (error) {
      console.error("Failed to load branches:", error);
    }
  }, [repoPath]);

  const loadWorktrees = useCallback(async () => {
    if (!repoPath) return;

    setIsLoadingWorktrees(true);
    try {
      const nextWorktrees = await getWorktrees(repoPath);
      setWorktrees(nextWorktrees);
    } finally {
      setIsLoadingWorktrees(false);
    }
  }, [repoPath]);

  useEffect(() => {
    if (repoPath && isDropdownOpen) {
      void loadBranches();
      void loadWorktrees();
    }
  }, [repoPath, isDropdownOpen, loadBranches, loadWorktrees]);

  useEffect(() => {
    const handleOpenFromPalette = () => {
      if (!paletteTarget || !repoPath) return;
      setActiveTab("branches");
      setIsDropdownOpen(true);
      void loadBranches();
      void loadWorktrees();
    };

    window.addEventListener(openEventName, handleOpenFromPalette);
    return () => window.removeEventListener(openEventName, handleOpenFromPalette);
  }, [openEventName, paletteTarget, repoPath, loadBranches]);

  useEffect(() => {
    if (!isDropdownOpen) {
      setBranchQuery("");
      setSelectedIndex(0);
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeTab, branchQuery]);

  useEffect(() => {
    if (!isDropdownOpen || !hasBlockingModalOpen) return;
    setIsDropdownOpen(false);
  }, [hasBlockingModalOpen, isDropdownOpen]);

  const handleBranchChange = async (branchName: string) => {
    if (!repoPath || !branchName || branchName === currentBranch) return;

    setIsLoading(true);
    try {
      const result = await checkoutBranch(repoPath, branchName);

      if (result.hasChanges) {
        showToast({
          message: result.message,
          type: "warning",
          duration: 0,
          action: {
            label: "Stash Changes",
            onClick: async () => {
              try {
                const stashSuccess = await createStash(
                  repoPath,
                  `Switching to ${branchName}`,
                  true,
                );
                if (stashSuccess) {
                  const retryResult = await checkoutBranch(repoPath, branchName);
                  if (retryResult.success) {
                    showToast({
                      message: "Changes stashed and branch switched successfully",
                      type: "success",
                    });
                    setIsDropdownOpen(false);
                    onBranchChange?.();
                  } else {
                    showToast({
                      message: "Failed to switch branch after stashing",
                      type: "error",
                    });
                  }
                }
              } catch {
                showToast({
                  message: "Failed to stash changes",
                  type: "error",
                });
              }
            },
          },
        });
      } else if (result.success) {
        setIsDropdownOpen(false);
        onBranchChange?.();
      } else {
        showToast({
          message: result.message,
          type: "error",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const closeDropdown = () => setIsDropdownOpen(false);

  const handleDeleteBranch = async (branchName: string) => {
    if (!repoPath || !branchName || branchName === currentBranch) return;

    const confirmed = await showConfirmDialog(
      `Are you sure you want to delete branch "${branchName}"?`,
      { title: "Delete Branch", confirmLabel: "Delete" },
    );
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const success = await deleteBranch(repoPath, branchName);
      if (success) {
        await loadBranches();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBranch = async (branchName: string) => {
    if (!repoPath || !branchName.trim()) return;

    setIsLoading(true);
    try {
      const success = await createBranch(repoPath, branchName.trim(), currentBranch);
      if (success) {
        setBranchQuery("");
        setIsDropdownOpen(false);
        onBranchChange?.();
      }
    } finally {
      setIsLoading(false);
    }
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

    setIsLoadingWorktrees(true);
    try {
      const success = await addWorktree(repoPath, worktreePath.trim());
      if (!success) return;

      await loadWorktrees();
      setBranchQuery("");
      setIsDropdownOpen(false);
      onWorktreeChange?.(worktreePath.trim());
    } finally {
      setIsLoadingWorktrees(false);
    }
  };

  const handleSelectRepositoryPath = (nextRepoPath: string) => {
    selectRepository(nextRepoPath);
    setSelectionError(null);
    setIsDropdownOpen(false);
    setBranchQuery("");
    onRepositoryChange?.(nextRepoPath);
  };

  const handleBrowseRepository = useCallback(async () => {
    setIsSelectingRepo(true);
    setSelectionError(null);

    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;

      const resolvedRepoPath = await resolveRepositoryPath(selected);
      if (!resolvedRepoPath) {
        setSelectionError("Selected folder is not inside a Git repository.");
        return;
      }

      setManualRepository(resolvedRepoPath);
      setIsDropdownOpen(false);
      setBranchQuery("");
      onRepositoryChange?.(resolvedRepoPath);
    } catch (error) {
      console.error("Failed to select repository:", error);
      setSelectionError(error instanceof Error ? error.message : "Failed to select repository.");
    } finally {
      setIsSelectingRepo(false);
    }
  }, [onRepositoryChange, setManualRepository]);

  const handleClearAddedRepositories = () => {
    clearManualRepository();
    setSelectionError(null);
    onRepositoryChange?.(useRepositoryStore.getState().activeRepoPath);
  };

  if (!currentBranch) {
    return null;
  }

  const handleOpenDropdown = async () => {
    if (!repoPath || isDropdownOpen) return;
    setActiveTab("branches");
    setIsDropdownOpen(true);
    await Promise.all([loadBranches(), loadWorktrees()]);
  };

  const commandEntries =
    activeTab === "branches"
      ? [
          ...(createBranchName
            ? [{ type: "create-branch" as const, value: createBranchName }]
            : []),
          ...filteredBranches.map((branch) => ({ type: "branch" as const, value: branch })),
        ]
      : activeTab === "worktrees"
        ? [
            ...(createWorktreePath
              ? [{ type: "create-worktree" as const, value: createWorktreePath }]
              : []),
            ...filteredWorktrees.map((worktree) => ({
              type: "worktree" as const,
              value: worktree.path,
            })),
          ]
        : filteredRepoPaths.map((repository) => ({
            type: "repository" as const,
            value: repository,
          }));

  const tabItems: TabsItem[] = [
    {
      id: "repositories",
      label: "Repositories",
      icon: <FolderOpen className={gitCommandIconClassName} />,
      isActive: activeTab === "repositories",
      onClick: () => setActiveTab("repositories"),
    },
    {
      id: "branches",
      label: "Branches",
      icon: <GitBranch className={gitCommandIconClassName} />,
      isActive: activeTab === "branches",
      onClick: () => setActiveTab("branches"),
    },
    {
      id: "worktrees",
      label: "Worktrees",
      icon: <GitFork className={gitCommandIconClassName} />,
      isActive: activeTab === "worktrees",
      onClick: () => setActiveTab("worktrees"),
    },
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
      if (selectedEntry.type === "create-branch") {
        void handleCreateBranch(selectedEntry.value);
      } else if (selectedEntry.type === "create-worktree") {
        void handleCreateWorktree(selectedEntry.value);
      } else if (selectedEntry.type === "worktree") {
        handleWorktreeChange(selectedEntry.value);
      } else if (selectedEntry.type === "repository") {
        handleSelectRepositoryPath(selectedEntry.value);
      } else {
        void handleBranchChange(selectedEntry.value);
      }
    }
  };

  return (
    <>
      <Button
        data-branch-manager-trigger="true"
        onClick={() => void handleOpenDropdown()}
        disabled={isLoading}
        variant="ghost"
        className={cn(
          "inline-flex max-w-full shrink overflow-hidden px-2 text-text-lighter hover:bg-hover/80",
          isDropdownOpen ? "bg-hover/80" : "cursor-pointer",
          triggerClassName,
        )}
        aria-label="Search branches"
      >
        <GitBranch className="shrink-0" />
        <span
          className={cn("ui-text-base min-w-0 truncate font-normal", triggerInputClassName)}
          style={{ maxWidth: `${triggerTextWidthCh}ch` }}
        >
          {currentBranch}
        </span>
      </Button>

      <GitCommandSurface
        isOpen={isDropdownOpen}
        onClose={closeDropdown}
        query={branchQuery}
        onQueryChange={setBranchQuery}
        onInputKeyDown={handleCommandKeyDown}
        placeholder={
          activeTab === "branches"
            ? "Search branches..."
            : activeTab === "worktrees"
              ? "Search worktrees..."
              : "Filter repositories..."
        }
        meta={
          activeTab === "branches"
            ? `${branches.length} branch${branches.length === 1 ? "" : "es"}`
            : activeTab === "worktrees"
              ? `${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}`
              : `${availableRepoPaths.length} repositor${
                  availableRepoPaths.length === 1 ? "y" : "ies"
                }`
        }
        headerAddon={
          <div
            role="tablist"
            aria-label="Git selector sections"
            className="flex shrink-0 items-center justify-start gap-1 bg-primary-bg px-2 py-1"
          >
            {tabItems.map((item) => (
              <Tab
                key={item.id}
                role="tab"
                aria-selected={item.isActive}
                tabIndex={0}
                isActive={Boolean(item.isActive)}
                size="md"
                variant="pill"
                className="w-fit justify-start rounded-full"
                onClick={item.onClick}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    item.onClick?.();
                  }
                }}
              >
                {item.icon}
                {item.label}
              </Tab>
            ))}
          </div>
        }
      >
        <CommandList>
          {activeTab === "branches" && branches.length === 0 ? (
            <CommandEmpty>No branches found</CommandEmpty>
          ) : null}
          {activeTab === "branches" && branches.length > 0 ? (
            <div className="space-y-1">
              {createBranchName ? (
                <CommandItem
                  type="button"
                  onClick={() => void handleCreateBranch(createBranchName)}
                  disabled={isLoading}
                  isSelected={selectedIndex === 0}
                  onMouseEnter={() => setSelectedIndex(0)}
                  className="ui-font"
                >
                  <Plus className={cn(gitCommandIconClassName, "text-text-lighter")} />
                  <span className="ui-text-base min-w-0 flex-1 truncate text-text">
                    Create new branch "{createBranchName}"
                  </span>
                </CommandItem>
              ) : null}
              {filteredBranches.map((branch, index) => (
                <BranchRow
                  key={branch}
                  branch={branch}
                  isCurrent={branch === currentBranch}
                  isSelected={selectedIndex === index + (createBranchName ? 1 : 0)}
                  isLoading={isLoading}
                  onMouseEnter={() => setSelectedIndex(index + (createBranchName ? 1 : 0))}
                  onSelect={() => void handleBranchChange(branch)}
                  onDelete={() => void handleDeleteBranch(branch)}
                />
              ))}
            </div>
          ) : null}
          {activeTab === "worktrees" && filteredWorktrees.length === 0 ? (
            <CommandEmpty>
              {isLoadingWorktrees ? "Loading worktrees..." : "No worktrees found"}
            </CommandEmpty>
          ) : null}
          {activeTab === "worktrees" && worktrees.length > 0 ? (
            <div className="space-y-1">
              {createWorktreePath ? (
                <CommandItem
                  type="button"
                  onClick={() => void handleCreateWorktree(createWorktreePath)}
                  disabled={isLoadingWorktrees}
                  isSelected={selectedIndex === 0}
                  onMouseEnter={() => setSelectedIndex(0)}
                  className="ui-font"
                >
                  <Plus className={cn(gitCommandIconClassName, "text-text-lighter")} />
                  <span className="ui-text-base min-w-0 flex-1 truncate text-text">
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
          {activeTab === "repositories" && isDiscoveringRepos && availableRepoPaths.length === 0 ? (
            <CommandEmpty>Detecting repositories...</CommandEmpty>
          ) : null}
          {activeTab === "repositories" && !isDiscoveringRepos && filteredRepoPaths.length === 0 ? (
            <CommandEmpty>
              {branchQuery.trim() ? "No matching repositories" : "No repositories found"}
            </CommandEmpty>
          ) : null}
          {activeTab === "repositories" && filteredRepoPaths.length > 0 ? (
            <div className="space-y-1">
              {filteredRepoPaths.map((repository, index) => (
                <RepositoryRow
                  key={repository}
                  repoPath={repository}
                  workspaceRootPath={workspaceRootPath}
                  isCurrent={repository === activeRepoPath}
                  isAdded={manualRepoPaths.includes(repository)}
                  isSelected={selectedIndex === index}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onSelect={() => handleSelectRepositoryPath(repository)}
                />
              ))}
            </div>
          ) : null}
        </CommandList>
        {activeTab === "repositories" ? (
          <CommandFooter>
            <CommandFooterAction
              type="button"
              onClick={() => void handleBrowseRepository()}
              disabled={isSelectingRepo}
            >
              <Plus />
              {isSelectingRepo ? "Adding..." : "Add"}
            </CommandFooterAction>
            <CommandFooterAction
              type="button"
              onClick={() => void refreshWorkspaceRepositories()}
              disabled={isDiscoveringRepos}
            >
              <RefreshCw />
              Refresh
            </CommandFooterAction>
            {manualRepoPaths.length > 0 ? (
              <CommandFooterAction type="button" onClick={handleClearAddedRepositories}>
                Clear Added
              </CommandFooterAction>
            ) : null}
            {selectionError ? (
              <span className="ui-text-base min-w-0 flex-1 truncate text-error/90">
                {selectionError}
              </span>
            ) : null}
          </CommandFooter>
        ) : null}
      </GitCommandSurface>
    </>
  );
};

function BranchRow({
  branch,
  isCurrent,
  isSelected,
  isLoading,
  onMouseEnter,
  onSelect,
  onDelete,
}: {
  branch: string;
  isCurrent: boolean;
  isSelected: boolean;
  isLoading: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const handleSelectKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isLoading) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  return (
    <div
      role="button"
      tabIndex={isLoading ? -1 : 0}
      aria-disabled={isLoading}
      onMouseEnter={onMouseEnter}
      onClick={() => {
        if (!isLoading) {
          onSelect();
        }
      }}
      onKeyDown={handleSelectKeyDown}
      className={cn(
        "group ui-font ui-text-base mb-1 flex min-h-7 w-full cursor-pointer items-center justify-start gap-2 rounded-lg px-2.5 py-1.5 text-left leading-[1.35] transition-colors",
        isSelected ? "bg-selected text-text" : "bg-transparent text-text hover:bg-hover",
        isCurrent ? "text-text" : "text-text-lighter hover:text-text",
        isLoading && "cursor-not-allowed opacity-50",
      )}
    >
      {isCurrent ? (
        <Check className={cn(gitCommandIconClassName, "text-success")} />
      ) : (
        <GitBranch className={cn(gitCommandIconClassName, "text-text-lighter")} />
      )}
      <span className="ui-text-base min-w-0 flex-1 truncate text-text">{branch}</span>
      {isCurrent ? (
        <span className="ui-text-base ml-auto shrink-0 text-success">current</span>
      ) : null}
      {!isCurrent ? (
        <Button
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          disabled={isLoading}
          variant="ghost"
          compact
          className={cn(
            "text-git-deleted opacity-100 transition-opacity sm:opacity-0",
            "hover:bg-git-deleted/10 hover:opacity-80 hover:text-git-deleted",
            "disabled:opacity-50 sm:group-hover:opacity-100",
          )}
          tooltip={`Delete ${branch}`}
          aria-label={`Delete branch ${branch}`}
          type="button"
        >
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}

function RepositoryRow({
  repoPath,
  workspaceRootPath,
  isCurrent,
  isAdded,
  isSelected,
  onMouseEnter,
  onSelect,
}: {
  repoPath: string;
  workspaceRootPath: string | null;
  isCurrent: boolean;
  isAdded: boolean;
  isSelected: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  const relativePath = workspaceRootPath ? getRelativePath(repoPath, workspaceRootPath) : repoPath;

  return (
    <CommandItem
      type="button"
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      isSelected={isSelected}
      className={cn("group ui-font", isCurrent ? "text-text" : "text-text-lighter hover:text-text")}
    >
      {isCurrent ? (
        <Check className={cn(gitCommandIconClassName, "text-success")} />
      ) : (
        <FolderOpen className={cn(gitCommandIconClassName, "text-text-lighter")} />
      )}
      <span className="min-w-0 flex flex-1 items-baseline gap-1.5">
        <span className="ui-text-base min-w-0 max-w-[45%] shrink-0 truncate text-text">
          {getFolderName(repoPath)}
        </span>
        <span className="ui-text-base min-w-0 flex-1 truncate text-text-lighter/75">
          {relativePath === "." ? repoPath : relativePath}
        </span>
      </span>
      {isAdded ? <span className="ui-text-base shrink-0 text-text-lighter/75">added</span> : null}
    </CommandItem>
  );
}

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
        <Check className={cn(gitCommandIconClassName, "text-success")} />
      ) : (
        <GitFork className={cn(gitCommandIconClassName, "text-text-lighter")} />
      )}
      <span className="ui-text-base min-w-0 flex-1 truncate text-text">
        {getFolderName(worktree.path)}
      </span>
      <span className="ui-text-base flex max-w-[45%] shrink min-w-0 items-center gap-1.5 text-text-lighter/80">
        <GitBranch className={gitCommandIconClassName} />
        <span className="truncate">{getBranchLabel(worktree)}</span>
      </span>
      {isCurrent ? (
        <span className="ui-text-base ml-auto shrink-0 text-success">current</span>
      ) : null}
    </CommandItem>
  );
}

export default GitBranchManager;
