import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  StreamBadge,
  StreamEmpty,
  StreamIconButton,
  StreamMenuButton,
  StreamRow,
  StreamScroll,
  StreamSection,
  StreamToolbar,
} from "@/features/sidebar/components/stream/stream-list";
import { showConfirmDialog, showPromptDialog } from "@/ui/dialog";
import type { MenuItem } from "@/ui/dropdown";
import {
  ArrowsClockwiseIcon,
  CheckIcon,
  CopyIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitDiffIcon,
  GlobeIcon,
  HistoryIcon,
  NodesIcon,
  OpenExternalIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
  UploadIcon,
  WarningIcon,
  XIcon,
} from "@/ui/icons";
import { writeClipboardText } from "@/utils/clipboard";
import { formatRelativeDate } from "@/utils/date";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { matchesSearchQuery } from "@/utils/search-match";
import { addRemote, fetchChanges, getRemotes, removeRemote } from "../api/git-remotes-api";
import {
  checkoutTag,
  createTag,
  deleteRemoteTag,
  deleteTag,
  getTags,
  pushTag,
} from "../api/git-tags-api";
import { addWorktree, removeWorktree } from "../api/git-worktrees-api";
import type { GitRemote, GitTag, GitWorktree } from "../types/git.types";
import { isOpenableGitWorktree, openGitWorktreeWorkspace } from "../utils/git-worktree-open";
import type { SourceControlModel } from "./use-source-control-model";

function filterBy<T>(items: T[], query: string, fields: (item: T) => string[]) {
  const q = query.trim().toLowerCase();
  return q ? items.filter((item) => matchesSearchQuery(q, fields(item))) : items;
}

function useSectionState() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return {
    isOpen: (id: string) => !collapsed.has(id),
    toggle: (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };
}

function PanelShell({
  search,
  actions,
  children,
}: {
  search: { value: string; onChange: (value: string) => void; placeholder: string };
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StreamToolbar search={search}>{actions}</StreamToolbar>
      <StreamScroll>{children}</StreamScroll>
    </div>
  );
}

const iconClass = "size-3.5 text-subtle-foreground";

export function BranchesPanel({ model }: { model: SourceControlModel }) {
  const [query, setQuery] = useState("");
  const sections = useSectionState();
  const others = filterBy(
    model.branches.filter((branch) => branch !== model.branch),
    query,
    (branch) => [branch],
  );
  const showCurrent = !!model.branch && filterBy([model.branch], query, (b) => [b]).length > 0;

  return (
    <PanelShell
      search={{ value: query, onChange: setQuery, placeholder: "Filter branches" }}
      actions={
        <StreamIconButton label="New branch" onClick={() => void model.createBranch()}>
          <PlusIcon className="size-3.5" />
        </StreamIconButton>
      }
    >
      {showCurrent ? (
        <StreamSection
          id="current"
          title="Current"
          open={sections.isOpen("current")}
          onToggle={() => sections.toggle("current")}
        >
          <StreamRow
            selected
            icon={<CheckIcon className="size-3.5" />}
            title={model.branch}
            secondary={
              model.ahead || model.behind ? `↑${model.ahead} ↓${model.behind}` : "up to date"
            }
            actions={
              <>
                <StreamIconButton
                  label="New branch from here"
                  onClick={() => void model.createBranch(model.branch)}
                >
                  <PlusIcon className="size-3" />
                </StreamIconButton>
                <StreamIconButton
                  label="Copy name"
                  onClick={() => void writeClipboardText(model.branch)}
                >
                  <CopyIcon className="size-3" />
                </StreamIconButton>
              </>
            }
          />
        </StreamSection>
      ) : null}
      <StreamSection
        id="local"
        title="Local"
        count={others.length}
        open={sections.isOpen("local")}
        onToggle={() => sections.toggle("local")}
      >
        {others.map((branch) => (
          <StreamRow
            key={branch}
            tooltip={`${branch}\nClick to switch`}
            icon={<GitBranchIcon className={iconClass} />}
            title={branch}
            onClick={() => void model.checkout(branch)}
            actions={
              <>
                <StreamIconButton
                  label={`Compare with ${model.branch}`}
                  onClick={() => model.viewBranchDiff(branch)}
                >
                  <GitDiffIcon className="size-3" />
                </StreamIconButton>
                <StreamIconButton
                  label="New branch from this"
                  onClick={() => void model.createBranch(branch)}
                >
                  <PlusIcon className="size-3" />
                </StreamIconButton>
                <StreamIconButton label="Delete" onClick={() => void model.deleteBranch(branch)}>
                  <TrashIcon className="size-3" />
                </StreamIconButton>
              </>
            }
          />
        ))}
        {others.length === 0 ? (
          <StreamEmpty title={query ? "No matching branches" : "No other branches"} />
        ) : null}
      </StreamSection>
    </PanelShell>
  );
}

