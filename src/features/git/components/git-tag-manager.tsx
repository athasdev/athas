import {
  CalendarIcon as Calendar,
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  ClockCounterClockwiseIcon as ClockCounterClockwise,
  CopyIcon as Copy,
  GitBranchIcon as GitBranch,
  GitCommitIcon as GitCommit,
  PlusIcon as Plus,
  TagIcon as Tag,
  TrashIcon as Trash2,
  UploadIcon as Upload,
  XIcon as X,
} from "@/ui/icons";
import { useEffect, useMemo, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import {
  CommandEmpty,
  CommandForm,
  CommandFormField,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import Input from "@/ui/input";
import { showConfirmDialog } from "@/ui/dialog";
import Select from "@/ui/select";
import { toast } from "sonner";
import { writeClipboardText } from "@/utils/clipboard";
import { formatShortDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import { getRemotes } from "../api/git-remotes-api";
import {
  checkoutTag,
  createTag,
  deleteRemoteTag,
  deleteTag,
  getTags,
  pushTag,
} from "../api/git-tags-api";
import { useGitBlameStore } from "../stores/git-blame.store";
import type { GitRemote, GitTag } from "../types/git.types";
import GitCommandSurface from "./git-command-surface";

interface GitTagManagerProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath?: string;
  onRefresh?: () => void;
  onViewTagComparison?: (baseRef: string, targetRef: string, title: string) => void;
}

const GitTagManager = ({
  isOpen,
  onClose,
  repoPath,
  onRefresh,
  onViewTagComparison,
}: GitTagManagerProps) => {
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<GitTag[]>([]);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMessage, setNewTagMessage] = useState("");
  const [newTagCommit, setNewTagCommit] = useState("");
  const [newTagSigned, setNewTagSigned] = useState(false);
  const [selectedRemote, setSelectedRemote] = useState("origin");
  const [expandedTagName, setExpandedTagName] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    void loadTags();
    void loadRemotes();
  }, [isOpen, repoPath]);

  const resetTransientState = () => {
    setQuery("");
    setIsCreateOpen(false);
    setNewTagName("");
    setNewTagMessage("");
    setNewTagCommit("");
    setNewTagSigned(false);
    setExpandedTagName(null);
  };

  const handleClose = () => {
    resetTransientState();
    onClose();
  };

  const filteredTags = useMemo(() => {
    if (!query.trim()) return tags;
    return tags.filter((tag) =>
      matchesSearchQuery(query, [
        tag.name,
        tag.commit,
        tag.message ?? "",
        tag.is_annotated ? "annotated" : "lightweight",
      ]),
    );
  }, [query, tags]);

  const loadTags = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      setTags(await getTags(repoPath));
    } finally {
      setIsLoading(false);
    }
  };

  const loadRemotes = async () => {
    if (!repoPath) return;

    const remoteList = await getRemotes(repoPath);
    setRemotes(remoteList);
    if (remoteList.length > 0 && !remoteList.some((remote) => remote.name === selectedRemote)) {
      setSelectedRemote(remoteList[0].name);
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
        newTagSigned,
      );
      if (!success) return;
      setNewTagName("");
      setNewTagMessage("");
      setNewTagCommit("");
      setNewTagSigned(false);
      setIsCreateOpen(false);
      await loadTags();
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleTagRemoteAction = async (
    tagName: string,
    actionName: string,
    action: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    if (!repoPath) return;

    const actionKey = `${actionName}:${tagName}`;
    setActionLoading((prev) => new Set(prev).add(actionKey));
    try {
      const result = await action();
      if (result.success) {
        toast.success(`${actionName} completed`);
        onRefresh?.();
      } else {
        toast.error(result.error || `${actionName} failed`);
      }
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  const handleCheckoutTag = async (tagName: string) => {
    if (!repoPath) return;
    if (
      !(await showConfirmDialog(`Checkout ${tagName} in detached HEAD?`, {
        title: "Checkout Tag",
        confirmLabel: "Checkout",
      }))
    ) {
      return;
    }

    const actionKey = `checkout:${tagName}`;
    setActionLoading((prev) => new Set(prev).add(actionKey));
    try {
      const result = await checkoutTag(repoPath, tagName);
      if (result.success) {
        useGitBlameStore.getState().actions.clearAllBlame();
        toast.success(result.message);
        onRefresh?.();
        handleClose();
      } else {
        toast.error(result.message);
      }
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  const handleDeleteTag = async (tagName: string) => {
    if (!repoPath) return;

    setActionLoading((prev) => new Set(prev).add(tagName));
    try {
      const success = await deleteTag(repoPath, tagName);
      if (!success) return;
      await loadTags();
      onRefresh?.();
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(tagName);
        return next;
      });
    }
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await writeClipboardText(value);
      toast.success(`${label} copied`);
    } catch (error) {
      console.error(`Failed to copy ${label.toLowerCase()}:`, error);
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  return (
    <GitCommandSurface
      isOpen={isOpen}
      onClose={handleClose}
      query={query}
      onQueryChange={setQuery}
      placeholder="Search tags..."
      meta={`${tags.length} tag${tags.length === 1 ? "" : "s"}`}
    >
      {!isCreateOpen ? (
        <div className="flex shrink-0 items-center justify-end px-2 pt-2">
          <div className="flex items-center justify-end gap-2">
            <Button type="button" onClick={() => setIsCreateOpen(true)} size="xs" variant="accent">
              <Plus />
              Add tag
            </Button>
          </div>
        </div>
      ) : null}
      {isCreateOpen ? (
        <CommandForm
          title="Create tag"
          icon={<Plus className="size-4" />}
          columns={2}
          submitLabel="Create"
          pendingLabel="Creating..."
          isPending={isLoading}
          submitDisabled={!newTagName.trim()}
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateTag();
          }}
          onCancel={() => setIsCreateOpen(false)}
        >
          <CommandFormField label="Name" htmlFor="git-tag-name">
            <Input
              id="git-tag-name"
              type="text"
              placeholder="v1.0.0"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              size="sm"
            />
          </CommandFormField>
          <CommandFormField label="Target" htmlFor="git-tag-target">
            <Input
              id="git-tag-target"
              type="text"
              placeholder="Commit SHA or ref"
              value={newTagCommit}
              onChange={(e) => setNewTagCommit(e.target.value)}
              size="sm"
            />
          </CommandFormField>
          <CommandFormField label="Message" htmlFor="git-tag-message" span="full">
            <Input
              id="git-tag-message"
              type="text"
              placeholder="Optional annotation"
              value={newTagMessage}
              onChange={(e) => setNewTagMessage(e.target.value)}
              size="sm"
            />
          </CommandFormField>
          <CommandFormField span="full">
            <label className="inline-flex items-center gap-2 text-text-lighter ui-text-sm">
              <Checkbox checked={newTagSigned} onChange={setNewTagSigned} />
              Sign tag
            </label>
          </CommandFormField>
        </CommandForm>
      ) : null}

      <CommandList>
        {isLoading && tags.length === 0 ? (
          <CommandEmpty>Loading tags...</CommandEmpty>
        ) : filteredTags.length === 0 ? (
          <CommandEmpty>{query.trim() ? "No matching tags" : "No tags found"}</CommandEmpty>
        ) : (
          filteredTags.map((tag) => {
            const isActionLoading = actionLoading.has(tag.name);
            const shortCommit = tag.commit.substring(0, 7);
            const tagIndex = tags.findIndex((candidate) => candidate.name === tag.name);
            const previousTag = tagIndex >= 0 ? tags[tagIndex + 1] : undefined;
            const isExpanded = expandedTagName === tag.name;
            const selectedRemoteName = remotes.some((remote) => remote.name === selectedRemote)
              ? selectedRemote
              : remotes[0]?.name;
            const toggleTagDetails = () =>
              setExpandedTagName((current) => (current === tag.name ? null : tag.name));

            return (
              <div key={tag.name} className="group/tag">
                <CommandItemRow
                  as="div"
                  onClick={toggleTagDetails}
                  aria-expanded={isExpanded}
                  icon={<Tag className="size-4 text-text-lighter" />}
                  iconVariant="framed"
                  title={tag.name}
                  description={tag.message}
                  contentLayout={tag.message ? "stacked" : "inline"}
                  className="min-h-11"
                  accessory={
                    <>
                      {isExpanded ? (
                        <CaretDown className="size-3.5 shrink-0 text-text-lighter" />
                      ) : (
                        <CaretRight className="size-3.5 shrink-0 text-text-lighter" />
                      )}
                      <CommandItemBadge>
                        <GitCommit className="size-3.5" />
                        {shortCommit}
                      </CommandItemBadge>
                      {tag.date ? (
                        <CommandItemBadge>
                          <Calendar className="size-3.5" />
                          {formatShortDate(tag.date)}
                        </CommandItemBadge>
                      ) : null}
                    </>
                  }
                  action={
                    <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/tag:opacity-100 sm:group-focus-within/tag:opacity-100">
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleCopy(tag.name, "Tag name");
                        }}
                        variant="ghost"
                        size="icon-xs"
                        className="text-text-lighter"
                        tooltip="Copy tag name"
                        aria-label={`Copy ${tag.name}`}
                      >
                        <Copy />
                      </Button>
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleCopy(tag.commit, "Commit SHA");
                        }}
                        variant="ghost"
                        size="icon-xs"
                        className="text-text-lighter"
                        tooltip="Copy commit SHA"
                        aria-label={`Copy commit ${shortCommit}`}
                      >
                        <GitCommit />
                      </Button>
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!previousTag) return;
                          onViewTagComparison?.(
                            previousTag.name,
                            tag.name,
                            `${previousTag.name}..${tag.name}`,
                          );
                          handleClose();
                        }}
                        disabled={!previousTag}
                        variant="ghost"
                        size="icon-xs"
                        className="text-text-lighter disabled:opacity-50"
                        tooltip="Compare with previous tag"
                        aria-label={`Compare ${tag.name} with previous tag`}
                      >
                        <ClockCounterClockwise />
                      </Button>
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewTagComparison?.("HEAD", tag.name, `HEAD..${tag.name}`);
                          handleClose();
                        }}
                        variant="ghost"
                        size="icon-xs"
                        className="text-text-lighter"
                        tooltip="Compare with HEAD"
                        aria-label={`Compare ${tag.name} with HEAD`}
                      >
                        <GitBranch />
                      </Button>
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleCheckoutTag(tag.name);
                        }}
                        disabled={actionLoading.has(`checkout:${tag.name}`)}
                        variant="ghost"
                        size="icon-xs"
                        className="text-text-lighter disabled:opacity-50"
                        tooltip="Checkout tag"
                        aria-label={`Checkout ${tag.name}`}
                      >
                        <Tag />
                      </Button>
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!repoPath || !selectedRemoteName) return;
                          void handleTagRemoteAction(tag.name, "Push tag", () =>
                            pushTag(repoPath, tag.name, selectedRemoteName),
                          );
                        }}
                        disabled={!selectedRemoteName || actionLoading.has(`Push tag:${tag.name}`)}
                        variant="ghost"
                        size="icon-xs"
                        className="text-text-lighter disabled:opacity-50"
                        tooltip={
                          selectedRemoteName ? `Push tag to ${selectedRemoteName}` : "No remote"
                        }
                        aria-label={`Push ${tag.name}`}
                      >
                        <Upload />
                      </Button>
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!repoPath || !selectedRemoteName) return;
                          void showConfirmDialog(`Delete ${tag.name} from ${selectedRemoteName}?`, {
                            title: "Delete Remote Tag",
                            confirmLabel: "Delete",
                          }).then((confirmed) => {
                            if (!confirmed) return;
                            void handleTagRemoteAction(tag.name, "Delete remote tag", () =>
                              deleteRemoteTag(repoPath, tag.name, selectedRemoteName),
                            );
                          });
                        }}
                        disabled={
                          !selectedRemoteName || actionLoading.has(`Delete remote tag:${tag.name}`)
                        }
                        variant="ghost"
                        size="icon-xs"
                        className="text-error hover:bg-error/10 hover:text-error disabled:opacity-50"
                        tooltip={
                          selectedRemoteName ? `Delete tag from ${selectedRemoteName}` : "No remote"
                        }
                        aria-label={`Delete ${tag.name} from remote`}
                      >
                        <X />
                      </Button>
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteTag(tag.name);
                        }}
                        disabled={isActionLoading}
                        variant="ghost"
                        size="icon-xs"
                        className="text-error hover:bg-error/10 hover:text-error disabled:opacity-50"
                        tooltip="Delete tag"
                        aria-label={`Delete ${tag.name}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  }
                />
                {isExpanded ? (
                  <div className="border-border/50 border-t px-2.5 py-2">
                    <div className="grid gap-1.5 pl-9">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="ui-text-base w-14 shrink-0 text-text-lighter">Commit</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleCopy(tag.commit, "Commit SHA");
                          }}
                          className="font-sans ui-text-base min-w-0 truncate text-text hover:text-accent"
                          title={tag.commit}
                        >
                          {tag.commit}
                        </button>
                      </div>
                      {tag.date ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="ui-text-base w-14 shrink-0 text-text-lighter">Date</span>
                          <span className="ui-text-base truncate text-text">
                            {formatShortDate(tag.date)}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="ui-text-base w-14 shrink-0 text-text-lighter">Type</span>
                        <Badge variant="muted" size="compact" className="ui-text-base">
                          {tag.is_annotated ? "Annotated" : "Lightweight"}
                        </Badge>
                      </div>
                      {tag.message ? (
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="ui-text-base w-14 shrink-0 text-text-lighter">
                            Message
                          </span>
                          <span className="ui-text-base min-w-0 break-words text-text">
                            {tag.message}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CommandList>
      {remotes.length > 0 ? (
        <div className="border-border/70 border-t px-3 py-2">
          <Select
            value={selectedRemote}
            onChange={setSelectedRemote}
            options={remotes.map((remote) => ({ value: remote.name, label: remote.name }))}
            size="xs"
            variant="default"
            aria-label="Tag remote"
          />
        </div>
      ) : null}
    </GitCommandSurface>
  );
};

export default GitTagManager;
