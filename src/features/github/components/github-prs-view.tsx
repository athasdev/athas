import { open } from "@tauri-apps/plugin-dialog";
import { GitHubCliStatusMessage } from "./github-cli-status";
import {
  AlertCircle,
  Activity,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { isNotGitRepositoryError, resolveRepositoryPath } from "@/features/git/api/git-repo-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { useSettingsStore } from "@/features/settings/store";
import { useContextMenu } from "@/hooks/use-context-menu";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button, buttonVariants } from "@/ui/button";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown, dropdownItemClassName, dropdownTriggerClassName } from "@/ui/dropdown";
import { paneHeaderClassName, paneIconButtonClassName } from "@/ui/pane";
import { Tab, TabsList } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { getFolderName } from "@/utils/path-helpers";
import { useGitHubStore } from "../stores/github-store";
import type { PRFilter, PullRequest } from "../types/github";
import GitHubActionsView from "./github-actions-view";
import GitHubIssuesView from "./github-issues-view";
import GitHubSidebarLoadingBar from "./github-sidebar-loading-bar";
import { githubActionListCache, githubIssueListCache } from "../utils/github-data-cache";

const filterLabels: Record<PRFilter, string> = {
  all: "All PRs",
  "my-prs": "My PRs",
  "review-requests": "Review Requests",
};

const repoOptionButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "sm" }),
  "ui-text-sm h-auto w-full justify-start rounded-lg px-2 py-1.5 text-left text-text-lighter",
);

type GitHubSidebarSection = "pull-requests" | "issues" | "actions";

interface PRListItemProps {
  pr: PullRequest;
  isActive: boolean;
  onSelect: () => void;
  onPrefetch: () => void;
  onContextMenu: (event: React.MouseEvent, pr: PullRequest) => void;
}

const PRListItem = memo(
  ({ pr, isActive, onSelect, onPrefetch, onContextMenu }: PRListItemProps) => {
    return (
      <Button
        onClick={onSelect}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        onContextMenu={(event) => onContextMenu(event, pr)}
        variant="ghost"
        size="sm"
        className={cn(
          "h-auto w-full items-start justify-start rounded-xl px-3 py-2.5 text-left hover:bg-hover/70",
          isActive && "bg-hover/80 text-text",
        )}
      >
        <img
          src={
            pr.author.avatarUrl ||
            `https://github.com/${encodeURIComponent(pr.author.login || "github")}.png?size=40`
          }
          alt={pr.author.login}
          className="size-5 shrink-0 self-start rounded-full bg-secondary-bg"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <div className="ui-text-sm truncate text-text leading-4">{pr.title}</div>
          <div className="ui-text-sm mt-1 text-text-lighter">{`#${pr.number} by ${pr.author.login}`}</div>
          <div className="mt-1">
            <span className="ui-text-sm inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary-bg/80 px-1.5 py-0.5 font-mono text-text-lighter">
              <span className="min-w-0 truncate">{pr.baseRef}</span>
              <span className="shrink-0 px-1">&larr;</span>
              <span className="min-w-0 truncate">{pr.headRef}</span>
            </span>
          </div>
        </div>
      </Button>
    );
  },
);

PRListItem.displayName = "PRListItem";