export function WorktreesPanel({
  model,
  worktrees,
  isLoading,
  onReload,
  onOpen,
}: {
  model: SourceControlModel;
  worktrees: GitWorktree[];
  isLoading: boolean;
  onReload: () => Promise<void>;
  onOpen: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const sections = useSectionState();
  const mainPath = worktrees[0]?.path;
  const visible = useMemo(
    () =>
      filterBy(
        [...worktrees].sort((a, b) => Number(b.is_current) - Number(a.is_current)),
        query,
        (worktree) => [worktree.path, worktree.branch ?? ""],
      ),
    [query, worktrees],
  );

  const handleAdd = async () => {
    if (!model.activeRepoPath) return;
    const parent = model.activeRepoPath.replace(/\/[^/]+\/?$/, "");
    const path = await showPromptDialog("Folder for the new worktree.", {
      title: "New worktree",
      defaultValue: `${parent}/${model.repoName}-`,
      confirmLabel: "Next",
    });
    if (!path?.trim()) return;
    const branch = await showPromptDialog("Branch to create for it (leave empty to detach).", {
      title: "New worktree",
      defaultValue: getFolderName(path.trim()),
      confirmLabel: "Create",
    });
    const ok = await addWorktree(
      model.activeRepoPath,
      path.trim(),
      branch?.trim() || undefined,
      !!branch?.trim(),
    );
    if (!ok) {
      toast.error("Failed to create worktree");
      return;
    }
    toast.success("Worktree created");
    await onReload();
  };

  const handleRemove = async (worktree: GitWorktree) => {
    if (!model.activeRepoPath) return;
    const confirmed = await showConfirmDialog(
      `Remove the worktree at ${worktree.path}? Its folder is deleted.`,
      { title: "Remove worktree", confirmLabel: "Remove" },
    );
    if (!confirmed) return;
    if (!(await removeWorktree(model.activeRepoPath, worktree.path))) {
      toast.error("Failed to remove worktree. It may have uncommitted changes.");
      return;
    }
    await onReload();
  };

  return (
    <PanelShell
      search={{ value: query, onChange: setQuery, placeholder: "Filter worktrees" }}
      actions={
        <>
          <StreamIconButton label="Reload" onClick={() => void onReload()}>
            <ArrowsClockwiseIcon className="size-3.5" />
          </StreamIconButton>
          <StreamIconButton label="New worktree" onClick={() => void handleAdd()}>
            <PlusIcon className="size-3.5" />
          </StreamIconButton>
        </>
      }
    >
      <StreamSection
        id="worktrees"
        title="Worktrees"
        count={worktrees.length}
        open={sections.isOpen("worktrees")}
        onToggle={() => sections.toggle("worktrees")}
      >
        {visible.map((worktree) => {
          const openable = isOpenableGitWorktree(worktree);
          const branchLabel = worktree.branch || (worktree.is_detached ? "detached" : "no branch");
          return (
            <StreamRow
              key={worktree.path}
              tooltip={`${worktree.path}${openable && !worktree.is_current ? "\nClick to open" : ""}`}
              selected={worktree.is_current}
              icon={
                !openable ? (
                  <WarningIcon className="size-3.5 text-warning" />
                ) : worktree.is_current ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <NodesIcon className={iconClass} />
                )
              }
              title={getFolderName(worktree.path)}
              secondary={branchLabel}
              meta={
                worktree.path === mainPath ? (
                  <StreamBadge>main</StreamBadge>
                ) : worktree.locked_reason ? (
                  <StreamBadge tone="warning">locked</StreamBadge>
                ) : undefined
              }
              onClick={openable && !worktree.is_current ? () => onOpen(worktree.path) : undefined}
              actions={
                <>
                  {openable ? (
                    <StreamIconButton
                      label="Open in new window"
                      onClick={() =>
                        void openGitWorktreeWorkspace(worktree.path, { target: "new-window" })
                      }
                    >
                      <OpenExternalIcon className="size-3" />
                    </StreamIconButton>
                  ) : null}
                  <StreamIconButton
                    label="Copy path"
                    onClick={() => void writeClipboardText(worktree.path)}
                  >
                    <CopyIcon className="size-3" />
                  </StreamIconButton>
                  {!worktree.is_current && worktree.path !== mainPath && !worktree.is_bare ? (
                    <StreamIconButton label="Remove" onClick={() => void handleRemove(worktree)}>
                      <TrashIcon className="size-3" />
                    </StreamIconButton>
                  ) : null}
                </>
              }
            />
          );
        })}
        {!isLoading && visible.length === 0 ? (
          <StreamEmpty
            title={query ? "No matching worktrees" : "No worktrees"}
            hint="Worktrees let you check out several branches side by side."
          />
        ) : null}
      </StreamSection>
    </PanelShell>
  );
}

