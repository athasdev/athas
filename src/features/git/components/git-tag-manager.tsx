import { Calendar, GitCommit, Plus, Tag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { formatShortDate } from "@/utils/date";
import { createTag, deleteTag, getTags } from "../api/git-tags-api";
import type { GitTag } from "../types/git-types";

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
      void loadTags();
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

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog onClose={onClose} title="Tags" icon={Tag} size="lg" classNames={{ content: "p-0" }}>
      <div className="ui-font flex max-h-[70vh] flex-col">
        <div className="border-border/70 border-b p-4">
          <div className="mb-3 flex items-center gap-2 text-text text-xs">
            <Plus size={12} className="text-text-lighter" />
            <span className="font-medium">Create tag</span>
          </div>

          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Tag name"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              className="w-full bg-primary-bg"
            />
            <Input
              type="text"
              placeholder="Tag message (optional)"
              value={newTagMessage}
              onChange={(e) => setNewTagMessage(e.target.value)}
              className="w-full bg-primary-bg"
            />
            <Input
              type="text"
              placeholder="Commit SHA (optional)"
              value={newTagCommit}
              onChange={(e) => setNewTagCommit(e.target.value)}
              className="w-full bg-primary-bg"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleCreateTag();
                }
              }}
            />
            <div className="flex justify-end">
              <Button
                onClick={() => void handleCreateTag()}
                disabled={isLoading || !newTagName.trim()}
                size="sm"
              >
                {isLoading ? "Creating..." : "Create Tag"}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && tags.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">Loading tags...</div>
          ) : tags.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">No tags found</div>
          ) : (
            tags.map((tag) => {
              const isActionLoading = actionLoading.has(tag.name);

              return (
                <div key={tag.name} className="border-border/70 border-b px-4 py-3 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <Tag size={12} className="text-text-lighter" />
                        <span className="font-medium text-text text-xs">{tag.name}</span>
                      </div>

                      {tag.message && (
                        <div className="mb-1 text-[11px] text-text-lighter">{tag.message}</div>
                      )}

                      <div className="flex items-center gap-3 text-[10px] text-text-lighter">
                        <div className="flex items-center gap-1">
                          <GitCommit size={10} />
                          <span className="ui-font">{tag.commit.substring(0, 7)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar size={10} />
                          {formatShortDate(tag.date)}
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={() => void handleDeleteTag(tag.name)}
                      disabled={isActionLoading}
                      variant="ghost"
                      size="xs"
                      className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      title="Delete tag"
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
          {tags.length} tag{tags.length !== 1 ? "s" : ""} total
        </div>
      </div>
    </Dialog>
  );
};

export default GitTagManager;
