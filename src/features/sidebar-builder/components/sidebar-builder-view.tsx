import { invoke } from "@tauri-apps/api/core";
import {
  CaretDown,
  CheckCircle,
  Circle,
  Copy,
  GlobeHemisphereWest,
  Plus,
  SpinnerGap,
  Star,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { getBranches } from "@/features/git/api/git-branches-api";
import { getGitLog } from "@/features/git/api/git-commits-api";
import { getCommitDiff, getFileDiff } from "@/features/git/api/git-diff-api";
import { getStashes } from "@/features/git/api/git-stash-api";
import { getGitStatus } from "@/features/git/api/git-status-api";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import GitWorktreeSwitcher from "@/features/git/components/git-worktree-switcher";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { useGitStore } from "@/features/git/stores/git-store";
import type { GitCommit } from "@/features/git/types/git-types";
import type { MultiFileDiff } from "@/features/git/types/git-diff-types";
import { countDiffStats } from "@/features/git/utils/git-diff-helpers";
import { getStashDisplayTitle } from "@/features/git/utils/git-stash-format";
import { useGitHubStore } from "@/features/github/stores/github-store";
import type { IssueListItem, WorkflowRunListItem } from "@/features/github/types/github";
import { useTerminalStore } from "@/features/terminal/stores/terminal-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandInput, CommandItem, CommandList } from "@/ui/command";
import { ContextMenu, type ContextMenuItem, useContextMenu } from "@/ui/context-menu";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import { getBaseName } from "@/utils/path-helpers";
import { matchesSearchQuery } from "@/utils/search-match";
import {
  SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE,
  SIDEBAR_BUILDER_WIDGET_DEFINITIONS,
} from "../constants/sidebar-builder-widgets";
import {
  type SidebarBuilderWidget,
  type SidebarBuilderWidgetType,
  useSidebarBuilderStore,
} from "../stores/sidebar-builder-store";

interface SidebarBuilderItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: ReactNode;
  avatarUrl?: string | null;
  avatarAlt?: string;
  avatarShape?: "circle" | "square";
  trailing?: ReactNode;
  canFavorite?: boolean;
  content?: ReactNode;
  onClick?: () => void;
}

interface SidebarBuilderItemContextData {
  item: SidebarBuilderItem;
  isFavorite: boolean;
  sourceWidgetType?: SidebarBuilderWidgetType;
}

interface HoverCardPosition {
  x: number;
  y: number;
  side: "left" | "right";
}

const GITHUB_WIDGET_TYPES = new Set<SidebarBuilderWidgetType>([
  "github-prs",
  "github-issues",
  "github-actions",
]);

const GIT_WIDGET_TYPES = new Set<SidebarBuilderWidgetType>([
  "git-changes",
  "git-history",
  "git-branches",
  "git-stashes",
  "git-worktrees",
]);
const DIRECT_WIDGET_TYPES = new Set<SidebarBuilderWidgetType>([
  "git-changes",
  "git-branches",
  "git-worktrees",
  "terminals",
  "browser-tabs",
]);

function normalizeGitPath(path: string) {
  const renamedParts = path.includes(" -> ") ? path.split(" -> ") : null;
  const renamedPath = renamedParts ? renamedParts[renamedParts.length - 1]?.trim() : path;
  const nextPath = renamedPath || path;
  return nextPath.startsWith('"') && nextPath.endsWith('"') ? nextPath.slice(1, -1) : nextPath;
}

function getGitAuthorAvatarUrl(commit: GitCommit) {
  const email = commit.email?.trim();
  const noreplyMatch = email?.match(/^\d+\+([^@]+)@users\.noreply\.github\.com$/i);
  if (noreplyMatch?.[1]) {
    return `https://github.com/${encodeURIComponent(noreplyMatch[1])}.png?size=32`;
  }

  if (email) {
    return `https://unavatar.io/${encodeURIComponent(email)}`;
  }

  const author = commit.author.trim();
  return author ? `https://github.com/${encodeURIComponent(author)}.png?size=32` : null;
}

