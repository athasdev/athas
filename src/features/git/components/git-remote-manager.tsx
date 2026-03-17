import { Globe, Plus, Server, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { addRemote, getRemotes, removeRemote } from "../api/git-remotes-api";
import type { GitRemote } from "../types/git-types";

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
      void loadRemotes();
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
    <Dialog
      onClose={onClose}
      title="Remotes"
      icon={Server}
      size="md"
      classNames={{ content: "p-0" }}
    >
      <div className="ui-font flex max-h-[70vh] flex-col">
        <div className="border-border/70 border-b p-4">
          <div className="mb-3 flex items-center gap-2 text-text text-xs">
            <Plus size={12} className="text-text-lighter" />
            <span className="font-medium">Add remote</span>
          </div>

          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Remote name"
              value={newRemoteName}
              onChange={(e) => setNewRemoteName(e.target.value)}
              className="w-full bg-primary-bg"
            />
            <Input
              type="text"
              placeholder="Remote URL"
              value={newRemoteUrl}
              onChange={(e) => setNewRemoteUrl(e.target.value)}
              className="w-full bg-primary-bg"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleAddRemote();
                }
              }}
            />
            <div className="flex justify-end">
              <Button
                onClick={() => void handleAddRemote()}
                disabled={isLoading || !newRemoteName.trim() || !newRemoteUrl.trim()}
                size="sm"
              >
                {isLoading ? "Adding..." : "Add Remote"}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && remotes.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">Loading remotes...</div>
          ) : remotes.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">No remotes configured</div>
          ) : (
            remotes.map((remote) => {
              const isActionLoading = actionLoading.has(remote.name);

              return (
                <div
                  key={remote.name}
                  className="border-border/70 border-b px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <Globe size={12} className="text-text-lighter" />
                        <span className="font-medium text-text text-xs">{remote.name}</span>
                      </div>
                      <div className="break-all text-[10px] text-text-lighter">{remote.url}</div>
                    </div>
                    <Button
                      onClick={() => void handleRemoveRemote(remote.name)}
                      disabled={isActionLoading}
                      variant="ghost"
                      size="xs"
                      className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      title="Remove remote"
                    >
                      <Trash2 size={10} />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-border/70 border-t bg-secondary-bg/40 px-4 py-2 text-[10px] text-text-lighter">
          {remotes.length} remote{remotes.length !== 1 ? "s" : ""} configured
        </div>
      </div>
    </Dialog>
  );
};

export default GitRemoteManager;
