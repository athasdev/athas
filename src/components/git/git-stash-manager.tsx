import { Archive, Clock, Download, GitBranch, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  applyStash,
  createStash,
  dropStash,
  type GitStash,
  getStashes,
  popStash,
} from "../../utils/git";

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

    setActionLoading(prev => new Set(prev).add(stashIndex));
    try {
      const success = await action();
      if (success) {
        await loadStashes();
        onRefresh?.();
        console.log(`${actionName} completed successfully`);
      }
    } catch (error) {
      console.error(`${actionName} failed:`, error);
    } finally {
      setActionLoading(prev => {
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
    const confirmed = confirm("Are you sure you want to drop this stash? This cannot be undone.");
    if (!confirmed) return;

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
    <div className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-lg shadow-xl w-96 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Archive size={16} className="text-[var(--text-lighter)]" />
            <h2 className="text-sm font-medium text-[var(--text-color)]">Stash Manager</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Create New Stash */}
        <div className="p-4 border-b border-[var(--border-color)]">
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Plus size={12} className="text-[var(--text-lighter)]" />
              <span className="text-xs text-[var(--text-color)] font-medium">Create New Stash</span>
            </div>

            <input
              type="text"
              placeholder="Stash message (optional)..."
              value={newStashMessage}
              onChange={e => setNewStashMessage(e.target.value)}
              className="w-full bg-[var(--primary-bg)] text-[var(--text-color)] border border-[var(--border-color)] px-2 py-1 text-xs rounded focus:outline-none focus:border-blue-500"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  handleCreateStash();
                }
              }}
            />

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-[var(--text-color)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUntracked}
                  onChange={e => setIncludeUntracked(e.target.checked)}
                  className="w-3 h-3"
                />
                Include untracked files
              </label>
            </div>

            <button
              onClick={handleCreateStash}
              disabled={isLoading}
              className="w-full bg-[var(--primary-bg)] border border-[var(--border-color)] text-[var(--text-color)] text-xs py-1.5 rounded hover:bg-[var(--hover-color)] disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Creating..." : "Create Stash"}
            </button>
          </div>
        </div>

        {/* Stash List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && stashes.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-lighter)] text-xs">
              Loading stashes...
            </div>
          ) : stashes.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-lighter)] text-xs">
              No stashes found
            </div>
          ) : (
            <div className="space-y-0">
              {stashes.map(stash => {
                const isActionLoading = actionLoading.has(stash.index);

                return (
                  <div
                    key={stash.index}
                    className="p-3 border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--hover-color)]"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono text-[var(--text-lighter)]">
                            {`stash@{${stash.index}}`}
                          </span>
                          <div className="flex items-center gap-1 text-[9px] text-[var(--text-lighter)]">
                            <GitBranch size={8} />
                            {stash.branch}
                          </div>
                        </div>

                        <div className="text-xs text-[var(--text-color)] mb-1">
                          {stash.message || `WIP on ${stash.branch}`}
                        </div>

                        <div className="flex items-center gap-1 text-[9px] text-[var(--text-lighter)]">
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
                        className="flex items-center gap-1 px-2 py-1 text-[9px] bg-[var(--primary-bg)] border border-[var(--border-color)] text-[var(--text-color)] rounded hover:bg-[var(--secondary-bg)] disabled:opacity-50 transition-colors"
                        title="Apply stash (keep in stash list)"
                      >
                        <Download size={8} />
                        Apply
                      </button>

                      <button
                        onClick={() => handlePopStash(stash.index)}
                        disabled={isActionLoading}
                        className="flex items-center gap-1 px-2 py-1 text-[9px] bg-[var(--primary-bg)] border border-[var(--border-color)] text-[var(--text-color)] rounded hover:bg-[var(--secondary-bg)] disabled:opacity-50 transition-colors"
                        title="Pop stash (apply and remove from stash list)"
                      >
                        <Upload size={8} />
                        Pop
                      </button>

                      <button
                        onClick={() => handleDropStash(stash.index)}
                        disabled={isActionLoading}
                        className="flex items-center gap-1 px-2 py-1 text-[9px] bg-red-600 border border-red-500 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
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
        <div className="p-3 border-t border-[var(--border-color)] text-[9px] text-[var(--text-lighter)] bg-[var(--primary-bg)]">
          {stashes.length} stash{stashes.length !== 1 ? "es" : ""} total
        </div>
      </div>
    </div>
  );
};

export default GitStashManager;
