import GitHubDeliveryList from "../delivery/components/github-delivery-list";
import { RELEASE_FILTERS, DEPLOYMENT_FILTERS } from "../delivery/utils/github-delivery";
import type { ReleaseFilter, DeploymentFilter } from "../delivery/types/github-delivery.types";
import { TagIcon, RocketIcon } from "@/ui/icons";
import { commands } from "@/bindings/commands";
import { open } from "@tauri-apps/plugin-dialog";
import { GitHubAuthStatusMessage } from "./github-auth-status";
import {
  ArrowClockwiseIcon,
  BoltIcon,
  ChatBubbleTextIcon,
  ChevronDownIcon,
  FolderOpenIcon,
  CopyIcon,
  FilterIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  WindowExpandIcon,
  PlusIcon,
} from "@/ui/icons";
import { GithubMark } from "@/ui/brand-marks";
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
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import {
  type GitHubActivitySection,
  useSidebarStore,
} from "@/features/layout/stores/sidebar.store";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { ContextMenuPopup, createContextMenuGroups } from "@/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  useDropdownMenu,
  type MenuItem,
} from "@/ui/dropdown";
import {
  StreamEmpty,
  StreamGroup,
  StreamIconButton,
  StreamLoading,
  StreamMenuButton,
  StreamScroll,
  StreamTextButton,
  StreamToolbar,
} from "@/features/sidebar/components/stream/stream-list";
import { StreamTabs } from "@/features/sidebar/components/stream/stream-tabs";
import { writeClipboardText } from "@/utils/clipboard";
import { useGitHubStore } from "../stores/github.store";
import { getTimeAgo, getSidebarTime } from "../utils/github-viewer-utils";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";
import { openGitHubContentInNewWindow } from "../utils/open-in-new-window";
import { groupPullRequests } from "../utils/github-sidebar-groups";
import type { IssueFilter, PRFilter, PullRequest, WorkflowRunFilter } from "../types/github.types";
import { useGitHubActionsStore } from "../stores/github-actions.store";
import GitHubActionsView from "./github-actions-view";
import { GitHubAvatar } from "./github-avatar";
import GitHubIssuesView from "./github-issues-view";
import { GitHubSidebarRow, type GitHubSidebarPreviewBadge } from "./github-sidebar-row";
import { GITHUB_ISSUE_LIST_TTL_MS, githubIssueListCache } from "../utils/github-data-cache";

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

type GitHubSidebarSection = GitHubActivitySection;
type GitHubPaletteAction =
  | { type: "show-section"; section: GitHubSidebarSection }
  | { type: "refresh" };

