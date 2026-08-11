import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { GitHubAuthStatusMessage } from "./github-auth-status";
import {
  CopyIcon as Copy,
  FunnelIcon as Funnel,
  GitBranchIcon as GitBranch,
  GithubLogoIcon as GithubLogo,
  GitPullRequestIcon as GitPullRequest,
  PlusIcon as Plus,
} from "@/ui/icons";
import { ArrowClockwiseIcon as RefreshCw } from "@/ui/icons";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getGitStatus } from "@/features/git/api/git-status-api";
import { isNotGitRepositoryError, resolveRepositoryPath } from "@/features/git/api/git-repo-api";
import GitProjectSelector from "@/features/git/components/git-project-selector";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  Dropdown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  useDropdownMenu,
  type MenuItem,
} from "@/ui/dropdown";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import {
  SidebarHeaderIconButton,
  SidebarSearchPopover,
  SidebarPanel,
  SidebarTabPanels,
  SidebarTabBar,
  SidebarTitleBar,
} from "@/ui/sidebar";
import { writeClipboardText } from "@/utils/clipboard";
import { useGitHubStore } from "../stores/github.store";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";
import { groupPullRequests } from "../utils/github-sidebar-groups";
import type {
  IssueFilter,
  IssueListItem,
  PRFilter,
  PullRequest,
  WorkflowRunFilter,
  WorkflowRunListItem,
} from "../types/github.types";
import GitHubActionsView from "./github-actions-view";
import { GitHubAvatar } from "./github-avatar";
import GitHubIssuesView from "./github-issues-view";
import { GitHubSidebarRow, type GitHubSidebarPreviewBadge } from "./github-sidebar-row";
import { GitHubSidebarSection as GitHubSidebarListSection } from "./github-sidebar-section";
import {
  GITHUB_ACTION_LIST_TTL_MS,
  GITHUB_ISSUE_LIST_TTL_MS,
  githubActionListCache,
  githubIssueListCache,
} from "../utils/github-data-cache";

const filterLabels: Record<PRFilter, string> = {
  all: "Open PRs",
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
  onSelectChanges: () => void;
  onPrefetch?: () => void;
  onContextMenu: (event: React.MouseEvent, pr: PullRequest) => void;
  repoPath?: string | null;
}

const PRListItem = memo(
  ({
    pr,
    isActive,
    onSelect,
    onSelectChanges,
    onPrefetch,
    onContextMenu,
    repoPath,
  }: PRListItemProps) => {
    const updatedLabel = getTimeAgo(pr.updatedAt);
    const stateLabel = pr.isDraft
      ? "Draft"
      : pr.reviewDecision
        ? pr.reviewDecision.replace(/_/g, " ").toLowerCase()
        : pr.state.toLowerCase();
    const branchLabel = pr.baseRef && pr.headRef ? `${pr.baseRef} <- ${pr.headRef}` : undefined;
    const badges: GitHubSidebarPreviewBadge[] = [
      { label: pr.isDraft ? "Draft" : pr.state, tone: pr.isDraft ? "muted" : "accent" },
      ...(pr.reviewDecision
        ? [
            {
              label: pr.reviewDecision.replace(/_/g, " ").toLowerCase(),
              tone: pr.reviewDecision === "APPROVED" ? "success" : "warning",
            } satisfies GitHubSidebarPreviewBadge,
          ]
        : []),
    ];
    const authorAvatar = (
      <GitHubAvatar
        login={pr.author.login}
        avatarUrl={pr.author.avatarUrl}
        size={40}
        className="size-full"
      />
    );

    return (
      <GitHubSidebarRow
        title={pr.title}
        onClick={onSelect}
        onPrefetch={onPrefetch}
        onContextMenu={(event) => onContextMenu(event, pr)}
        draggable
        onDragStart={(event) => {
          writeSidebarResourceDragData(event.dataTransfer, {
            type: "github-pr",
            repoPath: repoPath ?? undefined,
            number: pr.number,
            title: pr.title,
            authorAvatarUrl: getGitHubAvatarUrl(pr.author),
            name: `PR #${pr.number}`,
          });
        }}
        active={isActive}
        leading={
          <GitPullRequest
            className={pr.isDraft ? "size-4 text-subtle-foreground" : "size-4 text-primary"}
          />
        }
        description={
          <span className="flex min-w-0 items-center gap-1.5 capitalize">
            <span className="font-mono">#{pr.number}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{stateLabel}</span>
          </span>
        }
        trailing={
          <>
            <GitHubAvatar
              login={pr.author.login}
              avatarUrl={pr.author.avatarUrl}
              size={24}
              className="size-4"
            />
            <span>{updatedLabel}</span>
          </>
        }
        preview={{
          title: pr.title,
          subtitle: `#${pr.number} by ${pr.author.login}`,
          icon: authorAvatar,
          badges,
          details: [
            { label: "Updated", value: updatedLabel },
            { label: "Created", value: getTimeAgo(pr.createdAt) },
            { label: "Branches", value: branchLabel, mono: true },
            {
              label: "Changes",
              value: `+${pr.additions} / -${pr.deletions}`,
              mono: true,
              onClick: onSelectChanges,
              actionLabel: `Open changed files for pull request #${pr.number}`,
            },
          ],
        }}
      />
    );
  },
);

