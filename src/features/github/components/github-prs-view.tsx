import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { isNotGitRepositoryError, resolveRepositoryPath } from "@/features/git/api/repo";
import { useRepositoryStore } from "@/features/git/stores/repository-store";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { getFolderName } from "@/utils/path-helpers";
import { useGitHubStore } from "../store";
import type { PRFilter, PullRequest } from "../types";

const filterLabels: Record<PRFilter, string> = {
  all: "All PRs",
  "my-prs": "My PRs",
  "review-requests": "Review Requests",
};

interface PRListItemProps {
  pr: PullRequest;
  onSelect: () => void;
  onOpenExternal: () => void;
  onCheckout: () => void;
}

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
}

const PRListItem = memo(({ pr, onSelect, onOpenExternal, onCheckout }: PRListItemProps) => {
  const createdAgo = getTimeAgo(pr.createdAt);
  const updatedAgo = getTimeAgo(pr.updatedAt);
  const stateLabel = pr.state === "MERGED" ? "Merged" : pr.state === "CLOSED" ? "Closed" : "Open";
  const stateClass =
    pr.state === "MERGED"
      ? "bg-blue-500/15 text-blue-500"
      : pr.state === "CLOSED"
        ? "bg-red-500/15 text-red-500"
        : "bg-green-500/15 text-green-500";

  return (
    <div className="group rounded-xl border border-border/60 bg-primary-bg/80 p-3 transition-colors hover:bg-hover">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-border bg-secondary-bg/70 px-1.5 py-0.5 font-mono text-[10px] text-text-lighter">
                #{pr.number}
              </span>
              <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]", stateClass)}>
                {stateLabel}
              </span>
              {pr.isDraft && (
                <span className="rounded-md bg-text-lighter/20 px-1.5 py-0.5 text-[10px] text-text-lighter">
                  Draft
                </span>
              )}
              {pr.reviewDecision && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px]",
                    pr.reviewDecision === "APPROVED"
                      ? "bg-green-500/20 text-green-500"
                      : pr.reviewDecision === "CHANGES_REQUESTED"
                        ? "bg-red-500/20 text-red-500"
                        : "bg-yellow-500/20 text-yellow-500",
                  )}
                >
                  {pr.reviewDecision === "APPROVED"
                    ? "Approved"
                    : pr.reviewDecision === "CHANGES_REQUESTED"
                      ? "Changes Requested"
                      : "Review"}
                </span>
              )}
            </div>

            <button
              onClick={onSelect}
              className="block w-full text-left text-text text-xs leading-4 transition-colors hover:text-accent"
            >
              {pr.title}
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip content="Checkout PR branch" side="bottom">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCheckout();
                }}
                className="rounded-md border border-transparent p-1 text-text-lighter hover:border-border/60 hover:bg-selected hover:text-text"
                aria-label="Checkout PR branch"
              >
                <GitBranch size={12} />
              </button>
            </Tooltip>
            <Tooltip content="Open pull request on GitHub" side="bottom">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenExternal();
                }}
                className="rounded-md border border-transparent p-1 text-text-lighter hover:border-border/60 hover:bg-selected hover:text-text"
                aria-label="Open pull request in browser"
              >
                <ExternalLink size={12} />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-lighter">
          <span className="font-medium text-text-light">@{pr.author.login}</span>
          <span>created {createdAgo}</span>
          <span>updated {updatedAgo}</span>
          <span className="rounded bg-git-added/15 px-1.5 py-0.5 text-git-added">
            +{pr.additions}
          </span>
          <span className="rounded bg-git-deleted/15 px-1.5 py-0.5 text-git-deleted">
            -{pr.deletions}
          </span>
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border/60 bg-secondary-bg/55 px-1.5 py-0.5">
            <GitBranch size={10} />
            <span className="truncate">
              {pr.headRef} → {pr.baseRef}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
});

PRListItem.displayName = "PRListItem";

