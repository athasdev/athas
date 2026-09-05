import {
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
import { useEffect, useMemo, useRef, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Collapsible, CollapsibleContent } from "@/ui/collapsible";
import { EmptyState } from "@/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/ui/field";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/ui/dropdown";
import Input from "@/ui/input";
import { showConfirmDialog } from "@/ui/dialog";
import Select from "@/ui/select";
import { SidebarForm, SidebarFooter, SidebarListMenuItem, SidebarScrollArea } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
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

interface GitTagManagerProps {
  query: string;
  repoPath?: string;
  onRefresh?: () => void;
  onViewTagComparison?: (baseRef: string, targetRef: string, title: string) => void;
}

const GitTagManager = ({ query, repoPath, onRefresh, onViewTagComparison }: GitTagManagerProps) => {
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
  const tagLoadRequestIdRef = useRef(0);
  const remoteLoadRequestIdRef = useRef(0);

  useEffect(() => {
    void loadTags();
    void loadRemotes();
    return () => {
      tagLoadRequestIdRef.current += 1;
      remoteLoadRequestIdRef.current += 1;
    };
  }, [repoPath]);

  const resetTransientState = () => {
    setIsCreateOpen(false);
    setNewTagName("");
    setNewTagMessage("");
    setNewTagCommit("");
    setNewTagSigned(false);
    setExpandedTagName(null);
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

    const requestId = ++tagLoadRequestIdRef.current;
    setIsLoading(true);
    try {
      const nextTags = await getTags(repoPath);
      if (requestId === tagLoadRequestIdRef.current) {
        setTags(nextTags);
      }
    } finally {
      if (requestId === tagLoadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const loadRemotes = async () => {
    if (!repoPath) return;

    const requestId = ++remoteLoadRequestIdRef.current;
    const remoteList = await getRemotes(repoPath);
    if (requestId !== remoteLoadRequestIdRef.current) return;
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
        resetTransientState();
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
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarScrollArea className="min-h-0 flex-1">
        {isCreateOpen ? (
          <SidebarForm
            title="Create tag"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateTag();
            }}
            actions={
              <>
                <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={!newTagName.trim() || isLoading}>
                  {isLoading ? "Creating..." : "Create"}
                </Button>
              </>
            }
          >
            <FieldGroup className="gap-2">
              <Field>
                <FieldLabel htmlFor="git-tag-name">Name</FieldLabel>
                <Input
                  id="git-tag-name"
                  type="text"
                  placeholder="v1.0.0"
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="git-tag-target">Target</FieldLabel>
                <Input
                  id="git-tag-target"
                  type="text"
                  placeholder="Commit SHA or ref"
                  value={newTagCommit}
                  onChange={(event) => setNewTagCommit(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="git-tag-message">Message</FieldLabel>
                <Input
                  id="git-tag-message"
                  type="text"
                  placeholder="Optional annotation"
                  value={newTagMessage}
                  onChange={(event) => setNewTagMessage(event.target.value)}
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="git-tag-signed"
                  checked={newTagSigned}
                  onCheckedChange={setNewTagSigned}
                />
                <FieldLabel htmlFor="git-tag-signed">Sign tag</FieldLabel>
              </Field>
            </FieldGroup>
          </SidebarForm>
        ) : null}

        {isLoading && tags.length === 0 ? (
          <EmptyState layout="sidebar" message={<Spinner label="Loading tags" showLabel />} />
        ) : filteredTags.length === 0 ? (
          <EmptyState
            layout="sidebar"
            title={query.trim() ? "No matching tags" : "No tags found"}
          />
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
              <Collapsible
                key={tag.name}
                open={isExpanded}
                onOpenChange={(open) => setExpandedTagName(open ? tag.name : null)}
              >
                <SidebarListMenuItem
                  onClick={toggleTagDetails}
                  aria-expanded={isExpanded}
                  disabled={isActionLoading}
                  leading={<Tag />}
                  description={[shortCommit, tag.date && formatShortDate(tag.date)]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={isExpanded ? <CaretDown /> : <CaretRight />}
                  menuLabel={`Actions for ${tag.name}`}
                  menu={
                    <>
                      <DropdownMenuItem onClick={() => void handleCopy(tag.name, "Tag name")}>
                        <Copy />
                        Copy tag name
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleCopy(tag.commit, "Commit SHA")}>
                        <GitCommit />
                        Copy commit SHA
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!previousTag}
                        onClick={() => {
                          if (!previousTag) return;
                          onViewTagComparison?.(
                            previousTag.name,
                            tag.name,
                            `${previousTag.name}..${tag.name}`,
                          );
                          resetTransientState();
                        }}
                      >
                        <ClockCounterClockwise />
                        Compare with previous tag
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          onViewTagComparison?.("HEAD", tag.name, `HEAD..${tag.name}`);
                          resetTransientState();
                        }}
                      >
                        <GitBranch />
                        Compare with HEAD
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={actionLoading.has(`checkout:${tag.name}`)}
                        onClick={() => void handleCheckoutTag(tag.name)}
                      >
                        <Tag />
                        Checkout tag
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!selectedRemoteName || actionLoading.has(`Push tag:${tag.name}`)}
                        onClick={() => {
                          if (!repoPath || !selectedRemoteName) return;
                          void handleTagRemoteAction(tag.name, "Push tag", () =>
                            pushTag(repoPath, tag.name, selectedRemoteName),
                          );
                        }}
                      >
                        <Upload />
                        {selectedRemoteName ? `Push to ${selectedRemoteName}` : "Push tag"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={
                          !selectedRemoteName || actionLoading.has(`Delete remote tag:${tag.name}`)
                        }
                        onClick={() => {
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
                      >
                        <X />
                        {selectedRemoteName
                          ? `Delete from ${selectedRemoteName}`
                          : "Delete remote tag"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={isActionLoading}
                        onClick={() => void handleDeleteTag(tag.name)}
                      >
                        <Trash2 />
                        Delete local tag
                      </DropdownMenuItem>
                    </>
                  }
                >
                  {tag.name}
                </SidebarListMenuItem>
                <CollapsibleContent>
                  <div className="px-1.5 pt-1 pb-3">
                    <div className="grid gap-2 pl-[calc(1em+var(--athas-chrome-gap))]">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="ui-text-sm w-14 shrink-0 text-subtle-foreground">
                          Commit
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleCopy(tag.commit, "Commit SHA");
                          }}
                          className="min-w-0 max-w-full"
                          title={tag.commit}
                        >
                          <span className="truncate">{tag.commit}</span>
                        </Button>
                      </div>
                      {tag.date ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="ui-text-sm w-14 shrink-0 text-subtle-foreground">
                            Date
                          </span>
                          <span className="ui-text-sm truncate text-foreground">
                            {formatShortDate(tag.date)}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="ui-text-sm w-14 shrink-0 text-subtle-foreground">
                          Type
                        </span>
                        <Badge variant="muted">
                          {tag.is_annotated ? "Annotated" : "Lightweight"}
                        </Badge>
                      </div>
                      {tag.message ? (
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="ui-text-sm w-14 shrink-0 text-subtle-foreground">
                            Message
                          </span>
                          <span className="ui-text-sm min-w-0 wrap-break-word text-foreground">
                            {tag.message}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })
        )}
      </SidebarScrollArea>
      {!isCreateOpen ? (
        <SidebarFooter>
          <div className="flex items-center gap-1 p-1 pb-0">
            {remotes.length > 0 ? (
              <Select
                value={selectedRemote}
                onChange={setSelectedRemote}
                options={remotes.map((remote) => ({ value: remote.name, label: remote.name }))}
                variant="ghost"
                aria-label="Tag remote"
              />
            ) : null}
            <Button className="min-w-0 flex-1" type="button" onClick={() => setIsCreateOpen(true)}>
              <Plus />
              Add tag
            </Button>
          </div>
        </SidebarFooter>
      ) : null}
    </div>
  );
};

export default GitTagManager;
