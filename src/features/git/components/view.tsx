import { open } from "@tauri-apps/plugin-dialog";
import { Check, ChevronDown, FolderOpen, MoreHorizontal, RefreshCw, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { cn } from "@/utils/cn";
import { getFolderName } from "@/utils/path-helpers";
import { getBranches } from "../api/branches";
import { getGitLog } from "../api/commits";
import { getCommitDiff, getFileDiff, getStashDiff } from "../api/diff";
import { resolveRepositoryPath } from "../api/repo";
import { getStashes } from "../api/stash";
import { getGitStatus } from "../api/status";
import { useGitStore } from "../stores/git-store";
import { useRepositoryStore } from "../stores/repository-store";
import type { MultiFileDiff } from "../types/diff";
import type { GitFile } from "../types/git";
import { countDiffStats } from "../utils/diff-helpers";
import GitActionsMenu from "./actions-menu";
import GitBranchManager from "./branch-manager";
import GitCommitHistory from "./commit-history";
import GitCommitPanel from "./commit-panel";
import GitRemoteManager from "./remote-manager";
import GitStashPanel from "./stash/panel";
import GitStatusPanel from "./status/panel";
import GitTagManager from "./tag-manager";

interface GitViewProps {
  repoPath?: string;
  onFileSelect?: (path: string, isDir: boolean) => void;
  isActive?: boolean;
}

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
}

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
  const [gitActionsMenuPosition, setGitActionsMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [showRemoteManager, setShowRemoteManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);

  const wasActiveRef = useRef(isActive);
  const repoTriggerRef = useRef<HTMLButtonElement>(null);
  const repoMenuRef = useRef<HTMLDivElement>(null);

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
    if (isActive && !wasActiveRef.current && gitStatus) {
      refreshGitData();
    }
    wasActiveRef.current = isActive;
  }, [isActive, gitStatus, refreshGitData]);

  useEffect(() => {
    const handleGitStatusChanged = () => {
      refreshGitData();
    };

    window.addEventListener("git-status-changed", handleGitStatusChanged);
    return () => {
      window.removeEventListener("git-status-changed", handleGitStatusChanged);
    };
  }, [refreshGitData]);

  useEffect(() => {
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
  }, [activeRepoPath, refreshGitData]);

  useEffect(() => {
    if (!showGitActionsMenu) return;

    const handleClickOutside = () => {
      setShowGitActionsMenu(false);
      setGitActionsMenuPosition(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showGitActionsMenu]);

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
          .actions.openBuffer(virtualPath, displayName, "", false, false, true, true, diff);
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
            .actions.openBuffer(virtualPath, diffFileName, "", false, false, true, true, diff);
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
            .actions.openBuffer(virtualPath, displayName, "", false, false, true, true, multiDiff);
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
          .actions.openBuffer(virtualPath, displayName, "", false, false, true, true, multiDiff);
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
        setGitActionsMenuPosition({
          x: rect.left,
          y: rect.bottom + 5,
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
        "mt-2 inline-flex items-center gap-1 rounded border border-border bg-primary-bg px-2 py-1 text-[10px] transition-colors hover:bg-hover",
        "text-text-lighter hover:text-text disabled:cursor-not-allowed disabled:opacity-50",
      )}
      title="Select repository folder"
      aria-label="Select repository folder"
    >
      <FolderOpen size={12} />
      {isSelectingRepo ? "Selecting..." : "Select Repository"}
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
      <div className="min-w-0 flex-1">
        <div className="truncate text-text text-xs">{label}</div>
        <div className="truncate text-[10px] text-text-lighter">{subtitle}</div>
      </div>
    </button>
  );

  if (!activeRepoPath) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className={cn("flex items-center justify-between px-0.5 py-0.5")}>
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border/60 bg-secondary-bg/60 p-4">
          <div className="ui-font text-center text-text-lighter text-xs">
            <div className="mb-1">No Git repository selected</div>
            <div className="text-[10px] opacity-75">
              {isDiscoveringRepos
                ? "Scanning workspace for repositories..."
                : "Open a folder, switch repository, or select one manually"}
            </div>
            {renderSelectRepositoryButton()}
            {repoSelectionError && (
              <div className="mt-2 text-[10px] text-red-400">{repoSelectionError}</div>
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
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border/60 bg-secondary-bg/60 p-4">
          <div className="ui-font text-center text-text-lighter text-xs">Loading Git status...</div>
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
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border/60 bg-secondary-bg/60 p-4">
          <div className="ui-font text-center text-text-lighter text-xs">
            <div className="mb-1">Not a Git repository</div>
            <div className="text-[10px] opacity-75">Initialize with: git init or select a repo</div>
            {renderSelectRepositoryButton()}
            {repoSelectionError && (
              <div className="mt-2 text-[10px] text-red-400">{repoSelectionError}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const stagedFiles = gitStatus.files.filter((f) => f.staged);

  return (
    <>
      <div className="ui-font flex h-full select-none flex-col gap-2 p-2 text-xs">
        <div className={cn("flex items-center justify-between px-0.5 py-0.5")}>
          <div className="flex items-center gap-1">
            <GitBranchManager
              currentBranch={gitStatus.branch}
              repoPath={activeRepoPath}
              onBranchChange={refreshGitData}
              compact
            />
            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="text-[9px] text-text-lighter">
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
                "flex h-5 max-w-44 items-center gap-1 rounded-full px-1.5 py-0.5",
                "text-text-lighter text-xs transition-colors hover:bg-hover hover:text-text",
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
          <div className="min-h-0 flex-1 overflow-y-scroll">
            <GitStatusPanel
              files={gitStatus.files}
              onFileSelect={handleViewFileDiff}
              onOpenFile={handleOpenOriginalFile}
              onRefresh={handleManualRefresh}
              repoPath={activeRepoPath}
            />
          </div>

          <div className="max-h-44 shrink-0 overflow-hidden">
            <GitStashPanel
              repoPath={activeRepoPath}
              onRefresh={handleManualRefresh}
              onViewStashDiff={handleViewStashDiff}
            />
          </div>

          <div className="max-h-52 shrink-0 overflow-hidden">
            <GitCommitHistory onViewCommitDiff={handleViewCommitDiff} repoPath={activeRepoPath} />
          </div>
        </div>

        <div className="shrink-0">
          <GitCommitPanel
            stagedFilesCount={stagedFiles.length}
            stagedFiles={stagedFiles}
            currentBranch={gitStatus.branch}
            repoPath={activeRepoPath}
            onCommitSuccess={refreshGitData}
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

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-text-lighter uppercase tracking-wide">
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
                <div className="px-2 py-2 text-[10px] text-text-lighter">
                  No repositories found in this workspace.
                </div>
              )}

              {isDiscoveringRepos && (
                <div className="flex items-center gap-1.5 px-2 py-2 text-[10px] text-text-lighter">
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
                    className="mt-1 w-full rounded-lg px-2 py-1 text-left text-[10px] text-text-lighter hover:bg-hover hover:text-text"
                  >
                    Use workspace repositories
                  </button>
                )}

                {repoSelectionError && (
                  <div className="mt-1 rounded-lg border border-error/30 bg-error/5 px-2 py-1 text-[10px] text-error/90">
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
        position={gitActionsMenuPosition}
        onClose={() => {
          setShowGitActionsMenu(false);
          setGitActionsMenuPosition(null);
        }}
        hasGitRepo={!!gitStatus}
        repoPath={activeRepoPath}
        onRefresh={handleManualRefresh}
        onOpenRemoteManager={() => setShowRemoteManager(true)}
        onOpenTagManager={() => setShowTagManager(true)}
        onSelectRepository={handleSelectRepository}
        isSelectingRepository={isSelectingRepo}
      />

      <GitRemoteManager
        isOpen={showRemoteManager}
        onClose={() => setShowRemoteManager(false)}
        repoPath={activeRepoPath}
        onRefresh={handleManualRefresh}
      />

      <GitTagManager
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
        repoPath={activeRepoPath}
        onRefresh={handleManualRefresh}
      />
    </>
  );
};

export default memo(GitView);
