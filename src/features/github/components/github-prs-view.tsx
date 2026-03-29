import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { isNotGitRepositoryError, resolveRepositoryPath } from "@/features/git/api/git-repo-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import {
  dismissGitHubAuthMigrationNotice,
  isGitHubAuthMigrationNoticeDismissed,
} from "@/features/github/lib/github-auth-notice";
import { useSettingsStore } from "@/features/settings/store";
import { useContextMenu } from "@/hooks/use-context-menu";
import { Button, buttonVariants } from "@/ui/button";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown, dropdownItemClassName, dropdownTriggerClassName } from "@/ui/dropdown";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { getFolderName } from "@/utils/path-helpers";
import { useGitHubStore } from "../stores/github-store";
import type { PRFilter, PullRequest } from "../types/github";
import GitHubActionsView from "./github-actions-view";
import GitHubAuthSurface from "./github-auth-surface";
import GitHubIssuesView from "./github-issues-view";

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
  onContextMenu: (event: React.MouseEvent, pr: PullRequest) => void;
}

const PRListItem = memo(({ pr, isActive, onSelect, onContextMenu }: PRListItemProps) => {
  return (
    <Button
      onClick={onSelect}
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
});

PRListItem.displayName = "PRListItem";

const GitHubPRsView = memo(() => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const {
    authStatus,
    authSource,
    cliAvailable,
    currentUser,
    hasLegacyStoredToken,
    prs,
    isLoading,
    error,
    currentFilter,
    isAuthenticated,
  } = useGitHubStore();
  const { fetchPRs, setFilter, refreshAuthStatus, setActiveRepoPath, openPRInBrowser, checkoutPR } =
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
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const { openPRBuffer } = useBufferStore.use.actions();
  const settings = useSettingsStore((state) => state.settings);

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isRepoMenuOpen, setIsRepoMenuOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<GitHubSidebarSection>("pull-requests");
  const [isMigrationNoticeDismissed, setIsMigrationNoticeDismissed] = useState(() =>
    isGitHubAuthMigrationNoticeDismissed(),
  );
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const repoTriggerRef = useRef<HTMLButtonElement>(null);
  const prContextMenu = useContextMenu<PullRequest>();

  const isRepoError = !!error && isNotGitRepositoryError(error);
  const activePRNumber = useMemo(() => {
    const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
    return activeBuffer?.type === "pullRequest" ? activeBuffer.prNumber : null;
  }, [activeBufferId, buffers]);
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
    void refreshAuthStatus();
  }, [refreshAuthStatus]);

  useEffect(() => {
    if (availableSections.length === 0) return;
    if (!availableSections.includes(activeSection)) {
      setActiveSection(availableSections[0]);
    }
  }, [activeSection, availableSections]);

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
    (pr: PullRequest) => {
      openPRBuffer(pr.number, {
        title: pr.title,
        authorAvatarUrl:
          pr.author.avatarUrl ||
          `https://github.com/${encodeURIComponent(pr.author.login || "github")}.png?size=32`,
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
            void openPRInBrowser(selectedPR.url);
          },
        },
        {
          id: "checkout-branch",
          label: authSource === "pat" ? "Checkout Branch (CLI required)" : "Checkout Branch",
          icon: <GitBranch />,
          disabled: authSource === "pat",
          onClick: () => {
            if (activeRepoPath) {
              void checkoutPR(activeRepoPath, selectedPR.number);
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

  const authSourceLabel =
    authSource === "gh"
      ? "GitHub CLI"
      : authSource === "pat"
        ? "PAT fallback"
        : cliAvailable
          ? "Not connected"
          : "CLI missing";

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
      <GitHubAuthSurface
        authStatus={authStatus}
        repoPath={activeRepoPath ?? rootFolderPath}
        onRetry={() => {
          void refreshAuthStatus();
        }}
      />
    );
  }

  return (
    <div className="ui-font flex h-full select-none flex-col gap-2 p-2">
      {hasLegacyStoredToken && !isMigrationNoticeDismissed ? (
        <div className="rounded-2xl border border-border/60 bg-secondary-bg/50 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="ui-text-sm text-text">GitHub CLI is now the preferred auth path.</p>
              <p className="ui-text-sm mt-1 text-text-lighter">
                Your existing stored token still works as a fallback until you remove it.
              </p>
            </div>
            <Button
              onClick={() => {
                dismissGitHubAuthMigrationNotice();
                setIsMigrationNoticeDismissed(true);
              }}
              variant="ghost"
              size="xs"
              className="h-auto shrink-0 px-0 text-text-lighter hover:bg-transparent hover:text-text"
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 px-0.5 py-0.5">
        {availableSections.map((section) => (
          <Button
            key={section}
            type="button"
            variant="ghost"
            size="xs"
            active={activeSection === section}
            onClick={() => setActiveSection(section)}
            className="rounded-md px-2"
          >
            {section === "pull-requests"
              ? "Pull Requests"
              : section === "issues"
                ? "Issues"
                : "Actions"}
          </Button>
        ))}
      </div>

      {availableSections.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center">
          <p className="ui-text-sm text-text-lighter">
            Enable GitHub sidebar sections in Settings → Appearance.
          </p>
        </div>
      ) : (
        <>
          <div className="ui-text-sm flex items-center justify-between gap-2 px-1 text-text-lighter">
            <span>{currentUser ? `Signed in as ${currentUser}` : "GitHub connected"}</span>
            <span>{authSourceLabel}</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5 py-0.5">
            <div>
              {activeSection === "pull-requests" ? (
                <Tooltip content="Filter pull requests" side="bottom">
                  <Button
                    ref={filterTriggerRef}
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    variant="ghost"
                    size="sm"
                    className={dropdownTriggerClassName("ui-text-sm")}
                  >
                    <GitPullRequest className="shrink-0" />
                    <span className="truncate">{filterLabels[currentFilter]}</span>
                    <ChevronDown />
                  </Button>
                </Tooltip>
              ) : (
                <span className="ui-text-sm px-1 text-text">
                  {activeSection === "issues" ? "Open Issues" : "Workflow Runs"}
                </span>
              )}
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
                    className={dropdownTriggerClassName("ui-text-sm max-w-40")}
                  >
                    <FolderOpen className="shrink-0" />
                    <span className="truncate">
                      {activeRepoPath ? getFolderName(activeRepoPath) : "Select Repo"}
                    </span>
                    <ChevronDown />
                  </Button>
                </Tooltip>
              </div>

              {activeSection === "pull-requests" && (
                <Tooltip content="Refresh pull requests" side="bottom">
                  <Button
                    onClick={handleRefresh}
                    disabled={isLoading || !activeRepoPath}
                    variant="ghost"
                    size="icon-sm"
                    className="text-text-lighter"
                    aria-label="Refresh pull requests"
                  >
                    <RefreshCw className={isLoading ? "animate-spin" : ""} />
                  </Button>
                </Tooltip>
              )}
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
            ) : activeSection === "issues" ? (
              <GitHubIssuesView />
            ) : activeSection === "actions" ? (
              <GitHubActionsView />
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
                    isActive={activePRNumber === pr.number}
                    onSelect={() => handleSelectPR(pr)}
                    onContextMenu={handlePRContextMenu}
                  />
                ))}
              </div>
            )}
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
