import { pickDirectory } from "@/utils/file-dialogs";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { GitSidebarItemId } from "@/features/layout/config/item-order";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { onAppEvent } from "@/utils/app-events";
import { writeSidebarResourceDragData } from "@/features/sidebar/services/sidebar-resource-drag";
import { CommandEmpty, CommandItemBadge, CommandItemRow, CommandList } from "@/ui/command";
import { ContextMenuPopup, createContextMenuGroups } from "@/ui/context-menu";
import { showAlertDialog } from "@/ui/dialog";
import { useDropdownMenu, type MenuItem } from "@/ui/dropdown";
import { Avatar } from "@/ui/avatar";
import { EmptyState } from "@/ui/empty";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowUpIcon,
  CopyIcon,
  FileTextIcon,
  FolderOpenIcon,
  FolderStarIcon,
  GitBranchIcon,
  GitDiffIcon,
  GlobeIcon,
  HistoryIcon,
  MinusIcon,
  NodesIcon,
  PlusIcon,
  StackIcon,
  TagIcon,
  TrashIcon,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { writeClipboardText } from "@/utils/clipboard";
import { formatRelativeDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import { clearRepositoryDiscoveryCache, resolveRepositoryPath } from "../api/git-repo-api";
import { getRemotes } from "../api/git-remotes-api";
import { getGitStatus, initRepository } from "../api/git-status-api";
import { getTags } from "../api/git-tags-api";
import { getWorktrees } from "../api/git-worktrees-api";
import GitActionsMenu from "../components/git-actions-menu";
import GitCommandSurface from "../components/git-command-surface";
import { useRepositoryStore } from "../stores/git-repository.store";
import { useGitStore } from "../stores/git.store";
import type { GitCommit, GitWorktree } from "../types/git.types";
import { getGitAuthorAvatarUrl } from "../utils/git-author-avatar";
import { getStashDisplayTitle } from "../utils/git-stash-format";
import { openGitWorktreeWorkspace } from "../services/git-worktree-open";
import {
  StreamEmpty,
  StreamIconButton,
  StreamMenuButton,
  StreamRow,
  StreamScroll,
  StreamSearchField,
  StreamSection,
  StreamToolbar,
} from "@/features/sidebar/components/stream/stream-list";
import { StreamTabs, type StreamTab } from "@/features/sidebar/components/stream/stream-tabs";
import { StreamComposer, StreamIdentity } from "./stream-header";
import { DiffNumbers, FileGlyph, StatusLetter, shortHash } from "./stream-primitives";
import {
  BranchesPanel,
  RemotesPanel,
  RepositoriesPanel,
  TagsPanel,
  WorktreesPanel,
} from "./stream-refs";
import {
  useSourceControlModel,
  type ChangeFile,
  type SourceControlModel,
  type SourceControlModelProps,
} from "./use-source-control-model";

const SECTIONS_STORAGE_KEY = "athas:git-stream-sections";

type SectionId = "staged" | "changes" | "stashes" | "history";
type PanelId = "branches" | "worktrees" | "remotes" | "tags" | "repositories";
function readSections(): Record<SectionId, boolean> {
  const fallback = { staged: true, changes: true, stashes: false, history: true };
  try {
    const stored = JSON.parse(localStorage.getItem(SECTIONS_STORAGE_KEY) ?? "null");
    return stored ? { ...fallback, ...stored } : fallback;
  } catch {
    return fallback;
  }
}

function StreamView(props: SourceControlModelProps) {
  const model = useSourceControlModel(props);
  const { activeRepoPath } = model;
  const actions = useGitStore((state) => state.actions);
  const availableRepoPaths = useRepositoryStore.use.availableRepoPaths();
  const workspaceRootPath = useProjectStore((state) => state.rootFolderPath) ?? null;
  const { syncWorkspaceRepositories, setManualRepository, selectRepository } =
    useRepositoryStore.use.actions();
  const hiddenItems = useSettingsStore((state) => state.settings.hiddenGitSidebarItems);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);

  const [panel, setPanel] = useState<PanelId | null>(null);
  const [sections, setSections] = useState(readSections);
  const [picker, setPicker] = useState<"commit" | "branch" | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [isInitializingRepo, setIsInitializingRepo] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [isLoadingWorktrees, setIsLoadingWorktrees] = useState(false);
  const [refCounts, setRefCounts] = useState({ remotes: 0, tags: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);

  const isVisible = useCallback((id: GitSidebarItemId) => !hiddenItems.includes(id), [hiddenItems]);

  const loadWorktrees = useCallback(async () => {
    if (!activeRepoPath) return;
    setIsLoadingWorktrees(true);
    try {
      setWorktrees(await getWorktrees(activeRepoPath));
    } finally {
      setIsLoadingWorktrees(false);
    }
  }, [activeRepoPath]);

  const loadRefCounts = useCallback(async () => {
    if (!activeRepoPath) return;
    const [remotes, tags] = await Promise.all([
      getRemotes(activeRepoPath),
      getTags(activeRepoPath),
    ]);
    setRefCounts({ remotes: remotes.length, tags: tags.length });
  }, [activeRepoPath]);

  useEffect(() => {
    setPanel(null);
    setRepoError(null);
    setWorktrees([]);
    setRefCounts({ remotes: 0, tags: 0 });
    void loadWorktrees();
    void loadRefCounts();
  }, [loadRefCounts, loadWorktrees]);

  const goHome = useCallback(() => {
    setPanel(null);
  }, []);

  const openPanel = useCallback(
    (next: PanelId) => {
      setPanel(next);
      if (next === "worktrees") void loadWorktrees();
      if (next === "branches") void model.reloadBranches();
    },
    [loadWorktrees, model],
  );

  const setSectionOpen = useCallback((id: SectionId, open: boolean) => {
    setSections((prev) => {
      const next = { ...prev, [id]: open };
      try {
        localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const revealSection = useCallback(
    (id: SectionId) => {
      goHome();
      setSectionOpen(id, true);
      requestAnimationFrame(() =>
        scrollRef.current
          ?.querySelector(`[data-stream-section="${id}"]`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
    },
    [goHome, setSectionOpen],
  );

  const handleSelectRepository = useCallback(async () => {
    setIsSelectingRepo(true);
    setRepoError(null);
    try {
      const selected = await pickDirectory();
      if (!selected) return;
      const resolved = await resolveRepositoryPath(selected);
      if (!resolved) {
        const message = "Selected folder is not inside a Git repository.";
        setRepoError(message);
        await showAlertDialog(message, "Select Repository");
        return;
      }
      setManualRepository(resolved);
    } catch (error) {
      setRepoError("Failed to select repository");
      await showAlertDialog(`Failed to select repository:\n${error}`, "Select Repository");
    } finally {
      setIsSelectingRepo(false);
    }
  }, [setManualRepository]);

  const handleInitializeRepository = useCallback(async () => {
    const target = props.repoPath;
    if (!target) {
      toast.error("Open a folder before initializing a repository.");
      return;
    }
    setIsInitializingRepo(true);
    setRepoError(null);
    try {
      if (!(await initRepository(target))) {
        setRepoError("Failed to initialize repository.");
        toast.error("Failed to initialize repository.");
        return;
      }
      clearRepositoryDiscoveryCache();
      setManualRepository(target);
      await syncWorkspaceRepositories(target, { force: true });
      toast.success("Repository initialized.");
    } finally {
      setIsInitializingRepo(false);
    }
  }, [props.repoPath, setManualRepository, syncWorkspaceRepositories]);

  const handleOpenWorktree = useCallback(
    async (worktreePath: string) => {
      if (!(await openGitWorktreeWorkspace(worktreePath))) return;
      const status = await getGitStatus(worktreePath);
      actions.setWorkspaceGitStatus(status, worktreePath);
      actions.setGitStatus(status);
      goHome();
    },
    [actions, goHome],
  );

  const showBranchPicker = useCallback(async () => {
    setPicker("branch");
    setPickerQuery("");
    await model.reloadBranches();
  }, [model]);

  const handleItemVisibleChange = useCallback(
    (itemId: GitSidebarItemId, visible: boolean) => {
      const next = visible
        ? hiddenItems.filter((id) => id !== itemId)
        : Array.from(new Set([...hiddenItems, itemId]));
      void updateSetting("hiddenGitSidebarItems", next);
    },
    [hiddenItems, updateSetting],
  );

  useEffect(() => {
    return onAppEvent("git:palette-action", (detail) => {
      if (detail.type === "select-repository") void handleSelectRepository();
      else if (detail.type === "initialize-repository") void handleInitializeRepository();
      else if (detail.type === "refresh") void model.refresh();
      else if (detail.type === "manage-branches") openPanel(detail.tab ?? "branches");
      else if (detail.type === "show-branch-diff") void showBranchPicker();
      else if (detail.type === "manage-remotes") openPanel("remotes");
      else if (detail.type === "manage-tags") openPanel("tags");
      else if (detail.type === "view-stashes") revealSection("stashes");
      else if (detail.type === "show-tab") revealSection(detail.tab);
    });
  }, [
    handleInitializeRepository,
    handleSelectRepository,
    model,
    openPanel,
    revealSection,
    showBranchPicker,
  ]);

  const actionsMenu = (hasGitRepo: boolean) => (
    <GitActionsMenu
      hasGitRepo={hasGitRepo}
      hiddenItemIds={hiddenItems}
      onItemVisibleChange={handleItemVisibleChange}
      repoPath={activeRepoPath ?? props.repoPath}
      onRefresh={() => void model.refresh()}
      onOpenBranchManager={() => openPanel("branches")}
      onShowBranchDiff={() => void showBranchPicker()}
      onOpenRemoteManager={() => openPanel("remotes")}
      onOpenTagManager={() => openPanel("tags")}
      onViewStashes={() => revealSection("stashes")}
      onSelectRepository={handleSelectRepository}
      isSelectingRepository={isSelectingRepo}
      onInitializeRepository={handleInitializeRepository}
      isInitializingRepository={isInitializingRepo}
    />
  );

  if (!activeRepoPath || (!model.hasStatus && !model.isLoading)) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <div className="flex h-11 items-center justify-between px-3">
          <span className="ui-text-base font-semibold">Source Control</span>
          {actionsMenu(false)}
        </div>
        <EmptyState
          layout="sidebar"
          title={activeRepoPath ? "Not a Git repository" : "No repository selected"}
          message={repoError}
          action={{
            label: isSelectingRepo ? "Selecting..." : "Browse",
            icon: <FolderStarIcon />,
            disabled: isSelectingRepo,
            onClick: () => void handleSelectRepository(),
          }}
          secondaryAction={{
            label: isInitializingRepo ? "Initializing..." : "Initialize",
            icon: <GitBranchIcon />,
            variant: "ghost",
            disabled: !props.repoPath || isInitializingRepo,
            onClick: () => void handleInitializeRepository(),
          }}
        />
      </div>
    );
  }

  if (!model.hasStatus) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Spinner label="Loading Git status" showLabel compact />
      </div>
    );
  }

  const repoPaths = availableRepoPaths.length > 0 ? availableRepoPaths : [activeRepoPath];
  const currentWorktreeIndex = worktrees.findIndex((worktree) => worktree.is_current);

  let body: ReactNode;
  if (panel === "branches") {
    body = <BranchesPanel model={model} />;
  } else if (panel === "worktrees") {
    body = (
      <WorktreesPanel
        model={model}
        worktrees={worktrees}
        isLoading={isLoadingWorktrees}
        onReload={loadWorktrees}
        onOpen={(path) => void handleOpenWorktree(path)}
      />
    );
  } else if (panel === "repositories") {
    body = (
      <RepositoriesPanel
        repoPaths={repoPaths}
        activeRepoPath={activeRepoPath}
        workspaceRootPath={workspaceRootPath}
        onSelect={(path) => {
          selectRepository(path);
          goHome();
        }}
        onBrowse={() => void handleSelectRepository()}
      />
    );
  } else if (panel === "remotes") {
    body = <RemotesPanel model={model} onChanged={() => void loadRefCounts()} />;
  } else if (panel === "tags") {
    body = <TagsPanel model={model} onChanged={() => void loadRefCounts()} />;
  } else {
    body = (
      <>
        <div className="shrink-0">
          <StreamIdentity
            model={model}
            isLinkedWorktree={currentWorktreeIndex > 0}
            onOpenBranches={() => openPanel("branches")}
            actionsMenu={actionsMenu(true)}
          />
          <StreamComposer model={model} />
        </div>
        <StreamList
          model={model}
          scrollRef={scrollRef}
          sections={sections}
          onSectionToggle={(id) => setSectionOpen(id, !sections[id])}
          isVisible={isVisible}
          onOpenCommit={(commit) => model.viewCommit(commit.hash)}
          onCompareCommit={() => {
            setPicker("commit");
            setPickerQuery("");
          }}
          onCompareBranch={() => void showBranchPicker()}
        />
      </>
    );
  }

  const tabs: StreamTab[] = [
    {
      id: "home",
      label: "Changes",
      icon: <GitDiffIcon className="size-4" />,
      count: model.files.length,
      active: !panel,
      onClick: goHome,
    },
    {
      id: "branches",
      label: "Branches",
      icon: <GitBranchIcon className="size-4" />,
      count: model.branches.length,
      active: panel === "branches",
      onClick: () => openPanel("branches"),
    },
    {
      id: "worktrees",
      label: "Worktrees",
      icon: <NodesIcon className="size-4" />,
      count: worktrees.length,
      active: panel === "worktrees",
      onClick: () => openPanel("worktrees"),
    },
    ...(isVisible("remotes")
      ? [
          {
            id: "remotes",
            label: "Remotes",
            icon: <GlobeIcon className="size-4" />,
            count: refCounts.remotes,
            active: panel === "remotes",
            onClick: () => openPanel("remotes"),
          },
        ]
      : []),
    ...(isVisible("tags")
      ? [
          {
            id: "tags",
            label: "Tags",
            icon: <TagIcon className="size-4" />,
            count: refCounts.tags,
            active: panel === "tags",
            onClick: () => openPanel("tags"),
          },
        ]
      : []),
    ...(repoPaths.length > 1
      ? [
          {
            id: "repositories",
            label: "Repos",
            icon: <FolderOpenIcon className="size-4" />,
            count: repoPaths.length,
            active: panel === "repositories",
            onClick: () => openPanel("repositories"),
          },
        ]
      : []),
  ];

  const commitPickerItems = model.commits.filter((commit) =>
    matchesSearchQuery(pickerQuery.trim().toLowerCase(), [
      commit.message,
      commit.author,
      commit.hash,
    ]),
  );
  const branchPickerItems = model.branches.filter(
    (branch) =>
      branch !== model.branch && matchesSearchQuery(pickerQuery.trim().toLowerCase(), [branch]),
  );
  const closePicker = () => {
    setPicker(null);
    setPickerQuery("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <StreamTabs tabs={tabs} label="Source control sections" />
      {body}

      <GitCommandSurface
        isOpen={picker === "commit"}
        onClose={closePicker}
        query={pickerQuery}
        onQueryChange={setPickerQuery}
        placeholder="Compare working tree with commit..."
        meta={`${model.commits.length} commits`}
      >
        <CommandList>
          {commitPickerItems.length === 0 ? (
            <CommandEmpty>No matching commits</CommandEmpty>
          ) : (
            <div>
              {commitPickerItems.map((commit) => (
                <CommandItemRow
                  key={commit.hash}
                  type="button"
                  icon={<HistoryIcon />}
                  title={commit.message}
                  accessory={<CommandItemBadge>{shortHash(commit.hash)}</CommandItemBadge>}
                  onClick={() => {
                    model.viewCommit(commit.hash);
                    closePicker();
                  }}
                />
              ))}
            </div>
          )}
        </CommandList>
      </GitCommandSurface>
      <GitCommandSurface
        isOpen={picker === "branch"}
        onClose={closePicker}
        query={pickerQuery}
        onQueryChange={setPickerQuery}
        placeholder="Compare current branch with..."
        meta={`${branchPickerItems.length} branches`}
      >
        <CommandList>
          {branchPickerItems.length === 0 ? (
            <CommandEmpty>No other branches</CommandEmpty>
          ) : (
            <div>
              {branchPickerItems.map((branch) => (
                <CommandItemRow
                  key={branch}
                  type="button"
                  icon={<GitBranchIcon />}
                  title={branch}
                  description={`compare with ${model.branch}`}
                  onClick={() => {
                    model.viewBranchDiff(branch);
                    closePicker();
                  }}
                />
              ))}
            </div>
          )}
        </CommandList>
      </GitCommandSurface>
    </div>
  );
}

function StreamList({
  model,
  scrollRef,
  sections,
  onSectionToggle,
  isVisible,
  onOpenCommit,
  onCompareCommit,
  onCompareBranch,
}: {
  model: SourceControlModel;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sections: Record<SectionId, boolean>;
  onSectionToggle: (id: SectionId) => void;
  isVisible: (id: GitSidebarItemId) => boolean;
  onOpenCommit: (commit: GitCommit) => void;
  onCompareCommit: () => void;
  onCompareBranch: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const account = useAuthStore((state) => state.user);
  const activeBufferId = useActiveBufferId();
  const activeCommitDiff = useBufferStore((state) => {
    const buffer = getBufferById(state.buffers, activeBufferId);
    return buffer?.type === "diff" && buffer.diffData && "files" in buffer.diffData
      ? buffer.diffData
      : null;
  });
  const contextMenu = useDropdownMenu<ChangeFile>();

  const filterFiles = (files: ChangeFile[]) => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((file) => matchesSearchQuery(q, [file.path])) : files;
  };
  const staged = filterFiles(model.staged);
  const unstaged = filterFiles(model.unstaged);

  const commits = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return q
      ? model.commits.filter((c) =>
          matchesSearchQuery(q, [c.message, c.description ?? "", c.author, c.email ?? "", c.hash]),
        )
      : model.commits;
  }, [historyQuery, model.commits]);

  const compareItems: MenuItem[] = [
    {
      id: "unstaged",
      label: "Unstaged changes",
      disabled: model.unstaged.length === 0,
      onClick: () => model.viewAll("unstaged"),
    },
    {
      id: "staged",
      label: "Staged changes",
      disabled: model.staged.length === 0,
      onClick: () => model.viewAll("staged"),
    },
    { id: "sep", separator: true },
    { id: "commit", label: "Against a commit…", onClick: onCompareCommit },
    { id: "branch", label: "Against a branch…", onClick: onCompareBranch },
  ];

  const renderRow = (file: ChangeFile) => (
    <FileRow
      key={file.key}
      file={file}
      model={model}
      onContextMenu={(event) => contextMenu.open(event, file)}
    />
  );

  const menuFile = contextMenu.data;

  return (
    <>
      <StreamToolbar search={{ value: filter, onChange: setFilter, placeholder: "Filter changes" }}>
        <StreamMenuButton
          label="Compare"
          icon={<GitDiffIcon className="size-3.5" />}
          items={compareItems}
        />
      </StreamToolbar>
      <StreamScroll scrollRef={scrollRef}>
        {isVisible("changes") ? (
          <>
            {model.files.length === 0 ? (
              <StreamEmpty
                title="Working tree clean"
                hint="Edit something and it will show up here."
              />
            ) : null}

            {model.staged.length > 0 ? (
              <StreamSection
                id="staged"
                title="Staged"
                count={model.staged.length}
                open={sections.staged}
                onToggle={() => onSectionToggle("staged")}
                actions={
                  <>
                    <StreamIconButton label="Review staged" onClick={() => model.viewAll("staged")}>
                      <GitDiffIcon className="size-3.5" />
                    </StreamIconButton>
                    <StreamIconButton
                      label="Unstage all"
                      onClick={() => void model.setStaged(model.staged, false)}
                    >
                      <MinusIcon className="size-3.5" />
                    </StreamIconButton>
                  </>
                }
              >
                {staged.map(renderRow)}
              </StreamSection>
            ) : null}

            {model.unstaged.length > 0 ? (
              <StreamSection
                id="changes"
                title="Changes"
                count={model.unstaged.length}
                open={sections.changes}
                onToggle={() => onSectionToggle("changes")}
                actions={
                  <>
                    <StreamIconButton
                      label="Stash all"
                      onClick={() => void model.stash("create", undefined, "WIP from sidebar")}
                    >
                      <StackIcon className="size-3.5" />
                    </StreamIconButton>
                    <StreamIconButton
                      label="Discard all"
                      onClick={() =>
                        void model.discard(model.unstaged.filter((f) => f.status !== "untracked"))
                      }
                    >
                      <ArrowCounterClockwiseIcon className="size-3.5" />
                    </StreamIconButton>
                    <StreamIconButton
                      label="Stage all"
                      onClick={() => void model.setStaged(model.unstaged, true)}
                    >
                      <PlusIcon className="size-3.5" />
                    </StreamIconButton>
                  </>
                }
              >
                {unstaged.map(renderRow)}
              </StreamSection>
            ) : null}
          </>
        ) : null}

        {isVisible("stashes") && model.stashes.length > 0 ? (
          <StreamSection
            id="stashes"
            title="Stashes"
            count={model.stashes.length}
            open={sections.stashes}
            onToggle={() => onSectionToggle("stashes")}
          >
            {model.stashes.map((stash) => (
              <StreamRow
                key={stash.index}
                tooltip={stash.message}
                onClick={() => model.viewStash(stash.index)}
                icon={<StackIcon className="size-3.5 text-subtle-foreground" />}
                title={getStashDisplayTitle(stash.message)}
                meta={formatRelativeDate(stash.date)}
                actions={
                  <>
                    <StreamIconButton
                      label="Apply"
                      onClick={() => void model.stash("apply", stash.index)}
                    >
                      <ArchiveIcon className="size-3" />
                    </StreamIconButton>
                    <StreamIconButton
                      label="Pop"
                      onClick={() => void model.stash("pop", stash.index)}
                    >
                      <ArrowUpIcon className="size-3" />
                    </StreamIconButton>
                    <StreamIconButton
                      label="Drop"
                      onClick={() => void model.stash("drop", stash.index)}
                    >
                      <TrashIcon className="size-3" />
                    </StreamIconButton>
                  </>
                }
              />
            ))}
          </StreamSection>
        ) : null}

        {isVisible("history") ? (
          <StreamSection
            id="history"
            title="History"
            count={model.commits.length}
            open={sections.history}
            onToggle={() => onSectionToggle("history")}
            toolbar={
              model.commits.length > 5 ? (
                <StreamSearchField
                  value={historyQuery}
                  onChange={setHistoryQuery}
                  placeholder="Search message, author, hash"
                />
              ) : undefined
            }
          >
            <ol className="relative">
              {commits.map((commit, index) => {
                const unpushed = !historyQuery && index < model.ahead;
                const selected = activeCommitDiff?.commitHash === commit.hash;
                return (
                  <li
                    key={commit.hash}
                    aria-current={selected || undefined}
                    onClick={() => onOpenCommit(commit)}
                    className={cn(
                      "group relative flex cursor-default gap-2.5 rounded-md py-1.5 pr-2 pl-2",
                      selected ? "bg-primary/8" : "hover:bg-foreground/5",
                    )}
                  >
                    <span className="relative flex w-3 shrink-0 justify-center">
                      <span
                        className={cn(
                          "absolute top-0 -bottom-1.5 w-px bg-border",
                          index === 0 && "top-2",
                          index === commits.length - 1 && "bottom-auto h-2",
                        )}
                      />
                      <span
                        className={cn(
                          "relative mt-1 size-2.5 rounded-full border-2",
                          unpushed
                            ? "border-primary bg-background"
                            : "border-background bg-subtle-foreground",
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 ui-text-sm leading-4 text-foreground">
                        {commit.message}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 ui-text-caption text-subtle-foreground">
                        <Avatar
                          name={commit.author}
                          src={getGitAuthorAvatarUrl(commit, account)}
                          size="sm"
                        />
                        <span className="truncate">{commit.author}</span>
                        <span>·</span>
                        <span className="shrink-0">{formatRelativeDate(commit.date)}</span>
                        {unpushed ? (
                          <span className="rounded-full bg-primary/15 px-1.5 ui-text-caption font-medium text-primary">
                            unpushed
                          </span>
                        ) : null}
                        {selected ? null : (
                          <span className="ml-auto hidden font-mono group-hover:inline">
                            {shortHash(commit.hash)}
                          </span>
                        )}
                      </span>
                      {selected && activeCommitDiff ? (
                        <span className="mt-2 block">
                          {commit.description?.trim() ? (
                            <span className="mb-2 line-clamp-6 block ui-text-sm leading-4 whitespace-pre-wrap text-muted-foreground">
                              {commit.description.trim()}
                            </span>
                          ) : null}
                          <span className="flex items-center gap-1.5 ui-text-caption text-subtle-foreground">
                            <span className="shrink-0">
                              {activeCommitDiff.totalFiles} file
                              {activeCommitDiff.totalFiles === 1 ? "" : "s"}
                            </span>
                            <DiffNumbers
                              additions={activeCommitDiff.totalAdditions}
                              deletions={activeCommitDiff.totalDeletions}
                            />
                            <span className="ml-auto flex shrink-0 items-center gap-0.5">
                              <span className="font-mono">{shortHash(commit.hash)}</span>
                              <StreamIconButton
                                label="Copy commit hash"
                                onClick={() => void writeClipboardText(commit.hash)}
                              >
                                <CopyIcon className="size-3" />
                              </StreamIconButton>
                              <StreamIconButton
                                label="New branch from this commit"
                                onClick={() => void model.createBranch(commit.hash)}
                              >
                                <GitBranchIcon className="size-3" />
                              </StreamIconButton>
                            </span>
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            {commits.length === 0 ? (
              <div className="px-4 py-4 text-center ui-text-sm text-subtle-foreground">
                {historyQuery ? "No matching commits" : "No commits yet"}
              </div>
            ) : null}
            {model.hasMoreCommits && !historyQuery ? (
              <button
                type="button"
                onClick={() => model.loadMoreCommits()}
                className="mt-1 w-full rounded-md py-1.5 ui-text-sm text-subtle-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                Load older commits
              </button>
            ) : null}
          </StreamSection>
        ) : null}

        <ContextMenuPopup
          isOpen={contextMenu.isOpen}
          point={contextMenu.position}
          groups={createContextMenuGroups(
            menuFile
              ? [
                  {
                    id: "diff",
                    label: "Open Diff",
                    icon: <GitDiffIcon />,
                    onClick: () => model.openDiff(menuFile),
                  },
                  {
                    id: "open",
                    label: "Open File",
                    icon: <FileTextIcon />,
                    onClick: () => model.openFile(menuFile),
                  },
                  { id: "sep-1", separator: true },
                  menuFile.staged
                    ? {
                        id: "unstage",
                        label: "Unstage",
                        icon: <MinusIcon />,
                        onClick: () => void model.setStaged([menuFile], false),
                      }
                    : {
                        id: "stage",
                        label: "Stage",
                        icon: <PlusIcon />,
                        onClick: () => void model.setStaged([menuFile], true),
                      },
                  {
                    id: "stash",
                    label: "Stash File",
                    icon: <ArchiveIcon />,
                    onClick: () =>
                      void model.stash("create", undefined, `Stash ${menuFile.name}`, [
                        menuFile.path,
                      ]),
                  },
                  {
                    id: "copy",
                    label: "Copy Path",
                    icon: <CopyIcon />,
                    onClick: () => void writeClipboardText(menuFile.path),
                  },
                  ...(!menuFile.staged && menuFile.status !== "untracked"
                    ? [
                        { id: "sep-2", separator: true as const },
                        {
                          id: "discard",
                          label: "Discard Changes",
                          icon: <TrashIcon />,
                          tone: "destructive" as const,
                          onClick: () => void model.discard([menuFile]),
                        },
                      ]
                    : []),
                ]
              : [],
          )}
          onClose={contextMenu.close}
        />
      </StreamScroll>
    </>
  );
}

function FileRow({
  file,
  model,
  onContextMenu,
}: {
  file: ChangeFile;
  model: SourceControlModel;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  return (
    <StreamRow
      tooltip={file.path}
      muted={model.busyKeys.has(file.key)}
      struck={file.status === "deleted"}
      icon={<FileGlyph name={file.name} />}
      title={file.name}
      secondary={file.dir}
      meta={
        <>
          <DiffNumbers additions={file.additions} deletions={file.deletions} />
          <StatusLetter status={file.status} />
        </>
      }
      onClick={() => model.openPrimary(file)}
      onContextMenu={onContextMenu}
      draggable={!!model.activeRepoPath}
      onDragStart={(event) => {
        if (!model.activeRepoPath) return;
        writeSidebarResourceDragData(event.dataTransfer, {
          type: "git-file-diff",
          repoPath: model.activeRepoPath,
          filePath: file.path,
          staged: file.staged,
          status: file.status,
          name: file.name,
        });
      }}
      actions={
        <>
          {!file.staged && file.status !== "untracked" ? (
            <StreamIconButton label="Discard" onClick={() => void model.discard([file])}>
              <ArrowCounterClockwiseIcon className="size-3" />
            </StreamIconButton>
          ) : null}
          <StreamIconButton
            label={file.staged ? "Unstage" : "Stage"}
            onClick={() => void model.setStaged([file], !file.staged)}
          >
            {file.staged ? <MinusIcon className="size-3" /> : <PlusIcon className="size-3" />}
          </StreamIconButton>
        </>
      }
    />
  );
}

export default memo(StreamView);