const GitHubPRsView = memo(() => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const { prs, isLoading, error, currentFilter, isAuthenticated } = useGitHubStore();
  const { fetchPRs, setFilter, checkAuth, openPRInBrowser, checkoutPR, setActiveRepoPath } =
    useGitHubStore().actions;
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const workspaceRepoPaths = useRepositoryStore.use.workspaceRepoPaths();
  const manualRepoPath = useRepositoryStore.use.manualRepoPath();
  const isResolvingWorkspaceRepo = useRepositoryStore.use.isDiscovering();
  const {
    syncWorkspaceRepositories,
    selectRepository,
    setManualRepository,
    clearManualRepository,
    refreshWorkspaceRepositories,
  } = useRepositoryStore.use.actions();
  const { openPRBuffer } = useBufferStore.use.actions();

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isRepoMenuOpen, setIsRepoMenuOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [filterMenuPosition, setFilterMenuPosition] = useState<DropdownPosition | null>(null);
  const [repoMenuPosition, setRepoMenuPosition] = useState<DropdownPosition | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const repoTriggerRef = useRef<HTMLButtonElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const repoMenuRef = useRef<HTMLDivElement>(null);

  const isRepoError = !!error && isNotGitRepositoryError(error);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    void syncWorkspaceRepositories(rootFolderPath ?? null);
  }, [rootFolderPath, syncWorkspaceRepositories]);

  useEffect(() => {
    setRepoSelectionError(null);
    setIsRepoMenuOpen(false);
  }, [rootFolderPath]);

  useEffect(() => {
    setActiveRepoPath(activeRepoPath);
  }, [activeRepoPath, setActiveRepoPath]);

  useEffect(() => {
    if (activeRepoPath && isAuthenticated) {
      fetchPRs(activeRepoPath);
    }
  }, [activeRepoPath, isAuthenticated, currentFilter, fetchPRs]);

  const updateDropdownPosition = useCallback(
    (
      trigger: HTMLButtonElement | null,
      menuWidth: number,
      align: "left" | "right",
      setter: (value: DropdownPosition) => void,
    ) => {
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const safeWidth = Math.min(menuWidth, window.innerWidth - viewportPadding * 2);
      const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
      const availableAbove = rect.top - viewportPadding;
      const shouldOpenUp = availableBelow < 160 && availableAbove > availableBelow;
      const top = shouldOpenUp
        ? Math.max(viewportPadding, rect.top - 8)
        : Math.max(viewportPadding, rect.bottom + 6);
      const leftCandidate = align === "right" ? rect.right - safeWidth : rect.left;
      const left = Math.max(
        viewportPadding,
        Math.min(leftCandidate, window.innerWidth - safeWidth - viewportPadding),
      );

      setter({ left, top, width: safeWidth });
    },
    [],
  );

  useEffect(() => {
    if (!isFilterOpen && !isRepoMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        isFilterOpen &&
        !filterMenuRef.current?.contains(target) &&
        !filterTriggerRef.current?.contains(target as Node)
      ) {
        setIsFilterOpen(false);
      }
      if (
        isRepoMenuOpen &&
        !repoMenuRef.current?.contains(target) &&
        !repoTriggerRef.current?.contains(target as Node)
      ) {
        setIsRepoMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFilterOpen(false);
        setIsRepoMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isFilterOpen, isRepoMenuOpen]);

  useLayoutEffect(() => {
    if (!isFilterOpen) return;

    const handleReposition = () => {
      updateDropdownPosition(filterTriggerRef.current, 180, "left", setFilterMenuPosition);
    };

    handleReposition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isFilterOpen, updateDropdownPosition]);

  useLayoutEffect(() => {
    if (!isRepoMenuOpen) return;

    const handleReposition = () => {
      updateDropdownPosition(repoTriggerRef.current, 288, "right", setRepoMenuPosition);
    };

    handleReposition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isRepoMenuOpen, updateDropdownPosition]);

  const handleRefresh = useCallback(() => {
    if (activeRepoPath) {
      void fetchPRs(activeRepoPath, { force: true });
    }
  }, [activeRepoPath, fetchPRs]);

  const handleSelectRepository = useCallback(async () => {
    setIsSelectingRepo(true);
    setRepoSelectionError(null);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;

      const resolvedRepoPath = await resolveRepositoryPath(selected);
      if (!resolvedRepoPath) {
        setRepoSelectionError("Selected folder is not inside a Git repository.");
        return;
      }

      setManualRepository(resolvedRepoPath);
      setIsRepoMenuOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRepoSelectionError(message);
    } finally {
      setIsSelectingRepo(false);
    }
  }, [setManualRepository]);

  const handleUseWorkspaceRoot = useCallback(() => {
    clearManualRepository();
    setRepoSelectionError(null);
    setIsRepoMenuOpen(false);
  }, [clearManualRepository]);

  const handleFilterChange = useCallback(
    (filter: PRFilter) => {
      setFilter(filter);
      setIsFilterOpen(false);
    },
    [setFilter],
  );

  const handleSelectPR = useCallback(
    (prNumber: number) => {
      openPRBuffer(prNumber);
    },
    [openPRBuffer],
  );

  const handleOpenPR = useCallback(
    (prNumber: number) => {
      if (activeRepoPath) {
        openPRInBrowser(activeRepoPath, prNumber);
      }
    },
    [activeRepoPath, openPRInBrowser],
  );

  const handleCheckoutPR = useCallback(
    async (prNumber: number) => {
      if (activeRepoPath) {
        try {
          await checkoutPR(activeRepoPath, prNumber);
        } catch (err) {
          console.error("Failed to checkout PR:", err);
        }
      }
    },
    [activeRepoPath, checkoutPR],
  );

  const getWorkspaceRepoSubtitle = useCallback(
    (path: string) => {
      if (!rootFolderPath) return "Workspace repository";
      if (path === rootFolderPath) return "Workspace root repository";
      return "Workspace repository";
    },
    [rootFolderPath],
  );

  const renderRepoOption = (
    repoPath: string,
    label: string,
    subtitle: string,
    isActive: boolean,
    onClick: () => void,
  ) => (
    <button
      key={repoPath}
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover",
        isActive ? "bg-hover text-text" : "text-text-lighter",
      )}
    >
      <Check
        size={10}
        className={cn("mt-0.5 shrink-0", isActive ? "text-success opacity-100" : "opacity-0")}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-text text-xs">{label}</div>
        <div className="truncate text-[10px] text-text-lighter">{subtitle}</div>
      </div>
    </button>
  );

  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className="flex items-center justify-between px-0.5 py-0.5">
          <span className="font-medium text-text text-xs">Pull Requests</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-border/60 bg-secondary-bg/60 p-4 text-center">
          <AlertCircle size={24} className="mb-2 text-text-lighter" />
          <p className="text-text text-xs">GitHub CLI not authenticated</p>
          <p className="mt-1 text-[10px] text-text-lighter">Run `gh auth login` in terminal</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5 py-0.5">
        <div>
          <Tooltip content="Filter pull requests" side="bottom">
            <button
              ref={filterTriggerRef}
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={cn(
                "flex h-5 items-center gap-1 rounded-full px-1.5 py-0.5",
                "text-text-lighter text-xs transition-colors hover:bg-hover hover:text-text",
              )}
            >
              <GitPullRequest size={11} />
              {filterLabels[currentFilter]}
              <ChevronDown size={8} />
            </button>
          </Tooltip>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <div>
            <Tooltip content={activeRepoPath ?? "Select repository"} side="bottom">
              <button
                ref={repoTriggerRef}
                onClick={() =>
                  setIsRepoMenuOpen((value) => {
                    const nextOpen = !value;
                    if (nextOpen) {
                      void refreshWorkspaceRepositories();
                    }
                    return nextOpen;
                  })
                }
                className={cn(
                  "flex h-5 max-w-44 items-center gap-1 rounded-full px-1.5 py-0.5",
                  "text-text-lighter text-xs transition-colors hover:bg-hover hover:text-text",
                )}
              >
                <FolderOpen size={11} />
                <span className="truncate">
                  {activeRepoPath ? getFolderName(activeRepoPath) : "Select Repo"}
                </span>
                <ChevronDown size={8} />
              </button>
            </Tooltip>
          </div>

          <Tooltip content="Refresh pull requests" side="bottom">
            <button
              onClick={handleRefresh}
              disabled={isLoading || !activeRepoPath}
              className="rounded-lg border border-transparent p-1 text-text-lighter hover:border-border/60 hover:bg-hover hover:text-text disabled:opacity-50"
              aria-label="Refresh pull requests"
            >
              <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            </button>
          </Tooltip>
        </div>
      </div>

      {isFilterOpen &&
        filterMenuPosition &&
        createPortal(
          <div
            ref={filterMenuRef}
            className="fixed z-[10040] min-w-40 rounded-xl border border-border bg-primary-bg p-1"
            style={{
              left: `${filterMenuPosition.left}px`,
              top: `${filterMenuPosition.top}px`,
              width: `${filterMenuPosition.width}px`,
            }}
          >
            {(Object.keys(filterLabels) as PRFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => handleFilterChange(filter)}
                className={cn(
                  "block w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-hover",
                  filter === currentFilter ? "bg-selected text-accent" : "text-text",
                )}
              >
                {filterLabels[filter]}
              </button>
            ))}
          </div>,
          document.body,
        )}

      {isRepoMenuOpen &&
        repoMenuPosition &&
        createPortal(
          <div
            ref={repoMenuRef}
            className="fixed z-[10040] flex flex-col overflow-hidden rounded-2xl border border-border bg-primary-bg/95 backdrop-blur-sm"
            style={{
              left: `${repoMenuPosition.left}px`,
              top: `${repoMenuPosition.top}px`,
              width: `${repoMenuPosition.width}px`,
            }}
          >
            <div className="flex items-center justify-between bg-secondary-bg/75 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <FolderOpen size={12} className="shrink-0 text-text-lighter" />
                <span className="truncate font-medium text-text text-xs">
                  {activeRepoPath ? getFolderName(activeRepoPath) : "Repositories"}
                </span>
                <span className="rounded-full bg-selected px-1.5 py-0.5 text-[9px] text-text-lighter">
                  {workspaceRepoPaths.length + (manualRepoPath ? 1 : 0)}
                </span>
              </div>
              <button
                onClick={() => setIsRepoMenuOpen(false)}
                className="rounded-md p-1 text-text-lighter hover:bg-hover hover:text-text"
                aria-label="Close repository dropdown"
              >
                <X size={12} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-text-lighter uppercase tracking-wide">
                <span>Repositories</span>
                <span>{workspaceRepoPaths.length + (manualRepoPath ? 1 : 0)}</span>
              </div>

              <div className="space-y-1">
                {workspaceRepoPaths.map((workspaceRepoPath) =>
                  renderRepoOption(
                    workspaceRepoPath,
                    getFolderName(workspaceRepoPath),
                    getWorkspaceRepoSubtitle(workspaceRepoPath),
                    activeRepoPath === workspaceRepoPath,
                    () => {
                      selectRepository(workspaceRepoPath);
                      setRepoSelectionError(null);
                      setIsRepoMenuOpen(false);
                    },
                  ),
                )}

                {manualRepoPath &&
                  !workspaceRepoPaths.includes(manualRepoPath) &&
                  renderRepoOption(
                    manualRepoPath,
                    getFolderName(manualRepoPath),
                    "Manual selection",
                    activeRepoPath === manualRepoPath,
                    () => {
                      selectRepository(manualRepoPath);
                      setRepoSelectionError(null);
                      setIsRepoMenuOpen(false);
                    },
                  )}
              </div>

              {rootFolderPath && workspaceRepoPaths.length === 0 && !isResolvingWorkspaceRepo && (
                <div className="px-2 py-2 text-[10px] text-text-lighter">
                  No repositories found in this workspace.
                </div>
              )}

              {isResolvingWorkspaceRepo && (
                <div className="flex items-center gap-1.5 px-2 py-2 text-[10px] text-text-lighter">
                  <RefreshCw size={10} className="animate-spin" />
                  Detecting workspace repositories...
                </div>
              )}

              <div className="mt-1 border-border/60 border-t pt-2">
                <button
                  onClick={() => void handleSelectRepository()}
                  disabled={isSelectingRepo}
                  className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5 text-left text-text text-xs hover:bg-hover disabled:opacity-60"
                >
                  <FolderOpen size={12} />
                  {isSelectingRepo ? "Selecting..." : "Browse Repository..."}
                </button>

                {manualRepoPath && (
                  <button
                    onClick={() => void handleUseWorkspaceRoot()}
                    className="mt-1 w-full rounded-lg px-2 py-1 text-left text-[10px] text-text-lighter hover:bg-hover hover:text-text"
                  >
                    Use workspace repositories
                  </button>
                )}

                {repoSelectionError && (
                  <div className="mt-1 rounded-lg border border-error/30 bg-error/5 px-2 py-1 text-[10px] text-error/90">
                    {repoSelectionError}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Content */}
      <div className="scrollbar-hidden flex-1 overflow-y-auto rounded-xl border border-border/60 bg-secondary-bg/60 p-2">
        {!activeRepoPath ? (
          <div className="mx-auto flex max-w-72 flex-col items-center justify-center rounded-xl border border-border/60 bg-primary-bg/65 p-4 text-center">
            <FolderOpen size={20} className="mb-2 text-text-lighter" />
            <p className="text-text text-xs">No repository selected</p>
            <button
              onClick={() => void handleSelectRepository()}
              className="mt-2 rounded-lg border border-border/60 bg-secondary-bg/80 px-3 py-1 text-text text-xs hover:bg-hover"
            >
              Browse Repository
            </button>
            {workspaceRepoPaths.length === 0 && rootFolderPath && (
              <p className="mt-2 text-[10px] text-text-lighter">
                No repositories were detected under the current workspace.
              </p>
            )}
          </div>
        ) : error ? (
          <div className="mx-auto flex max-w-80 flex-col items-center justify-center rounded-xl border border-error/30 bg-error/5 p-4 text-center">
            <AlertCircle size={20} className="mb-2 text-error" />
            {isRepoError ? (
              <>
                <p className="text-error text-xs">Repository is not a Git repository</p>
                <p className="mt-1 text-[10px] text-text-lighter">
                  Select another folder that contains a `.git` repository.
                </p>
                <button
                  onClick={() => void handleSelectRepository()}
                  className="mt-2 rounded-lg border border-border/60 bg-primary-bg px-3 py-1 text-text text-xs hover:bg-hover"
                >
                  Browse Repository
                </button>
              </>
            ) : (
              <>
                <p className="text-error text-xs">{error}</p>
                <button
                  onClick={handleRefresh}
                  className="mt-2 text-accent text-xs hover:underline"
                >
                  Try again
                </button>
              </>
            )}
            {repoSelectionError && (
              <p className="mt-2 text-[10px] text-error/80">{repoSelectionError}</p>
            )}
          </div>
        ) : isLoading && prs.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <RefreshCw size={16} className="animate-spin text-text-lighter" />
          </div>
        ) : prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <GitPullRequest size={20} className="mb-2 text-text-lighter" />
            <p className="text-text-lighter text-xs">No pull requests</p>
          </div>
        ) : (
          <div className="space-y-2">
            {prs.map((pr) => (
              <PRListItem
                key={pr.number}
                pr={pr}
                onSelect={() => handleSelectPR(pr.number)}
                onOpenExternal={() => handleOpenPR(pr.number)}
                onCheckout={() => handleCheckoutPR(pr.number)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

GitHubPRsView.displayName = "GitHubPRsView";

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

export default GitHubPRsView;
