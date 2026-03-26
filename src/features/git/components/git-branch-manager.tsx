import { Check, ChevronDown, GitBranch, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { dropdownTriggerClassName } from "@/ui/dropdown";
import { paneIconButtonClassName } from "@/ui/pane";
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
  const [newBranchName, setNewBranchName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const dropdownWidth = useMemo(() => (compact ? 360 : 420), [compact]);
  const filteredBranches = useMemo(() => {
    const normalizedQuery = branchQuery.trim().toLowerCase();
    const sorted = [...branches].sort((a, b) => {
      if (a === currentBranch) return -1;
      if (b === currentBranch) return 1;
      return a.localeCompare(b);
    });

    if (!normalizedQuery) {
      return sorted;
    }

    return sorted.filter((branch) => branch.toLowerCase().includes(normalizedQuery));
  }, [branchQuery, branches, currentBranch]);

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
      setShowSearch(true);
      setShowCreate(false);
      void loadBranches();
    };

    window.addEventListener("athas:open-branch-manager", handleOpenFromPalette);
    return () => window.removeEventListener("athas:open-branch-manager", handleOpenFromPalette);
  }, [paletteTarget, repoPath, loadBranches]);

  useEffect(() => {
    if (!isDropdownOpen) {
      setShowSearch(false);
      setShowCreate(false);
      setBranchQuery("");
      return;
    }

    if (showSearch) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    } else if (showCreate) {
      window.requestAnimationFrame(() => createInputRef.current?.focus());
    }
  }, [isDropdownOpen, showSearch, showCreate]);

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

  const handleCreateBranch = async () => {
    if (!repoPath || !newBranchName.trim()) return;

    setIsLoading(true);
    try {
      const success = await createBranch(repoPath, newBranchName.trim(), currentBranch);
      if (success) {
        setNewBranchName("");
        await loadBranches();
        onBranchChange?.();
      }
    } finally {
      setIsLoading(false);
    }
  };

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

  if (!currentBranch) {
    return null;
  }

  const handleToggleDropdown = async () => {
    if (!repoPath) return;
    const nextOpen = !isDropdownOpen;
    setIsDropdownOpen(nextOpen);
    if (nextOpen) {
      setShowSearch(true);
      setShowCreate(false);
      await loadBranches();
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        data-branch-manager-trigger="true"
        onClick={() => void handleToggleDropdown()}
        disabled={isLoading}
        type="button"
        variant="ghost"
        size="sm"
        className={
          compact
            ? dropdownTriggerClassName("ui-text-sm max-w-44")
            : "ui-font ui-text-sm flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 font-medium text-text-lighter transition-colors hover:bg-hover hover:text-text disabled:opacity-50"
        }
      >
        <GitBranch className="shrink-0" />
        <span className="truncate">{currentBranch}</span>
        <ChevronDown />
      </Button>

      <Dropdown
        isOpen={isDropdownOpen}
        anchorRef={buttonRef}
        anchorSide={placement === "up" ? "top" : "bottom"}
        onClose={() => setIsDropdownOpen(false)}
        className="flex flex-col overflow-hidden rounded-2xl p-0"
        style={{
          width: `min(${dropdownWidth}px, calc(100vw - 16px))`,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: compact ? "240px" : "280px",
        }}
      >
        <div className="flex items-center justify-between bg-secondary-bg/75 px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <GitBranch className="shrink-0 text-text-lighter" />
            <span className="ui-text-sm truncate font-medium text-text">{currentBranch}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              onClick={() => {
                setShowSearch((prev) => {
                  const next = !prev;
                  if (next) setShowCreate(false);
                  if (!next) setBranchQuery("");
                  return next;
                });
              }}
              variant="ghost"
              size="icon-sm"
              className={cn(paneIconButtonClassName("size-6"), showSearch && "bg-hover text-text")}
              aria-label="Toggle branch search"
              title="Search branches"
              type="button"
            >
              <Search />
            </Button>
            <Button
              onClick={() => {
                setShowCreate((prev) => {
                  const next = !prev;
                  if (next) setShowSearch(false);
                  return next;
                });
              }}
              variant="ghost"
              size="icon-sm"
              className={cn(paneIconButtonClassName("size-6"), showCreate && "bg-hover text-text")}
              aria-label="Toggle create branch"
              title="Create branch"
              type="button"
            >
              <Plus />
            </Button>
            <Button
              onClick={() => setIsDropdownOpen(false)}
              variant="ghost"
              size="icon-sm"
              className={paneIconButtonClassName("size-6")}
              aria-label="Close branch dropdown"
              title="Close"
              type="button"
            >
              <X />
            </Button>
          </div>
        </div>

        {showCreate && (
          <div className="border-border/60 border-t px-2.5 py-2">
            <div className="flex gap-1.5">
              <Input
                ref={createInputRef}
                id="new-branch-name"
                type="text"
                placeholder="feature/new-branch"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newBranchName.trim()) {
                    e.preventDefault();
                    void handleCreateBranch();
                  }
                }}
                disabled={isLoading}
              />
              <Button
                onClick={() => void handleCreateBranch()}
                disabled={!newBranchName.trim() || isLoading}
                variant="default"
                size="sm"
                className="shrink-0 gap-1 rounded-lg"
                type="button"
              >
                <Plus />
                Create
              </Button>
            </div>
          </div>
        )}

        {showSearch && (
          <div className="px-2 py-1">
            <Input
              ref={searchInputRef}
              id="branch-search"
              type="text"
              placeholder="Search branches"
              value={branchQuery}
              onChange={(e) => setBranchQuery(e.target.value)}
              disabled={isLoading}
              leftIcon={Search}
              size="xs"
              variant="ghost"
              className="w-full px-0 py-0 pl-6 pr-1 bg-transparent focus:bg-transparent focus:ring-0"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="ui-text-sm mb-1 flex items-center justify-between px-1 text-text-lighter">
            <span>{showSearch && branchQuery ? "Matches" : "Branches"}</span>
            <span>
              {filteredBranches.length}
              {branchQuery ? ` / ${branches.length}` : ""}
            </span>
          </div>
          {branches.length === 0 ? (
            <div className="ui-text-sm p-3 text-center text-text-lighter italic">
              No branches found
            </div>
          ) : filteredBranches.length === 0 ? (
            <div className="ui-text-sm p-3 text-center text-text-lighter italic">
              No branches match "{branchQuery}"
            </div>
          ) : (
            <div className="space-y-1">
              {filteredBranches.map((branch) => (
                <div
                  key={branch}
                  className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-hover"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleBranchChange(branch)}
                    disabled={isLoading || branch === currentBranch}
                    className={cn(
                      "h-auto min-w-0 flex-1 justify-start gap-1.5 px-0 py-0 text-left disabled:opacity-50 hover:bg-transparent",
                      branch === currentBranch
                        ? "font-medium text-text"
                        : "text-text-lighter hover:text-text",
                    )}
                  >
                    {branch === currentBranch && <Check className="shrink-0 text-success" />}
                    {branch !== currentBranch && (
                      <GitBranch className="shrink-0 text-text-lighter" />
                    )}
                    <span className="ui-font ui-text-sm truncate">{branch}</span>
                    {branch === currentBranch && (
                      <span className="ui-text-sm ml-auto shrink-0 text-success">current</span>
                    )}
                  </Button>
                  {branch !== currentBranch && (
                    <Button
                      onClick={() => void handleDeleteBranch(branch)}
                      disabled={isLoading}
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        "text-git-deleted opacity-100 transition-opacity sm:opacity-0",
                        "hover:bg-git-deleted/10 hover:opacity-80 hover:text-git-deleted",
                        "disabled:opacity-50 sm:group-hover:opacity-100",
                      )}
                      title={`Delete ${branch}`}
                      aria-label={`Delete branch ${branch}`}
                      type="button"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Dropdown>
    </>
  );
};

export default GitBranchManager;
