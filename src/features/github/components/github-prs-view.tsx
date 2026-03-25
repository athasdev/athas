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
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { isNotGitRepositoryError, resolveRepositoryPath } from "@/features/git/api/git-repo-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import Badge from "@/ui/badge";
import { Button, buttonVariants } from "@/ui/button";
import { Dropdown, dropdownItemClassName, dropdownTriggerClassName } from "@/ui/dropdown";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { getFolderName } from "@/utils/path-helpers";
import { useGitHubStore } from "../stores/github-store";
import type { PRFilter, PullRequest } from "../types/github";

const filterLabels: Record<PRFilter, string> = {
  all: "All PRs",
  "my-prs": "My PRs",
  "review-requests": "Review Requests",
};

const prIconButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "rounded-md text-text-lighter",
);

const prLinkButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "xs" }),
  "h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80",
);

const repoOptionButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "sm" }),
  "h-auto w-full justify-start rounded-lg px-2 py-1.5 text-left",
);

interface PRListItemProps {
  pr: PullRequest;
  onSelect: () => void;
  onOpenExternal: () => void;
  onCheckout: () => void;
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
              <span className="ui-text-sm rounded-md border border-border bg-secondary-bg/70 px-1.5 py-0.5 font-mono text-text-lighter">
                #{pr.number}
              </span>
              <span className={cn("ui-text-sm rounded-md px-1.5 py-0.5", stateClass)}>
                {stateLabel}
              </span>
              {pr.isDraft && (
                <span className="ui-text-sm rounded-md bg-text-lighter/20 px-1.5 py-0.5 text-text-lighter">
                  Draft
                </span>
              )}
              {pr.reviewDecision && (
                <span
                  className={cn(
                    "ui-text-sm rounded-md px-1.5 py-0.5",
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

            <Button
              onClick={onSelect}
              variant="ghost"
              size="sm"
              className="ui-text-sm block h-auto w-full justify-start p-0 text-left text-text leading-4 hover:bg-transparent hover:text-accent"
            >
              {pr.title}
            </Button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip content="Checkout PR branch" side="bottom">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onCheckout();
                }}
                variant="ghost"
                size="icon-sm"
                className="rounded-md text-text-lighter"
                aria-label="Checkout PR branch"
              >
                <GitBranch />
              </Button>
            </Tooltip>
            <Tooltip content="Open pull request on GitHub" side="bottom">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenExternal();
                }}
                variant="ghost"
                size="icon-sm"
                className="rounded-md text-text-lighter"
                aria-label="Open pull request in browser"
              >
                <ExternalLink />
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="ui-text-sm flex flex-wrap items-center gap-x-2 gap-y-1 text-text-lighter">
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
            <GitBranch />
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
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const repoTriggerRef = useRef<HTMLButtonElement>(null);

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
    <Button
      key={repoPath}
      onClick={onClick}
      className={cn(
        repoOptionButtonClass,
        "group items-start gap-1.5",
        isActive ? "bg-hover text-text" : "text-text-lighter",
      )}
    >
      <Check
        className={cn("mt-0.5 shrink-0", isActive ? "text-success opacity-100" : "opacity-0")}
      />
      <div className="min-w-0 flex-1">
        <div className="ui-text-sm truncate text-text">{label}</div>
        <div className="ui-text-sm truncate text-text-lighter">{subtitle}</div>
      </div>
    </Button>
  );

  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className="flex items-center justify-between px-0.5 py-0.5">
          <span className="ui-text-sm font-medium text-text">Pull Requests</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-border/60 bg-secondary-bg/60 p-4 text-center">
          <AlertCircle className="mb-2 text-text-lighter" />
          <p className="ui-text-sm text-text">GitHub CLI not authenticated</p>
          <p className="ui-text-sm mt-1 text-text-lighter">
            Run <code className="rounded bg-hover px-1 py-0.5">gh auth login</code> in terminal
          </p>
          <Button
            onClick={() => void checkAuth()}
            variant="ghost"
            size="xs"
            className="mt-2 h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
            aria-label="Retry authentication check"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-font flex h-full select-none flex-col gap-2 p-2">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5 py-0.5">
        <div>
          <Tooltip content="Filter pull requests" side="bottom">
            <Button
              ref={filterTriggerRef}
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              variant="ghost"
              size="sm"
              className={dropdownTriggerClassName()}
            >
              <GitPullRequest className="shrink-0" />
              <span className="truncate">{filterLabels[currentFilter]}</span>
              <ChevronDown />
            </Button>
          </Tooltip>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <div>
            <Tooltip content={activeRepoPath ?? "Select repository"} side="bottom">
              <Button
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
                variant="ghost"
                size="sm"
                className={dropdownTriggerClassName("max-w-44")}
              >
                <FolderOpen className="shrink-0" />
                <span className="truncate">
                  {activeRepoPath ? getFolderName(activeRepoPath) : "Select Repo"}
                </span>
                <ChevronDown />
              </Button>
            </Tooltip>
          </div>

          <Tooltip content="Refresh pull requests" side="bottom">
            <Button
              onClick={handleRefresh}
              disabled={isLoading || !activeRepoPath}
              variant="ghost"
              size="icon-sm"
              className="rounded-lg text-text-lighter"
              aria-label="Refresh pull requests"
            >
              <RefreshCw className={isLoading ? "animate-spin" : ""} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <Dropdown
        isOpen={isFilterOpen}
        anchorRef={filterTriggerRef}
        onClose={() => setIsFilterOpen(false)}
        className="min-w-40"
      >
        {(Object.keys(filterLabels) as PRFilter[]).map((filter) => (
          <Button
            key={filter}
            onClick={() => handleFilterChange(filter)}
            variant="ghost"
            size="sm"
            className={cn(
              dropdownItemClassName(),
              filter === currentFilter && "bg-selected text-accent",
            )}
          >
            {filterLabels[filter]}
          </Button>
        ))}
      </Dropdown>

      <Dropdown
        isOpen={isRepoMenuOpen}
        anchorRef={repoTriggerRef}
        anchorAlign="end"
        onClose={() => setIsRepoMenuOpen(false)}
        className="flex w-[288px] flex-col overflow-hidden rounded-2xl p-0"
      >
        <div className="flex items-center justify-between bg-secondary-bg/75 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <FolderOpen className="shrink-0 text-text-lighter" />
            <span className="ui-text-sm truncate font-medium text-text">
              {activeRepoPath ? getFolderName(activeRepoPath) : "Repositories"}
            </span>
            <Badge
              shape="pill"
              className="ui-text-sm border-0 bg-selected px-1.5 text-text-lighter"
            >
              {workspaceRepoPaths.length + (manualRepoPath ? 1 : 0)}
            </Badge>
          </div>
          <Button
            onClick={() => setIsRepoMenuOpen(false)}
            variant="ghost"
            size="icon-sm"
            className="rounded-md text-text-lighter"
            aria-label="Close repository dropdown"
          >
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="ui-text-sm mb-1 flex items-center justify-between px-1 text-text-lighter">
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
            <div className="ui-text-sm px-2 py-2 text-text-lighter">
              No repositories found in this workspace.
            </div>
          )}

          {isResolvingWorkspaceRepo && (
            <div className="ui-text-sm flex items-center gap-1.5 px-2 py-2 text-text-lighter">
              <RefreshCw className="animate-spin" />
              Detecting workspace repositories...
            </div>
          )}

          <div className="mt-1 border-border/60 border-t pt-2">
            <Button
              onClick={() => void handleSelectRepository()}
              disabled={isSelectingRepo}
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg px-2 text-left text-text"
            >
              <FolderOpen />
              {isSelectingRepo ? "Selecting..." : "Browse Repository..."}
            </Button>

            {manualRepoPath && (
              <Button
                onClick={() => void handleUseWorkspaceRoot()}
                variant="ghost"
                size="xs"
                className="ui-text-sm mt-1 h-auto w-full justify-start rounded-lg px-2 py-1 text-left text-text-lighter"
              >
                Use workspace repositories
              </Button>
            )}

            {repoSelectionError && (
              <div className="ui-text-sm mt-1 rounded-lg border border-error/30 bg-error/5 px-2 py-1 text-error/90">
                {repoSelectionError}
              </div>
            )}
          </div>
        </div>
      </Dropdown>

      {/* Content */}
      <div className="scrollbar-hidden flex-1 overflow-y-auto">
        {!activeRepoPath ? (
          <div className="flex h-full items-center justify-center">
            <div className="ui-font flex flex-col items-center text-center">
              <span className="ui-text-sm text-text-lighter">No repository selected</span>
              <Button
                onClick={() => void handleSelectRepository()}
                variant="ghost"
                size="xs"
                className="ui-text-sm mt-1.5 h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
              >
                Browse Repository
              </Button>
            </div>
          </div>
        ) : error ? (
          <div className="mx-auto flex max-w-80 flex-col items-center justify-center rounded-xl border border-error/30 bg-error/5 p-4 text-center">
            <AlertCircle className="mb-2 text-error" />
            {isRepoError ? (
              <>
                <p className="ui-text-sm text-error">Repository is not a Git repository</p>
                <p className="ui-text-sm mt-1 text-text-lighter">
                  Select another folder that contains a `.git` repository.
                </p>
                <Button
                  onClick={() => void handleSelectRepository()}
                  variant="outline"
                  size="sm"
                  className="mt-2 rounded-lg"
                >
                  Browse Repository
                </Button>
              </>
            ) : (
              <>
                <p className="ui-text-sm text-error">{error}</p>
                <Button
                  onClick={handleRefresh}
                  variant="ghost"
                  size="xs"
                  className="mt-2 h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
                >
                  Try again
                </Button>
              </>
            )}
            {repoSelectionError && (
              <p className="ui-text-sm mt-2 text-error/80">{repoSelectionError}</p>
            )}
          </div>
        ) : isLoading && prs.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <RefreshCw className="animate-spin text-text-lighter" />
          </div>
        ) : prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <GitPullRequest className="mb-2 text-text-lighter" />
            <p className="ui-text-sm text-text-lighter">No pull requests</p>
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
