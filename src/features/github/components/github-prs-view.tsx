import { open } from "@tauri-apps/plugin-dialog";
import { GitHubAuthStatusMessage } from "./github-auth-status";
import {
  ArrowSquareOut,
  ChatCircleText,
  Copy,
  GitBranch,
  GitPullRequest,
  Lightning,
} from "@phosphor-icons/react";
import {
  WarningCircle as AlertCircle,
  CaretDown as ChevronDown,
  ArrowClockwise as RefreshCw,
} from "@phosphor-icons/react";
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
import GitProjectSelector from "@/features/git/components/git-project-selector";
import { isNotGitRepositoryError, resolveRepositoryPath } from "@/features/git/api/git-repo-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown, dropdownItemClassName, dropdownTriggerClassName } from "@/ui/dropdown";
import { PaneIconButton, paneHeaderClassName } from "@/ui/pane";
import {
  Tabs,
  EQUAL_WIDTH_SEGMENTED_TAB_ITEM_CLASS_NAME,
  EQUAL_WIDTH_SEGMENTED_TABS_CLASS_NAME,
} from "@/ui/tabs";
import { cn } from "@/utils/cn";
import { useGitHubStore } from "../stores/github-store";
import type { PRFilter, PullRequest } from "../types/github";
import GitHubActionsView from "./github-actions-view";
import GitHubIssuesView from "./github-issues-view";
import GitHubSidebarLoadingBar from "./github-sidebar-loading-bar";
import { GitHubSidebarState } from "./github-sidebar-state";
import { githubActionListCache, githubIssueListCache } from "../utils/github-data-cache";

const filterLabels: Record<PRFilter, string> = {
  all: "All PRs",
  "my-prs": "My PRs",
  "review-requests": "Review Requests",
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
    <Button
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
      variant="ghost"
      size="sm"
      className={cn(
        "h-auto w-full cursor-grab items-start justify-start rounded-xl px-3 py-2.5 text-left transition-[transform,background-color,opacity] hover:bg-hover/70 active:cursor-grabbing",
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
          <span className="ui-text-sm inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary-bg/80 px-1.5 py-0.5 editor-font text-text-lighter">
            <span className="min-w-0 truncate">{pr.baseRef}</span>
            <span className="shrink-0 px-1">&larr;</span>
            <span className="min-w-0 truncate">{pr.headRef}</span>
          </span>
        </div>
      </div>
    </Button>
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
  const { openPRBuffer } = useBufferStore.use.actions();
  const settings = useSettingsStore((state) => state.settings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const effectiveRepoPath = activeRepoPath ?? rootFolderPath ?? null;

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<GitHubSidebarSection>("pull-requests");
  const [sectionRefreshNonce, setSectionRefreshNonce] = useState(0);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
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

  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className="flex items-center justify-between px-0.5 py-0.5">
          <span className="ui-text-sm font-medium text-text">GitHub</span>
        </div>
        <GitHubAuthStatusMessage />
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
          <Tabs
            variant="segmented"
            size="md"
            contentLayout="stacked"
            reorderable
            onReorder={(orderedIds) =>
              updateSetting(
                "githubSidebarSectionOrder",
                orderedIds as typeof settings.githubSidebarSectionOrder,
              )
            }
            className={EQUAL_WIDTH_SEGMENTED_TABS_CLASS_NAME}
            items={sectionTabs.map((tab) => ({
              id: tab.id,
              isActive: activeSection === tab.id,
              onClick: () => setActiveSection(tab.id),
              role: "tab",
              tabIndex: 0,
              icon: <div className="relative flex items-center justify-center">{tab.icon}</div>,
              label: <span className="ui-text-sm text-center leading-none">{tab.label}</span>,
              className: EQUAL_WIDTH_SEGMENTED_TAB_ITEM_CLASS_NAME,
            }))}
          />

          <div className={paneHeaderClassName("justify-between rounded-lg")}>
            <div>
              <Button
                ref={filterTriggerRef}
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                variant="ghost"
                size="sm"
                disabled={activeSection !== "pull-requests"}
                className={dropdownTriggerClassName("ui-text-sm")}
                tooltip="Filter pull requests"
                tooltipSide="bottom"
              >
                <GitPullRequest className="shrink-0" size={16} weight="duotone" />
                <span className="truncate">
                  {activeSection === "pull-requests"
                    ? filterLabels[currentFilter]
                    : activeSection === "issues"
                      ? "Issues"
                      : "Actions"}
                </span>
                {activeSection === "pull-requests" ? <ChevronDown /> : null}
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <GitProjectSelector onRepositoryChange={() => setRepoSelectionError(null)} />

              <PaneIconButton
                onClick={handleRefreshActiveSection}
                disabled={isLoading || !effectiveRepoPath}
                className="disabled:opacity-50"
                tooltip={
                  activeSection === "pull-requests"
                    ? "Refresh pull requests"
                    : activeSection === "issues"
                      ? "Refresh issues"
                      : "Refresh workflow runs"
                }
                tooltipSide="bottom"
              >
                <RefreshCw className={isLoading ? "animate-spin" : ""} />
              </PaneIconButton>
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

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeSection === "pull-requests" && (
              <GitHubSidebarLoadingBar isVisible={isLoading} className="mx-2 mb-1 mt-1" />
            )}
            <div className="scrollbar-hidden min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              {!effectiveRepoPath ? (
                <GitHubSidebarState
                  icon={<GitBranch className="size-4" />}
                  title="No repository selected"
                  actionLabel={isSelectingRepo ? "Selecting..." : "Browse Repository"}
                  onAction={() => void handleSelectRepository()}
                  isActionDisabled={isSelectingRepo}
                />
              ) : activeSection === "issues" ? (
                <GitHubIssuesView refreshNonce={sectionRefreshNonce} />
              ) : activeSection === "actions" ? (
                <GitHubActionsView refreshNonce={sectionRefreshNonce} />
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
                  onAction={isRepoError ? () => void handleSelectRepository() : handleRefresh}
                  isActionDisabled={isSelectingRepo}
                  tone="error"
                />
              ) : isLoading && deferredPrs.length === 0 ? (
                <div className="flex items-center justify-center p-4">
                  <RefreshCw className="animate-spin text-text-lighter" />
                </div>
              ) : deferredPrs.length === 0 ? (
                <GitHubSidebarState
                  icon={<GitPullRequest className="size-4" />}
                  title="No pull requests"
                />
              ) : (
                <div className="space-y-2 overflow-x-hidden">
                  {deferredPrs.map((pr) => (
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
