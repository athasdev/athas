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
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useSettingsStore } from "@/features/settings/store";
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

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
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
  const [repoMenuPosition, setRepoMenuPosition] = useState<DropdownPosition | null>(null);
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
  const repoMenuRef = useRef<HTMLDivElement>(null);

  const visibleGitFiles = useMemo(
    () =>
      settings.showUntrackedFiles
        ? (gitStatus?.files ?? [])
        : (gitStatus?.files ?? []).filter((file) => file.status !== "untracked"),
    [gitStatus?.files, settings.showUntrackedFiles],
  );

  const updateRepoMenuPosition = useCallback(() => {
    const trigger = repoTriggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const menuWidth = 288;
    const safeWidth = Math.min(menuWidth, window.innerWidth - viewportPadding * 2);
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openUp = availableBelow < 180 && availableAbove > availableBelow;
    const top = openUp ? Math.max(viewportPadding, rect.top - 8) : rect.bottom + 6;
    const leftCandidate = rect.right - safeWidth;
    const left = Math.max(
      viewportPadding,
      Math.min(leftCandidate, window.innerWidth - safeWidth - viewportPadding),
    );

    setRepoMenuPosition({
      left,
      top,
      width: safeWidth,
    });
  }, []);

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

  const getWorkspaceRepoSubtitle = useCallback(
    (path: string) => {
      if (!repoPath) return "Workspace repository";
      if (path === repoPath) return "Workspace root repository";
      return "Workspace repository";
    },
    [repoPath],
  );

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

  useEffect(() => {
    if (!isRepoMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (repoMenuRef.current?.contains(target)) return;
      if (repoTriggerRef.current?.contains(target)) return;
      setIsRepoMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsRepoMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isRepoMenuOpen]);

  useLayoutEffect(() => {
    if (!isRepoMenuOpen) return;

    const handleReposition = () => {
      updateRepoMenuPosition();
    };

    handleReposition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isRepoMenuOpen, updateRepoMenuPosition]);

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
    <button
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
      className={cn(
        "flex h-5 w-5 cursor-pointer items-center justify-center rounded p-0",
        "text-text-lighter transition-colors hover:bg-hover hover:text-text",
      )}
      title="Git Actions"
      aria-label="Git Actions"
    >
      <MoreHorizontal size={12} />
    </button>
  );

  const renderSelectRepositoryButton = () => (
    <button
      onClick={handleSelectRepository}
      disabled={isSelectingRepo}
      className={cn(
        "mt-2 inline-flex h-6 items-center gap-1.5 rounded-lg border border-border/60 bg-secondary-bg/80 px-2.5 text-[0.8em] text-text transition-colors hover:bg-hover",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      title="Select repository folder"
      aria-label="Select repository folder"
    >
      <FolderOpen size={11} />
      {isSelectingRepo ? "Selecting..." : "Browse Repository"}
    </button>
  );

  const renderRepoOption = (
    path: string,
    label: string,
    subtitle: string,
    isActive: boolean,
    onClick: () => void,
  ) => (
    <button
      key={path}
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
      <div className="min-w-0 flex-1 pt-px">
        <div className="truncate text-[0.8em] leading-[1.15] text-text">{label}</div>
        <div className="truncate text-[0.68em] leading-[1.15] text-text-lighter/78">{subtitle}</div>
      </div>
    </button>
  );

  if (!activeRepoPath) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className={cn("flex items-center justify-between px-0.5 py-0.5")}>
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="ui-font flex max-w-72 flex-col items-center text-center">
            <div className="text-[0.8em] leading-tight text-text">No repository selected</div>
            {renderSelectRepositoryButton()}
            {workspaceRepoPaths.length === 0 && repoPath && !isDiscoveringRepos && (
              <div className="mt-2 text-[0.68em] leading-relaxed text-text-lighter/82">
                No repositories were detected under the current workspace.
              </div>
            )}
            {isDiscoveringRepos && (
              <div className="mt-2 text-[0.68em] leading-relaxed text-text-lighter/82">
                Scanning workspace for repositories...
              </div>
            )}
            {repoSelectionError && (
              <div className="mt-2 text-[0.68em] text-red-400">{repoSelectionError}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isLoadingGitData && !gitStatus) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className={cn("flex items-center justify-between px-0.5 py-0.5")}>
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="ui-font text-center text-[0.8em] text-text-lighter">
            Loading Git status...
          </div>
        </div>
      </div>
    );
  }

  if (!gitStatus) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className={cn("flex items-center justify-between px-0.5 py-0.5")}>
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="ui-font flex max-w-72 flex-col items-center text-center">
            <div className="text-[0.8em] leading-tight text-text">No repository selected</div>
            {renderSelectRepositoryButton()}
            <div className="mt-2 text-[0.68em] leading-relaxed text-text-lighter/82">
              Select another folder that contains a `.git` repository.
            </div>
            {repoSelectionError && (
              <div className="mt-2 text-[0.68em] text-red-400">{repoSelectionError}</div>
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
      <div
        className="ui-font flex h-full select-none flex-col gap-2 p-2"
        style={{ fontSize: "calc(var(--app-ui-font-size) * 0.82)" }}
      >
        <div className={cn("flex items-center justify-between px-0.5 py-0.5")}>
          <div className="flex min-w-0 items-center gap-1">
            <GitBranchManager
              currentBranch={gitStatus.branch}
              repoPath={activeRepoPath}
              onBranchChange={refreshAfterAction}
              compact
            />
            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="text-[0.78em] text-text-lighter">
                {gitStatus.ahead > 0 && <span className="text-git-added">↑{gitStatus.ahead}</span>}
                {gitStatus.behind > 0 && (
                  <span className="text-git-deleted">↓{gitStatus.behind}</span>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
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
              className={cn(
                "ui-font flex h-5 max-w-44 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.92em]",
                "text-text-lighter transition-colors hover:bg-hover hover:text-text",
              )}
              title={activeRepoPath}
            >
              <FolderOpen size={11} />
              <span className="truncate">{getFolderName(activeRepoPath)}</span>
              <ChevronDown size={8} />
            </button>
            <button
              onClick={handleManualRefresh}
              disabled={isLoadingGitData || isRefreshing}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded p-0",
                "text-text-lighter transition-colors hover:bg-hover hover:text-text",
                "disabled:opacity-50",
              )}
              title="Refresh"
              aria-label="Refresh git status"
            >
              <RefreshCw
                size={12}
                className={isLoadingGitData || isRefreshing ? "animate-spin" : ""}
              />
            </button>
            {renderActionsButton()}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <div className="grid shrink-0 grid-cols-4 gap-1 rounded-xl border border-border/60 bg-secondary-bg/40 p-1">
            {gitTabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 transition-colors",
                    isSelected
                      ? "bg-selected text-text shadow-sm"
                      : "text-text-lighter hover:bg-hover hover:text-text",
                  )}
                >
                  <div className="relative flex items-center justify-center">
                    <Icon size={16} strokeWidth={2.2} />
                  </div>
                  <span className="truncate text-[0.84em] leading-none">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-secondary-bg/20">
            {activeTab === "changes" && (
              <div className="scrollbar-none h-full overflow-y-auto">
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

            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-2">
              <div className="mb-1 flex items-center justify-between px-1 text-[0.78em] text-text-lighter">
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

              {repoPath && workspaceRepoPaths.length === 0 && !isDiscoveringRepos && (
                <div className="px-2 py-2 text-[0.78em] text-text-lighter">
                  No repositories found in this workspace.
                </div>
              )}

              {isDiscoveringRepos && (
                <div className="flex items-center gap-1.5 px-2 py-2 text-[0.78em] text-text-lighter">
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
                    onClick={handleUseWorkspaceRoot}
                    className="mt-1 w-full rounded-lg px-2 py-1 text-left text-[0.78em] text-text-lighter hover:bg-hover hover:text-text"
                  >
                    Use workspace repositories
                  </button>
                )}

                {repoSelectionError && (
                  <div className="mt-1 rounded-lg border border-error/30 bg-error/5 px-2 py-1 text-[0.78em] text-error/90">
                    {repoSelectionError}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

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
