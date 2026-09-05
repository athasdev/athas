import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckIcon as Check,
  CopyIcon as Copy,
  DotsThreeIcon as DotsThree,
  PlusIcon as Plus,
  ArrowClockwiseIcon as RefreshCw,
  TrashIcon as Trash2,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuFooter,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandItemAction,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
  CommandTabs,
  useCommandListNavigation,
} from "@/ui/command";
import { ChevronExpandYIcon, GitBranchIcon, FolderOpenIcon, NodesIcon } from "@/ui/icons";
import { showConfirmDialog, showPromptDialog } from "@/ui/dialog";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { matchesSearchQuery } from "@/utils/search-match";
import { writeClipboardText } from "@/utils/clipboard";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../api/git-branches-api";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { createStash } from "../api/git-stash-api";
import { addWorktree, getWorktrees } from "../api/git-worktrees-api";
import { useRepositoryStore } from "../stores/git-repository.store";
import { useGitBlameStore } from "../stores/git-blame.store";
import type { GitWorktree } from "../types/git.types";
import { isOpenableGitWorktree } from "../utils/git-worktree-open";
import GitCommandSurface from "./git-command-surface";

interface GitBranchManagerProps {
  currentBranch?: string;
  repoPath?: string;
  onBranchChange?: () => void;
  onWorktreeChange?: (repoPath: string) => void;
  onRepositoryChange?: (repoPath: string | null) => void;
  paletteTarget?: boolean;
  openEventName?: string;
  triggerMode?: "repository" | "branch";
}

