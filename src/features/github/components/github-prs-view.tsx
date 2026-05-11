import { open } from "@tauri-apps/plugin-dialog";
import { GitHubAuthStatusMessage } from "./github-auth-status";
import {
  ArrowSquareOut,
  ChatCircleText,
  Check,
  Copy,
  Funnel,
  GitBranch,
  GitPullRequest,
  Lightning,
  MagnifyingGlass as Search,
  Plus,
} from "@phosphor-icons/react";
import { WarningCircle as AlertCircle, ArrowClockwise as RefreshCw } from "@phosphor-icons/react";
import {
  memo,
  type ReactNode,
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
import { getGitStatus } from "@/features/git/api/git-status-api";
import { isNotGitRepositoryError, resolveRepositoryPath } from "@/features/git/api/git-repo-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import { LoadingIndicator } from "@/ui/loading";
import {
  SidebarEmptyActionState,
  SidebarHeader,
  SidebarHeaderIconButton,
  SidebarHeaderSearch,
  SidebarListItem,
  SidebarPanel,
  SidebarSectionPager,
  SidebarSectionSwitcher,
} from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { useGitHubStore } from "../stores/github-store";
import type { IssueFilter, PRFilter, PullRequest, WorkflowRunFilter } from "../types/github";
import GitHubActionsView from "./github-actions-view";
import { GitHubCreateCommand, type GitHubCreateKind } from "./github-create-command";
import GitHubIssuesView from "./github-issues-view";
import { GitHubSidebarState } from "./github-sidebar-state";
import { githubActionListCache, githubIssueListCache } from "../utils/github-data-cache";

const filterLabels: Record<PRFilter, string> = {
  all: "All PRs",
  "my-prs": "My PRs",
  "review-requests": "Review Requests",
};

const issueFilterLabels: Record<IssueFilter, string> = {
  open: "Open Issues",
  closed: "Closed Issues",
  all: "All Issues",
};

const actionFilterLabels: Record<WorkflowRunFilter, string> = {
  all: "All Runs",
  "in-progress": "In Progress",
  successful: "Successful",
  failed: "Failed",
};

type GitHubSidebarSection = "pull-requests" | "issues" | "actions";
type GitHubPaletteAction =
  | { type: "show-section"; section: GitHubSidebarSection }
  | { type: "refresh" };

interface PRListItemProps {
  pr: PullRequest;
  isActive: boolean;
  onSelect: () => void;
  onContextMenu: (event: React.MouseEvent, pr: PullRequest) => void;
  repoPath?: string | null;
}

const PRListItem = memo(({ pr, isActive, onSelect, onContextMenu, repoPath }: PRListItemProps) => {
  return (
    <SidebarListItem
      onClick={onSelect}
      onContextMenu={(event) => onContextMenu(event, pr)}
      draggable
      onDragStart={(event) => {
        writeSidebarResourceDragData(event.dataTransfer, {
          type: "github-pr",
          repoPath: repoPath ?? undefined,
          number: pr.number,
          title: pr.title,
          authorAvatarUrl:
            pr.author.avatarUrl ||
            `https://github.com/${encodeURIComponent(pr.author.login || "github")}.png?size=32`,
          name: `PR #${pr.number}`,
        });
      }}
      className={cn(
        "items-start rounded-md px-2 py-2 transition-[transform,background-color,opacity]",
      )}
      active={isActive}
      leading={
        <img
          src={
            pr.author.avatarUrl ||
            `https://github.com/${encodeURIComponent(pr.author.login || "github")}.png?size=40`
          }
          alt={pr.author.login}
          className="size-5 rounded-full bg-secondary-bg"
          loading="lazy"
        />
      }
    >
      <div className="min-w-0 flex-1">
        <div className="ui-text-sm truncate text-text leading-4">{pr.title}</div>
        <div className="ui-text-sm mt-1 text-text-lighter">{`#${pr.number} by ${pr.author.login}`}</div>
        <div className="mt-1">
          <span className="ui-text-xs inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary-bg/80 px-1.5 py-0.5 editor-font text-text-lighter">
            <span className="min-w-0 truncate">{pr.baseRef}</span>
            <span className="shrink-0 px-1">&larr;</span>
            <span className="min-w-0 truncate">{pr.headRef}</span>
          </span>
        </div>
      </div>
    </SidebarListItem>
  );
});

PRListItem.displayName = "PRListItem";

const GitHubPRsView = memo(() => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const { prs, isLoading, error, currentFilter, isAuthenticated } = useGitHubStore();
  const { fetchPRs, setFilter, checkAuth, setActiveRepoPath, openPRInBrowser, checkoutPR } =
    useGitHubStore().actions;
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const { syncWorkspaceRepositories, setManualRepository } = useRepositoryStore.use.actions();
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const { openPRBuffer, openGitHubIssueBuffer } = useBufferStore.use.actions();
  const settings = useSettingsStore((state) => state.settings);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const effectiveRepoPath = activeRepoPath ?? rootFolderPath ?? null;

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<GitHubSidebarSection>("pull-requests");
  const [sectionRefreshNonce, setSectionRefreshNonce] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("open");
  const [actionFilter, setActionFilter] = useState<WorkflowRunFilter>("all");
  const [createKind, setCreateKind] = useState<GitHubCreateKind | null>(null);
  const [currentBranch, setCurrentBranch] = useState("");
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const prContextMenu = useContextMenu<PullRequest>();
  const sectionContextMenu = useContextMenu<null>();

  const isRepoError = !!error && isNotGitRepositoryError(error);
  const activePRNumber = useMemo(() => {
    const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
    return activeBuffer?.type === "pullRequest" ? activeBuffer.prNumber : null;
  }, [activeBufferId, buffers]);
  const deferredPrs = useDeferredValue(prs);
  const deferredSearchQuery = useDeferredValue(searchQuery);
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
  }, [rootFolderPath]);

  useEffect(() => {
    setActiveRepoPath(activeRepoPath);
  }, [activeRepoPath, setActiveRepoPath]);

  useEffect(() => {
    if (rootFolderPath) {
      void syncWorkspaceRepositories(rootFolderPath);
    }
  }, [rootFolderPath, syncWorkspaceRepositories]);

  useEffect(() => {
    if (!effectiveRepoPath) {
      setCurrentBranch("");
      return;
    }

    let cancelled = false;
    void getGitStatus(effectiveRepoPath).then((status) => {
      if (!cancelled) {
        setCurrentBranch(status?.branch ?? "");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [effectiveRepoPath]);

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

  const handleRefresh = useCallback(() => {
    if (effectiveRepoPath) {
      void fetchPRs(effectiveRepoPath, { force: true });
    }
  }, [effectiveRepoPath, fetchPRs]);

  const handleRefreshActiveSection = useCallback(() => {
    if (!effectiveRepoPath) return;

    if (activeSection === "issues") {
      githubIssueListCache.clear(`${effectiveRepoPath}::${issueFilter}`);
      setSectionRefreshNonce((value) => value + 1);
      return;
    }

    if (activeSection === "actions") {
      githubActionListCache.clear(effectiveRepoPath);
      setSectionRefreshNonce((value) => value + 1);
      return;
    }

    void fetchPRs(effectiveRepoPath, { force: true });
  }, [activeSection, effectiveRepoPath, fetchPRs, issueFilter]);

  useEffect(() => {
    const handlePaletteAction = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;

      const detail = event.detail as GitHubPaletteAction;
      if (!detail) return;

      if (detail.type === "show-section") {
        setActiveSection(detail.section);
        return;
      }

      if (detail.type === "refresh") {
        handleRefreshActiveSection();
      }
    };

    window.addEventListener("athas:github-palette-action", handlePaletteAction);
    return () => window.removeEventListener("athas:github-palette-action", handlePaletteAction);
  }, [handleRefreshActiveSection]);

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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRepoSelectionError(message);
    } finally {
      setIsSelectingRepo(false);
    }
  }, [setManualRepository]);

  const handleFilterChange = useCallback(
    (filter: PRFilter) => {
      setFilter(filter);
      setIsFilterOpen(false);
    },
    [setFilter],
  );

  const handleIssueFilterChange = useCallback((filter: IssueFilter) => {
    setIssueFilter(filter);
    setIsFilterOpen(false);
  }, []);

  const handleActionFilterChange = useCallback((filter: WorkflowRunFilter) => {
    setActionFilter(filter);
    setIsFilterOpen(false);
  }, []);

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
      event.stopPropagation();
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
          icon: <ArrowSquareOut />,
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
  const sectionContextMenuItems: ContextMenuItem[] = [
    {
      id: "refresh",
      label:
        activeSection === "pull-requests"
          ? "Refresh Pull Requests"
          : activeSection === "issues"
            ? "Refresh Issues"
            : "Refresh Workflow Runs",
      icon: <RefreshCw />,
      disabled: isLoading || !effectiveRepoPath,
      onClick: handleRefreshActiveSection,
    },
    {
      id: "select-repository",
      label: "Browse Repository",
      icon: <GitBranch />,
      disabled: isSelectingRepo,
      onClick: () => void handleSelectRepository(),
    },
  ];

  const allSectionTabs = useMemo(() => {
    const tabMap: Record<
      GitHubSidebarSection,
      { id: GitHubSidebarSection; label: string; icon: ReactNode }
    > = {
      "pull-requests": {
        id: "pull-requests",
        label: "Pull Requests",
        icon: <GitPullRequest size={16} weight="duotone" />,
      },
      issues: {
        id: "issues",
        label: "Issues",
        icon: <ChatCircleText size={16} weight="duotone" />,
      },
      actions: {
        id: "actions",
        label: "Actions",
        icon: <Lightning size={16} weight="duotone" />,
      },
    };

    return settings.githubSidebarSectionOrder.map((id) => tabMap[id]).filter(Boolean);
  }, [settings.githubSidebarSectionOrder]);

  const sectionTabs = allSectionTabs.filter((tab) => availableSections.includes(tab.id));
  const activeFilterLabel =
    activeSection === "pull-requests"
      ? filterLabels[currentFilter]
      : activeSection === "issues"
        ? issueFilterLabels[issueFilter]
        : actionFilterLabels[actionFilter];
  const isActiveFilterDefault =
    activeSection === "pull-requests"
      ? currentFilter === "all"
      : activeSection === "issues"
        ? issueFilter === "open"
        : actionFilter === "all";
  const filterMenuItems = useMemo<MenuItem[]>(() => {
    if (activeSection === "issues") {
      return (Object.keys(issueFilterLabels) as IssueFilter[]).map((filter) => ({
        id: filter,
        label: issueFilterLabels[filter],
        keybinding: issueFilter === filter ? <Check className="size-3.5 text-accent" /> : null,
        onClick: () => handleIssueFilterChange(filter),
      }));
    }

    if (activeSection === "actions") {
      return (Object.keys(actionFilterLabels) as WorkflowRunFilter[]).map((filter) => ({
        id: filter,
        label: actionFilterLabels[filter],
        keybinding: actionFilter === filter ? <Check className="size-3.5 text-accent" /> : null,
        onClick: () => handleActionFilterChange(filter),
      }));
    }

    return (Object.keys(filterLabels) as PRFilter[]).map((filter) => ({
      id: filter,
      label: filterLabels[filter],
      keybinding: currentFilter === filter ? <Check className="size-3.5 text-accent" /> : null,
      onClick: () => handleFilterChange(filter),
    }));
  }, [
    actionFilter,
    activeSection,
    currentFilter,
    handleActionFilterChange,
    handleFilterChange,
    handleIssueFilterChange,
    issueFilter,
  ]);
  const filteredPrs = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    if (!query) return deferredPrs;

    return deferredPrs.filter((pr) =>
      [
        pr.title,
        `#${pr.number}`,
        pr.author.login,
        pr.headRef,
        pr.baseRef,
        pr.state,
        pr.reviewDecision ?? "",
        pr.isDraft ? "draft" : "",
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [deferredPrs, deferredSearchQuery]);

  if (!isAuthenticated) {
    return (
      <SidebarPanel className="gap-2 p-2">
        <SidebarHeader className="bg-transparent px-0 py-0 backdrop-blur-none">
          <span className="ui-text-sm font-medium text-text">GitHub</span>
        </SidebarHeader>
        <GitHubAuthStatusMessage />
      </SidebarPanel>
    );
  }

  return (
    <>
      <SidebarPanel
        className="ui-font select-none gap-2 p-2"
        onContextMenu={(event) => {
          sectionContextMenu.open(event, null);
        }}
      >
        {availableSections.length === 0 ? (
          <SidebarEmptyActionState
            className="h-full"
            message="Enable GitHub sidebar sections in Settings -> Appearance."
          />
        ) : (
          <>
            <SidebarSectionSwitcher
              items={sectionTabs}
              value={activeSection}
              onChange={(section) => setActiveSection(section as GitHubSidebarSection)}
            />

            <SidebarHeader className="px-0">
              <SidebarHeaderSearch
                value={searchQuery}
                onChange={setSearchQuery}
                leftIcon={Search}
                placeholder="Search"
              />
              <SidebarHeaderIconButton
                className="shrink-0"
                disabled={!effectiveRepoPath}
                tooltip={
                  activeSection === "pull-requests"
                    ? "New Pull Request"
                    : activeSection === "issues"
                      ? "New Issue"
                      : "Run Workflow"
                }
                tooltipSide="bottom"
                onClick={() => {
                  const nextKind =
                    activeSection === "pull-requests"
                      ? "pull-request"
                      : activeSection === "issues"
                        ? "issue"
                        : "action";
                  setCreateKind(nextKind);
                }}
              >
                <Plus />
              </SidebarHeaderIconButton>
              <SidebarHeaderIconButton
                ref={filterTriggerRef}
                active={!isActiveFilterDefault}
                className="shrink-0"
                tooltip={`Filter: ${activeFilterLabel}`}
                tooltipSide="bottom"
                onClick={() => setIsFilterOpen(true)}
              >
                <Funnel />
              </SidebarHeaderIconButton>
            </SidebarHeader>

            <Dropdown
              isOpen={isFilterOpen}
              anchorRef={filterTriggerRef}
              anchorSide="bottom"
              anchorAlign="end"
              items={filterMenuItems}
              onClose={() => setIsFilterOpen(false)}
              closeOnSelect={false}
              className="w-fit min-w-fit"
            />

            <SidebarSectionPager
              className="flex-1"
              items={[
                {
                  id: "pull-requests",
                  content: (
                    <div className="flex h-full min-h-0 flex-col overflow-hidden">
                      <div className="scrollbar-hidden min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1">
                        {!effectiveRepoPath ? (
                          <GitHubSidebarState
                            icon={<GitBranch className="size-4" />}
                            title="No repository selected"
                            actionLabel={isSelectingRepo ? "Selecting..." : "Browse Repository"}
                            onAction={() => void handleSelectRepository()}
                            isActionDisabled={isSelectingRepo}
                          />
                        ) : error ? (
                          <GitHubSidebarState
                            icon={<AlertCircle className="size-4" />}
                            title={isRepoError ? "Repository is not a Git repository" : error}
                            description={
                              isRepoError
                                ? "Select another folder that contains a `.git` repository."
                                : repoSelectionError || undefined
                            }
                            actionLabel={
                              isRepoError
                                ? isSelectingRepo
                                  ? "Selecting..."
                                  : "Browse Repository"
                                : "Try again"
                            }
                            onAction={
                              isRepoError ? () => void handleSelectRepository() : handleRefresh
                            }
                            isActionDisabled={isSelectingRepo}
                            tone="error"
                          />
                        ) : isLoading && deferredPrs.length === 0 ? (
                          <div className="flex items-center justify-center p-4">
                            <LoadingIndicator label="Loading pull requests" showLabel compact />
                          </div>
                        ) : deferredPrs.length === 0 ? (
                          <GitHubSidebarState
                            icon={<GitPullRequest className="size-4" />}
                            title="No pull requests"
                          />
                        ) : filteredPrs.length === 0 ? (
                          <GitHubSidebarState
                            icon={<GitPullRequest className="size-4" />}
                            title="No matching pull requests"
                          />
                        ) : (
                          <div className="space-y-px overflow-x-hidden">
                            {isLoading ? (
                              <div className="flex items-center px-2 py-1.5">
                                <LoadingIndicator label="Refreshing" compact />
                              </div>
                            ) : null}
                            {filteredPrs.map((pr) => (
                              <PRListItem
                                key={pr.number}
                                pr={pr}
                                isActive={activePRNumber === pr.number}
                                onSelect={() => handleSelectPR(pr)}
                                onContextMenu={handlePRContextMenu}
                                repoPath={effectiveRepoPath}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                },
                {
                  id: "issues",
                  content: (
                    <GitHubIssuesView
                      refreshNonce={sectionRefreshNonce}
                      searchQuery={searchQuery}
                      filter={issueFilter}
                    />
                  ),
                },
                {
                  id: "actions",
                  content: (
                    <GitHubActionsView
                      refreshNonce={sectionRefreshNonce}
                      searchQuery={searchQuery}
                      filter={actionFilter}
                    />
                  ),
                },
              ].filter((item) => sectionTabs.some((tab) => tab.id === item.id))}
              value={activeSection}
              onChange={(section) => setActiveSection(section as GitHubSidebarSection)}
            />
          </>
        )}
        <ContextMenu
          isOpen={prContextMenu.isOpen}
          position={prContextMenu.position}
          items={prContextMenuItems}
          onClose={prContextMenu.close}
        />
        <ContextMenu
          isOpen={sectionContextMenu.isOpen}
          position={sectionContextMenu.position}
          items={sectionContextMenuItems}
          onClose={sectionContextMenu.close}
        />
      </SidebarPanel>
      <GitHubCreateCommand
        kind={createKind}
        repoPath={effectiveRepoPath}
        defaultHead={currentBranch}
        onClose={() => setCreateKind(null)}
        onIssueCreated={(issue) => {
          githubIssueListCache.clear();
          setActiveSection("issues");
          setIssueFilter("open");
          setSectionRefreshNonce((value) => value + 1);
          startTransition(() => {
            openGitHubIssueBuffer({
              issueNumber: issue.number,
              repoPath: effectiveRepoPath ?? undefined,
              title: issue.title,
              authorAvatarUrl:
                issue.author.avatarUrl ||
                `https://github.com/${encodeURIComponent(issue.author.login || "github")}.png?size=32`,
              url: issue.url,
            });
          });
        }}
        onPullRequestCreated={(pullRequest) => {
          setActiveSection("pull-requests");
          if (effectiveRepoPath) {
            void fetchPRs(effectiveRepoPath, { force: true });
          }
          startTransition(() => {
            openPRBuffer(pullRequest.number, {
              title: pullRequest.title,
              authorAvatarUrl:
                pullRequest.author.avatarUrl ||
                `https://github.com/${encodeURIComponent(pullRequest.author.login || "github")}.png?size=32`,
            });
          });
        }}
        onWorkflowDispatched={() => {
          if (effectiveRepoPath) {
            githubActionListCache.clear(effectiveRepoPath);
          }
          setActiveSection("actions");
          setSectionRefreshNonce((value) => value + 1);
        }}
      />
    </>
  );
});

GitHubPRsView.displayName = "GitHubPRsView";

export default GitHubPRsView;
