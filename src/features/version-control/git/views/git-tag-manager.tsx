import { Calendar, GitCommit, Plus, Tag, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { createTag, deleteTag, getTags } from "../controllers/git";
import type { GitTag } from "../models/git-types";

interface GitTagManagerProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath?: string;
  onRefresh?: () => void;
}

const GitTagManager = ({ isOpen, onClose, repoPath, onRefresh }: GitTagManagerProps) => {
  const [tags, setTags] = useState<GitTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMessage, setNewTagMessage] = useState("");
  const [newTagCommit, setNewTagCommit] = useState("");
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      loadTags();
    }
  }, [isOpen, repoPath]);

  const loadTags = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const tagList = await getTags(repoPath);
      setTags(tagList);
    } catch (error) {
      console.error("Failed to load tags:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTag = async () => {
    if (!repoPath || !newTagName.trim()) return;

    setIsLoading(true);
    try {
      const success = await createTag(
        repoPath,
        newTagName.trim(),
        newTagMessage.trim() || undefined,
        newTagCommit.trim() || undefined,
      );
      if (success) {
        setNewTagName("");
        setNewTagMessage("");
        setNewTagCommit("");
        await loadTags();
        onRefresh?.();
      }
    } catch (error) {
      console.error("Failed to create tag:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTag = async (tagName: string) => {
    if (!repoPath) return;

    setActionLoading((prev) => new Set(prev).add(tagName));
    try {
      const success = await deleteTag(repoPath, tagName);
      if (success) {
        await loadTags();
        onRefresh?.();
      }
    } catch (error) {
      console.error("Failed to delete tag:", error);
    } finally {
      setActionLoading((prev) => {
        const newSet = new Set(prev);
        newSet.delete(tagName);
        return newSet;
      });
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
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
          "flex max-h-[80vh] w-[480px] flex-col rounded-lg",
          "border border-border bg-secondary-bg shadow-xl",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b p-4">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-text-lighter" />
            <h2 className="font-medium text-sm text-text">Tag Manager</h2>
          </div>
          <button onClick={onClose} className="text-text-lighter transition-colors hover:text-text">
            <X size={16} />
          </button>
        </div>

        {/* Create New Tag */}
        <div className="border-border border-b p-4">
          <div className="space-y-2">
            <div className="mb-2 flex items-center gap-2">
              <Plus size={12} className="text-text-lighter" />
              <span className="font-medium text-text text-xs">Create New Tag</span>
            </div>

            <input
              type="text"
              placeholder="Tag name (e.g., v1.0.0)"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "px-2 py-1 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
              )}
            />

            <input
              type="text"
              placeholder="Tag message (optional)"
              value={newTagMessage}
              onChange={(e) => setNewTagMessage(e.target.value)}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "px-2 py-1 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
              )}
            />

            <input
              type="text"
              placeholder="Commit SHA (optional, defaults to HEAD)"
              value={newTagCommit}
              onChange={(e) => setNewTagCommit(e.target.value)}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "px-2 py-1 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateTag();
                }
              }}
            />

            <button
              onClick={handleCreateTag}
              disabled={isLoading || !newTagName.trim()}
              className={cn(
                "w-full rounded border border-border bg-primary-bg",
                "py-1.5 text-text text-xs transition-colors",
                "hover:bg-hover disabled:opacity-50",
              )}
            >
              {isLoading ? "Creating..." : "Create Tag"}
            </button>
          </div>
        </div>

        {/* Tag List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && tags.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">Loading tags...</div>
          ) : tags.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">No tags found</div>
          ) : (
            <div className="space-y-0">
              {tags.map((tag) => {
                const isActionLoading = actionLoading.has(tag.name);

                return (
                  <div
                    key={tag.name}
                    className={cn("border-border border-b p-3", "last:border-b-0 hover:bg-hover")}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <Tag size={12} className="text-text-lighter" />
                          <span className="font-medium font-mono text-text text-xs">
                            {tag.name}
                          </span>
                        </div>

                        {tag.message && (
                          <div className="mb-1 text-[11px] text-text-lighter">{tag.message}</div>
                        )}

                        <div className="flex items-center gap-3 text-[9px] text-text-lighter">
                          <div className="flex items-center gap-1">
                            <GitCommit size={8} />
                            <span className="font-mono">{tag.commit.substring(0, 7)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar size={8} />
                            {formatDate(tag.date)}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteTag(tag.name)}
                        disabled={isActionLoading}
                        className={cn(
                          "ml-2 flex items-center gap-1 rounded border border-red-500",
                          "bg-red-600 px-2 py-1 text-[9px] text-white",
                          "transition-colors hover:bg-red-700 disabled:opacity-50",
                        )}
                        title="Delete tag"
                      >
                        <Trash2 size={8} />
                        Delete
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
          {tags.length} tag{tags.length !== 1 ? "s" : ""} total
        </div>
      </div>
    </div>
  );
};

export default GitTagManager;
