import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Calendar,
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  Copy,
  GitBranch,
  GitCommit,
  Plus,
  Tag,
  Trash as Trash2,
  Upload,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import { CommandEmpty, CommandList } from "@/ui/command";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { toast } from "@/ui/toast";
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
import type { GitRemote, GitTag } from "../types/git-types";
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
    setQuery("");
    setIsCreateOpen(false);
    setExpandedTagName(null);
    void loadTags();
    void loadRemotes();
  }, [isOpen, repoPath]);

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
    if (!window.confirm(`Checkout ${tagName} in detached HEAD?`)) return;

    const actionKey = `checkout:${tagName}`;
    setActionLoading((prev) => new Set(prev).add(actionKey));
    try {
      const result = await checkoutTag(repoPath, tagName);
      if (result.success) {
        toast.success(result.message);
        onRefresh?.();
        onClose();
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
      await writeText(value);
      toast.success(`${label} copied`);
    } catch (error) {
      console.error(`Failed to copy ${label.toLowerCase()}:`, error);
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  return (
    <GitCommandSurface
      isOpen={isOpen}
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      placeholder="Search tags..."
      meta={`${tags.length} tag${tags.length === 1 ? "" : "s"}`}
    >
      <div className="border-border/70 border-b px-3 py-2">
        {!isCreateOpen ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              size="xs"
              variant="secondary"
              className="gap-1.5"
            >
              <Plus />
              Add
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-secondary-bg text-text-lighter">
              <Plus className="size-4" />
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
              <Input
                type="text"
                placeholder="Tag name"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                size="xs"
                className="w-full"
              />
              <Input
                type="text"
                placeholder="Commit SHA or ref"
                value={newTagCommit}
                onChange={(e) => setNewTagCommit(e.target.value)}
                size="xs"
                className="w-full"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleCreateTag();
                  }
                }}
              />
              <Input
                type="text"
                placeholder="Message"
                value={newTagMessage}
                onChange={(e) => setNewTagMessage(e.target.value)}
                size="xs"
                className="col-span-2 w-full"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleCreateTag();
                  }
                }}
              />
              <label className="ui-text-xs col-span-2 inline-flex items-center gap-2 text-text-lighter">
                <Checkbox checked={newTagSigned} onChange={setNewTagSigned} />
                Sign tag
              </label>
            </div>
            <div className="flex items-center gap-1">
              <Button
                onClick={() => void handleCreateTag()}
                disabled={isLoading || !newTagName.trim()}
                size="xs"
                variant="secondary"
              >
                {isLoading ? "Creating..." : "Create"}
              </Button>
              <Button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                size="icon-xs"
                variant="ghost"
                tooltip="Cancel"
                aria-label="Cancel create tag"
              >
                <X />
              </Button>
            </div>
          </div>
        )}
      </div>

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
              <div
                key={tag.name}
                className="group/tag ui-font relative mb-1 rounded-lg text-left transition-colors hover:bg-hover focus-within:bg-hover"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={toggleTagDetails}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    toggleTagDetails();
                  }}
                  className="flex min-h-12 w-full cursor-pointer items-center gap-2 px-2.5 py-2 outline-none"
                  aria-expanded={isExpanded}
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-secondary-bg/70 text-text-lighter">
                    <Tag className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 pr-48">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="ui-text-sm truncate text-text" title={tag.name}>
                        {tag.name}
                      </div>
                      {isExpanded ? (
                        <CaretDown className="size-3.5 shrink-0 text-text-lighter" />
                      ) : (
                        <CaretRight className="size-3.5 shrink-0 text-text-lighter" />
                      )}
                    </div>
                    {tag.message ? (
                      <div
                        className="ui-text-xs mt-1 truncate text-text-lighter"
                        title={tag.message}
                      >
                        {tag.message}
                      </div>
                    ) : null}
                    <div className="ui-text-xs mt-1 flex min-w-0 flex-wrap items-center gap-3 text-text-lighter/80">
                      <span className="inline-flex items-center gap-1">
                        <GitCommit className="size-3.5" />
                        <span className="ui-font">{shortCommit}</span>
                      </span>
                      {tag.date ? (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="size-3.5" />
                          {formatShortDate(tag.date)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="pointer-events-none absolute top-6 right-2 flex -translate-y-1/2 translate-x-1 items-center gap-0.5 rounded-md border border-border/60 bg-secondary-bg p-0.5 opacity-0 transition-all group-hover/tag:pointer-events-auto group-hover/tag:translate-x-0 group-hover/tag:opacity-100 group-focus-within/tag:pointer-events-auto group-focus-within/tag:translate-x-0 group-focus-within/tag:opacity-100">
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
                      onClose();
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
                      onClose();
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
                    tooltip={selectedRemoteName ? `Push tag to ${selectedRemoteName}` : "No remote"}
                    aria-label={`Push ${tag.name}`}
                  >
                    <Upload />
                  </Button>
                  <Button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!repoPath || !selectedRemoteName) return;
                      if (!window.confirm(`Delete ${tag.name} from ${selectedRemoteName}?`)) return;
                      void handleTagRemoteAction(tag.name, "Delete remote tag", () =>
                        deleteRemoteTag(repoPath, tag.name, selectedRemoteName),
                      );
                    }}
                    disabled={
                      !selectedRemoteName || actionLoading.has(`Delete remote tag:${tag.name}`)
                    }
                    variant="ghost"
                    size="icon-xs"
                    className="text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
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
                    className="text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                    tooltip="Delete tag"
                    aria-label={`Delete ${tag.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {isExpanded ? (
                  <div className="border-border/50 border-t px-2.5 py-2">
                    <div className="grid gap-1.5 pl-9">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="ui-text-xs w-14 shrink-0 text-text-lighter">Commit</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleCopy(tag.commit, "Commit SHA");
                          }}
                          className="ui-font ui-text-xs min-w-0 truncate text-text hover:text-accent"
                          title={tag.commit}
                        >
                          {tag.commit}
                        </button>
                      </div>
                      {tag.date ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="ui-text-xs w-14 shrink-0 text-text-lighter">Date</span>
                          <span className="ui-text-xs truncate text-text">
                            {formatShortDate(tag.date)}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="ui-text-xs w-14 shrink-0 text-text-lighter">Type</span>
                        <Badge variant="muted" size="compact" className="text-[10px]">
                          {tag.is_annotated ? "Annotated" : "Lightweight"}
                        </Badge>
                      </div>
                      {tag.message ? (
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="ui-text-xs w-14 shrink-0 text-text-lighter">
                            Message
                          </span>
                          <span className="ui-text-xs min-w-0 break-words text-text">
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
            variant="outline"
            aria-label="Tag remote"
          />
        </div>
      ) : null}
    </GitCommandSurface>
  );
};

export default GitTagManager;
