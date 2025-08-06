import { Globe, Plus, Server, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { addRemote, type GitRemote, getRemotes, removeRemote } from "@/utils/git";

interface GitRemoteManagerProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath?: string;
  onRefresh?: () => void;
}

const GitRemoteManager = ({ isOpen, onClose, repoPath, onRefresh }: GitRemoteManagerProps) => {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [newRemoteUrl, setNewRemoteUrl] = useState("");
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      loadRemotes();
    }
  }, [isOpen, repoPath]);

  const loadRemotes = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const remoteList = await getRemotes(repoPath);
      setRemotes(remoteList);
    } catch (error) {
      console.error("Failed to load remotes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddRemote = async () => {
    if (!repoPath || !newRemoteName.trim() || !newRemoteUrl.trim()) return;

    setIsLoading(true);
    try {
      const success = await addRemote(repoPath, newRemoteName.trim(), newRemoteUrl.trim());
      if (success) {
        setNewRemoteName("");
        setNewRemoteUrl("");
        await loadRemotes();
        onRefresh?.();
      }
    } catch (error) {
      console.error("Failed to add remote:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveRemote = async (remoteName: string) => {
    if (!repoPath) return;

    const confirmed = confirm(`Are you sure you want to remove remote '${remoteName}'?`);
    if (!confirmed) return;

    setActionLoading((prev) => new Set(prev).add(remoteName));
    try {
      const success = await removeRemote(repoPath, remoteName);
      if (success) {
        await loadRemotes();
        onRefresh?.();
      }
    } catch (error) {
      console.error("Failed to remove remote:", error);
    } finally {
      setActionLoading((prev) => {
        const newSet = new Set(prev);
        newSet.delete(remoteName);
        return newSet;
      });
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
            <Server size={16} className="text-text-lighter" />
            <h2 className="font-medium text-sm text-text">Remote Manager</h2>
          </div>
          <button onClick={onClose} className="text-text-lighter transition-colors hover:text-text">
            <X size={16} />
          </button>
        </div>

        {/* Add New Remote */}
        <div className="border-border border-b p-4">
          <div className="space-y-2">
            <div className="mb-2 flex items-center gap-2">
              <Plus size={12} className="text-text-lighter" />
              <span className="font-medium text-text text-xs">Add New Remote</span>
            </div>

            <input
              type="text"
              placeholder="Remote name (e.g., origin)"
              value={newRemoteName}
              onChange={(e) => setNewRemoteName(e.target.value)}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "px-2 py-1 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
              )}
            />

            <input
              type="text"
              placeholder="Remote URL (e.g., https://github.com/user/repo.git)"
              value={newRemoteUrl}
              onChange={(e) => setNewRemoteUrl(e.target.value)}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "px-2 py-1 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAddRemote();
                }
              }}
            />

            <button
              onClick={handleAddRemote}
              disabled={isLoading || !newRemoteName.trim() || !newRemoteUrl.trim()}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "py-1.5 text-text text-xs transition-colors",
                "hover:bg-hover disabled:opacity-50",
              )}
            >
              {isLoading ? "Adding..." : "Add Remote"}
            </button>
          </div>
        </div>

        {/* Remote List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && remotes.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">Loading remotes...</div>
          ) : remotes.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">No remotes configured</div>
          ) : (
            <div className="space-y-0">
              {remotes.map((remote) => {
                const isActionLoading = actionLoading.has(remote.name);

                return (
                  <div
                    key={remote.name}
                    className={cn("border-border border-b p-3", "last:border-b-0 hover:bg-hover")}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <Globe size={12} className="text-text-lighter" />
                          <span className="font-medium font-mono text-text text-xs">
                            {remote.name}
                          </span>
                        </div>

                        <div className="break-all text-[10px] text-text-lighter">{remote.url}</div>
                      </div>

                      <button
                        onClick={() => handleRemoveRemote(remote.name)}
                        disabled={isActionLoading}
                        className={cn(
                          "ml-2 flex items-center gap-1 rounded border border-red-500",
                          "bg-red-600 px-2 py-1 text-[9px] text-white",
                          "transition-colors hover:bg-red-700 disabled:opacity-50",
                        )}
                        title="Remove remote"
                      >
                        <Trash2 size={8} />
                        Remove
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
          {remotes.length} remote{remotes.length !== 1 ? "s" : ""} configured
        </div>
      </div>
    </div>
  );
};

export default GitRemoteManager;