const GitHubPRsView = memo(() => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const { prs, isLoading, error, currentFilter, isAuthenticated } = useGitHubStore();
  const {
    fetchPRs,
    setFilter,
    checkAuth,
    setActiveRepoPath,
    openPRInBrowser,
    checkoutPR,
    prefetchPR,
  } = useGitHubStore().actions;
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
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const { openPRBuffer } = useBufferStore.use.actions();
  const settings = useSettingsStore((state) => state.settings);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const effectiveRepoPath = activeRepoPath ?? rootFolderPath ?? null;

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isRepoMenuOpen, setIsRepoMenuOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<GitHubSidebarSection>("pull-requests");
  const [sectionRefreshNonce, setSectionRefreshNonce] = useState(0);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const repoTriggerRef = useRef<HTMLButtonElement>(null);
  const prContextMenu = useContextMenu<PullRequest>();

  const isRepoError = !!error && isNotGitRepositoryError(error);
  const activePRNumber = useMemo(() => {
    const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
    return activeBuffer?.type === "pullRequest" ? activeBuffer.prNumber : null;
  }, [activeBufferId, buffers]);
  const deferredPrs = useDeferredValue(prs);
  const availableSections = useMemo(
    () =>
      [
        settings.showGitHubPullRequests ? "pull-requests" : null,
        settings.showGitHubIssues ? "issues" : null,
        settings.showGitHubActions ? "actions" : null,
      ].filter((section): section is GitHubSidebarSection => !!section),
    [settings.showGitHubActions, settings.showGitHubIssues, settings.showGitHubPullRequests],
  );

  useEffect(() => {
    if (isGitHubPRsViewActive) {
      const timeoutId = window.setTimeout(() => {
        void checkAuth();
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [checkAuth, isGitHubPRsViewActive]);

  useEffect(() => {
    if (availableSections.length === 0) return;
    if (!availableSections.includes(activeSection)) {
      setActiveSection(availableSections[0]);
    }
  }, [activeSection, availableSections]);

  useEffect(() => {
    setRepoSelectionError(null);
    setIsRepoMenuOpen(false);
  }, [rootFolderPath]);

  useEffect(() => {
    setActiveRepoPath(activeRepoPath);
  }, [activeRepoPath, setActiveRepoPath]);

  useEffect(() => {
    if (isRepoMenuOpen && rootFolderPath) {
      void syncWorkspaceRepositories(rootFolderPath);
    }
  }, [isRepoMenuOpen, rootFolderPath, syncWorkspaceRepositories]);

  useEffect(() => {
    if (!isGitHubPRsViewActive || !effectiveRepoPath || !isAuthenticated) return;

    let timeoutId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        void fetchPRs(effectiveRepoPath);
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [effectiveRepoPath, fetchPRs, isAuthenticated, isGitHubPRsViewActive, currentFilter]);

  useEffect(() => {
    if (!effectiveRepoPath || !isGitHubPRsViewActive || activeSection !== "pull-requests") return;

    for (const pr of prs.slice(0, 3)) {
      void prefetchPR(effectiveRepoPath, pr.number);
    }
  }, [activeSection, effectiveRepoPath, isGitHubPRsViewActive, prefetchPR, prs]);

  const handleRefresh = useCallback(() => {
    if (effectiveRepoPath) {
      void fetchPRs(effectiveRepoPath, { force: true });
    }
  }, [effectiveRepoPath, fetchPRs]);

  const handleRefreshActiveSection = useCallback(() => {
    if (!effectiveRepoPath) return;

    if (activeSection === "issues") {
      githubIssueListCache.clear(effectiveRepoPath);
      setSectionRefreshNonce((value) => value + 1);
      return;
    }

    if (activeSection === "actions") {
      githubActionListCache.clear(effectiveRepoPath);
      setSectionRefreshNonce((value) => value + 1);
      return;
    }

    void fetchPRs(effectiveRepoPath, { force: true });
  }, [activeSection, effectiveRepoPath, fetchPRs]);

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
    (pr: PullRequest) => {
      startTransition(() => {
        openPRBuffer(pr.number, {
          title: pr.title,
          authorAvatarUrl:
            pr.author.avatarUrl ||
            `https://github.com/${encodeURIComponent(pr.author.login || "github")}.png?size=32`,
        });
      });
    },
    [openPRBuffer],
  );

  const handlePRContextMenu = useCallback(
    (event: React.MouseEvent, pr: PullRequest) => {
      prContextMenu.open(event, pr);
    },
    [prContextMenu],
  );

  const selectedPR = prContextMenu.data;

  const prContextMenuItems: ContextMenuItem[] = selectedPR
    ? [
        {
          id: "open-pr",
          label: "Open PR",
          icon: <GitPullRequest />,
          onClick: () => {
            handleSelectPR(selectedPR);
          },
        },
        {
          id: "open-on-github",
          label: "Open on GitHub",
          icon: <ExternalLink />,
          onClick: () => {
            if (effectiveRepoPath) {
              void openPRInBrowser(effectiveRepoPath, selectedPR.number);
            }
          },
        },
        {
          id: "checkout-branch",
          label: "Checkout Branch",
          icon: <GitBranch />,
          onClick: () => {
            if (effectiveRepoPath) {
              void checkoutPR(effectiveRepoPath, selectedPR.number);
            }
          },
        },
        {
          id: "copy-title",
          label: "Copy Title",
          icon: <Copy />,
          onClick: () => {
            void navigator.clipboard.writeText(selectedPR.title);
          },
        },
      ]
    : [];

  const allSectionTabs: Array<{
    id: GitHubSidebarSection;
    label: string;
    icon: typeof GitPullRequest;
  }> = [
    {
      id: "pull-requests",
      label: "Pull Requests",
      icon: GitPullRequest,
    },
    {
      id: "issues",
      label: "Issues",
      icon: MessageSquare,
    },
    {
      id: "actions",
      label: "Actions",
      icon: Activity,
    },
  ];
  const sectionTabs = allSectionTabs.filter((tab) =>
    availableSections.includes(tab.id),
  ) as typeof allSectionTabs;

  const renderRepoOption = (
    repoPath: string,
    label: string,
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
      <span className={cn("min-w-0 flex-1 truncate", isActive ? "text-text" : "text-text-lighter")}>
        {label}
      </span>
    </Button>
  );

  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className="flex items-center justify-between px-0.5 py-0.5">
          <span className="ui-text-sm font-medium text-text">GitHub</span>
        </div>
        <GitHubCliStatusMessage />
      </div>
    );
  }

  return (
    <div className="ui-font flex h-full select-none flex-col gap-2 p-2">
      {availableSections.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center">
          <p className="ui-text-sm text-text-lighter">
            Enable GitHub sidebar sections in Settings → Appearance.
          </p>
        </div>
      ) : (
        <>
          <TabsList
            variant="segmented"
            className={cn(
              "grid h-auto shrink-0 border-border/60 bg-secondary-bg/40",
              sectionTabs.length === 1
                ? "grid-cols-1"
                : sectionTabs.length === 2
                  ? "grid-cols-2"
                  : "grid-cols-3",
            )}
          >
            {sectionTabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeSection === tab.id;

              return (
                <Tab
                  key={tab.id}
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveSection(tab.id)}
                  isActive={isSelected}
                  size="md"
                  variant="segmented"
                  contentLayout="stacked"
                  className="h-auto min-h-12 min-w-0 px-1 py-1.5 whitespace-normal transition-colors"
                >
                  <div className="relative flex items-center justify-center">
                    <Icon strokeWidth={2.2} />
                  </div>
                  <span className="ui-text-sm text-center leading-none">{tab.label}</span>
                </Tab>
              );
            })}
          </TabsList>

          <div className={paneHeaderClassName("justify-between rounded-lg")}>
            <div>
              <Tooltip content="Filter pull requests" side="bottom">
                <Button
                  ref={filterTriggerRef}
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  variant="ghost"
                  size="sm"
                  disabled={activeSection !== "pull-requests"}
                  className={dropdownTriggerClassName("ui-text-sm")}
                >
                  <GitPullRequest className="shrink-0" />
                  <span className="truncate">
                    {activeSection === "pull-requests"
                      ? filterLabels[currentFilter]
                      : activeSection === "issues"
                        ? "Issues"
                        : "Actions"}
                  </span>
                  {activeSection === "pull-requests" ? <ChevronDown /> : null}
                </Button>
              </Tooltip>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <div>
                <Tooltip content={effectiveRepoPath ?? "Select repository"} side="bottom">
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
                    className={dropdownTriggerClassName("ui-text-sm max-w-40")}
                  >
                    <FolderOpen className="shrink-0" />
                    <span className="truncate">
                      {effectiveRepoPath ? getFolderName(effectiveRepoPath) : "Select Repo"}
                    </span>
                    <ChevronDown />
                  </Button>
                </Tooltip>
              </div>

              <Tooltip
                content={
                  activeSection === "pull-requests"
                    ? "Refresh pull requests"
                    : activeSection === "issues"
                      ? "Refresh issues"
                      : "Refresh workflow runs"
                }
                side="bottom"
              >
                <Button
                  onClick={handleRefreshActiveSection}
                  disabled={isLoading || !effectiveRepoPath}
                  variant="ghost"
                  size="icon-sm"
                  className={cn(paneIconButtonClassName(), "size-6", "disabled:opacity-50")}
                  aria-label={
                    activeSection === "pull-requests"
                      ? "Refresh pull requests"
                      : activeSection === "issues"
                        ? "Refresh issues"
                        : "Refresh workflow runs"
                  }
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
                  dropdownItemClassName("justify-start"),
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
            className="w-[240px]"
          >
            <div className="space-y-1">
              {workspaceRepoPaths.map((workspaceRepoPath) =>
                renderRepoOption(
                  workspaceRepoPath,
                  getFolderName(workspaceRepoPath),
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
                  activeRepoPath === manualRepoPath,
                  () => {
                    selectRepository(manualRepoPath);
                    setRepoSelectionError(null);
                    setIsRepoMenuOpen(false);
                  },
                )}

              {rootFolderPath && workspaceRepoPaths.length === 0 && !isResolvingWorkspaceRepo && (
                <div className="ui-text-sm px-2 py-1.5 text-text-lighter">
                  No repositories found in this workspace.
                </div>
              )}

              {isResolvingWorkspaceRepo && (
                <div className="ui-text-sm flex items-center gap-1.5 px-2 py-1.5 text-text-lighter">
                  <RefreshCw className="animate-spin" />
                  Detecting workspace repositories...
                </div>
              )}

              <div className="mt-1 border-border/60 border-t pt-2">
                <Button
                  onClick={() => void handleSelectRepository()}
                  disabled={isSelectingRepo}
                  variant="ghost"
                  size="sm"
                  className="ui-text-sm w-full justify-start rounded-lg px-2 text-left text-text-lighter"
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

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeSection === "pull-requests" && (
              <GitHubSidebarLoadingBar isVisible={isLoading} className="mx-2 mb-1 mt-1" />
            )}
            <div className="scrollbar-hidden min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              {!effectiveRepoPath ? (
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
              ) : activeSection === "issues" ? (
                <GitHubIssuesView refreshNonce={sectionRefreshNonce} />
              ) : activeSection === "actions" ? (
                <GitHubActionsView refreshNonce={sectionRefreshNonce} />
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
              ) : isLoading && deferredPrs.length === 0 ? (
                <div className="flex items-center justify-center p-4">
                  <RefreshCw className="animate-spin text-text-lighter" />
                </div>
              ) : deferredPrs.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-4 text-center">
                  <GitPullRequest className="mb-2 text-text-lighter" />
                  <p className="ui-text-sm text-text-lighter">No pull requests</p>
                </div>
              ) : (
                <div className="space-y-2 overflow-x-hidden">
                  {deferredPrs.map((pr) => (
                    <PRListItem
                      key={pr.number}
                      pr={pr}
                      isActive={activePRNumber === pr.number}
                      onSelect={() => handleSelectPR(pr)}
                      onPrefetch={() => {
                        if (!effectiveRepoPath) return;
                        void prefetchPR(effectiveRepoPath, pr.number);
                      }}
                      onContextMenu={handlePRContextMenu}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      <ContextMenu
        isOpen={prContextMenu.isOpen}
        position={prContextMenu.position}
        items={prContextMenuItems}
        onClose={prContextMenu.close}
      />
    </div>
  );
});

GitHubPRsView.displayName = "GitHubPRsView";

export default GitHubPRsView;
