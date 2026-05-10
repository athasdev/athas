import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitHubAuthStatusMessage } from "./github-auth-status";
import {
  ArrowSquareOut,
  ChatCircleText,
  Copy,
  GitBranch,
  GitPullRequest,
  Lightning,
  MagnifyingGlass as Search,
  Plus,
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
import { getRemotes } from "@/features/git/api/git-remotes-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown, dropdownItemClassName, dropdownTriggerClassName } from "@/ui/dropdown";
import {
  SidebarEmptyActionState,
  SidebarFooter,
  SidebarHeader,
  SidebarHeaderSearch,
  SidebarListItem,
  SidebarPanel,
  SidebarSectionPager,
  SidebarSectionSwitcher,
} from "@/ui/sidebar";
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

function parseGitHubRemoteSlug(remoteUrl: string): { owner: string; repo: string } | null {
  const normalized = remoteUrl.trim();
  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    const [, owner, repo] = httpsMatch;
    return { owner, repo };
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    const [, owner, repo] = sshMatch;
    return { owner, repo };
  }

  return null;
}

async function getGitHubRepositoryUrl(repoPath: string): Promise<string | null> {
  const remotes = await getRemotes(repoPath);
  const remoteUrl =
    remotes.find((remote) => remote.name === "origin")?.url ?? remotes[0]?.url ?? null;
  if (!remoteUrl) return null;

  const slug = parseGitHubRemoteSlug(remoteUrl);
  return slug ? `https://github.com/${slug.owner}/${slug.repo}` : null;
}

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
          <span className="ui-text-sm inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary-bg/80 px-1.5 py-0.5 editor-font text-text-lighter">
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
  const { openPRBuffer } = useBufferStore.use.actions();
  const settings = useSettingsStore((state) => state.settings);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const effectiveRepoPath = activeRepoPath ?? rootFolderPath ?? null;

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<GitHubSidebarSection>("pull-requests");
  const [sectionRefreshNonce, setSectionRefreshNonce] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
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

  const openGitHubRepositoryPath = useCallback(
    async (path: string) => {
      if (!effectiveRepoPath) return;
      const repositoryUrl = await getGitHubRepositoryUrl(effectiveRepoPath);
      if (!repositoryUrl) return;
      await openUrl(`${repositoryUrl}${path}`);
    },
    [effectiveRepoPath],
  );

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

          <SidebarHeader className="justify-between bg-transparent px-0 py-0 backdrop-blur-none">
            <div>
              <Button
                ref={filterTriggerRef}
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                variant="ghost"
                compact
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
            </div>
          </SidebarHeader>

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
                compact
                className={cn(
                  dropdownItemClassName("justify-start"),
                  filter === currentFilter && "bg-selected text-accent",
                )}
              >
                {filterLabels[filter]}
              </Button>
            ))}
          </Dropdown>

          <SidebarHeader className="px-0">
            <SidebarHeaderSearch
              value={searchQuery}
              onChange={setSearchQuery}
              leftIcon={Search}
              placeholder="Search"
            />
          </SidebarHeader>

          <SidebarSectionPager
            className="flex-1"
            items={[
              {
                id: "pull-requests",
                content: (
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <GitHubSidebarLoadingBar isVisible={isLoading} className="mx-1 mb-1 mt-1" />
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
                          <RefreshCw className="animate-spin text-text-lighter" />
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
                  <GitHubIssuesView refreshNonce={sectionRefreshNonce} searchQuery={searchQuery} />
                ),
              },
              {
                id: "actions",
                content: (
                  <GitHubActionsView refreshNonce={sectionRefreshNonce} searchQuery={searchQuery} />
                ),
              },
            ].filter((item) => sectionTabs.some((tab) => tab.id === item.id))}
            value={activeSection}
            onChange={(section) => setActiveSection(section as GitHubSidebarSection)}
          />

          <SidebarFooter className="px-0 py-1.5">
            <div className="grid grid-cols-3 gap-1">
              <Button
                type="button"
                variant="ghost"
                compact
                className="h-7 min-w-0 rounded-md px-1.5 text-xs text-text-lighter"
                disabled={!effectiveRepoPath}
                tooltip="New Pull Request"
                tooltipSide="top"
                onClick={() => void openGitHubRepositoryPath("/compare?expand=1")}
              >
                <GitPullRequest />
                <span className="truncate">PR</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                compact
                className="h-7 min-w-0 rounded-md px-1.5 text-xs text-text-lighter"
                disabled={!effectiveRepoPath}
                tooltip="New Issue"
                tooltipSide="top"
                onClick={() => void openGitHubRepositoryPath("/issues/new")}
              >
                <ChatCircleText />
                <span className="truncate">Issue</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                compact
                className="h-7 min-w-0 rounded-md px-1.5 text-xs text-text-lighter"
                disabled={!effectiveRepoPath}
                tooltip="Run Workflow"
                tooltipSide="top"
                onClick={() => void openGitHubRepositoryPath("/actions")}
              >
                <Plus />
                <span className="truncate">Action</span>
              </Button>
            </div>
          </SidebarFooter>
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
  );
});

GitHubPRsView.displayName = "GitHubPRsView";

export default GitHubPRsView;