export function RepositoriesPanel({
  repoPaths,
  activeRepoPath,
  workspaceRootPath,
  onSelect,
  onBrowse,
}: {
  repoPaths: string[];
  activeRepoPath: string | null;
  workspaceRootPath: string | null;
  onSelect: (path: string) => void;
  onBrowse: () => void;
}) {
  const [query, setQuery] = useState("");
  const sections = useSectionState();
  const visible = filterBy(repoPaths, query, (path) => [path]);

  return (
    <PanelShell
      search={{ value: query, onChange: setQuery, placeholder: "Filter repositories" }}
      actions={
        <StreamIconButton label="Add repository" onClick={onBrowse}>
          <PlusIcon className="size-3.5" />
        </StreamIconButton>
      }
    >
      <StreamSection
        id="repositories"
        title="Repositories"
        count={repoPaths.length}
        open={sections.isOpen("repositories")}
        onToggle={() => sections.toggle("repositories")}
      >
        {visible.map((path) => {
          const relative = workspaceRootPath ? getRelativePath(path, workspaceRootPath) : path;
          const isCurrent = path === activeRepoPath;
          return (
            <StreamRow
              key={path}
              tooltip={path}
              selected={isCurrent}
              icon={
                isCurrent ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <FolderOpenIcon className={iconClass} />
                )
              }
              title={getFolderName(path)}
              secondary={relative === "." || !relative ? path : relative}
              onClick={isCurrent ? undefined : () => onSelect(path)}
              actions={
                <StreamIconButton label="Copy path" onClick={() => void writeClipboardText(path)}>
                  <CopyIcon className="size-3" />
                </StreamIconButton>
              }
            />
          );
        })}
        {visible.length === 0 ? <StreamEmpty title="No matching repositories" /> : null}
      </StreamSection>
    </PanelShell>
  );
}

function useRemotes(repoPath: string | null) {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      setRemotes(await getRemotes(repoPath));
    } finally {
      setIsLoading(false);
    }
  }, [repoPath]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { remotes, isLoading, reload };
}

