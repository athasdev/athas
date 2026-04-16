import { Check, ChevronDown, GitBranch, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../api/git-branches-api";
import { createStash } from "../api/git-stash-api";

interface GitBranchManagerProps {
  currentBranch?: string;
  repoPath?: string;
  onBranchChange?: () => void;
  compact?: boolean;
  paletteTarget?: boolean;
  placement?: "auto" | "up" | "down";
}

const COMPACT_DROPDOWN_WIDTH = 360;
const DEFAULT_DROPDOWN_WIDTH = 420;

function getFilteredBranches(branches: string[], currentBranch: string, query: string) {
  const sorted = [...branches].sort((a, b) => {
    if (a === currentBranch) return -1;
    if (b === currentBranch) return 1;
    return a.localeCompare(b);
  });

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return sorted;

  return sorted.filter((branch) => branch.toLowerCase().includes(normalizedQuery));
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
  compact = false,
  paletteTarget = false,
  placement = "auto",
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
  const dropdownWidth = compact ? COMPACT_DROPDOWN_WIDTH : DEFAULT_DROPDOWN_WIDTH;
  const activeBranch = currentBranch ?? "";
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
    <>
      <Input
        ref={inputRef}
        data-branch-manager-trigger="true"
        value={isDropdownOpen ? branchQuery : currentBranch}
        onFocus={() => void handleOpenDropdown()}
        onClick={() => void handleOpenDropdown()}
        onChange={(event) => {
          setBranchQuery(event.target.value);
          if (!isDropdownOpen) {
            void handleOpenDropdown();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsDropdownOpen(false);
          }
        }}
        disabled={isLoading}
        readOnly={!isDropdownOpen}
        leftIcon={GitBranch}
        rightIcon={ChevronDown}
        size="sm"
        variant="ghost"
        containerClassName={compact ? "w-fit min-w-0 shrink" : "w-fit min-w-0"}
        className={cn(
          "ui-font ui-text-sm min-w-0 pl-7 pr-7 font-medium text-text-lighter",
          compact ? "w-[180px] truncate" : "w-fit rounded-full",
        )}
        placeholder={currentBranch}
        aria-label="Search branches"
      />

      <Dropdown
        isOpen={isDropdownOpen}
        anchorRef={inputRef}
        anchorSide={placement === "up" ? "top" : "bottom"}
        onClose={closeDropdown}
        className="flex flex-col overflow-hidden rounded-2xl p-0"
        menuClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{
          width: `min(${dropdownWidth}px, calc(100vw - 16px))`,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: compact ? "240px" : "280px",
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {branches.length === 0 ? (
            <div className="ui-text-sm p-3 text-center text-text-lighter italic">
              No branches found
            </div>
          ) : (
            <div className="space-y-1">
              {createBranchName ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleCreateBranch(createBranchName)}
                  disabled={isLoading}
                  className={cn(
                    "h-auto w-full justify-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-text hover:bg-hover",
                    normalizedQuery && "bg-hover",
                  )}
                >
                  <Plus className="shrink-0 text-text-lighter" />
                  <span className="ui-font ui-text-sm truncate">
                    Create new branch "{createBranchName}"
                  </span>
                </Button>
              ) : null}
              {filteredBranches.map((branch, index) => (
                <BranchRow
                  key={branch}
                  branch={branch}
                  isCurrent={branch === currentBranch}
                  isFirstMatch={Boolean(normalizedQuery) && !createBranchName && index === 0}
                  isLoading={isLoading}
                  onSelect={() => void handleBranchChange(branch)}
                  onDelete={() => void handleDeleteBranch(branch)}
                />
              ))}
            </div>
          )}
        </div>
      </Dropdown>
    </>
  );
};

function BranchRow({
  branch,
  isCurrent,
  isFirstMatch,
  isLoading,
  onSelect,
  onDelete,
}: {
  branch: string;
  isCurrent: boolean;
  isFirstMatch: boolean;
  isLoading: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-hover",
        isFirstMatch && "bg-hover",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onSelect}
        disabled={isLoading || isCurrent}
        className={cn(
          "h-auto min-w-0 flex-1 justify-start gap-1.5 px-0 py-0 text-left disabled:opacity-50 hover:bg-transparent",
          isCurrent ? "font-medium text-text" : "text-text-lighter hover:text-text",
        )}
      >
        {isCurrent ? (
          <Check className="shrink-0 text-success" />
        ) : (
          <GitBranch className="shrink-0 text-text-lighter" />
        )}
        <span className="ui-font ui-text-sm truncate">{branch}</span>
        {isCurrent ? (
          <span className="ui-text-sm ml-auto shrink-0 text-success">current</span>
        ) : null}
      </Button>
      {!isCurrent ? (
        <Button
          onClick={onDelete}
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
    </div>
  );
}

export default GitBranchManager;
