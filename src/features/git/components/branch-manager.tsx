import { Check, ChevronDown, GitBranch, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../api/branches";
import { createStash } from "../api/stash";

interface GitBranchManagerProps {
  currentBranch?: string;
  repoPath?: string;
  onBranchChange?: () => void;
  compact?: boolean;
}

const GitBranchManager = ({
  currentBranch,
  repoPath,
  onBranchChange,
  compact = false,
}: GitBranchManagerProps) => {
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranchName, setNewBranchName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();
  const isBranchManagerVisible = useUIState((state) => state.isBranchManagerVisible);
  const setIsBranchManagerVisible = useUIState((state) => state.setIsBranchManagerVisible);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    loadBranches();
  }, [repoPath]);

  const loadBranches = async () => {
    if (!repoPath) return;

    try {
      const branchList = await getBranches(repoPath);
      setBranches(branchList);
    } catch (error) {
      console.error("Failed to load branches:", error);
    }
  };

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
                    setIsBranchManagerVisible(false);
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
        setIsBranchManagerVisible(false);
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

  const getModalPosition = () => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const modalWidth = 480;
    const modalMaxHeight = viewportHeight * 0.6;

    const left = viewportWidth / 2 - modalWidth / 2;
    const top = viewportHeight / 2 - modalMaxHeight / 2;

    return {
      left: `${left}px`,
      top: `${top}px`,
      maxHeight: `${modalMaxHeight}px`,
    };
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsBranchManagerVisible(true)}
        disabled={isLoading}
        className={cn(
          "flex items-center",
          compact
            ? "gap-1 rounded px-1 py-0.5 text-text-lighter hover:bg-hover disabled:opacity-50"
            : "gap-1 rounded px-2 py-1 font-medium text-text text-xs hover:bg-hover disabled:opacity-50",
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
        {!compact && <ChevronDown size={8} />}
      </button>

      {isBranchManagerVisible && (
        <div
          className={cn("fixed inset-0 z-100", "bg-black bg-opacity-50")}
          onClick={() => setIsBranchManagerVisible(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setIsBranchManagerVisible(false);
            }
          }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div
            className={cn(
              "absolute flex w-120 flex-col rounded-lg",
              "border border-border bg-primary-bg",
            )}
            style={getModalPosition()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={cn(
                "flex items-center justify-between border-border border-b",
                "px-3 py-2",
              )}
            >
              <h3 className="flex items-center gap-1.5 font-medium text-text text-xs">
                <GitBranch size={12} />
                Branch Manager
              </h3>
              <button
                onClick={() => setIsBranchManagerVisible(false)}
                className={cn("rounded p-0.5 text-text-lighter", "hover:bg-hover hover:text-text")}
              >
                <X size={12} />
              </button>
            </div>

            <div className="border-border border-b px-3 py-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-branch-name"
                  className="font-medium text-[10px] text-text-lighter"
                >
                  Create New Branch
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="new-branch-name"
                    type="text"
                    placeholder="Enter branch name..."
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    className={cn(
                      "flex-1 rounded border border-border bg-secondary-bg",
                      "px-2 py-1.5 text-text text-xs",
                      "focus:border-accent focus:outline-none",
                    )}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newBranchName.trim()) {
                        e.preventDefault();
                        handleCreateBranch();
                      } else if (e.key === "Escape") {
                        if (newBranchName.trim()) {
                          e.preventDefault();
                          e.stopPropagation();
                          setNewBranchName("");
                        }
                      }
                    }}
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleCreateBranch}
                    disabled={!newBranchName.trim() || isLoading}
                    className={cn(
                      "flex items-center gap-1 rounded border border-accent",
                      "bg-accent px-2 py-1.5 text-white text-xs",
                      "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    <Plus size={10} />
                    Create
                  </button>
                </div>
                {currentBranch && (
                  <p className="text-[10px] text-text-lighter">
                    From: <span className="ui-font">{currentBranch}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="border-border border-b bg-secondary-bg px-3 py-1.5">
                <h4 className="font-medium text-[10px] text-text">Branches ({branches.length})</h4>
              </div>

              <div className="flex-1 overflow-y-auto">
                {branches.length === 0 ? (
                  <div className="p-3 text-center text-text-lighter text-xs italic">
                    No branches found
                  </div>
                ) : (
                  <div className="p-1">
                    {branches.map((branch) => (
                      <div
                        key={branch}
                        className={cn(
                          "group flex items-center justify-between rounded",
                          "px-2 py-1.5 hover:bg-hover",
                        )}
                      >
                        <button
                          onClick={() => handleBranchChange(branch)}
                          disabled={isLoading || branch === currentBranch}
                          className={cn(
                            "flex flex-1 items-center gap-1.5 text-left text-xs disabled:opacity-50",
                            branch === currentBranch
                              ? "font-medium text-text"
                              : "text-text-lighter hover:text-text",
                          )}
                        >
                          {branch === currentBranch && <Check size={10} className="text-success" />}
                          <GitBranch size={10} className="text-text-lighter" />
                          <span className="ui-font truncate">{branch}</span>
                          {branch === currentBranch && (
                            <span className="ml-auto text-[9px] text-success">current</span>
                          )}
                        </button>
                        {branch !== currentBranch && (
                          <button
                            onClick={() => handleDeleteBranch(branch)}
                            disabled={isLoading}
                            className={cn(
                              "rounded p-0.5 text-git-deleted opacity-0",
                              "hover:bg-git-deleted/10 hover:opacity-80",
                              "disabled:opacity-50 group-hover:opacity-100",
                            )}
                            title="Delete branch"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={cn("rounded-b-lg border-border border-t bg-secondary-bg", "px-3 py-2")}>
              <div className="flex items-center justify-between text-[10px] text-text-lighter">
                <span>
                  Current: <span className="ui-font text-text">{currentBranch}</span>
                </span>
                <span>
                  Press <kbd className="rounded bg-hover px-1 py-0.5 text-[9px]">Esc</kbd> to close
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GitBranchManager;