PRListItem.displayName = "PRListItem";

const GitHubPRsView = memo(() => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const prs = useGitHubStore.use.prs();
  const isLoading = useGitHubStore.use.isLoading();
  const error = useGitHubStore.use.error();
  const currentFilter = useGitHubStore.use.currentFilter();
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const {
    fetchPRs,
    setFilter,
    checkAuth,
    setActiveRepoPath,
    openPRInBrowser,
    checkoutPR,
    prefetchPR,
  } = useGitHubStore.use.actions();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const { syncWorkspaceRepositories, setManualRepository } = useRepositoryStore.use.actions();
  const { openPRBuffer, openGitHubFormBuffer } = useBufferStore.use.actions();
  const showGitHubPullRequests = useSettingsStore((state) => state.settings.showGitHubPullRequests);
  const showGitHubIssues = useSettingsStore((state) => state.settings.showGitHubIssues);
  const showGitHubActions = useSettingsStore((state) => state.settings.showGitHubActions);
  const githubSidebarSectionOrder = useSettingsStore(
    (state) => state.settings.githubSidebarSectionOrder,
  );
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const effectiveRepoPath = activeRepoPath ?? rootFolderPath ?? null;

  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<GitHubSidebarSection>("pull-requests");
  const [sectionRefreshNonce, setSectionRefreshNonce] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("open");
  const [actionFilter, setActionFilter] = useState<WorkflowRunFilter>("all");
  const [currentBranch, setCurrentBranch] = useState("");
  const prContextMenu = useDropdownMenu<PullRequest>();
  const sectionContextMenu = useDropdownMenu<null>();

  const isRepoError = !!error && isNotGitRepositoryError(error);
  const activePRNumber = useBufferStore((state) => {
    const activeBuffer = state.activeBufferId
      ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
      : null;
    return activeBuffer?.type === "pullRequest" ? activeBuffer.prNumber : null;
  });
  const deferredPrs = useDeferredValue(prs);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const availableSections = useMemo(
    () =>
      [
        showGitHubPullRequests ? "pull-requests" : null,
        showGitHubIssues ? "issues" : null,
        showGitHubActions ? "actions" : null,
      ].filter((section): section is GitHubSidebarSection => !!section),
    [showGitHubActions, showGitHubIssues, showGitHubPullRequests],
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

  useEffect(() => {
    if (!isGitHubPRsViewActive || !effectiveRepoPath || !isAuthenticated) return;

    let cancelled = false;
    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const prefetchSecondaryLists = () => {
      if (cancelled) return;

      if (showGitHubIssues) {
        const issueCacheKey = `${effectiveRepoPath}::${issueFilter}`;
        void githubIssueListCache
          .load(
            issueCacheKey,
            () =>
              invoke<IssueListItem[]>("github_list_issues", {
                repoPath: effectiveRepoPath,
                state: issueFilter,
              }),
            { ttlMs: GITHUB_ISSUE_LIST_TTL_MS },
          )
          .catch(() => undefined);
      }

      if (showGitHubActions) {
        void githubActionListCache
          .load(
            effectiveRepoPath,
            () =>
              invoke<WorkflowRunListItem[]>("github_list_workflow_runs", {
                repoPath: effectiveRepoPath,
              }),
            { ttlMs: GITHUB_ACTION_LIST_TTL_MS },
          )
          .catch(() => undefined);
      }
    };

    let idleId: number | null = null;
    const timeoutId = window.setTimeout(() => {
      if (typeof idleApi.requestIdleCallback === "function") {
        idleId = idleApi.requestIdleCallback(prefetchSecondaryLists, { timeout: 1000 });
        return;
      }

      prefetchSecondaryLists();
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (idleId !== null) {
        idleApi.cancelIdleCallback?.(idleId);
      }
    };
  }, [
    effectiveRepoPath,
    isAuthenticated,
    isGitHubPRsViewActive,
    issueFilter,
    showGitHubActions,
    showGitHubIssues,
  ]);

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

  const handleFilterChange = useCallback((filter: PRFilter) => setFilter(filter), [setFilter]);

  const handleIssueFilterChange = useCallback((filter: IssueFilter) => {
    setIssueFilter(filter);
  }, []);

  const handleActionFilterChange = useCallback((filter: WorkflowRunFilter) => {
    setActionFilter(filter);
  }, []);

  const handleSelectPR = useCallback(
    (pr: PullRequest) => {
      startTransition(() => {
        openPRBuffer(pr.number, {
          title: pr.title,
          repoPath: effectiveRepoPath ?? undefined,
          authorAvatarUrl: getGitHubAvatarUrl(pr.author),
        });
      });
    },
    [effectiveRepoPath, openPRBuffer],
  );

  const handleSelectPRChanges = useCallback(
    (pr: PullRequest) => {
      startTransition(() => {
        openPRBuffer(pr.number, {
          title: pr.title,
          repoPath: effectiveRepoPath ?? undefined,
          authorAvatarUrl: getGitHubAvatarUrl(pr.author),
          initialView: "files",
        });
      });
    },
    [effectiveRepoPath, openPRBuffer],
  );

  const handlePrefetchPR = useCallback(
    (pr: PullRequest) => {
      if (!effectiveRepoPath) return;
      void prefetchPR(effectiveRepoPath, pr.number);
    },
    [effectiveRepoPath, prefetchPR],
  );

  const handlePRContextMenu = useCallback(
    (event: React.MouseEvent, pr: PullRequest) => {
      event.stopPropagation();
      prContextMenu.open(event, pr);
    },
    [prContextMenu],
  );

  const selectedPR = prContextMenu.data;

  const prContextMenuItems: MenuItem[] = selectedPR
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
          icon: <GithubLogo />,
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
            void writeClipboardText(selectedPR.title);
          },
        },
      ]
    : [];
  const sectionContextMenuItems: MenuItem[] = [
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
    const tabMap: Record<GitHubSidebarSection, { id: GitHubSidebarSection; label: string }> = {
      "pull-requests": {
        id: "pull-requests",
        label: "Pull Requests",
      },
      issues: {
        id: "issues",
        label: "Issues",
      },
      actions: {
        id: "actions",
        label: "Actions",
      },
    };

    return githubSidebarSectionOrder.map((id) => tabMap[id]).filter(Boolean);
  }, [githubSidebarSectionOrder]);

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
  const activeFilterOptions =
    activeSection === "issues"
      ? Object.entries(issueFilterLabels)
      : activeSection === "actions"
        ? Object.entries(actionFilterLabels)
        : Object.entries(filterLabels);
  const activeFilterValue =
    activeSection === "issues"
      ? issueFilter
      : activeSection === "actions"
        ? actionFilter
        : currentFilter;
  const handleActiveFilterChange = (filter: string) => {
    if (activeSection === "issues") {
      handleIssueFilterChange(filter as IssueFilter);
    } else if (activeSection === "actions") {
      handleActionFilterChange(filter as WorkflowRunFilter);
    } else {
      handleFilterChange(filter as PRFilter);
    }
  };
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
  const groupedPrs = useMemo(
    () => groupPullRequests(filteredPrs, currentFilter),
    [currentFilter, filteredPrs],
  );
  const forceListSectionsExpanded = deferredSearchQuery.trim().length > 0;

  useEffect(() => {
    if (
      !isGitHubPRsViewActive ||
      activeSection !== "pull-requests" ||
      !effectiveRepoPath ||
      filteredPrs.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const prefetchVisiblePRs = () => {
      if (cancelled) return;
      filteredPrs.slice(0, 4).forEach((pr) => {
        void prefetchPR(effectiveRepoPath, pr.number);
      });
    };
    const usesIdleCallback = typeof idleApi.requestIdleCallback === "function";
    const idleId = usesIdleCallback
      ? idleApi.requestIdleCallback?.(prefetchVisiblePRs, { timeout: 1200 })
      : window.setTimeout(prefetchVisiblePRs, 500);

    return () => {
      cancelled = true;
      if (usesIdleCallback && idleId !== undefined) {
        idleApi.cancelIdleCallback(idleId);
      } else if (idleId !== undefined) {
        window.clearTimeout(idleId);
      }
    };
  }, [activeSection, effectiveRepoPath, filteredPrs, isGitHubPRsViewActive, prefetchPR]);

  if (!isAuthenticated) {
    return (
      <SidebarPanel>
        <SidebarTitleBar title="GitHub" />
        <GitHubAuthStatusMessage />
      </SidebarPanel>
    );
  }

  return (
    <>
      <SidebarPanel
        className="font-sans select-none"
        onContextMenu={(event) => {
          sectionContextMenu.open(event, null);
        }}
      >
        {availableSections.length === 0 ? (
          <Empty density="compact" className="h-full">
            <EmptyDescription>
              Enable GitHub sidebar sections in Settings -&gt; Appearance.
            </EmptyDescription>
          </Empty>
        ) : (
          <>
            <SidebarTitleBar
              title={<GitProjectSelector onRepositoryChange={() => setRepoSelectionError(null)} />}
            >
              <SidebarSearchPopover
                value={searchQuery}
                onChange={setSearchQuery}
                aria-label="Search GitHub"
              />
              <SidebarHeaderIconButton
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
                  if (effectiveRepoPath) {
                    openGitHubFormBuffer({
                      repoPath: effectiveRepoPath,
                      formKind: nextKind,
                      defaultHead: currentBranch,
                    });
                  }
                }}
              >
                <Plus />
              </SidebarHeaderIconButton>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarHeaderIconButton
                      active={!isActiveFilterDefault}
                      tooltip={`Filter: ${activeFilterLabel}`}
                      tooltipSide="bottom"
                      aria-label={`Filter GitHub ${activeSection}`}
                    />
                  }
                >
                  <Funnel />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuRadioGroup
                    value={activeFilterValue}
                    onValueChange={handleActiveFilterChange}
                  >
                    {activeFilterOptions.map(([value, label]) => (
                      <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarTitleBar>

            <SidebarTabBar items={sectionTabs} value={activeSection} onChange={setActiveSection}>
              <SidebarTabPanels
                className="flex-1"
                items={[
                  {
                    id: "pull-requests",
                    content: (
                      <div className="flex h-full min-h-0 flex-col overflow-hidden">
                        <ScrollArea className="min-h-0 flex-1" contentClassName="px-2 py-2">
                          {!effectiveRepoPath ? (
                            <Empty density="compact">
                              <EmptyTitle>No repository selected</EmptyTitle>
                              <EmptyContent>
                                <Button
                                  type="button"
                                  variant="default"
                                  size="xs"
                                  disabled={isSelectingRepo}
                                  onClick={() => void handleSelectRepository()}
                                >
                                  {isSelectingRepo ? "Selecting..." : "Browse Repository"}
                                </Button>
                              </EmptyContent>
                            </Empty>
                          ) : error ? (
                            <Empty density="compact" tone="error" role="alert">
                              <EmptyHeader>
                                <EmptyTitle>
                                  {isRepoError ? "Repository is not a Git repository" : error}
                                </EmptyTitle>
                                {isRepoError || repoSelectionError ? (
                                  <EmptyDescription>
                                    {isRepoError
                                      ? "Select another folder that contains a `.git` repository."
                                      : repoSelectionError}
                                  </EmptyDescription>
                                ) : null}
                              </EmptyHeader>
                              <EmptyContent>
                                <Button
                                  type="button"
                                  variant="default"
                                  size="xs"
                                  disabled={isSelectingRepo}
                                  onClick={
                                    isRepoError
                                      ? () => void handleSelectRepository()
                                      : handleRefresh
                                  }
                                >
                                  {isRepoError
                                    ? isSelectingRepo
                                      ? "Selecting..."
                                      : "Browse Repository"
                                    : "Try again"}
                                </Button>
                              </EmptyContent>
                            </Empty>
                          ) : isLoading && deferredPrs.length === 0 ? (
                            <div className="flex items-center justify-center py-8">
                              <Spinner label="Loading pull requests" showLabel compact />
                            </div>
                          ) : deferredPrs.length === 0 ? (
                            <Empty density="compact">
                              <EmptyDescription>No pull requests</EmptyDescription>
                            </Empty>
                          ) : filteredPrs.length === 0 ? (
                            <Empty density="compact">
                              <EmptyDescription>No matching pull requests</EmptyDescription>
                            </Empty>
                          ) : (
                            <div className="space-y-1 overflow-x-hidden">
                              {isLoading ? (
                                <div className="flex items-center px-2 py-1.5">
                                  <Spinner label="Refreshing" compact />
                                </div>
                              ) : null}
                              {groupedPrs.map((group) => (
                                <GitHubSidebarListSection
                                  key={group.id}
                                  title={group.title}
                                  count={group.items.length}
                                  defaultExpanded={group.defaultExpanded}
                                  forceExpanded={forceListSectionsExpanded}
                                >
                                  {group.items.map((pr) => (
                                    <PRListItem
                                      key={pr.number}
                                      pr={pr}
                                      isActive={activePRNumber === pr.number}
                                      onSelect={() => handleSelectPR(pr)}
                                      onSelectChanges={() => handleSelectPRChanges(pr)}
                                      onPrefetch={() => handlePrefetchPR(pr)}
                                      onContextMenu={handlePRContextMenu}
                                      repoPath={effectiveRepoPath}
                                    />
                                  ))}
                                </GitHubSidebarListSection>
                              ))}
                            </div>
                          )}
                        </ScrollArea>
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
              />
            </SidebarTabBar>
          </>
        )}
        <Dropdown
          isOpen={prContextMenu.isOpen}
          point={prContextMenu.position}
          items={prContextMenuItems}
          onClose={prContextMenu.close}
        />
        <Dropdown
          isOpen={sectionContextMenu.isOpen}
          point={sectionContextMenu.position}
          items={sectionContextMenuItems}
          onClose={sectionContextMenu.close}
        />
      </SidebarPanel>
    </>
  );
});

GitHubPRsView.displayName = "GitHubPRsView";

export default GitHubPRsView;
