import { Check, ChevronDown, GitBranch, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { buttonClassName } from "@/ui/button";
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
      <button
        ref={buttonRef}
        data-branch-manager-trigger="true"
        onClick={() => void handleToggleDropdown()}
        disabled={isLoading}
        type="button"
        className={
          compact
            ? dropdownTriggerClassName("max-w-44")
            : "ui-font flex min-w-0 items-center gap-1 rounded-full px-2 py-1 font-medium text-text-lighter text-xs transition-colors hover:bg-hover hover:text-text disabled:opacity-50"
        }
      >
        <GitBranch size={11} className="shrink-0" />
        <span className="truncate">{currentBranch}</span>
        <ChevronDown size={8} />
      </button>

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
            <GitBranch size={12} className="shrink-0 text-text-lighter" />
            <span className="truncate font-medium text-text text-xs">{currentBranch}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setShowSearch((prev) => {
                  const next = !prev;
                  if (next) setShowCreate(false);
                  if (!next) setBranchQuery("");
                  return next;
                });
              }}
              className={cn(paneIconButtonClassName("h-6 w-6"), showSearch && "bg-hover text-text")}
              aria-label="Toggle branch search"
              title="Search branches"
              type="button"
            >
              <Search size={11} />
            </button>
            <button
              onClick={() => {
                setShowCreate((prev) => {
                  const next = !prev;
                  if (next) setShowSearch(false);
                  return next;
                });
              }}
              className={cn(paneIconButtonClassName("h-6 w-6"), showCreate && "bg-hover text-text")}
              aria-label="Toggle create branch"
              title="Create branch"
              type="button"
            >
              <Plus size={11} />
            </button>
            <button
              onClick={() => setIsDropdownOpen(false)}
              className={paneIconButtonClassName("h-6 w-6")}
              aria-label="Close branch dropdown"
              title="Close"
              type="button"
            >
              <X size={11} />
            </button>
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
              <button
                onClick={() => void handleCreateBranch()}
                disabled={!newBranchName.trim() || isLoading}
                className={buttonClassName({
                  variant: "default",
                  size: "sm",
                  className: "shrink-0 gap-1 rounded-lg",
                })}
                type="button"
              >
                <Plus size={10} />
                Create
              </button>
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
          <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-text-lighter">
            <span>{showSearch && branchQuery ? "Matches" : "Branches"}</span>
            <span>
              {filteredBranches.length}
              {branchQuery ? ` / ${branches.length}` : ""}
            </span>
          </div>
          {branches.length === 0 ? (
            <div className="p-3 text-center text-text-lighter text-xs italic">
              No branches found
            </div>
          ) : filteredBranches.length === 0 ? (
            <div className="p-3 text-center text-text-lighter text-xs italic">
              No branches match "{branchQuery}"
            </div>
          ) : (
            <div className="space-y-1">
              {filteredBranches.map((branch) => (
                <div
                  key={branch}
                  className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-hover"
                >
                  <button
                    onClick={() => void handleBranchChange(branch)}
                    disabled={isLoading || branch === currentBranch}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs disabled:opacity-50",
                      branch === currentBranch
                        ? "font-medium text-text"
                        : "text-text-lighter hover:text-text",
                    )}
                    type="button"
                  >
                    {branch === currentBranch && (
                      <Check size={10} className="shrink-0 text-success" />
                    )}
                    {branch !== currentBranch && (
                      <GitBranch size={10} className="shrink-0 text-text-lighter" />
                    )}
                    <span className="ui-font truncate">{branch}</span>
                    {branch === currentBranch && (
                      <span className="ml-auto shrink-0 text-[9px] text-success">current</span>
                    )}
                  </button>
                  {branch !== currentBranch && (
                    <button
                      onClick={() => void handleDeleteBranch(branch)}
                      disabled={isLoading}
                      className={cn(
                        "rounded p-1 text-git-deleted opacity-100 transition-opacity sm:opacity-0",
                        "hover:bg-git-deleted/10 hover:opacity-80",
                        "disabled:opacity-50 sm:group-hover:opacity-100",
                      )}
                      title={`Delete ${branch}`}
                      aria-label={`Delete branch ${branch}`}
                      type="button"
                    >
                      <Trash2 size={10} />
                    </button>
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
