import { Check, ChevronDown, GitBranch, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/features/layout/contexts/toast-context";
import { cn } from "@/utils/cn";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../api/branches";
import { createStash } from "../api/stash";

interface GitBranchManagerProps {
  currentBranch?: string;
  repoPath?: string;
  onBranchChange?: () => void;
  compact?: boolean;
  paletteTarget?: boolean;
  placement?: "auto" | "up" | "down";
}

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
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
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const { showToast } = useToast();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownWidth = useMemo(() => (compact ? 360 : 420), [compact]);
  const estimatedHeight = useMemo(() => (compact ? 430 : 500), [compact]);
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

  const updateDropdownPosition = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const safeWidth = Math.min(dropdownWidth, window.innerWidth - viewportPadding * 2);
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openUp =
      placement === "up"
        ? true
        : placement === "down"
          ? false
          : availableBelow < Math.min(estimatedHeight, 280) && availableAbove > availableBelow;
    const maxHeight = Math.max(
      220,
      Math.min(estimatedHeight, openUp ? availableAbove - 6 : availableBelow - 6),
    );
    const measuredHeight = dropdownRef.current?.getBoundingClientRect().height ?? estimatedHeight;
    const visibleHeight = Math.min(maxHeight, measuredHeight);

    const desiredLeft = rect.left;
    const left = Math.max(
      viewportPadding,
      Math.min(desiredLeft, window.innerWidth - safeWidth - viewportPadding),
    );

    const top = openUp ? Math.max(viewportPadding, rect.top - visibleHeight - 6) : rect.bottom + 6;

    setPosition({
      left,
      top,
      width: safeWidth,
      maxHeight,
    });
  }, [dropdownWidth, estimatedHeight, placement]);

  useEffect(() => {
    if (repoPath && isDropdownOpen) {
      void loadBranches();
    }
  }, [repoPath, isDropdownOpen, loadBranches]);

  useEffect(() => {
    if (!isDropdownOpen) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setIsDropdownOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsDropdownOpen(false);
      }
    };

    const handleReposition = () => {
      updateDropdownPosition();
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isDropdownOpen]);

  useEffect(() => {
    const handleOpenFromPalette = () => {
      if (!paletteTarget || !repoPath) return;
      setIsDropdownOpen(true);
      setBranchQuery("");
      updateDropdownPosition();
      void loadBranches();
    };

    window.addEventListener("athas:open-branch-manager", handleOpenFromPalette);
    return () => window.removeEventListener("athas:open-branch-manager", handleOpenFromPalette);
  }, [paletteTarget, repoPath, updateDropdownPosition, loadBranches]);

  useLayoutEffect(() => {
    if (!isDropdownOpen) return;
    updateDropdownPosition();
  }, [isDropdownOpen, updateDropdownPosition, branchQuery, branches.length, newBranchName]);

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
      setBranchQuery("");
      updateDropdownPosition();
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
        className={cn(
          "flex items-center",
          compact
            ? "gap-1 rounded-full px-1.5 py-0.5 text-text-lighter hover:bg-hover disabled:opacity-50"
            : "gap-1 rounded-full px-2 py-1 font-medium text-text text-xs hover:bg-hover disabled:opacity-50",
        )}
      >
        <GitBranch
          size={compact ? 11 : 12}
          className={compact ? "shrink-0" : "text-text-lighter"}
        />
        <span
          className={cn(
            "ui-font flex items-center truncate",
            compact ? "max-w-20 pt-0.5 text-xs" : "max-w-32",
          )}
        >
          {currentBranch}
        </span>
        <ChevronDown size={8} />
      </button>

      {isDropdownOpen &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[10030] flex flex-col overflow-hidden rounded-2xl border border-border bg-primary-bg/95 backdrop-blur-sm"
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
              width: `${position.width}px`,
              maxHeight: `${position.maxHeight}px`,
            }}
          >
            <div className="flex items-center justify-between border-border/70 border-b bg-secondary-bg/75 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <GitBranch size={12} className="shrink-0 text-text-lighter" />
                <span className="truncate font-medium text-text text-xs">{currentBranch}</span>
                <span className="rounded-full bg-selected px-1.5 py-0.5 text-[9px] text-text-lighter">
                  Current
                </span>
              </div>
              <button
                onClick={() => setIsDropdownOpen(false)}
                className="rounded-md p-1 text-text-lighter hover:bg-hover hover:text-text"
                aria-label="Close branch dropdown"
              >
                <X size={12} />
              </button>
            </div>

            <div className="border-border/60 border-b p-2.5">
              <div className="mb-1 font-medium text-[10px] text-text-lighter uppercase tracking-wide">
                Create Branch
              </div>
              <div className="flex gap-1.5">
                <input
                  id="new-branch-name"
                  type="text"
                  placeholder="feature/new-branch"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className={cn(
                    "flex-1 rounded-lg border border-border bg-secondary-bg",
                    "px-2 py-1.5 text-text text-xs focus:border-accent focus:outline-none",
                  )}
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
                  className={cn(
                    "flex items-center gap-1 rounded-lg border border-accent bg-accent px-2 py-1.5 text-white text-xs",
                    "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <Plus size={10} />
                  Create
                </button>
              </div>
            </div>

            <div className="border-border/60 border-b p-2.5">
              <label
                htmlFor="branch-search"
                className="mb-1 block text-[10px] text-text-lighter uppercase tracking-wide"
              >
                Find Branch
              </label>
              <div className="relative">
                <Search
                  size={11}
                  className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-text-lighter"
                />
                <input
                  id="branch-search"
                  type="text"
                  placeholder="Search by branch name"
                  value={branchQuery}
                  onChange={(e) => setBranchQuery(e.target.value)}
                  disabled={isLoading}
                  className={cn(
                    "w-full rounded-lg border border-border bg-secondary-bg py-1.5 pr-2 pl-7 text-text text-xs",
                    "focus:border-accent focus:outline-none disabled:opacity-50",
                  )}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-text-lighter uppercase tracking-wide">
                <span>Branches</span>
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
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default GitBranchManager;
