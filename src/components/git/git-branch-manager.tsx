import { Check, ChevronDown, GitBranch, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/contexts/toast-context";
import { cn } from "@/utils/cn";
import {
  checkoutBranch,
  createBranch,
  createStash,
  deleteBranch,
  getBranches,
} from "../../utils/git";

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
  const [showModal, setShowModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    loadBranches();
  }, [repoPath]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showModal) {
        setShowModal(false);
      }
    };

    if (showModal) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showModal]);

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
          duration: 0, // Don't auto-dismiss
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
                  // Try to checkout again after stashing
                  const retryResult = await checkoutBranch(repoPath, branchName);
                  if (retryResult.success) {
                    showToast({
                      message: "Changes stashed and branch switched successfully",
                      type: "success",
                    });
                    setShowModal(false);
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
        setShowModal(false);
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

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
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
          className={compact ? "flex-shrink-0" : "text-text-lighter"}
        />
        <span
          className={cn(
            "flex items-center truncate font-mono",
            compact ? "max-w-20 pt-0.5 text-xs" : "max-w-32",
          )}
        >
          {currentBranch}
        </span>
        {!compact && <ChevronDown size={8} />}
      </button>

      {showModal && (
        <div
          className={cn("fixed inset-0 z-100 flex items-center justify-center", "bg-opacity-50")}
          onClick={() => setShowModal(false)}
        >
          <div
            className={cn(
              "flex max-h-[60vh] w-120 flex-col rounded-lg",
              "border border-border bg-primary-bg shadow-xl",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
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
                onClick={() => setShowModal(false)}
                className={cn("rounded p-0.5 text-text-lighter", "hover:bg-hover hover:text-text")}
              >
                <X size={12} />
              </button>
            </div>

            {/* Create New Branch */}
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
                      "focus:border-blue-500 focus:outline-none",
                    )}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newBranchName.trim()) {
                        e.preventDefault();
                        handleCreateBranch();
                      }
                    }}
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleCreateBranch}
                    disabled={!newBranchName.trim() || isLoading}
                    className={cn(
                      "flex items-center gap-1 rounded border border-blue-600",
                      "bg-blue-600 px-2 py-1.5 text-white text-xs",
                      "hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    <Plus size={10} />
                    Create
                  </button>
                </div>
                {currentBranch && (
                  <p className="text-[10px] text-text-lighter">
                    From: <span className="font-mono">{currentBranch}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Branch List */}
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
                          {branch === currentBranch && (
                            <Check size={10} className="text-green-400" />
                          )}
                          <GitBranch size={10} className="text-text-lighter" />
                          <span className="truncate font-mono">{branch}</span>
                          {branch === currentBranch && (
                            <span className="ml-auto text-[9px] text-green-400">current</span>
                          )}
                        </button>
                        {branch !== currentBranch && (
                          <button
                            onClick={() => handleDeleteBranch(branch)}
                            disabled={isLoading}
                            className={cn(
                              "rounded p-0.5 text-red-400 opacity-0",
                              "hover:bg-red-400/10 hover:text-red-300",
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

            {/* Modal Footer */}
            <div className={cn("rounded-b-lg border-border border-t bg-secondary-bg", "px-3 py-2")}>
              <div className="flex items-center justify-between text-[10px] text-text-lighter">
                <span>
                  Current: <span className="font-mono text-text">{currentBranch}</span>
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
