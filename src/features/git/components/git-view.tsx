import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  Check,
  ChevronDown,
  GitFork,
  FolderGit2,
  FolderOpen,
  History,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
import { dropdownTriggerClassName } from "@/ui/dropdown";
import { PANE_GROUP_BASE, paneHeaderClassName, paneIconButtonClassName } from "@/ui/pane";
import { Dropdown } from "@/ui/dropdown";
import { Tab, TabsList } from "@/ui/tabs";
import { cn } from "@/utils/cn";
import { getFolderName } from "@/utils/path-helpers";
import { getBranches } from "../api/git-branches-api";
import { getGitLog } from "../api/git-commits-api";
import { getCommitDiff, getFileDiff, getStashDiff } from "../api/git-diff-api";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { getStashes } from "../api/git-stash-api";
import { getGitStatus } from "../api/git-status-api";
import { useGitStore } from "../stores/git-store";
import { useRepositoryStore } from "../stores/git-repository-store";
import type { MultiFileDiff } from "../types/git-diff-types";
import type { GitFile } from "../types/git-types";
import { countDiffStats } from "../utils/git-diff-helpers";
import type { GitActionsMenuAnchorRect } from "../utils/git-actions-menu-position";
import GitActionsMenu from "./git-actions-menu";
import GitBranchManager from "./git-branch-manager";
import GitCommitHistory from "./git-commit-history";
import GitCommitPanel from "./git-commit-panel";
import GitRemoteManager from "./git-remote-manager";
import GitStashPanel from "./stash/git-stash-panel";
import GitStatusPanel from "./status/git-status-panel";
import GitTagManager from "./git-tag-manager";
import GitWorktreeManager from "./git-worktree-manager";

interface GitViewProps {
  repoPath?: string;
  onFileSelect?: (path: string, isDir: boolean) => void;
  isActive?: boolean;
}

interface GitFileDiffStats {
  additions: number;
  deletions: number;
}

type GitSidebarTab = "changes" | "stash" | "history" | "worktrees";

