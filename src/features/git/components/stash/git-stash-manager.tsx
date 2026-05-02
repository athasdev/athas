import { Archive, Clock, Download, Plus, Trash as Trash2, Upload, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import { applyStash, createStash, dropStash, getStashes, popStash } from "../../api/git-stash-api";
import type { GitStash } from "../../types/git-types";

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

  if (!isOpen) {
    return null;
  }

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center", "bg-opacity-50")}>
      <div
        className={cn(
          "flex max-h-[80vh] w-96 flex-col rounded-lg",
          "border border-border bg-secondary-bg",
        )}
      >
        <div className="flex items-center justify-between border-border border-b p-4">
          <div className="flex items-center gap-2">
            <Archive className="text-text-lighter" />
            <h2 className="font-medium text-sm text-text">Stash Manager</h2>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-text-lighter">
            <X />
          </Button>
        </div>

        <div className="border-border border-b p-4">
          <div className="space-y-2">
            <div className="mb-2 flex items-center gap-2">
              <Plus className="text-text-lighter" />
              <span className="font-medium text-text text-xs">Create New Stash</span>
            </div>

            <Input
              type="text"
              placeholder="Stash message (optional)..."
              value={newStashMessage}
              onChange={(e) => setNewStashMessage(e.target.value)}
              className={cn("w-full bg-primary-bg")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateStash();
                }
              }}
            />

            <div className="flex items-center gap-2">
              <label
                htmlFor="include-untracked-stash"
                className="flex cursor-pointer items-center gap-1 text-text text-xs"
              >
                <Checkbox
                  id="include-untracked-stash"
                  checked={includeUntracked}
                  onChange={setIncludeUntracked}
                />
                Include untracked files
              </label>
            </div>

            <Button
              onClick={handleCreateStash}
              disabled={isLoading}
              variant="outline"
              size="sm"
              className="w-full"
            >
              {isLoading ? "Creating..." : "Create Stash"}
            </Button>
          </div>
        </div>

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
                          <span className="ui-font text-text-lighter text-xs">
                            {`stash@{${stash.index}}`}
                          </span>
                        </div>

                        <div className="mb-1 text-text text-xs">
                          {stash.message || "Stashed changes"}
                        </div>

                        <div className="flex items-center gap-1 text-[9px] text-text-lighter">
                          <Clock />
                          {formatRelativeDate(stash.date)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        onClick={() => handleApplyStash(stash.index)}
                        disabled={isActionLoading}
                        variant="outline"
                        size="xs"
                        className="gap-1 px-2 py-1 text-[9px]"
                        tooltip="Apply stash (keep in stash list)"
                      >
                        <Download />
                        Apply
                      </Button>

                      <Button
                        onClick={() => handlePopStash(stash.index)}
                        disabled={isActionLoading}
                        variant="outline"
                        size="xs"
                        className="gap-1 px-2 py-1 text-[9px]"
                        tooltip="Pop stash (apply and remove from stash list)"
                      >
                        <Upload />
                        Pop
                      </Button>

                      <Button
                        onClick={() => handleDropStash(stash.index)}
                        disabled={isActionLoading}
                        variant="danger"
                        size="xs"
                        className="gap-1 px-2 py-1 text-[9px]"
                        tooltip="Drop stash (delete permanently)"
                      >
                        <Trash2 />
                        Drop
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