interface PRListItemProps {
  pr: PullRequest;
  isActive: boolean;
  onSelect: () => void;
  onSelectChanges: () => void;
  onOpenInNewWindow: () => void;
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
    onOpenInNewWindow,
    onPrefetch,
    onContextMenu,
    repoPath,
  }: PRListItemProps) => {
    const updatedLabel = getTimeAgo(pr.updatedAt);
    const branchLabel = pr.baseRef && pr.headRef ? `${pr.baseRef} <- ${pr.headRef}` : undefined;
    const badges: GitHubSidebarPreviewBadge[] = [
      { label: pr.isDraft ? "Draft" : pr.state, tone: pr.isDraft ? "neutral" : "accent" },
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
        size={48}
        displaySize="md"
      />
    );

    return (
      <GitHubSidebarRow
        title={pr.title}
        description={`#${pr.number} · ${pr.author.login}`}
        onClick={onSelect}
        onOpenInNewWindow={onOpenInNewWindow}
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
        leading={authorAvatar}
        trailing={getSidebarTime(pr.updatedAt)}
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
  const availableRepoPaths = useRepositoryStore.use.availableRepoPaths();
  const { syncWorkspaceRepositories, setManualRepository, selectRepository } =
    useRepositoryStore.use.actions();
  const { openPRBuffer, openGitHubFormBuffer } = useBufferStore.use.actions();
  const showGitHubPullRequests = useSettingsStore((state) => state.settings.showGitHubPullRequests);
  const showGitHubIssues = useSettingsStore((state) => state.settings.showGitHubIssues);
  const showGitHubReleases = useSettingsStore((state) => state.settings.showGitHubReleases);
  const showGitHubDeployments = useSettingsStore((state) => state.settings.showGitHubDeployments);
  const showGitHubActions = useSettingsStore((state) => state.settings.showGitHubActions);
  const githubSidebarSectionOrder = useSettingsStore(
    (state) => state.settings.githubSidebarSectionOrder,
  );
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const effectiveRepoPath = activeRepoPath ?? rootFolderPath ?? null;

  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const activeSection = useSidebarStore.use.githubSection();
  const setActiveSection = useSidebarStore.use.actions().setGitHubSection;
  const [sectionRefreshNonce, setSectionRefreshNonce] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("open");
  const [actionFilter, setActionFilter] = useState<WorkflowRunFilter>("all");
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("all");
  const [deploymentFilter, setDeploymentFilter] = useState<DeploymentFilter>("all");
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
  const availableSections = useMemo(() => {
    const visibility: Record<GitHubSidebarSection, boolean> = {
      "pull-requests": showGitHubPullRequests,
      issues: showGitHubIssues,
      actions: showGitHubActions,
      releases: showGitHubReleases,
      deployments: showGitHubDeployments,
    };
    return githubSidebarSectionOrder.filter((section) => visibility[section]);
  }, [
    githubSidebarSectionOrder,
    showGitHubActions,
    showGitHubIssues,
    showGitHubPullRequests,
    showGitHubReleases,
    showGitHubDeployments,
  ]);

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
          .load(issueCacheKey, () => commands.githubListIssues(effectiveRepoPath, issueFilter), {
            ttlMs: GITHUB_ISSUE_LIST_TTL_MS,
          })
          .catch(() => undefined);
      }

      if (showGitHubActions) {
        void useGitHubActionsStore.getState().actions.loadRuns(effectiveRepoPath, { quiet: true });
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

    if (
      activeSection === "actions" ||
      activeSection === "releases" ||
      activeSection === "deployments"
    ) {
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

  const handleOpenPRInNewWindow = useCallback(
    (pr: PullRequest) => {
      openGitHubContentInNewWindow(effectiveRepoPath, {
        type: "pullRequest",
        prNumber: pr.number,
        repoPath: effectiveRepoPath ?? undefined,
        authorAvatarUrl: getGitHubAvatarUrl(pr.author),
        name: pr.title,
      });
    },
    [effectiveRepoPath],
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
          icon: <GitPullRequestIcon />,
          onClick: () => {
            handleSelectPR(selectedPR);
          },
        },
        {
          id: "open-pr-new-window",
          label: "Open in New Window",
          icon: <WindowExpandIcon />,
          onClick: () => {
            handleOpenPRInNewWindow(selectedPR);
          },
        },
        {
          id: "open-on-github",
          label: "Open on GitHub",
          icon: <GithubMark />,
          onClick: () => {
            if (effectiveRepoPath) {
              void openPRInBrowser(effectiveRepoPath, selectedPR.number);
            }
          },
        },
        {
          id: "checkout-branch",
          label: "Checkout Branch",
          icon: <GitBranchIcon />,
          onClick: () => {
            if (effectiveRepoPath) {
              void checkoutPR(effectiveRepoPath, selectedPR.number);
            }
          },
        },
        {
          id: "copy-title",
          label: "Copy Title",
          icon: <CopyIcon />,
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
            : activeSection === "releases"
              ? "Refresh Releases"
              : activeSection === "deployments"
                ? "Refresh Deployments"
                : "Refresh Workflow Runs",
      icon: <ArrowClockwiseIcon />,
      disabled: isLoading || !effectiveRepoPath,
      onClick: handleRefreshActiveSection,
    },
    {
      id: "select-repository",
      label: "Browse Repository",
      icon: <GitBranchIcon />,
      disabled: isSelectingRepo,
      onClick: () => void handleSelectRepository(),
    },
  ];

  const activeFilterLabel =
    activeSection === "releases"
      ? RELEASE_FILTERS[releaseFilter]
      : activeSection === "deployments"
        ? DEPLOYMENT_FILTERS[deploymentFilter]
        : activeSection === "pull-requests"
          ? filterLabels[currentFilter]
          : activeSection === "issues"
            ? issueFilterLabels[issueFilter]
            : actionFilterLabels[actionFilter];
  const isActiveFilterDefault =
    activeSection === "releases"
      ? releaseFilter === "all"
      : activeSection === "deployments"
        ? deploymentFilter === "all"
        : activeSection === "pull-requests"
          ? currentFilter === "all"
          : activeSection === "issues"
            ? issueFilter === "open"
            : actionFilter === "all";
  const activeFilterOptions =
    activeSection === "releases"
      ? Object.entries(RELEASE_FILTERS)
      : activeSection === "deployments"
        ? Object.entries(DEPLOYMENT_FILTERS)
        : activeSection === "issues"
          ? Object.entries(issueFilterLabels)
          : activeSection === "actions"
            ? Object.entries(actionFilterLabels)
            : Object.entries(filterLabels);
  const activeFilterValue =
    activeSection === "releases"
      ? releaseFilter
      : activeSection === "deployments"
        ? deploymentFilter
        : activeSection === "issues"
          ? issueFilter
          : activeSection === "actions"
            ? actionFilter
            : currentFilter;
  const handleActiveFilterChange = (filter: string) => {
    if (activeSection === "releases") {
      setReleaseFilter(filter as ReleaseFilter);
    } else if (activeSection === "deployments") {
      setDeploymentFilter(filter as DeploymentFilter);
    } else if (activeSection === "issues") {
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

  const sectionLabels: Record<GitHubSidebarSection, string> = {
    "pull-requests": "Pull Requests",
    issues: "Issues",
    actions: "Actions",
    releases: "Releases",
    deployments: "Deployments",
  };
  const sectionIcons: Record<GitHubSidebarSection, React.ReactNode> = {
    "pull-requests": <GitPullRequestIcon />,
    issues: <ChatBubbleTextIcon />,
    actions: <BoltIcon />,
    releases: <TagIcon />,
    deployments: <RocketIcon />,
  };
  const repoName = effectiveRepoPath?.split("/").filter(Boolean).pop() ?? "No repository";
  const filterItems: MenuItem[] = activeFilterOptions.map(([value, label]) => ({
    id: value,
    label,
    checked: value === activeFilterValue,
    onClick: () => handleActiveFilterChange(value),
  }));
  const repositoryItems: MenuItem[] = [
    ...availableRepoPaths.map((path) => ({
      id: path,
      label: path.split("/").filter(Boolean).pop() ?? path,
      checked: path === effectiveRepoPath,
      onClick: () => selectRepository(path),
    })),
    ...(availableRepoPaths.length > 0 ? [{ id: "sep", separator: true as const }] : []),
    {
      id: "browse",
      label: isSelectingRepo ? "Selecting…" : "Browse Repository…",
      icon: <FolderOpenIcon />,
      disabled: isSelectingRepo,
      onClick: () => void handleSelectRepository(),
    },
  ];
  const handleCreate = () => {
    if (!effectiveRepoPath) return;
    if (activeSection === "releases") {
      useBufferStore.getState().actions.openContent({
        type: "githubDelivery",
        kind: "releases",
        repoPath: effectiveRepoPath,
      });
      return;
    }
    openGitHubFormBuffer({
      repoPath: effectiveRepoPath,
      formKind:
        activeSection === "pull-requests"
          ? "pull-request"
          : activeSection === "issues"
            ? "issue"
            : "action",
      defaultHead: currentBranch,
    });
  };
  const createLabel =
    activeSection === "releases"
      ? "New release"
      : activeSection === "pull-requests"
        ? "New pull request"
        : activeSection === "issues"
          ? "New issue"
          : "Run workflow";

  if (!isAuthenticated) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background font-sans text-foreground">
        <div className="flex h-11 shrink-0 items-center px-3 text-[13px] font-semibold">GitHub</div>
        <GitHubAuthStatusMessage layout="sidebar" />
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background font-sans text-foreground select-none"
      onContextMenu={(event) => sectionContextMenu.open(event, null)}
    >
      {availableSections.length === 0 ? (
        <StreamEmpty
          title="No GitHub sections enabled"
          hint="Turn them on in Settings → Appearance."
        />
      ) : (
        <>
          <StreamTabs
            label="GitHub sections"
            tabs={availableSections.map((section) => ({
              id: section,
              label: section === "pull-requests" ? "PRs" : sectionLabels[section],
              icon: sectionIcons[section],
              count: section === "pull-requests" ? prs.length : undefined,
              active: activeSection === section,
              onClick: () => {
                setActiveSection(section);
                setSearchQuery("");
              },
            }))}
          />

          <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    title={`${effectiveRepoPath ?? ""}\nSwitch repository`}
                    className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-foreground/5"
                  />
                }
              >
                <GithubMark className="size-3.5 shrink-0 text-subtle-foreground" />
                <span className="min-w-0 truncate text-[12px]">
                  <span className="font-medium text-foreground">{repoName}</span>
                  {currentBranch ? (
                    <span className="text-subtle-foreground"> / {currentBranch}</span>
                  ) : null}
                </span>
                <ChevronDownIcon className="size-3 shrink-0 text-subtle-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" size="default">
                <DropdownMenuItems items={repositoryItems} />
              </DropdownMenuContent>
            </DropdownMenu>
            <StreamIconButton
              label="Refresh"
              disabled={isLoading || !effectiveRepoPath}
              onClick={handleRefreshActiveSection}
            >
              <ArrowClockwiseIcon className="size-3.5" />
            </StreamIconButton>
          </div>

          <StreamToolbar
            search={{
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder: `Filter ${sectionLabels[activeSection].toLowerCase()}`,
            }}
          >
            <StreamMenuButton
              label={`Filter: ${activeFilterLabel}`}
              icon={<FilterIcon className="size-3.5" />}
              active={!isActiveFilterDefault}
              items={filterItems}
            />
            {activeSection !== "deployments" ? (
              <StreamIconButton
                label={createLabel}
                disabled={!effectiveRepoPath}
                onClick={handleCreate}
              >
                <PlusIcon className="size-3.5" />
              </StreamIconButton>
            ) : null}
          </StreamToolbar>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeSection === "pull-requests" ? (
              <StreamScroll>
                {!effectiveRepoPath ? (
                  <StreamEmpty
                    title="No repository selected"
                    action={
                      <StreamTextButton
                        disabled={isSelectingRepo}
                        onClick={() => void handleSelectRepository()}
                      >
                        {isSelectingRepo ? "Selecting…" : "Browse Repository"}
                      </StreamTextButton>
                    }
                  />
                ) : error ? (
                  <StreamEmpty
                    title={isRepoError ? "Not a Git repository" : error}
                    hint={
                      isRepoError
                        ? "Select a folder that contains a .git repository."
                        : (repoSelectionError ?? undefined)
                    }
                    action={
                      <StreamTextButton
                        disabled={isSelectingRepo}
                        onClick={isRepoError ? () => void handleSelectRepository() : handleRefresh}
                      >
                        {isRepoError ? "Browse Repository" : "Try again"}
                      </StreamTextButton>
                    }
                  />
                ) : isLoading && deferredPrs.length === 0 ? (
                  <StreamLoading label="Loading pull requests" />
                ) : deferredPrs.length === 0 ? (
                  <StreamEmpty title="No pull requests" />
                ) : filteredPrs.length === 0 ? (
                  <StreamEmpty title="No matching pull requests" />
                ) : (
                  groupedPrs.map((group) => (
                    <StreamGroup
                      key={group.id}
                      id={String(group.id)}
                      title={group.title}
                      count={group.items.length}
                      forceOpen={searchQuery.trim().length > 0}
                    >
                      {group.items.map((pr) => (
                        <PRListItem
                          key={pr.number}
                          pr={pr}
                          isActive={activePRNumber === pr.number}
                          onSelect={() => handleSelectPR(pr)}
                          onSelectChanges={() => handleSelectPRChanges(pr)}
                          onOpenInNewWindow={() => handleOpenPRInNewWindow(pr)}
                          onPrefetch={() => handlePrefetchPR(pr)}
                          onContextMenu={handlePRContextMenu}
                          repoPath={effectiveRepoPath}
                        />
                      ))}
                    </StreamGroup>
                  ))
                )}
              </StreamScroll>
            ) : activeSection === "issues" ? (
              <GitHubIssuesView
                refreshNonce={sectionRefreshNonce}
                searchQuery={searchQuery}
                filter={issueFilter}
              />
            ) : activeSection === "releases" || activeSection === "deployments" ? (
              effectiveRepoPath ? (
                <GitHubDeliveryList
                  key={`${effectiveRepoPath}:${activeSection}`}
                  kind={activeSection}
                  repoPath={effectiveRepoPath}
                  refreshNonce={sectionRefreshNonce}
                  searchQuery={searchQuery}
                  filter={activeSection === "releases" ? releaseFilter : deploymentFilter}
                />
              ) : (
                <StreamEmpty title="No repository selected" />
              )
            ) : (
              <GitHubActionsView
                refreshNonce={sectionRefreshNonce}
                searchQuery={searchQuery}
                filter={actionFilter}
              />
            )}
          </div>
        </>
      )}
      <ContextMenuPopup
        isOpen={prContextMenu.isOpen}
        point={prContextMenu.position}
        groups={createContextMenuGroups(prContextMenuItems)}
        onClose={prContextMenu.close}
      />
      <ContextMenuPopup
        isOpen={sectionContextMenu.isOpen}
        point={sectionContextMenu.position}
        groups={createContextMenuGroups(sectionContextMenuItems)}
        onClose={sectionContextMenu.close}
      />
    </div>
  );
});

GitHubPRsView.displayName = "GitHubPRsView";

export default GitHubPRsView;