const GitView = ({ repoPath, onFileSelect, isActive }: GitViewProps) => {
  const { gitStatus, isLoadingGitData, isRefreshing, actions } = useGitStore();
  const { setIsLoadingGitData, setIsRefreshing } = actions;
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const workspaceRepoPaths = useRepositoryStore.use.workspaceRepoPaths();
  const manualRepoPath = useRepositoryStore.use.manualRepoPath();
  const isDiscoveringRepos = useRepositoryStore.use.isDiscovering();
  const {
    syncWorkspaceRepositories,
    selectRepository,
    setManualRepository,
    clearManualRepository,
    refreshWorkspaceRepositories,
  } = useRepositoryStore.use.actions();
  const [showGitActionsMenu, setShowGitActionsMenu] = useState(false);
  const [isRepoMenuOpen, setIsRepoMenuOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [gitActionsMenuAnchor, setGitActionsMenuAnchor] = useState<GitActionsMenuAnchorRect | null>(
    null,
  );

  const [showRemoteManager, setShowRemoteManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const settings = useSettingsStore((state) => state.settings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [activeTab, setActiveTab] = useState<GitSidebarTab>("changes");
  const [fileDiffStats, setFileDiffStats] = useState<Record<string, GitFileDiffStats>>({});

  const wasActiveRef = useRef(isActive);
  const repoTriggerRef = useRef<HTMLButtonElement>(null);

  const visibleGitFiles = useMemo(
    () =>
      settings.showUntrackedFiles
        ? (gitStatus?.files ?? [])
        : (gitStatus?.files ?? []).filter((file) => file.status !== "untracked"),
    [gitStatus?.files, settings.showUntrackedFiles],
  );

  const handleSelectRepository = useCallback(async () => {
    setIsSelectingRepo(true);
    setRepoSelectionError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      const resolvedRepoPath = await resolveRepositoryPath(selected);
      if (!resolvedRepoPath) {
        const message = "Selected folder is not inside a Git repository.";
        setRepoSelectionError(message);
        alert(message);
        return;
      }

      setManualRepository(resolvedRepoPath);
      setIsRepoMenuOpen(false);
    } catch (error) {
      console.error("Failed to select repository:", error);
      const message = "Failed to select repository";
      setRepoSelectionError(message);
      alert(`${message}:\n${error}`);
    } finally {
      setIsSelectingRepo(false);
    }
  }, [setManualRepository]);

  const handleUseWorkspaceRoot = useCallback(() => {
    clearManualRepository();
    setRepoSelectionError(null);
    setIsRepoMenuOpen(false);
  }, [clearManualRepository]);

  const loadInitialGitData = useCallback(async () => {
    if (!activeRepoPath) return;

    setIsLoadingGitData(true);
    try {
      const [status, commits, branches, stashes] = await Promise.all([
        getGitStatus(activeRepoPath),
        getGitLog(activeRepoPath, 50, 0),
        getBranches(activeRepoPath),
        getStashes(activeRepoPath),
      ]);

      actions.loadFreshGitData({
        gitStatus: status,
        commits,
        branches,
        stashes,
        repoPath: activeRepoPath,
      });
    } catch (error) {
      console.error("Failed to load initial git data:", error);
    } finally {
      setIsLoadingGitData(false);
    }
  }, [activeRepoPath, actions, setIsLoadingGitData]);

  const refreshGitData = useCallback(async () => {
    if (!activeRepoPath) return;

    try {
      const [status, branches] = await Promise.all([
        getGitStatus(activeRepoPath),
        getBranches(activeRepoPath),
      ]);

      await actions.refreshGitData({
        gitStatus: status,
        branches,
        repoPath: activeRepoPath,
      });
    } catch (error) {
      console.error("Failed to refresh git data:", error);
    }
  }, [activeRepoPath, actions]);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refreshGitData(),
        refreshWorkspaceRepositories(),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshGitData, refreshWorkspaceRepositories, setIsRefreshing]);

  useEffect(() => {
    void syncWorkspaceRepositories(repoPath ?? null);
  }, [repoPath, syncWorkspaceRepositories]);

  useEffect(() => {
    loadInitialGitData();
  }, [loadInitialGitData]);

  useEffect(() => {
    setRepoSelectionError(null);
    setIsRepoMenuOpen(false);
  }, [repoPath]);

  useEffect(() => {
    if (settings.autoRefreshGitStatus && isActive && !wasActiveRef.current && gitStatus) {
      refreshGitData();
    }
    wasActiveRef.current = isActive;
  }, [settings.autoRefreshGitStatus, isActive, gitStatus, refreshGitData]);

  useEffect(() => {
    if (!settings.autoRefreshGitStatus) return;

    const handleGitStatusChanged = () => {
      refreshGitData();
    };

    window.addEventListener("git-status-changed", handleGitStatusChanged);
    return () => {
      window.removeEventListener("git-status-changed", handleGitStatusChanged);
    };
  }, [settings.autoRefreshGitStatus, refreshGitData]);

  useEffect(() => {
    if (!settings.autoRefreshGitStatus) return;

    let refreshTimeout: NodeJS.Timeout | null = null;

    const handleFileChange = (event: CustomEvent) => {
      const { path } = event.detail;

      if (activeRepoPath && path.startsWith(activeRepoPath)) {
        if (refreshTimeout) {
          clearTimeout(refreshTimeout);
        }

        refreshTimeout = setTimeout(() => {
          refreshGitData();
        }, 300);
      }
    };

    window.addEventListener("file-external-change", handleFileChange as any);

    return () => {
      window.removeEventListener("file-external-change", handleFileChange as any);
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
    };
  }, [settings.autoRefreshGitStatus, activeRepoPath, refreshGitData]);

  useEffect(() => {
    if (!settings.rememberLastGitPanelMode) return;
    setActiveTab(settings.gitLastPanelMode);
  }, [settings.rememberLastGitPanelMode, settings.gitLastPanelMode]);

  useEffect(() => {
    if (!settings.rememberLastGitPanelMode) return;
    if (settings.gitLastPanelMode !== activeTab) {
      void updateSetting("gitLastPanelMode", activeTab);
    }
  }, [activeTab, settings.rememberLastGitPanelMode, settings.gitLastPanelMode, updateSetting]);

  useEffect(() => {
    if (!activeRepoPath || !visibleGitFiles.length) {
      setFileDiffStats({});
      return;
    }

    let isCancelled = false;

    const loadFileDiffStats = async () => {
      const uniqueFiles = Array.from(
        new Map(
          visibleGitFiles.map((file) => [
            `${file.staged ? "staged" : "unstaged"}:${file.path}`,
            file,
          ]),
        ).values(),
      );

      const statsEntries = await Promise.all(
        uniqueFiles.map(async (file) => {
          const diff = await getFileDiff(activeRepoPath, file.path, file.staged);
          const { additions, deletions } = diff
            ? countDiffStats([diff])
            : { additions: 0, deletions: 0 };
          return [
            `${file.staged ? "staged" : "unstaged"}:${file.path}`,
            { additions, deletions },
          ] as const;
        }),
      );

      if (!isCancelled) {
        setFileDiffStats(Object.fromEntries(statsEntries));
      }
    };

    void loadFileDiffStats();

    return () => {
      isCancelled = true;
    };
  }, [activeRepoPath, visibleGitFiles]);

  const handleOpenOriginalFile = async (filePath: string) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      let actualFilePath = filePath;

      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        actualFilePath = parts[1].trim();
      }

      if (actualFilePath.startsWith('"') && actualFilePath.endsWith('"')) {
        actualFilePath = actualFilePath.slice(1, -1);
      }

      const fullPath = `${activeRepoPath}/${actualFilePath}`;

      onFileSelect(fullPath, false);
    } catch (error) {
      console.error("Error opening file:", error);
      alert(`Failed to open file ${filePath}:\n${error}`);
    }
  };

  const handleViewFileDiff = async (filePath: string, staged: boolean = false) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      let actualFilePath = filePath;

      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        if (staged) {
          actualFilePath = parts[1].trim();
        } else {
          actualFilePath = parts[0].trim();
        }
      }

      if (actualFilePath.startsWith('"') && actualFilePath.endsWith('"')) {
        actualFilePath = actualFilePath.slice(1, -1);
      }

      const file = gitStatus?.files.find((f: GitFile) => f.path === actualFilePath);

      if (file && file.status === "untracked" && !staged) {
        handleOpenOriginalFile(actualFilePath);
        return;
      }

      const diff = await getFileDiff(activeRepoPath, actualFilePath, staged);

      if (diff && (diff.lines.length > 0 || diff.is_image)) {
        const encodedPath = encodeURIComponent(actualFilePath);
        const virtualPath = `diff://${staged ? "staged" : "unstaged"}/${encodedPath}`;
        const displayName = `${actualFilePath.split("/").pop()} (${
          staged ? "staged" : "unstaged"
        })`;

        useBufferStore
          .getState()
          .actions.openBuffer(virtualPath, displayName, "", false, undefined, true, true, diff);
      } else {
        handleOpenOriginalFile(actualFilePath);
      }
    } catch (error) {
      console.error("Error getting file diff:", error);
      alert(`Failed to get diff for ${filePath}:\n${error}`);
    }
  };

  const handleViewCommitDiff = async (commitHash: string, filePath?: string) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      const diffs = await getCommitDiff(activeRepoPath, commitHash);

      if (diffs && diffs.length > 0) {
        if (filePath) {
          const diff = diffs.find((d) => d.file_path === filePath) || diffs[0];
          const diffFileName = `${diff.file_path.split("/").pop()}.diff`;
          const virtualPath = `diff://commit/${commitHash}/${diffFileName}`;

          useBufferStore
            .getState()
            .actions.openBuffer(virtualPath, diffFileName, "", false, undefined, true, true, diff);
        } else {
          const { additions, deletions } = countDiffStats(diffs);

          const multiDiff: MultiFileDiff = {
            commitHash,
            files: diffs,
            totalFiles: diffs.length,
            totalAdditions: additions,
            totalDeletions: deletions,
          };

          const virtualPath = `diff://commit/${commitHash}/all-files`;
          const displayName = `Commit ${commitHash.substring(0, 7)} (${diffs.length} files)`;

          useBufferStore
            .getState()
            .actions.openBuffer(
              virtualPath,
              displayName,
              "",
              false,
              undefined,
              true,
              true,
              multiDiff,
            );
        }
      } else {
        alert(`No changes in this commit${filePath ? ` for file ${filePath}` : ""}.`);
      }
    } catch (error) {
      console.error("Error getting commit diff:", error);
      alert(`Failed to get diff for commit ${commitHash}:\n${error}`);
    }
  };

  const handleViewStashDiff = async (stashIndex: number) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      const diffs = await getStashDiff(activeRepoPath, stashIndex);

      if (diffs && diffs.length > 0) {
        const { additions, deletions } = countDiffStats(diffs);

        const multiDiff: MultiFileDiff = {
          commitHash: `stash@{${stashIndex}}`,
          files: diffs,
          totalFiles: diffs.length,
          totalAdditions: additions,
          totalDeletions: deletions,
        };

        const virtualPath = `diff://stash/${stashIndex}/all-files`;
        const displayName = `Stash @{${stashIndex}} (${diffs.length} files)`;

        useBufferStore
          .getState()
          .actions.openBuffer(
            virtualPath,
            displayName,
            "",
            false,
            undefined,
            true,
            true,
            multiDiff,
          );
      } else {
        alert("No changes in this stash.");
      }
    } catch (error) {
      console.error("Error getting stash diff:", error);
      alert(`Failed to get diff for stash@{${stashIndex}}:\n${error}`);
    }
  };

  const renderActionsButton = () => (
    <Button
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setGitActionsMenuAnchor({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        });
        setShowGitActionsMenu(!showGitActionsMenu);
        setIsRepoMenuOpen(false);
      }}
      variant="ghost"
      size="icon-sm"
      className={cn(paneIconButtonClassName(), "size-6")}
      title="Git Actions"
      aria-label="Git Actions"
    >
      <MoreHorizontal />
    </Button>
  );

  const renderSelectRepositoryButton = () => (
    <Button
      onClick={handleSelectRepository}
      disabled={isSelectingRepo}
      variant="ghost"
      size="sm"
      className={cn(
        "mt-1.5 ui-font ui-text-sm text-accent transition-colors hover:text-accent/80",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      title="Select repository folder"
      aria-label="Select repository folder"
    >
      {isSelectingRepo ? "Selecting..." : "Browse Repository"}
    </Button>
  );

  const renderRepoOption = (
    path: string,
    label: string,
    isActive: boolean,
    onClick: () => void,
  ) => (
    <Button
      key={path}
      onClick={onClick}
      variant="ghost"
      size="sm"
      className={cn(
        "group flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover",
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

  if (!activeRepoPath) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className={paneHeaderClassName("justify-between rounded-lg")}>
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="ui-font flex flex-col items-center text-center">
            <span className="ui-text-sm text-text-lighter">No repository selected</span>
            {renderSelectRepositoryButton()}
            {repoSelectionError && (
              <span className="ui-text-sm mt-1.5 text-red-400">{repoSelectionError}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isLoadingGitData && !gitStatus) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className={paneHeaderClassName("justify-between rounded-lg")}>
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="ui-font ui-text-sm text-center text-text-lighter">
            Loading Git status...
          </div>
        </div>
      </div>
    );
  }

  if (!gitStatus) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className={paneHeaderClassName("justify-between rounded-lg")}>
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="ui-font flex flex-col items-center text-center">
            <span className="ui-text-sm text-text-lighter">Not a Git repository</span>
            {renderSelectRepositoryButton()}
            {repoSelectionError && (
              <span className="ui-text-sm mt-1.5 text-red-400">{repoSelectionError}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const stagedFiles = visibleGitFiles.filter((f) => f.staged);
  const refreshAfterAction = settings.autoRefreshGitStatus ? handleManualRefresh : undefined;
  const handleGitFileClick = settings.openDiffOnClick ? handleViewFileDiff : handleOpenOriginalFile;
  const gitTabs: Array<{
    id: GitSidebarTab;
    label: string;
    icon: typeof FolderGit2;
  }> = [
    {
      id: "changes",
      label: "Changes",
      icon: FolderGit2,
    },
    {
      id: "stash",
      label: "Stashes",
      icon: Archive,
    },
    {
      id: "history",
      label: "History",
      icon: History,
    },
    {
      id: "worktrees",
      label: "Worktrees",
      icon: GitFork,
    },
  ];

  return (
    <>
      <div className="ui-font ui-text-sm flex h-full select-none flex-col gap-2 p-2">
        <div className={paneHeaderClassName("flex-wrap justify-between rounded-lg h-auto min-h-9")}>
          <div className={cn(PANE_GROUP_BASE, "min-w-0 flex-wrap")}>
            <GitBranchManager
              currentBranch={gitStatus.branch}
              repoPath={activeRepoPath}
              onBranchChange={refreshAfterAction}
              compact
            />
            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="ui-text-sm text-text-lighter">
                {gitStatus.ahead > 0 && <span className="text-git-added">↑{gitStatus.ahead}</span>}
                {gitStatus.behind > 0 && (
                  <span className="text-git-deleted">↓{gitStatus.behind}</span>
                )}
              </span>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              ref={repoTriggerRef}
              onClick={() => {
                setIsRepoMenuOpen((value) => {
                  const nextOpen = !value;
                  if (nextOpen) {
                    void refreshWorkspaceRepositories();
                  }
                  return nextOpen;
                });
                setShowGitActionsMenu(false);
              }}
              variant="ghost"
              size="sm"
              className={dropdownTriggerClassName("ui-text-sm max-w-40")}
              title={activeRepoPath}
            >
              <FolderOpen className="shrink-0" />
              <span className="truncate">{getFolderName(activeRepoPath)}</span>
              <ChevronDown />
            </Button>
            <Button
              onClick={handleManualRefresh}
              disabled={isLoadingGitData || isRefreshing}
              variant="ghost"
              size="icon-sm"
              className={cn(paneIconButtonClassName(), "size-6", "disabled:opacity-50")}
              title="Refresh"
              aria-label="Refresh git status"
            >
              <RefreshCw className={isLoadingGitData || isRefreshing ? "animate-spin" : ""} />
            </Button>
            {renderActionsButton()}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <TabsList
            variant="segmented"
            className="grid h-auto shrink-0 grid-cols-4 border-border/60 bg-secondary-bg/40"
          >
            {gitTabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;

              return (
                <Tab
                  key={tab.id}
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(tab.id)}
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

          <div
            className={cn(
              "min-h-0 flex-1 overflow-hidden",
              activeTab === "changes"
                ? ""
                : "rounded-xl border border-border/60 bg-secondary-bg/20",
            )}
          >
            {activeTab === "changes" && (
              <div className="h-full overflow-hidden">
                <GitStatusPanel
                  files={visibleGitFiles}
                  fileDiffStats={fileDiffStats}
                  onFileSelect={handleGitFileClick}
                  onOpenFile={handleOpenOriginalFile}
                  onRefresh={refreshAfterAction}
                  repoPath={activeRepoPath}
                />
              </div>
            )}

            {activeTab === "stash" && (
              <div className="h-full p-1">
                <GitStashPanel
                  isCollapsed={false}
                  onToggle={() => {}}
                  repoPath={activeRepoPath}
                  onRefresh={refreshAfterAction}
                  onViewStashDiff={handleViewStashDiff}
                  showHeader={false}
                />
              </div>
            )}

            {activeTab === "history" && (
              <div className="h-full p-1">
                <GitCommitHistory
                  isCollapsed={false}
                  onToggle={() => {}}
                  onViewCommitDiff={handleViewCommitDiff}
                  repoPath={activeRepoPath}
                  showHeader={false}
                />
              </div>
            )}

            {activeTab === "worktrees" && (
              <div className="h-full overflow-hidden">
                <GitWorktreeManager
                  embedded
                  repoPath={activeRepoPath}
                  onRefresh={refreshAfterAction}
                  onSelectWorktree={(worktreePath) => {
                    selectRepository(worktreePath);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <GitCommitPanel
            stagedFilesCount={stagedFiles.length}
            stagedFiles={stagedFiles}
            currentBranch={gitStatus.branch}
            repoPath={activeRepoPath}
            onCommitSuccess={refreshAfterAction}
          />
        </div>
      </div>

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

          {repoPath && workspaceRepoPaths.length === 0 && !isDiscoveringRepos && (
            <div className="ui-text-sm px-2 py-1.5 text-text-lighter">
              No repositories found in this workspace.
            </div>
          )}

          {isDiscoveringRepos && (
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
              className="ui-text-sm flex w-full items-center gap-2 rounded-lg text-left text-text-lighter disabled:opacity-60"
            >
              <FolderOpen />
              {isSelectingRepo ? "Selecting..." : "Browse Repository..."}
            </Button>

            {manualRepoPath && (
              <Button
                onClick={handleUseWorkspaceRoot}
                variant="ghost"
                size="sm"
                className="ui-text-sm mt-1 w-full rounded-lg px-2 py-1 text-left text-text-lighter hover:text-text"
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

      <GitActionsMenu
        isOpen={showGitActionsMenu}
        anchorRect={gitActionsMenuAnchor}
        onClose={() => {
          setShowGitActionsMenu(false);
          setGitActionsMenuAnchor(null);
        }}
        hasGitRepo={!!gitStatus}
        repoPath={activeRepoPath}
        onRefresh={refreshAfterAction}
        onOpenRemoteManager={() => setShowRemoteManager(true)}
        onOpenTagManager={() => setShowTagManager(true)}
        onSelectRepository={handleSelectRepository}
        isSelectingRepository={isSelectingRepo}
      />

      <GitRemoteManager
        isOpen={showRemoteManager}
        onClose={() => setShowRemoteManager(false)}
        repoPath={activeRepoPath}
        onRefresh={refreshAfterAction}
      />

      <GitTagManager
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
        repoPath={activeRepoPath}
        onRefresh={refreshAfterAction}
      />
    </>
  );
};

export default memo(GitView);
