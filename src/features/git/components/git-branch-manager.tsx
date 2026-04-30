import { Check, GitBranch, Plus, Trash as Trash2 } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
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
import { matchesSearchQuery } from "@/utils/search-match";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../api/git-branches-api";
import { createStash } from "../api/git-stash-api";

interface GitBranchManagerProps {
  currentBranch?: string;
  repoPath?: string;
  onBranchChange?: () => void;
  paletteTarget?: boolean;
  placement?: "up" | "down";
}

const BRANCH_MANAGER_DROPDOWN_WIDTH = 360;

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
}: GitBranchManagerProps) => {
  const [branches, setBranches] = useState<string[]>([]);
  const [branchQuery, setBranchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isThemeSelectorVisible ||
      state.isIconThemeSelectorVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const activeBranch = currentBranch ?? "";
  const triggerText = isDropdownOpen ? branchQuery || activeBranch : activeBranch;
  const triggerTextWidthCh = Math.min(Math.max(triggerText.length + 1, 6), 40);
  const normalizedQuery = branchQuery.trim();
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
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    window.addEventListener("athas:open-branch-manager", handleOpenFromPalette);
    return () => window.removeEventListener("athas:open-branch-manager", handleOpenFromPalette);
  }, [paletteTarget, repoPath, loadBranches]);

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

    const confirmed = confirm(`Are you sure you want to delete branch "${branchName}"?`);
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

  return (
    <Combobox
      items={filteredBranches}
      value={currentBranch}
      inputValue={isDropdownOpen ? branchQuery : currentBranch}
      open={isDropdownOpen}
      filter={null}
      itemToStringLabel={(branch) => branch}
      itemToStringValue={(branch) => branch}
      onInputValueChange={(value) => {
        setBranchQuery(value);
        if (!isDropdownOpen) {
          void handleOpenDropdown();
        }
      }}
      onOpenChange={(open) => {
        setIsDropdownOpen(open);
        if (open) {
          void loadBranches();
        }
      }}
      onValueChange={(value) => {
        if (typeof value === "string") {
          void handleBranchChange(value);
        }
      }}
    >
      <ComboboxInput
        ref={inputRef}
        data-branch-manager-trigger="true"
        onFocus={() => void handleOpenDropdown()}
        onClick={() => void handleOpenDropdown()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeDropdown();
          }
        }}
        disabled={isLoading}
        readOnly={!isDropdownOpen}
        leftIcon={GitBranch}
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
        placeholder={currentBranch}
        aria-label="Search branches"
      />

      <ComboboxContent
        side={placement === "up" ? "top" : "bottom"}
        className="flex flex-col rounded-2xl p-0"
        style={{
          width: `min(${BRANCH_MANAGER_DROPDOWN_WIDTH}px, calc(100vw - 16px))`,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "240px",
        }}
      >
        <ComboboxList className="min-h-0 flex-1 p-2">
          {branches.length === 0 ? <ComboboxEmpty>No branches found</ComboboxEmpty> : null}
          {branches.length > 0 ? (
            <div className="space-y-1">
              {createBranchName ? (
                <ComboboxActionItem
                  type="button"
                  onClick={() => void handleCreateBranch(createBranchName)}
                  disabled={isLoading}
                  className={normalizedQuery ? "bg-hover" : undefined}
                >
                  <Plus className="shrink-0 text-text-lighter" />
                  <span className="min-w-0 flex-1 truncate">
                    Create new branch "{createBranchName}"
                  </span>
                </ComboboxActionItem>
              ) : null}
              {filteredBranches.map((branch, index) => (
                <BranchRow
                  key={branch}
                  branch={branch}
                  isCurrent={branch === currentBranch}
                  isFirstMatch={Boolean(normalizedQuery) && !createBranchName && index === 0}
                  isLoading={isLoading}
                  onDelete={() => void handleDeleteBranch(branch)}
                />
              ))}
            </div>
          ) : null}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
};

function BranchRow({
  branch,
  isCurrent,
  isFirstMatch,
  isLoading,
  onDelete,
}: {
  branch: string;
  isCurrent: boolean;
  isFirstMatch: boolean;
  isLoading: boolean;
  onDelete: () => void;
}) {
  return (
    <ComboboxItem
      value={branch}
      disabled={isLoading}
      showIndicator={false}
      className={cn(
        "group",
        isFirstMatch && "bg-hover",
        isCurrent ? "font-medium text-text" : "text-text-lighter hover:text-text",
      )}
    >
      {isCurrent ? (
        <Check className="shrink-0 text-success" />
      ) : (
        <GitBranch className="shrink-0 text-text-lighter" />
      )}
      <span className="min-w-0 flex-1 truncate">{branch}</span>
      {isCurrent ? <span className="ui-text-sm ml-auto shrink-0 text-success">current</span> : null}
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
          size="icon-xs"
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
    </ComboboxItem>
  );
}

export default GitBranchManager;