type GitBranchManagerTab = "branches" | "worktrees" | "repositories";

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
  const sorted = worktrees.filter(isOpenableGitWorktree).sort((a, b) => {
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
  triggerMode = "repository",
}: GitBranchManagerProps) => {
  const [branches, setBranches] = useState<string[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [branchQuery, setBranchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<GitBranchManagerTab>("branches");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingWorktrees, setIsLoadingWorktrees] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const branchLoadRequestIdRef = useRef(0);
  const worktreeLoadRequestIdRef = useRef(0);
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
  const selectorRepoPath = activeRepoPath ?? repoPath;
  const activeRepositoryLabel = selectorRepoPath
    ? getFolderName(selectorRepoPath)
    : "Select Repository";
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

    const requestId = ++branchLoadRequestIdRef.current;
    try {
      const branchList = await getBranches(repoPath);
      if (requestId === branchLoadRequestIdRef.current) {
        setBranches(branchList);
      }
    } catch (error) {
      console.error("Failed to load branches:", error);
    }
  }, [repoPath]);

  const loadWorktrees = useCallback(async () => {
    if (!repoPath) return;

    const requestId = ++worktreeLoadRequestIdRef.current;
    setIsLoadingWorktrees(true);
    try {
      const nextWorktrees = await getWorktrees(repoPath);
      if (requestId === worktreeLoadRequestIdRef.current) {
        setWorktrees(nextWorktrees);
      }
    } finally {
      if (requestId === worktreeLoadRequestIdRef.current) {
        setIsLoadingWorktrees(false);
      }
    }
  }, [repoPath]);

  useEffect(() => {
    branchLoadRequestIdRef.current += 1;
    worktreeLoadRequestIdRef.current += 1;
    setBranches([]);
    setWorktrees([]);
    setIsLoadingWorktrees(false);
  }, [repoPath]);

  useEffect(() => {
    if (repoPath && isDropdownOpen) {
      void loadBranches();
      if (triggerMode === "repository") void loadWorktrees();
    }
  }, [repoPath, isDropdownOpen, loadBranches, loadWorktrees, triggerMode]);

  useEffect(() => {
    const handleOpenFromPalette = (event: Event) => {
      if (!paletteTarget || !repoPath) return;
      const requestedTab = (event as CustomEvent<{ tab?: GitBranchManagerTab }>).detail?.tab;
      setActiveTab(requestedTab ?? "branches");
      setIsDropdownOpen(true);
    };

    window.addEventListener(openEventName, handleOpenFromPalette);
    return () => window.removeEventListener(openEventName, handleOpenFromPalette);
  }, [openEventName, paletteTarget, repoPath]);

  useEffect(() => {
    if (!isDropdownOpen) {
      setBranchQuery("");
    }
  }, [isDropdownOpen]);

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
                    useGitBlameStore.getState().actions.clearAllBlame();
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
        useGitBlameStore.getState().actions.clearAllBlame();
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

  const handleCreateBranch = async (branchName: string, fromBranch = currentBranch) => {
    if (!repoPath || !branchName.trim()) return;

    setIsLoading(true);
    try {
      const success = await createBranch(repoPath, branchName.trim(), fromBranch);
      if (success) {
        setBranchQuery("");
        setIsDropdownOpen(false);
        onBranchChange?.();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromptCreateBranch = async (fromBranch = currentBranch) => {
    setIsDropdownOpen(false);
    const branchName = await showPromptDialog("Enter a name for the new branch.", {
      title: fromBranch ? `New Branch from ${fromBranch}` : "New Branch",
      defaultValue: createBranchName ?? "",
      placeholder: "feature/name",
      confirmLabel: "Create",
    });
    if (!branchName?.trim()) return;
    await handleCreateBranch(branchName, fromBranch);
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

  const focusCommandInput = useCallback(() => {
    requestAnimationFrame(() => commandInputRef.current?.focus());
  }, []);

  const handleTabChange = useCallback(
    (tab: GitBranchManagerTab) => {
      setActiveTab(tab);
      focusCommandInput();
    },
    [focusCommandInput],
  );

  const handleOpenDropdown = async () => {
    if (!repoPath || isDropdownOpen) return;
    setActiveTab("branches");
    setIsDropdownOpen(true);
    if (triggerMode === "branch") {
      await loadBranches();
      return;
    }
    await Promise.all([loadBranches(), loadWorktrees()]);
  };

  const commandEntries = useMemo(
    () =>
      activeTab === "branches"
        ? [
            ...(createBranchName
              ? [{ type: "create-branch" as const, value: createBranchName }]
              : []),
            ...filteredBranches.map((branch) => ({
              type: "branch" as const,
              value: branch,
            })),
          ]
        : activeTab === "worktrees"
          ? [
              ...(createWorktreePath
                ? [
                    {
                      type: "create-worktree" as const,
                      value: createWorktreePath,
                    },
                  ]
                : []),
              ...filteredWorktrees.map((worktree) => ({
                type: "worktree" as const,
                value: worktree.path,
              })),
            ]
          : filteredRepoPaths.map((repository) => ({
              type: "repository" as const,
              value: repository,
            })),
    [
      activeTab,
      createBranchName,
      createWorktreePath,
      filteredBranches,
      filteredRepoPaths,
      filteredWorktrees,
    ],
  );

  const handleCommandSelect = useCallback(
    (index: number) => {
      const selectedEntry = commandEntries[index];
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
    },
    [commandEntries],
  );

  const {
    selectedIndex,
    setSelectedIndex,
    onInputKeyDown: handleCommandKeyDown,
  } = useCommandListNavigation({
    itemCount: commandEntries.length,
    resetKey: `${activeTab}:${branchQuery}`,
    onSelect: handleCommandSelect,
  });

  if (!currentBranch) {
    return null;
  }

  if (triggerMode === "branch") {
    return (
      <DropdownMenu
        open={isDropdownOpen}
        onOpenChange={(open) => {
          setActiveTab("branches");
          setIsDropdownOpen(open);
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              data-branch-manager-trigger="true"
              disabled={isLoading}
              variant="ghost"
              size="chrome"
              className={cn(
                "max-w-48 min-w-0 shrink justify-start overflow-hidden text-left",
                isDropdownOpen && "bg-accent/80",
              )}
              title={selectorRepoPath ?? undefined}
              aria-label={`Switch branch. Current branch: ${currentBranch}`}
            />
          }
        >
          <span className="min-w-0 truncate">{currentBranch}</span>
          <ChevronExpandYIcon className="text-subtle-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" viewport="searchable" className="w-64">
          <DropdownMenuSearch
            value={branchQuery}
            onChange={(event) => setBranchQuery(event.target.value)}
            placeholder="Search branches"
            autoFocus
          />
          <DropdownMenuViewport>
            {filteredBranches.length > 0 ? (
              <DropdownMenuRadioGroup
                value={currentBranch}
                onValueChange={(branch) => void handleBranchChange(branch)}
              >
                {filteredBranches.map((branch) => (
                  <DropdownMenuRadioItem
                    key={branch}
                    value={branch}
                    disabled={isLoading}
                    closeOnClick={branch !== currentBranch}
                    trailingAction={
                      <BranchDropdownActions
                        branch={branch}
                        isCurrent={branch === currentBranch}
                        isLoading={isLoading}
                        onCreateFrom={() => void handlePromptCreateBranch(branch)}
                        onCopy={() => void writeClipboardText(branch)}
                        onDelete={() => void handleDeleteBranch(branch)}
                      />
                    }
                  >
                    <GitBranchIcon />
                    <span className="min-w-0 flex-1 truncate">{branch}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            ) : (
              <DropdownMenuItem disabled>
                {branchQuery.trim() ? "No branches match" : "No branches found"}
              </DropdownMenuItem>
            )}
          </DropdownMenuViewport>
          <DropdownMenuFooter>
            <DropdownMenuItem onClick={() => void handlePromptCreateBranch()}>
              <Plus />
              New branch…
            </DropdownMenuItem>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={isLoading}
              onClick={() => void loadBranches()}
            >
              <RefreshCw />
              Refresh branches
            </DropdownMenuItem>
          </DropdownMenuFooter>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const tabItems = [
    {
      id: "repositories",
      label: "Repositories",
      icon: <FolderOpenIcon />,
      isActive: activeTab === "repositories",
      onSelect: () => handleTabChange("repositories"),
    },
    {
      id: "branches",
      label: "Branches",
      icon: <GitBranchIcon />,
      isActive: activeTab === "branches",
      onSelect: () => handleTabChange("branches"),
    },
    {
      id: "worktrees",
      label: "Worktrees",
      icon: <NodesIcon />,
      isActive: activeTab === "worktrees",
      onSelect: () => handleTabChange("worktrees"),
    },
  ];

  return (
    <>
      <Button
        data-branch-manager-trigger="true"
        onClick={() => void handleOpenDropdown()}
        disabled={isLoading}
        variant="ghost"
        size="default"
        className={cn(
          "w-fit max-w-full min-w-0 shrink justify-start overflow-hidden text-left hover:bg-accent/80",
          isDropdownOpen && "bg-accent/80",
        )}
        title={selectorRepoPath ?? undefined}
        aria-label={`Switch repository or branch. ${activeRepositoryLabel}, branch ${currentBranch}`}
      >
        <FolderOpenIcon />
        <span className="flex min-w-0 flex-1 flex-col items-start overflow-hidden leading-none">
          <span className="max-w-full truncate font-medium text-foreground ui-text-sm">
            {activeRepositoryLabel}
          </span>
          <span className="max-w-full truncate font-normal text-subtle-foreground ui-text-caption">
            {currentBranch}
          </span>
        </span>
      </Button>

      <GitCommandSurface
        isOpen={isDropdownOpen}
        onClose={closeDropdown}
        query={branchQuery}
        onQueryChange={setBranchQuery}
        onInputKeyDown={handleCommandKeyDown}
        inputRef={commandInputRef}
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
        headerAddon={<CommandTabs items={tabItems} ariaLabel="Git selector sections" />}
      >
        <CommandList>
          {activeTab === "branches" && !createBranchName && filteredBranches.length === 0 ? (
            <CommandEmpty>
              {branchQuery.trim() ? "No matching branches" : "No branches found"}
            </CommandEmpty>
          ) : null}
          {activeTab === "branches" && (createBranchName || filteredBranches.length > 0) ? (
            <div>
              {createBranchName ? (
                <CommandItemRow
                  as="div"
                  icon={<Plus />}
                  title={`Create new branch "${createBranchName}"`}
                  onClick={() => void handleCreateBranch(createBranchName)}
                  disabled={isLoading}
                  isSelected={selectedIndex === 0}
                  onMouseEnter={() => setSelectedIndex(0)}
                />
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
          {activeTab === "worktrees" && !createWorktreePath && filteredWorktrees.length === 0 ? (
            <CommandEmpty>
              {isLoadingWorktrees
                ? "Loading worktrees..."
                : branchQuery.trim()
                  ? "No matching worktrees"
                  : "No worktrees found"}
            </CommandEmpty>
          ) : null}
          {activeTab === "worktrees" && (createWorktreePath || filteredWorktrees.length > 0) ? (
            <div>
              {createWorktreePath ? (
                <CommandItemRow
                  as="div"
                  icon={<Plus />}
                  title={`Create worktree "${createWorktreePath}"`}
                  onClick={() => void handleCreateWorktree(createWorktreePath)}
                  disabled={isLoadingWorktrees}
                  isSelected={selectedIndex === 0}
                  onMouseEnter={() => setSelectedIndex(0)}
                />
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
            <div>
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
        <CommandFooter>
          {activeTab === "branches" ? (
            <>
              <CommandFooterAction
                type="button"
                onClick={() => createBranchName && void handleCreateBranch(createBranchName)}
                disabled={!createBranchName || isLoading}
              >
                <Plus />
                New Branch
              </CommandFooterAction>
              <CommandFooterAction
                type="button"
                onClick={() => void loadBranches()}
                disabled={isLoading}
              >
                <RefreshCw />
                Refresh
              </CommandFooterAction>
            </>
          ) : null}
          {activeTab === "worktrees" ? (
            <>
              <CommandFooterAction
                type="button"
                onClick={() => createWorktreePath && void handleCreateWorktree(createWorktreePath)}
                disabled={!createWorktreePath || isLoadingWorktrees}
              >
                <Plus />
                {isLoadingWorktrees ? "Adding..." : "Add"}
              </CommandFooterAction>
              <CommandFooterAction
                type="button"
                onClick={() => void loadWorktrees()}
                disabled={isLoadingWorktrees}
              >
                <RefreshCw />
                Refresh
              </CommandFooterAction>
            </>
          ) : null}
          {activeTab === "repositories" ? (
            <>
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
                <span className="ui-text-sm min-w-0 flex-1 truncate text-destructive/90">
                  {selectionError}
                </span>
              ) : null}
            </>
          ) : null}
        </CommandFooter>
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
  return (
    <CommandItemRow
      as="div"
      icon={isCurrent ? <Check className="text-success" /> : <GitBranchIcon />}
      title={branch}
      isSelected={isSelected}
      disabled={isLoading}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      accessory={isCurrent ? <CommandItemBadge variant="success">current</CommandItemBadge> : null}
      action={
        !isCurrent ? (
          <CommandItemAction
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
            tone="danger"
            tooltip={`Delete ${branch}`}
            aria-label={`Delete branch ${branch}`}
            type="button"
          >
            <Trash2 />
          </CommandItemAction>
        ) : null
      }
    />
  );
}

function BranchDropdownActions({
  branch,
  isCurrent,
  isLoading,
  onCreateFrom,
  onCopy,
  onDelete,
}: {
  branch: string;
  isCurrent: boolean;
  isLoading: boolean;
  onCreateFrom: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        appearance="action"
        render={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            size="chrome"
            aria-label={`More actions for ${branch}`}
          />
        }
      >
        <DotsThree />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-44">
        <DropdownMenuItem disabled={isLoading} onClick={onCreateFrom}>
          <Plus />
          New branch from…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCopy}>
          <Copy />
          Copy branch name
        </DropdownMenuItem>
        {!isCurrent ? (
          <DropdownMenuItem variant="destructive" disabled={isLoading} onClick={onDelete}>
            <Trash2 />
            Delete branch…
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
    <CommandItemRow
      as="div"
      icon={isCurrent ? <Check className="text-success" /> : <FolderOpenIcon />}
      title={getFolderName(repoPath)}
      description={relativePath === "." ? repoPath : relativePath}
      isSelected={isSelected}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      accessory={
        <>
          {isCurrent ? <CommandItemBadge variant="success">current</CommandItemBadge> : null}
          {isAdded ? <CommandItemBadge>added</CommandItemBadge> : null}
        </>
      }
    />
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
    <CommandItemRow
      as="div"
      icon={isCurrent ? <Check className="text-success" /> : <NodesIcon />}
      title={getFolderName(worktree.path)}
      description={
        <>
          <GitBranchIcon />
          <span className="truncate">{getBranchLabel(worktree)}</span>
        </>
      }
      isSelected={isSelected}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      accessory={isCurrent ? <CommandItemBadge variant="success">current</CommandItemBadge> : null}
    />
  );
}

export default GitBranchManager;