export function RemotesPanel({
  model,
  onChanged,
}: {
  model: SourceControlModel;
  onChanged: () => void;
}) {
  const repoPath = model.activeRepoPath;
  const { remotes, isLoading, reload } = useRemotes(repoPath);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const sections = useSectionState();
  const visible = filterBy(remotes, query, (remote) => [remote.name, remote.url]);

  const afterChange = async () => {
    await reload();
    onChanged();
  };

  const handleAdd = async () => {
    if (!repoPath) return;
    const name = await showPromptDialog("Name for the remote.", {
      title: "Add remote",
      defaultValue: remotes.length === 0 ? "origin" : "",
      placeholder: "origin",
      confirmLabel: "Next",
    });
    if (!name?.trim()) return;
    const url = await showPromptDialog("URL of the remote repository.", {
      title: `Add remote ${name.trim()}`,
      placeholder: "git@github.com:owner/repo.git",
      confirmLabel: "Add",
    });
    if (!url?.trim()) return;
    if (!(await addRemote(repoPath, name.trim(), url.trim()))) {
      toast.error("Failed to add remote");
      return;
    }
    await afterChange();
  };

  const handleRemove = async (remote: GitRemote) => {
    if (!repoPath) return;
    const confirmed = await showConfirmDialog(`Remove remote "${remote.name}"?`, {
      title: "Remove remote",
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    if (!(await removeRemote(repoPath, remote.name))) {
      toast.error("Failed to remove remote");
      return;
    }
    await afterChange();
  };

  const handleFetch = async (remote?: GitRemote) => {
    if (!repoPath) return;
    setBusy(remote?.name ?? "*");
    try {
      const result = await fetchChanges(repoPath, remote?.name);
      if (result.success) toast.success(remote ? `Fetched ${remote.name}` : "Fetched");
      else toast.error(result.error || "Fetch failed");
      await model.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <PanelShell
      search={{ value: query, onChange: setQuery, placeholder: "Filter remotes" }}
      actions={
        <>
          <StreamIconButton
            label="Fetch all"
            disabled={!!busy || remotes.length === 0}
            onClick={() => void handleFetch()}
          >
            <ArrowsClockwiseIcon className={busy === "*" ? "size-3.5 animate-spin" : "size-3.5"} />
          </StreamIconButton>
          <StreamIconButton label="Add remote" onClick={() => void handleAdd()}>
            <PlusIcon className="size-3.5" />
          </StreamIconButton>
        </>
      }
    >
      <StreamSection
        id="remotes"
        title="Remotes"
        count={remotes.length}
        open={sections.isOpen("remotes")}
        onToggle={() => sections.toggle("remotes")}
      >
        {visible.map((remote) => (
          <StreamRow
            key={remote.name}
            tooltip={remote.url}
            muted={busy === remote.name}
            icon={<GlobeIcon className={iconClass} />}
            title={remote.name}
            secondary={remote.url}
            actions={
              <>
                <StreamIconButton
                  label={`Fetch ${remote.name}`}
                  disabled={!!busy}
                  onClick={() => void handleFetch(remote)}
                >
                  <ArrowsClockwiseIcon className="size-3" />
                </StreamIconButton>
                <StreamIconButton
                  label="Copy URL"
                  onClick={() => void writeClipboardText(remote.url)}
                >
                  <CopyIcon className="size-3" />
                </StreamIconButton>
                <StreamIconButton label="Remove" onClick={() => void handleRemove(remote)}>
                  <TrashIcon className="size-3" />
                </StreamIconButton>
              </>
            }
          />
        ))}
        {!isLoading && visible.length === 0 ? (
          <StreamEmpty
            title={query ? "No matching remotes" : "No remotes"}
            hint={query ? undefined : "Add one to push and pull."}
          />
        ) : null}
      </StreamSection>
    </PanelShell>
  );
}

export function TagsPanel({
  model,
  onChanged,
}: {
  model: SourceControlModel;
  onChanged: () => void;
}) {
  const repoPath = model.activeRepoPath;
  const { remotes } = useRemotes(repoPath);
  const [tags, setTags] = useState<GitTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const sections = useSectionState();
  const remoteName = remotes.find((remote) => remote.name === "origin")?.name ?? remotes[0]?.name;

  const reload = useCallback(async () => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      setTags(await getTags(repoPath));
    } finally {
      setIsLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = filterBy(tags, query, (tag) => [tag.name, tag.message ?? "", tag.commit]);

  const afterChange = async () => {
    await reload();
    onChanged();
  };

  const compare = (base: string, tag: GitTag) =>
    model.diff.viewTagComparison(base, tag.name, `${base}..${tag.name}`);

  const handleCreate = async () => {
    if (!repoPath) return;
    const name = await showPromptDialog(`Tag the current commit on ${model.branch}.`, {
      title: "New tag",
      placeholder: "v1.0.0",
      confirmLabel: "Next",
    });
    if (!name?.trim()) return;
    const message = await showPromptDialog("Message for an annotated tag (optional).", {
      title: `New tag ${name.trim()}`,
      confirmLabel: "Create",
    });
    if (!(await createTag(repoPath, name.trim(), message?.trim() || undefined))) {
      toast.error("Failed to create tag");
      return;
    }
    toast.success(`Created ${name.trim()}`);
    await afterChange();
  };

  const runRemote = async (
    label: string,
    action: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    const result = await action();
    if (result.success) toast.success(label);
    else toast.error(result.error || `${label} failed`);
  };

  const tagMenu = (tag: GitTag, previous?: GitTag): MenuItem[] => {
    if (!repoPath) return [];
    return [
      {
        id: "compare-previous",
        label: previous ? `Compare with ${previous.name}` : "Compare with previous tag",
        icon: <HistoryIcon />,
        disabled: !previous,
        onClick: () => previous && compare(previous.name, tag),
      },
      {
        id: "compare-head",
        label: "Compare with HEAD",
        icon: <GitDiffIcon />,
        onClick: () => compare("HEAD", tag),
      },
      {
        id: "checkout",
        label: "Checkout tag",
        icon: <TagIcon />,
        onClick: async () => {
          const result = await checkoutTag(repoPath, tag.name);
          if (result.success) await model.refresh();
          else toast.error(result.message || "Checkout failed");
        },
      },
      { id: "sep-1", separator: true },
      {
        id: "push",
        label: remoteName ? `Push to ${remoteName}` : "Push tag",
        icon: <UploadIcon />,
        disabled: !remoteName,
        onClick: () => {
          if (remoteName) {
            void runRemote(`Pushed ${tag.name}`, () => pushTag(repoPath, tag.name, remoteName));
          }
        },
      },
      {
        id: "delete-remote",
        label: remoteName ? `Delete from ${remoteName}` : "Delete remote tag",
        icon: <XIcon />,
        disabled: !remoteName,
        onClick: async () => {
          if (!remoteName) return;
          const confirmed = await showConfirmDialog(`Delete ${tag.name} from ${remoteName}?`, {
            title: "Delete remote tag",
            confirmLabel: "Delete",
          });
          if (confirmed) {
            await runRemote(`Deleted ${tag.name} from ${remoteName}`, () =>
              deleteRemoteTag(repoPath, tag.name, remoteName),
            );
          }
        },
      },
      { id: "sep-2", separator: true },
      {
        id: "copy-name",
        label: "Copy name",
        icon: <CopyIcon />,
        onClick: () => void writeClipboardText(tag.name),
      },
      {
        id: "copy-sha",
        label: "Copy commit SHA",
        icon: <GitCommitIcon />,
        onClick: () => void writeClipboardText(tag.commit),
      },
      { id: "sep-3", separator: true },
      {
        id: "delete",
        label: "Delete local tag",
        icon: <TrashIcon />,
        onClick: async () => {
          const confirmed = await showConfirmDialog(`Delete tag "${tag.name}"?`, {
            title: "Delete tag",
            confirmLabel: "Delete",
          });
          if (!confirmed) return;
          if (!(await deleteTag(repoPath, tag.name))) {
            toast.error("Failed to delete tag");
            return;
          }
          await afterChange();
        },
      },
    ];
  };

  return (
    <PanelShell
      search={{ value: query, onChange: setQuery, placeholder: "Filter tags" }}
      actions={
        <StreamIconButton label="New tag" onClick={() => void handleCreate()}>
          <PlusIcon className="size-3.5" />
        </StreamIconButton>
      }
    >
      <StreamSection
        id="tags"
        title="Tags"
        count={tags.length}
        open={sections.isOpen("tags")}
        onToggle={() => sections.toggle("tags")}
      >
        {visible.map((tag) => {
          const previous = tags[tags.indexOf(tag) + 1];
          return (
            <StreamRow
              key={tag.name}
              tooltip={`${tag.name}${tag.message ? `\n${tag.message}` : ""}\n${tag.commit}\nClick to see what changed since ${previous?.name ?? "HEAD"}`}
              icon={<TagIcon className={iconClass} />}
              title={tag.name}
              secondary={tag.message || tag.commit.slice(0, 7)}
              meta={tag.date ? formatRelativeDate(tag.date) : undefined}
              onClick={() => compare(previous?.name ?? "HEAD", tag)}
              actions={
                <>
                  <StreamIconButton label="Compare with HEAD" onClick={() => compare("HEAD", tag)}>
                    <GitDiffIcon className="size-3" />
                  </StreamIconButton>
                  <StreamMenuButton label="Tag actions" items={tagMenu(tag, previous)} />
                </>
              }
            />
          );
        })}
        {!isLoading && visible.length === 0 ? (
          <StreamEmpty title={query ? "No matching tags" : "No tags"} />
        ) : null}
      </StreamSection>
    </PanelShell>
  );
}
