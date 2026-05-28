import { Check, GitBranch, Plus, Trash as Trash2 } from "@phosphor-icons/react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandItem, CommandList } from "@/ui/command";
import { primitiveConfirm } from "@/ui/primitive-dialog-service";
import { cn } from "@/utils/cn";
import { matchesSearchQuery } from "@/utils/search-match";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../api/git-branches-api";
import { createStash } from "../api/git-stash-api";
import GitCommandSurface from "./git-command-surface";

interface GitBranchManagerProps {
  currentBranch?: string;
  repoPath?: string;
  onBranchChange?: () => void;
  paletteTarget?: boolean;
  placement?: "up" | "down";
  triggerIconSize?: number;
  triggerClassName?: string;
  triggerInputClassName?: string;
}

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

const GitBranchManager = ({
  currentBranch,
  repoPath,
  onBranchChange,
  paletteTarget = false,
  placement = "down",
  triggerIconSize,
  triggerClassName,
  triggerInputClassName,
}: GitBranchManagerProps) => {
  const [branches, setBranches] = useState<string[]>([]);
  const [branchQuery, setBranchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
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

  const loadBranches = useCallback(async () => {
    if (!repoPath) return;

    try {
      const branchList = await getBranches(repoPath);
      setBranches(branchList);
    } catch (error) {
      console.error("Failed to load branches:", error);
    }
  }, [repoPath]);

  useEffect(() => {
    if (repoPath && isDropdownOpen) {
      void loadBranches();
    }
  }, [repoPath, isDropdownOpen, loadBranches]);

  useEffect(() => {
    const handleOpenFromPalette = () => {
      if (!paletteTarget || !repoPath) return;
      setIsDropdownOpen(true);
      void loadBranches();
    };

    window.addEventListener("athas:open-branch-manager", handleOpenFromPalette);
    return () => window.removeEventListener("athas:open-branch-manager", handleOpenFromPalette);
  }, [paletteTarget, repoPath, loadBranches]);

  useEffect(() => {
    if (!isDropdownOpen) {
      setBranchQuery("");
      setSelectedIndex(0);
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [branchQuery]);

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

    const confirmed = await primitiveConfirm(
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

  if (!currentBranch) {
    return null;
  }

  const handleOpenDropdown = async () => {
    if (!repoPath || isDropdownOpen) return;
    setIsDropdownOpen(true);
    await loadBranches();
  };

  const commandEntries = [
    ...(createBranchName ? [{ type: "create" as const, value: createBranchName }] : []),
    ...filteredBranches.map((branch) => ({ type: "branch" as const, value: branch })),
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
        void handleCreateBranch(selectedEntry.value);
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
        <GitBranch size={triggerIconSize} className="shrink-0" />
        <span
          className={cn("ui-text-sm min-w-0 truncate font-normal", triggerInputClassName)}
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
        placeholder="Search branches..."
        meta={`${branches.length} branch${branches.length === 1 ? "" : "es"}`}
        placement={placement === "up" ? "bottom" : "top"}
      >
        <CommandList>
          {branches.length === 0 ? <CommandEmpty>No branches found</CommandEmpty> : null}
          {branches.length > 0 ? (
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
                  <Plus size={14} className="shrink-0 text-text-lighter" />
                  <span className="ui-text-xs min-w-0 flex-1 truncate text-text">
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
        </CommandList>
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
    <CommandItem
      disabled={isLoading}
      isSelected={isSelected}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      className={cn("group ui-font", isCurrent ? "text-text" : "text-text-lighter hover:text-text")}
    >
      {isCurrent ? (
        <Check size={14} className="shrink-0 text-success" />
      ) : (
        <GitBranch size={14} className="shrink-0 text-text-lighter" />
      )}
      <span className="ui-text-xs min-w-0 flex-1 truncate text-text">{branch}</span>
      {isCurrent ? <span className="ui-text-xs ml-auto shrink-0 text-success">current</span> : null}
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
    </CommandItem>
  );
}

export default GitBranchManager;
