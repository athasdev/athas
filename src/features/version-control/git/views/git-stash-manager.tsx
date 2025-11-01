import { Archive, Clock, Download, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { applyStash, createStash, dropStash, getStashes, popStash } from "../controllers/git";
import type { GitStash } from "../models/git-types";

interface GitStashManagerProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath?: string;
  onRefresh?: () => void;
}

const GitStashManager = ({ isOpen, onClose, repoPath, onRefresh }: GitStashManagerProps) => {
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newStashMessage, setNewStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [actionLoading, setActionLoading] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isOpen) {
      loadStashes();
    }
  }, [isOpen, repoPath]);

  const loadStashes = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const stashList = await getStashes(repoPath);
      setStashes(stashList);
    } catch (error) {
      console.error("Failed to load stashes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateStash = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const success = await createStash(
        repoPath,
        newStashMessage.trim() || undefined,
        includeUntracked,
      );
      if (success) {
        setNewStashMessage("");
        await loadStashes();
        onRefresh?.();
      }
    } catch (error) {
      console.error("Failed to create stash:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStashAction = async (
    action: () => Promise<boolean>,
    stashIndex: number,
    actionName: string,
  ) => {
    if (!repoPath) return;

    setActionLoading((prev) => new Set(prev).add(stashIndex));
    try {
      const success = await action();
      if (success) {
        await loadStashes();
        onRefresh?.();
      } else {
        console.error(`${actionName} failed`);
      }
    } catch (error) {
      console.error(`${actionName} error:`, error);
    } finally {
      setActionLoading((prev) => {
        const newSet = new Set(prev);
        newSet.delete(stashIndex);
        return newSet;
      });
    }
  };

  const handleApplyStash = (stashIndex: number) => {
    handleStashAction(() => applyStash(repoPath!, stashIndex), stashIndex, "Apply stash");
  };

  const handlePopStash = (stashIndex: number) => {
    handleStashAction(() => popStash(repoPath!, stashIndex), stashIndex, "Pop stash");
  };

  const handleDropStash = (stashIndex: number) => {
    handleStashAction(() => dropStash(repoPath!, stashIndex), stashIndex, "Drop stash");
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        if (diffHours === 0) {
          const diffMins = Math.floor(diffMs / (1000 * 60));
          return diffMins <= 1 ? "just now" : `${diffMins}m ago`;
        }
        return `${diffHours}h ago`;
      } else if (diffDays === 1) {
        return "yesterday";
      } else if (diffDays < 7) {
        return `${diffDays}d ago`;
      } else {
        return date.toLocaleDateString();
      }
    } catch {
      return dateString;
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center", "bg-opacity-50")}>
      <div
        className={cn(
          "flex max-h-[80vh] w-96 flex-col rounded-lg",
          "border border-border bg-secondary-bg shadow-xl",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b p-4">
          <div className="flex items-center gap-2">
            <Archive size={16} className="text-text-lighter" />
            <h2 className="font-medium text-sm text-text">Stash Manager</h2>
          </div>
          <button onClick={onClose} className="text-text-lighter transition-colors hover:text-text">
            <X size={16} />
          </button>
        </div>

        {/* Create New Stash */}
        <div className="border-border border-b p-4">
          <div className="space-y-2">
            <div className="mb-2 flex items-center gap-2">
              <Plus size={12} className="text-text-lighter" />
              <span className="font-medium text-text text-xs">Create New Stash</span>
            </div>

            <input
              type="text"
              placeholder="Stash message (optional)..."
              value={newStashMessage}
              onChange={(e) => setNewStashMessage(e.target.value)}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "px-2 py-1 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateStash();
                }
              }}
            />

            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-text text-xs">
                <input
                  type="checkbox"
                  checked={includeUntracked}
                  onChange={(e) => setIncludeUntracked(e.target.checked)}
                  className="h-3 w-3"
                />
                Include untracked files
              </label>
            </div>

            <button
              onClick={handleCreateStash}
              disabled={isLoading}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "py-1.5 text-text text-xs transition-colors",
                "hover:bg-hover disabled:opacity-50",
              )}
            >
              {isLoading ? "Creating..." : "Create Stash"}
            </button>
          </div>
        </div>

        {/* Stash List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && stashes.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">Loading stashes...</div>
          ) : stashes.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">No stashes found</div>
          ) : (
            <div className="space-y-0">
              {stashes.map((stash) => {
                const isActionLoading = actionLoading.has(stash.index);

                return (
                  <div
                    key={stash.index}
                    className={cn("border-border border-b p-3", "last:border-b-0 hover:bg-hover")}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="font-mono text-text-lighter text-xs">
                            {`stash@{${stash.index}}`}
                          </span>
                        </div>

                        <div className="mb-1 text-text text-xs">
                          {stash.message || "Stashed changes"}
                        </div>

                        <div className="flex items-center gap-1 text-[9px] text-text-lighter">
                          <Clock size={8} />
                          {formatDate(stash.date)}
                        </div>
                      </div>
                    </div>

                    {/* Stash Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleApplyStash(stash.index)}
                        disabled={isActionLoading}
                        className={cn(
                          "flex items-center gap-1 rounded border border-border",
                          "bg-primary-bg px-2 py-1 text-[9px] text-text",
                          "transition-colors hover:bg-secondary-bg disabled:opacity-50",
                        )}
                        title="Apply stash (keep in stash list)"
                      >
                        <Download size={8} />
                        Apply
                      </button>

                      <button
                        onClick={() => handlePopStash(stash.index)}
                        disabled={isActionLoading}
                        className={cn(
                          "flex items-center gap-1 rounded border border-border",
                          "bg-primary-bg px-2 py-1 text-[9px] text-text",
                          "transition-colors hover:bg-secondary-bg disabled:opacity-50",
                        )}
                        title="Pop stash (apply and remove from stash list)"
                      >
                        <Upload size={8} />
                        Pop
                      </button>

                      <button
                        onClick={() => handleDropStash(stash.index)}
                        disabled={isActionLoading}
                        className={cn(
                          "flex items-center gap-1 rounded border border-red-500",
                          "bg-red-600 px-2 py-1 text-[9px] text-white",
                          "transition-colors hover:bg-red-700 disabled:opacity-50",
                        )}
                        title="Drop stash (delete permanently)"
                      >
                        <Trash2 size={8} />
                        Drop
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={cn("border-border border-t bg-primary-bg p-3", "text-[9px] text-text-lighter")}
        >
          {stashes.length} stash{stashes.length !== 1 ? "es" : ""} total
        </div>
      </div>
    </div>
  );
};

export default GitStashManager;