function getWebViewerFavicon(url: string, favicon?: string) {
  if (favicon) return favicon;
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname) return null;
    return `${parsedUrl.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

function getDirectoryLabel(directory?: string) {
  if (!directory) return "";
  const normalized = directory.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || directory;
}

function getCommandLabel(command?: string) {
  if (!command) return "";
  const firstSegment = command.trim().split(/\s+/)[0];
  return firstSegment?.split(/[\\/]/).pop() || "";
}

function isUsefulTerminalTitle(title?: string) {
  if (!title) return false;
  const trimmed = title.trim();
  if (!trimmed || trimmed === "Default Terminal") return false;
  if (trimmed.length > 28) return false;
  if (trimmed.includes("@")) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if ((code >= 0 && code <= 31) || code === 127 || code === 155) {
      return false;
    }
  }
  return true;
}

function getWorkflowRunStatus(run: WorkflowRunListItem) {
  const conclusion = run.conclusion?.toLowerCase() ?? null;
  const status = run.status?.toLowerCase() ?? null;
  const displayStatus = conclusion ?? status ?? "unknown";

  if (conclusion === "success") {
    return {
      label: displayStatus,
      icon: <CheckCircle className="text-success" weight="fill" />,
    };
  }

  if (["failure", "failed", "error", "timed_out", "startup_failure"].includes(conclusion ?? "")) {
    return {
      label: displayStatus,
      icon: <XCircle className="text-error" weight="fill" />,
    };
  }

  if (["cancelled", "skipped"].includes(conclusion ?? "")) {
    return {
      label: displayStatus,
      icon: <WarningCircle className="text-warning" weight="duotone" />,
    };
  }

  if (["in_progress", "queued", "requested", "waiting", "pending"].includes(status ?? "")) {
    return {
      label: displayStatus,
      icon: <SpinnerGap className="animate-spin text-warning" weight="duotone" />,
    };
  }

  return {
    label: displayStatus,
    icon: <Circle className="text-text-lighter" weight="duotone" />,
  };
}

function getHoverCardPosition(rect: DOMRect): HoverCardPosition {
  const width = 280;
  const height = 132;
  const gap = 8;
  const padding = 8;
  const canOpenRight = rect.right + gap + width <= window.innerWidth - padding;
  const side: HoverCardPosition["side"] = canOpenRight ? "right" : "left";
  const x = canOpenRight ? rect.right + gap : Math.max(padding, rect.left - width - gap);
  const centeredY = rect.top + rect.height / 2 - height / 2;
  const y = Math.max(padding, Math.min(centeredY, window.innerHeight - height - padding));

  return { x, y, side };
}

function SidebarItemHoverCard({
  item,
  position,
}: {
  item: SidebarBuilderItem;
  position: HoverCardPosition | null;
}) {
  if (!position || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10030] w-[280px] rounded-lg border border-border/70 bg-secondary-bg/95 p-2.5 shadow-[0_18px_42px_-28px_rgba(0,0,0,0.6)] backdrop-blur-sm"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className={cn(
          "-translate-y-1/2 absolute top-1/2 size-2 rotate-45 border-border/70 bg-secondary-bg/95",
          position.side === "right" ? "-left-1 border-b border-l" : "-right-1 border-t border-r",
        )}
      />
      <div className="flex min-w-0 items-start gap-2">
        {item.avatarUrl ? (
          <img
            src={item.avatarUrl}
            alt={item.avatarAlt ?? ""}
            className={cn(
              "size-7 shrink-0 bg-primary-bg object-cover",
              item.avatarShape === "square" ? "rounded" : "rounded-full",
            )}
            loading="lazy"
          />
        ) : (
          <span className="grid size-7 shrink-0 place-content-center rounded-md bg-primary-bg text-text-lighter">
            {item.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-text text-xs leading-5">{item.title}</div>
          {item.subtitle ? (
            <div className="mt-0.5 break-words text-text-lighter text-[11px] leading-4">
              {item.subtitle}
            </div>
          ) : null}
          {item.badge ? (
            <div className="mt-2">
              <span className="rounded bg-primary-bg px-1.5 py-0.5 text-[10px] text-text-lighter">
                {item.badge}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AddWidgetPicker({
  query,
  selectedIndex,
  activeWidgetTypes,
  onQueryChange,
  onSelectedIndexChange,
  onSelect,
  onClose,
}: {
  query: string;
  selectedIndex: number;
  activeWidgetTypes: Set<SidebarBuilderWidgetType>;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onSelect: (type: SidebarBuilderWidgetType) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filteredDefinitions = useMemo(
    () =>
      SIDEBAR_BUILDER_WIDGET_DEFINITIONS.filter(
        (definition) =>
          !query.trim() ||
          matchesSearchQuery(query, [definition.label, definition.description, definition.type]),
      ),
    [query],
  );
  const groupedDefinitions = useMemo(
    () =>
      [
        {
          id: "github",
          label: "GitHub",
          items: filteredDefinitions.filter((definition) => definition.type.startsWith("github-")),
        },
        {
          id: "git",
          label: "Git",
          items: filteredDefinitions.filter((definition) => definition.type.startsWith("git-")),
        },
        {
          id: "workspace",
          label: "Workspace",
          items: filteredDefinitions.filter(
            (definition) => definition.type === "terminals" || definition.type === "browser-tabs",
          ),
        },
      ].filter((group) => group.items.length > 0),
    [filteredDefinitions],
  );

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    onSelectedIndexChange(0);
  }, [onSelectedIndexChange, query]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectedIndexChange(Math.min(selectedIndex + 1, filteredDefinitions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectedDefinition = filteredDefinitions[selectedIndex];
      if (selectedDefinition) {
        onSelect(selectedDefinition.type);
      }
    }
  };

  return (
    <div className="mx-1 mb-1 rounded-lg border border-border/70 bg-primary-bg/95 shadow-lg">
      <div className="flex h-8 items-center gap-2 border-border/60 border-b px-2">
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={onQueryChange}
          onKeyDown={handleKeyDown}
          placeholder="Add to sidebar..."
          className="text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          tooltip="Close"
          onClick={onClose}
          className="text-text-lighter/75"
          compact
        >
          <X />
        </Button>
      </div>
      <CommandList>
        {filteredDefinitions.length === 0 ? (
          <CommandEmpty>No widgets found</CommandEmpty>
        ) : (
          groupedDefinitions.map((group) => (
            <div key={group.id} className="py-0.5">
              <div className="px-2 py-1 font-medium text-text-lighter text-[10px] uppercase">
                {group.label}
              </div>
              {group.items.map((definition) => {
                const index = filteredDefinitions.findIndex(
                  (item) => item.type === definition.type,
                );
                const isAdded = activeWidgetTypes.has(definition.type);

                return (
                  <CommandItem
                    key={definition.type}
                    isSelected={index === selectedIndex}
                    onMouseEnter={() => onSelectedIndexChange(index)}
                    onClick={() => onSelect(definition.type)}
                    className="px-2 py-1.5"
                  >
                    <span className="grid size-5 shrink-0 place-content-center text-text-lighter">
                      {definition.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">{definition.label}</span>
                    {isAdded ? (
                      <span className="shrink-0 rounded bg-secondary-bg px-1.5 py-0.5 text-[10px] text-text-lighter">
                        Added
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </div>
          ))
        )}
      </CommandList>
    </div>
  );
}

function WidgetRow({
  item,
  isFavorite,
  onToggleFavorite,
  onContextMenu,
  sourceWidgetType,
}: {
  item: SidebarBuilderItem;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onContextMenu: (
    event: MouseEvent,
    item: SidebarBuilderItem,
    isFavorite: boolean,
    sourceWidgetType?: SidebarBuilderWidgetType,
  ) => void;
  sourceWidgetType?: SidebarBuilderWidgetType;
}) {
  const [avatarError, setAvatarError] = useState(false);
  const [hoverCardPosition, setHoverCardPosition] = useState<HoverCardPosition | null>(null);
  const showAvatar = item.avatarUrl && !avatarError;
  const canFavorite = item.canFavorite !== false;

  useEffect(() => {
    setAvatarError(false);
  }, [item.avatarUrl]);

  return (
    <div
      className="group flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover/70"
      onContextMenu={(event) => onContextMenu(event, item, isFavorite, sourceWidgetType)}
      onMouseEnter={(event) =>
        setHoverCardPosition(getHoverCardPosition(event.currentTarget.getBoundingClientRect()))
      }
      onMouseLeave={() => setHoverCardPosition(null)}
    >
      {item.content ? (
        <div className="min-w-0 flex-1">{item.content}</div>
      ) : (
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={item.onClick}
        >
          {showAvatar ? (
            <img
              src={item.avatarUrl ?? ""}
              alt={item.avatarAlt ?? ""}
              className={cn(
                "size-5 shrink-0 bg-secondary-bg object-cover",
                item.avatarShape === "square" ? "rounded" : "rounded-full",
              )}
              loading="lazy"
              onError={() => setAvatarError(true)}
            />
          ) : (
            <span className="grid size-5 shrink-0 place-content-center text-text-lighter">
              {item.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-text text-xs leading-4">{item.title}</span>
        </button>
      )}
      {item.trailing ? <div className="shrink-0">{item.trailing}</div> : null}
      {canFavorite ? (
        <Button
          type="button"
          variant="ghost"
          tooltip={isFavorite ? "Remove Favorite" : "Favorite"}
          onClick={onToggleFavorite}
          className={cn(
            "opacity-0 group-hover:opacity-100",
            isFavorite && "opacity-100 text-warning",
          )}
          compact
        >
          <Star weight={isFavorite ? "fill" : "regular"} />
        </Button>
      ) : null}
      <SidebarItemHoverCard item={item} position={hoverCardPosition} />
    </div>
  );
}

function WidgetSection({
  widget,
  items,
  favoriteItemIds,
  onToggle,
  onToggleFavorite,
  onItemContextMenu,
  onSectionContextMenu,
}: {
  widget: SidebarBuilderWidget;
  items: SidebarBuilderItem[];
  favoriteItemIds: string[];
  onToggle: () => void;
  onToggleFavorite: (itemId: string) => void;
  onItemContextMenu: (event: MouseEvent, item: SidebarBuilderItem, isFavorite: boolean) => void;
  onSectionContextMenu: (event: MouseEvent, widget: SidebarBuilderWidget) => void;
}) {
  const definition = SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get(widget.type);
  const visibleItems = items.slice(0, widget.itemLimit);

  return (
    <section className="px-1 py-1">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1 rounded-md px-1 text-left font-medium text-text-lighter text-[11px] leading-none uppercase hover:bg-hover/60 hover:text-text"
        onClick={onToggle}
        onContextMenu={(event) => onSectionContextMenu(event, widget)}
      >
        <CaretDown
          className={cn("size-3 shrink-0 transition-transform", !widget.isOpen && "-rotate-90")}
          weight="bold"
        />
        <span className="min-w-0 flex-1 truncate">{definition?.label ?? widget.type}</span>
      </button>
      {widget.isOpen ? (
        <div>
          {visibleItems.length > 0 ? (
            visibleItems.map((item) => (
              <WidgetRow
                key={item.id}
                item={item}
                isFavorite={favoriteItemIds.includes(item.id)}
                onToggleFavorite={() => onToggleFavorite(item.id)}
                onContextMenu={onItemContextMenu}
              />
            ))
          ) : (
            <div className="px-3 py-2 text-text-lighter text-xs">No items</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function SidebarBuilderView() {
  const widgets = useSidebarBuilderStore.use.widgets();
  const favoriteItemIds = useSidebarBuilderStore.use.favoriteItemIds();
  const builderActions = useSidebarBuilderStore.use.actions();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const { syncWorkspaceRepositories } = useRepositoryStore.use.actions();
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
  const { gitStatus, commits, stashes, actions: gitActions } = useGitStore();
  const { prs, isAuthenticated } = useGitHubStore();
  const { checkAuth, fetchPRs } = useGitHubStore().actions;
  const buffers = useBufferStore.use.buffers();
  const terminalSessions = useTerminalStore((state) => state.sessions);
  const {
    openBuffer,
    openPRBuffer,
    openGitHubIssueBuffer,
    openGitHubActionBuffer,
    openTerminalBuffer,
    openWebViewerBuffer,
    setActiveBuffer,
  } = useBufferStore.use.actions();
  const { setActiveView, setIsSidebarVisible } = useUIState();
  const { selectRepository } = useRepositoryStore.use.actions();
  const [issues, setIssues] = useState<IssueListItem[]>([]);
  const [runs, setRuns] = useState<WorkflowRunListItem[]>([]);
  const [workingTreeStats, setWorkingTreeStats] = useState({ additions: 0, deletions: 0 });
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [isAddPickerOpen, setIsAddPickerOpen] = useState(false);
  const [addPickerQuery, setAddPickerQuery] = useState("");
  const [addPickerSelectedIndex, setAddPickerSelectedIndex] = useState(0);
  const itemContextMenu = useContextMenu<SidebarBuilderItemContextData>();
  const sectionContextMenu = useContextMenu<SidebarBuilderWidget>();
  const activeWidgetTypes = useMemo(() => new Set(widgets.map((widget) => widget.type)), [widgets]);
  const hasGitWidgets = useMemo(
    () => Array.from(activeWidgetTypes).some((type) => GIT_WIDGET_TYPES.has(type)),
    [activeWidgetTypes],
  );
  const hasGitHubWidgets = useMemo(
    () => Array.from(activeWidgetTypes).some((type) => GITHUB_WIDGET_TYPES.has(type)),
    [activeWidgetTypes],
  );

  const toggleAddPicker = useCallback(() => {
    setIsAddPickerOpen((isOpen) => !isOpen);
    setAddPickerQuery("");
    setAddPickerSelectedIndex(0);
  }, []);

  const selectWidgetType = useCallback(
    (type: SidebarBuilderWidgetType) => {
      builderActions.addWidget(type);
      if (type === "terminals") {
        openTerminalBuffer({ workingDirectory: repoPath ?? undefined });
      }
      if (type === "browser-tabs") {
        openWebViewerBuffer(`about:blank#tab-${Date.now()}`);
      }
      setIsAddPickerOpen(false);
      setAddPickerQuery("");
      setAddPickerSelectedIndex(0);
    },
    [builderActions, openTerminalBuffer, openWebViewerBuffer, repoPath],
  );

  const showGitPane = useCallback(
    (detail?: unknown) => {
      setIsSidebarVisible(true);
      setActiveView("git");
      if (detail) {
        window.dispatchEvent(new CustomEvent("athas:git-palette-action", { detail }));
      }
    },
    [setActiveView, setIsSidebarVisible],
  );

  const refreshSidebarData = useCallback(async () => {
    if (!repoPath) return;

    try {
      const [status, nextCommits, nextBranches, nextStashes] = await Promise.all([
        getGitStatus(repoPath),
        getGitLog(repoPath, 50, 0),
        getBranches(repoPath),
        getStashes(repoPath),
      ]);

      gitActions.loadFreshGitData({
        gitStatus: status,
        commits: nextCommits,
        branches: nextBranches,
        stashes: nextStashes,
        repoPath,
      });

      if (hasGitHubWidgets && isAuthenticated) {
        await Promise.all([
          activeWidgetTypes.has("github-prs") ? fetchPRs(repoPath) : Promise.resolve(),
          activeWidgetTypes.has("github-issues")
            ? invoke<IssueListItem[]>("github_list_issues", { repoPath }).then(setIssues)
            : Promise.resolve(),
          activeWidgetTypes.has("github-actions")
            ? invoke<WorkflowRunListItem[]>("github_list_workflow_runs", { repoPath }).then(setRuns)
            : Promise.resolve(),
        ]);
      }
    } catch (error) {
      console.error("Failed to refresh custom sidebar data:", error);
    }
  }, [activeWidgetTypes, fetchPRs, gitActions, hasGitHubWidgets, isAuthenticated, repoPath]);

  const handleWorktreeChange = useCallback(
    async (worktreePath: string) => {
      selectRepository(worktreePath);
      const status = await getGitStatus(worktreePath);
      gitActions.setWorkspaceGitStatus(status, worktreePath);
    },
    [gitActions, selectRepository],
  );

  useEffect(() => {
    void syncWorkspaceRepositories(rootFolderPath ?? null);
  }, [rootFolderPath, syncWorkspaceRepositories]);

  useEffect(() => {
    if (!repoPath || !hasGitWidgets) return;
    void refreshSidebarData();
  }, [hasGitWidgets, refreshSidebarData, repoPath]);

  useEffect(() => {
    if (!repoPath || !activeWidgetTypes.has("git-changes")) {
      setWorkingTreeStats({ additions: 0, deletions: 0 });
      return;
    }

    const files = (gitStatus?.files ?? []).filter((file) => file.status !== "untracked");
    if (files.length === 0) {
      setWorkingTreeStats({ additions: 0, deletions: 0 });
      return;
    }

    let cancelled = false;
    void Promise.all(
      files.map((file) => getFileDiff(repoPath, normalizeGitPath(file.path), file.staged)),
    )
      .then((diffs) => {
        if (cancelled) return;
        setWorkingTreeStats(
          countDiffStats(diffs.filter((diff): diff is NonNullable<typeof diff> => Boolean(diff))),
        );
      })
      .catch(() => {
        if (!cancelled) setWorkingTreeStats({ additions: 0, deletions: 0 });
      });

    return () => {
      cancelled = true;
    };
  }, [activeWidgetTypes, gitStatus?.files, repoPath]);

  useEffect(() => {
    if (!hasGitHubWidgets) return;
    void checkAuth();
  }, [checkAuth, hasGitHubWidgets]);

  useEffect(() => {
    if (!repoPath || !isAuthenticated || !activeWidgetTypes.has("github-prs")) return;
    void fetchPRs(repoPath);
  }, [activeWidgetTypes, fetchPRs, isAuthenticated, repoPath]);

  useEffect(() => {
    if (!repoPath || !isAuthenticated || !activeWidgetTypes.has("github-issues")) return;

    let cancelled = false;
    void invoke<IssueListItem[]>("github_list_issues", { repoPath })
      .then((nextIssues) => {
        if (!cancelled) setIssues(nextIssues);
      })
      .catch((error) => {
        console.error("Failed to load sidebar issues:", error);
        if (!cancelled) setIssues([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeWidgetTypes, isAuthenticated, repoPath]);

  useEffect(() => {
    if (!repoPath || !isAuthenticated || !activeWidgetTypes.has("github-actions")) return;

    let cancelled = false;
    void invoke<WorkflowRunListItem[]>("github_list_workflow_runs", { repoPath })
      .then((nextRuns) => {
        if (!cancelled) setRuns(nextRuns);
      })
      .catch((error) => {
        console.error("Failed to load sidebar actions:", error);
        if (!cancelled) setRuns([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeWidgetTypes, isAuthenticated, repoPath]);

  const openCommitDiff = useCallback(
    async (commit: GitCommit) => {
      if (!repoPath) return;
      const diffs = await getCommitDiff(repoPath, commit.hash);
      if (!diffs?.length) return;

      const stats = countDiffStats(diffs);
      const multiDiff: MultiFileDiff = {
        title: `Commit ${commit.hash.substring(0, 7)}`,
        repoPath,
        commitHash: commit.hash,
        commitMessage: commit.message,
        commitDescription: commit.description,
        commitAuthor: commit.author,
        commitDate: commit.date,
        files: diffs,
        totalFiles: diffs.length,
        totalAdditions: stats.additions,
        totalDeletions: stats.deletions,
      };

      openBuffer(
        `diff://commit/${commit.hash}/all-files`,
        `Commit ${commit.hash.substring(0, 7)} (${diffs.length} files)`,
        "",
        false,
        undefined,
        true,
        true,
        multiDiff,
      );
    },
    [openBuffer, repoPath],
  );

  const openUncommittedChanges = useCallback(async () => {
    if (!repoPath) return;
    const files = (gitStatus?.files ?? []).filter((file) => file.status !== "untracked");

    if (files.length === 0) {
      showGitPane({ type: "show-tab", tab: "changes" });
      return;
    }

    const diffEntries = await Promise.all(
      files.map(async (file) => ({
        file,
        diff: await getFileDiff(repoPath, normalizeGitPath(file.path), file.staged),
      })),
    );
    const diffs = diffEntries
      .map((entry) => entry.diff)
      .filter((diff): diff is NonNullable<typeof diff> => Boolean(diff));

    if (diffs.length === 0) {
      showGitPane({ type: "show-tab", tab: "changes" });
      return;
    }

    const stats = countDiffStats(diffs);
    const multiDiff: MultiFileDiff = {
      title: "Uncommitted Changes",
      repoPath,
      commitHash: "working-tree",
      files: diffs,
      totalFiles: diffs.length,
      totalAdditions: stats.additions,
      totalDeletions: stats.deletions,
    };

    openBuffer(
      "diff://working-tree/all-files",
      `Uncommitted Changes (${diffs.length} files)`,
      "",
      false,
      undefined,
      true,
      true,
      multiDiff,
    );
  }, [gitStatus?.files, openBuffer, repoPath, showGitPane]);

  const widgetItems = useMemo(() => {
    const map = new Map<SidebarBuilderWidgetType, SidebarBuilderItem[]>();

    map.set(
      "github-prs",
      prs.map((pr) => ({
        id: `github-pr:${pr.number}`,
        title: pr.title,
        subtitle: `#${pr.number} by ${pr.author.login}`,
        badge: pr.isDraft ? "draft" : undefined,
        icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("github-prs")?.icon,
        avatarUrl:
          pr.author.avatarUrl ||
          `https://github.com/${encodeURIComponent(pr.author.login || "github")}.png?size=32`,
        avatarAlt: pr.author.login,
        onClick: () =>
          openPRBuffer(pr.number, {
            title: pr.title,
            authorAvatarUrl: pr.author.avatarUrl ?? undefined,
          }),
      })),
    );

    map.set(
      "github-issues",
      issues.map((issue) => ({
        id: `github-issue:${issue.number}`,
        title: issue.title,
        subtitle: `#${issue.number} by ${issue.author.login}`,
        icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("github-issues")?.icon,
        avatarUrl:
          issue.author.avatarUrl ||
          `https://github.com/${encodeURIComponent(issue.author.login || "github")}.png?size=32`,
        avatarAlt: issue.author.login,
        onClick: () =>
          openGitHubIssueBuffer({
            issueNumber: issue.number,
            repoPath: repoPath ?? undefined,
            title: issue.title,
            authorAvatarUrl: issue.author.avatarUrl ?? undefined,
            url: issue.url,
          }),
      })),
    );

    map.set(
      "github-actions",
      runs.map((run) => {
        const title = run.displayTitle || run.name || run.workflowName || `Run #${run.databaseId}`;
        const runStatus = getWorkflowRunStatus(run);
        return {
          id: `github-action:${run.databaseId}`,
          title,
          subtitle: [
            run.workflowName,
            run.headBranch,
            run.updatedAt && formatRelativeDate(run.updatedAt),
          ]
            .filter(Boolean)
            .join(" · "),
          badge: runStatus.label,
          icon: runStatus.icon,
          onClick: () =>
            openGitHubActionBuffer({
              runId: run.databaseId,
              repoPath: repoPath ?? undefined,
              title,
              url: run.url,
            }),
        };
      }),
    );

    map.set(
      "git-history",
      commits.map((commit) => ({
        id: `git-history:${commit.hash}`,
        title: commit.message,
        subtitle: `${commit.author} · ${formatRelativeDate(commit.date)}`,
        badge: commit.hash.substring(0, 7),
        icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("git-history")?.icon,
        avatarUrl: getGitAuthorAvatarUrl(commit),
        avatarAlt: commit.author,
        onClick: () => {
          void openCommitDiff(commit);
        },
      })),
    );

    map.set(
      "git-changes",
      gitStatus
        ? [
            {
              id: "git-change:working-tree",
              title: "Uncommitted Changes",
              subtitle:
                gitStatus.files.length === 1
                  ? "1 changed file"
                  : `${gitStatus.files.length} changed files`,
              badge: gitStatus.branch,
              icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("git-changes")?.icon,
              trailing: (
                <span className="flex items-center gap-1 font-medium text-[11px] tabular-nums">
                  <span className="text-git-added">+{workingTreeStats.additions}</span>
                  <span className="text-git-deleted">-{workingTreeStats.deletions}</span>
                </span>
              ),
              canFavorite: false,
              onClick: () => {
                void openUncommittedChanges();
              },
            },
          ]
        : [],
    );

    map.set(
      "git-branches",
      gitStatus?.branch && repoPath
        ? [
            {
              id: "git-branch-selector",
              title: gitStatus.branch,
              subtitle: "Branch selector",
              icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("git-branches")?.icon,
              content: (
                <GitBranchManager
                  currentBranch={gitStatus.branch}
                  repoPath={repoPath}
                  onBranchChange={() => {
                    void refreshSidebarData();
                  }}
                  triggerIconSize={14}
                  triggerClassName="h-7 w-full rounded-md px-0 hover:bg-transparent focus-within:bg-transparent"
                  triggerInputClassName="max-w-none truncate text-xs text-text"
                />
              ),
            },
          ]
        : [],
    );

    map.set(
      "git-stashes",
      stashes.map((stash) => ({
        id: `git-stash:${stash.index}`,
        title: getStashDisplayTitle(stash.message),
        subtitle: formatRelativeDate(stash.date),
        badge: `stash@{${stash.index}}`,
        icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("git-stashes")?.icon,
        onClick: () => showGitPane({ type: "view-stashes" }),
      })),
    );

    map.set(
      "git-worktrees",
      repoPath
        ? [
            {
              id: "git-worktree-selector",
              title: getBaseName(repoPath),
              subtitle: "Worktree selector",
              icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("git-worktrees")?.icon,
              content: (
                <GitWorktreeSwitcher
                  repoPath={repoPath}
                  onWorktreeChange={(worktreePath) => {
                    void handleWorktreeChange(worktreePath);
                  }}
                  triggerIconSize={14}
                  triggerClassName="h-7 w-full rounded-md px-0 hover:bg-transparent focus-within:bg-transparent"
                  triggerInputClassName="max-w-none truncate text-xs text-text"
                />
              ),
            },
          ]
        : [],
    );

    map.set(
      "terminals",
      buffers
        .filter((buffer) => buffer.type === "terminal")
        .map((buffer) => {
          const session = terminalSessions.get(buffer.sessionId);
          const title = session?.title?.trim();
          const commandLabel = getCommandLabel(buffer.initialCommand);
          const directoryLabel = getDirectoryLabel(
            session?.currentDirectory ?? buffer.workingDirectory,
          );
          const displayTitle = isUsefulTerminalTitle(title)
            ? title!
            : commandLabel || directoryLabel || buffer.name;

          return {
            id: `terminal:${buffer.sessionId}`,
            title: displayTitle,
            subtitle: session?.currentDirectory ?? buffer.workingDirectory ?? "Terminal",
            icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("terminals")?.icon,
            onClick: () => {
              const bufferId = openTerminalBuffer({
                sessionId: buffer.sessionId,
                name: buffer.name,
                workingDirectory: buffer.workingDirectory,
                remoteConnectionId: buffer.remoteConnectionId,
              });
              setActiveBuffer(bufferId);
            },
          };
        }),
    );

    map.set(
      "browser-tabs",
      buffers
        .filter((buffer) => buffer.type === "webViewer")
        .map((buffer) => ({
          id: `browser-tab:${buffer.id}`,
          title: buffer.title || buffer.name,
          subtitle: buffer.url,
          icon: <GlobeHemisphereWest weight="duotone" />,
          avatarUrl: getWebViewerFavicon(buffer.url, buffer.favicon),
          avatarShape: "square" as const,
          onClick: () => {
            const bufferId = openWebViewerBuffer(buffer.url);
            setActiveBuffer(bufferId);
          },
        })),
    );

    return map;
  }, [
    buffers,
    commits,
    gitStatus,
    handleWorktreeChange,
    issues,
    openCommitDiff,
    openUncommittedChanges,
    openGitHubActionBuffer,
    openGitHubIssueBuffer,
    openPRBuffer,
    openTerminalBuffer,
    openWebViewerBuffer,
    refreshSidebarData,
    repoPath,
    runs,
    setActiveBuffer,
    showGitPane,
    stashes,
    terminalSessions,
    workingTreeStats.additions,
    workingTreeStats.deletions,
  ]);

  const itemsById = useMemo(() => {
    const map = new Map<string, SidebarBuilderItem>();
    for (const items of widgetItems.values()) {
      for (const item of items) {
        map.set(item.id, item);
      }
    }
    return map;
  }, [widgetItems]);

  const favoriteItems = favoriteItemIds
    .map((itemId) => itemsById.get(itemId))
    .filter((item): item is SidebarBuilderItem => item !== undefined && item.canFavorite !== false);

  const directItems = widgets
    .filter((widget) => DIRECT_WIDGET_TYPES.has(widget.type))
    .flatMap((widget) =>
      (widgetItems.get(widget.type) ?? []).map((item) => ({
        item,
        sourceWidgetType: widget.type,
      })),
    );
  const folderWidgets = widgets.filter((widget) => !DIRECT_WIDGET_TYPES.has(widget.type));

  const handleItemContextMenu = useCallback(
    (
      event: MouseEvent,
      item: SidebarBuilderItem,
      isFavorite: boolean,
      sourceWidgetType?: SidebarBuilderWidgetType,
    ) => {
      itemContextMenu.open(event, { item, isFavorite, sourceWidgetType });
    },
    [itemContextMenu],
  );

  const itemContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const data = itemContextMenu.data;
    if (!data) return [];

    return [
      {
        id: "open",
        label: "Open",
        onClick: () => data.item.onClick?.(),
        disabled: !data.item.onClick,
      },
      ...(data.item.canFavorite === false
        ? []
        : [
            {
              id: "favorite",
              label: data.isFavorite ? "Remove Favorite" : "Favorite",
              icon: <Star weight={data.isFavorite ? "fill" : "regular"} />,
              onClick: () => builderActions.toggleFavoriteItem(data.item.id),
            } satisfies ContextMenuItem,
          ]),
      ...(data.sourceWidgetType
        ? [
            {
              id: "remove-source",
              label: "Remove from Sidebar",
              icon: <X />,
              onClick: () => {
                const widget = widgets.find((entry) => entry.type === data.sourceWidgetType);
                if (widget) {
                  builderActions.removeWidget(widget.id);
                }
              },
            } satisfies ContextMenuItem,
          ]
        : []),
      { id: "sep-copy", label: "", separator: true, onClick: () => {} },
      {
        id: "copy-title",
        label: "Copy Title",
        icon: <Copy />,
        onClick: () => {
          void navigator.clipboard?.writeText(data.item.title);
        },
      },
      ...(data.item.subtitle
        ? [
            {
              id: "copy-subtitle",
              label: "Copy Detail",
              icon: <Copy />,
              onClick: () => {
                void navigator.clipboard?.writeText(data.item.subtitle ?? "");
              },
            } satisfies ContextMenuItem,
          ]
        : []),
    ];
  }, [builderActions, itemContextMenu.data, widgets]);

  const sectionContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const widget = sectionContextMenu.data;
    if (!widget) return [];

    const definition = SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get(widget.type);
    const countItems: ContextMenuItem[] = [3, 5, 10, 20].map((count) => ({
      id: `show-${count}`,
      label: widget.itemLimit === count ? `Show ${count} Items` : `Show ${count}`,
      onClick: () => builderActions.updateWidgetLimit(widget.id, count),
    }));

    const creationItems: ContextMenuItem[] =
      widget.type === "terminals"
        ? [
            {
              id: "new-terminal",
              label: "New Terminal",
              icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("terminals")?.icon,
              onClick: () => openTerminalBuffer({ workingDirectory: repoPath ?? undefined }),
            },
            { id: "sep-terminal", label: "", separator: true, onClick: () => {} },
          ]
        : widget.type === "browser-tabs"
          ? [
              {
                id: "new-browser-tab",
                label: "New Browser Tab",
                icon: SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE.get("browser-tabs")?.icon,
                onClick: () => openWebViewerBuffer(`about:blank#tab-${Date.now()}`),
              },
              { id: "sep-browser", label: "", separator: true, onClick: () => {} },
            ]
          : [];

    return [
      ...creationItems,
      {
        id: "toggle",
        label: widget.isOpen ? "Collapse" : "Expand",
        onClick: () => builderActions.toggleWidget(widget.id),
      },
      ...countItems,
      { id: "sep-remove", label: "", separator: true, onClick: () => {} },
      {
        id: "remove",
        label: `Remove ${definition?.label ?? "Section"}`,
        icon: <X />,
        onClick: () => builderActions.removeWidget(widget.id),
      },
    ];
  }, [builderActions, openTerminalBuffer, openWebViewerBuffer, repoPath, sectionContextMenu.data]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <div className="flex h-7 shrink-0 items-center justify-end px-1.5">
        <Button
          type="button"
          variant="ghost"
          tooltip="Add"
          onClick={toggleAddPicker}
          className="text-text-lighter/70 hover:text-text"
          compact
        >
          <Plus />
        </Button>
      </div>
      {isAddPickerOpen ? (
        <AddWidgetPicker
          query={addPickerQuery}
          selectedIndex={addPickerSelectedIndex}
          activeWidgetTypes={activeWidgetTypes}
          onQueryChange={setAddPickerQuery}
          onSelectedIndexChange={setAddPickerSelectedIndex}
          onSelect={selectWidgetType}
          onClose={() => setIsAddPickerOpen(false)}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {favoriteItems.length > 0 ? (
          <section className="px-1 py-1">
            <button
              type="button"
              className="flex h-7 w-full items-center gap-1.5 px-1 text-left font-medium text-text-lighter text-[11px] uppercase"
              onClick={() => setFavoritesOpen((isOpen) => !isOpen)}
            >
              <CaretDown
                className={cn("size-3.5 transition-transform", !favoritesOpen && "-rotate-90")}
                weight="bold"
              />
              Favorites
            </button>
            {favoritesOpen
              ? favoriteItems.map((item) => (
                  <WidgetRow
                    key={item.id}
                    item={item}
                    isFavorite
                    onToggleFavorite={() => builderActions.toggleFavoriteItem(item.id)}
                    onContextMenu={handleItemContextMenu}
                  />
                ))
              : null}
          </section>
        ) : null}

        {directItems.length > 0 ? (
          <section className="px-1 py-1">
            {directItems.map(({ item, sourceWidgetType }) => (
              <WidgetRow
                key={`${sourceWidgetType}:${item.id}`}
                item={item}
                isFavorite={favoriteItemIds.includes(item.id)}
                onToggleFavorite={() => builderActions.toggleFavoriteItem(item.id)}
                onContextMenu={handleItemContextMenu}
                sourceWidgetType={sourceWidgetType}
              />
            ))}
          </section>
        ) : null}

        {widgets.length === 0 ? (
          <div className="h-full" />
        ) : (
          folderWidgets.map((widget) => (
            <WidgetSection
              key={widget.id}
              widget={widget}
              items={widgetItems.get(widget.type) ?? []}
              favoriteItemIds={favoriteItemIds}
              onToggle={() => builderActions.toggleWidget(widget.id)}
              onToggleFavorite={builderActions.toggleFavoriteItem}
              onItemContextMenu={handleItemContextMenu}
              onSectionContextMenu={sectionContextMenu.open}
            />
          ))
        )}
      </div>

      <ContextMenu
        isOpen={itemContextMenu.isOpen}
        position={itemContextMenu.position}
        items={itemContextMenuItems}
        onClose={itemContextMenu.close}
      />
      <ContextMenu
        isOpen={sectionContextMenu.isOpen}
        position={sectionContextMenu.position}
        items={sectionContextMenuItems}
        onClose={sectionContextMenu.close}
      />
    </div>
  );
}
