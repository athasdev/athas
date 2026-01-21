import { MoreHorizontal, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { cn } from "@/utils/cn";
import { getBranches } from "../api/branches";
import { getGitLog } from "../api/commits";
import { getCommitDiff, getFileDiff, getStashDiff } from "../api/diff";
import { getStashes } from "../api/stash";
import { getGitStatus } from "../api/status";
import { useGitStore } from "../stores/git-store";
import type { MultiFileDiff } from "../types/diff";
import type { GitFile } from "../types/git";
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

const GitView = ({ repoPath, onFileSelect, isActive }: GitViewProps) => {
  const { gitStatus, isLoadingGitData, isRefreshing, actions } = useGitStore();
  const { setIsLoadingGitData, setIsRefreshing } = actions;
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showGitActionsMenu, setShowGitActionsMenu] = useState(false);
  const [gitActionsMenuPosition, setGitActionsMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [showRemoteManager, setShowRemoteManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);

  const wasActiveRef = useRef(isActive);

  const loadInitialGitData = useCallback(async () => {
    if (!repoPath) return;

    setIsLoadingGitData(true);
    try {
      const [status, commits, branches, stashes] = await Promise.all([
        getGitStatus(repoPath),
        getGitLog(repoPath, 50, 0),
        getBranches(repoPath),
        getStashes(repoPath),
      ]);

      actions.loadFreshGitData({
        gitStatus: status,
        commits,
        branches,
        stashes,
        repoPath,
      });
    } catch (error) {
      console.error("Failed to load initial git data:", error);
    } finally {
      setIsLoadingGitData(false);
    }
  }, [repoPath, actions, setIsLoadingGitData]);

  const refreshGitData = useCallback(async () => {
    if (!repoPath) return;

    try {
      const [status, branches] = await Promise.all([getGitStatus(repoPath), getBranches(repoPath)]);

      await actions.refreshGitData({
        gitStatus: status,
        branches,
        repoPath,
      });
    } catch (error) {
      console.error("Failed to refresh git data:", error);
    }
  }, [repoPath, actions]);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshGitData(), new Promise((resolve) => setTimeout(resolve, 500))]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshGitData, setIsRefreshing]);

  useEffect(() => {
    loadInitialGitData();
  }, [loadInitialGitData]);

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

      if (repoPath && path.startsWith(repoPath)) {
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
  }, [repoPath, refreshGitData]);

  useEffect(() => {
    const handleClickOutside = () => {
      if (showBranchDropdown) {
        setShowBranchDropdown(false);
      }
      if (showGitActionsMenu) {
        setShowGitActionsMenu(false);
        setGitActionsMenuPosition(null);
      }
    };

    if (showBranchDropdown || showGitActionsMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showBranchDropdown, showGitActionsMenu]);

  const handleOpenOriginalFile = async (filePath: string) => {
    if (!repoPath || !onFileSelect) return;

    try {
      let actualFilePath = filePath;

      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        actualFilePath = parts[1].trim();
      }

      if (actualFilePath.startsWith('"') && actualFilePath.endsWith('"')) {
        actualFilePath = actualFilePath.slice(1, -1);
      }

      const fullPath = `${repoPath}/${actualFilePath}`;

      onFileSelect(fullPath, false);
    } catch (error) {
      console.error("Error opening file:", error);
      alert(`Failed to open file ${filePath}:\n${error}`);
    }
  };

  const handleViewFileDiff = async (filePath: string, staged: boolean = false) => {
    if (!repoPath || !onFileSelect) return;

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

      const diff = await getFileDiff(repoPath, actualFilePath, staged);

      if (diff && (diff.lines.length > 0 || diff.is_image)) {
        const encodedPath = encodeURIComponent(actualFilePath);
        const virtualPath = `diff://${staged ? "staged" : "unstaged"}/${encodedPath}`;
        const displayName = `${actualFilePath.split("/").pop()} (${
          staged ? "staged" : "unstaged"
        })`;

        useBufferStore
          .getState()
          .actions.openBuffer(
            virtualPath,
            displayName,
            JSON.stringify(diff),
            false,
            false,
            true,
            true,
            diff,
          );
      } else {
        handleOpenOriginalFile(actualFilePath);
      }
    } catch (error) {
      console.error("Error getting file diff:", error);
      alert(`Failed to get diff for ${filePath}:\n${error}`);
    }
  };

  const handleViewCommitDiff = async (commitHash: string, filePath?: string) => {
    if (!repoPath || !onFileSelect) return;

    try {
      const diffs = await getCommitDiff(repoPath, commitHash);

      if (diffs && diffs.length > 0) {
        if (filePath) {
          const diff = diffs.find((d) => d.file_path === filePath) || diffs[0];
          const diffFileName = `${diff.file_path.split("/").pop()}.diff`;
          const virtualPath = `diff://commit/${commitHash}/${diffFileName}`;

          useBufferStore
            .getState()
            .actions.openBuffer(
              virtualPath,
              diffFileName,
              JSON.stringify(diff),
              false,
              false,
              true,
              true,
              diff,
            );
        } else {
          const totalAdditions = diffs.reduce(
            (sum, diff) => sum + diff.lines.filter((line) => line.line_type === "added").length,
            0,
          );
          const totalDeletions = diffs.reduce(
            (sum, diff) => sum + diff.lines.filter((line) => line.line_type === "removed").length,
            0,
          );

          const multiDiff: MultiFileDiff = {
            commitHash,
            files: diffs,
            totalFiles: diffs.length,
            totalAdditions,
            totalDeletions,
          };

          const virtualPath = `diff://commit/${commitHash}/all-files`;
          const displayName = `Commit ${commitHash.substring(0, 7)} (${diffs.length} files)`;

          useBufferStore
            .getState()
            .actions.openBuffer(
              virtualPath,
              displayName,
              JSON.stringify(multiDiff),
              false,
              false,
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
    if (!repoPath || !onFileSelect) return;

    try {
      const diffs = await getStashDiff(repoPath, stashIndex);

      if (diffs && diffs.length > 0) {
        const totalAdditions = diffs.reduce(
          (sum, diff) => sum + diff.lines.filter((line) => line.line_type === "added").length,
          0,
        );
        const totalDeletions = diffs.reduce(
          (sum, diff) => sum + diff.lines.filter((line) => line.line_type === "removed").length,
          0,
        );

        const multiDiff: MultiFileDiff = {
          commitHash: `stash@{${stashIndex}}`,
          files: diffs,
          totalFiles: diffs.length,
          totalAdditions,
          totalDeletions,
        };

        const virtualPath = `diff://stash/${stashIndex}/all-files`;
        const displayName = `Stash @{${stashIndex}} (${diffs.length} files)`;

        useBufferStore
          .getState()
          .actions.openBuffer(
            virtualPath,
            displayName,
            JSON.stringify(multiDiff),
            false,
            false,
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
        setGitActionsMenuPosition({
          x: rect.left,
          y: rect.bottom + 5,
        });
        setShowGitActionsMenu(!showGitActionsMenu);
        setShowBranchDropdown(false);
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

  if (!repoPath) {
    return (
      <div className="flex h-full flex-col bg-secondary-bg">
        <div
          className={cn(
            "flex items-center justify-between border-border border-b",
            "bg-secondary-bg px-2 py-1.5",
          )}
        >
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="ui-font text-center text-text-lighter text-xs">
            <div className="mb-1">No Git repository detected</div>
            <div className="text-[10px] opacity-75">Open a Git project folder</div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoadingGitData && !gitStatus) {
    return (
      <div className="flex h-full flex-col bg-secondary-bg">
        <div
          className={cn(
            "flex items-center justify-between border-border border-b",
            "bg-secondary-bg px-2 py-1.5",
          )}
        >
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="ui-font text-center text-text-lighter text-xs">Loading Git status...</div>
        </div>
      </div>
    );
  }

  if (!gitStatus) {
    return (
      <div className="flex h-full flex-col bg-secondary-bg">
        <div
          className={cn(
            "flex items-center justify-between border-border border-b",
            "bg-secondary-bg px-2 py-1.5",
          )}
        >
          <div className="flex items-center gap-2">{renderActionsButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="ui-font text-center text-text-lighter text-xs">
            <div className="mb-1">Not a Git repository</div>
            <div className="text-[10px] opacity-75">Initialize with: git init</div>
          </div>
        </div>
      </div>
    );
  }

  const stagedFiles = gitStatus.files.filter((f) => f.staged);

  return (
    <>
      <div className="ui-font flex h-full select-none flex-col bg-secondary-bg text-xs">
        <div
          className={cn(
            "flex items-center justify-between border-border border-b",
            "bg-secondary-bg px-2 py-1.5",
          )}
        >
          <div className="flex items-center gap-1">
            <GitBranchManager
              currentBranch={gitStatus.branch}
              repoPath={repoPath}
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

          <div className="flex items-center gap-0.5">
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

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="max-h-[50%] flex-none overflow-y-auto border-border border-b">
            <GitStatusPanel
              files={gitStatus.files}
              onFileSelect={handleViewFileDiff}
              onOpenFile={handleOpenOriginalFile}
              onRefresh={handleManualRefresh}
              repoPath={repoPath}
            />
          </div>

          <GitCommitHistory onViewCommitDiff={handleViewCommitDiff} repoPath={repoPath} />

          <GitStashPanel
            repoPath={repoPath}
            onRefresh={handleManualRefresh}
            onViewStashDiff={handleViewStashDiff}
          />
        </div>

        <GitCommitPanel
          stagedFilesCount={stagedFiles.length}
          repoPath={repoPath}
          onCommitSuccess={refreshGitData}
        />
      </div>

      <GitActionsMenu
        isOpen={showGitActionsMenu}
        position={gitActionsMenuPosition}
        onClose={() => {
          setShowGitActionsMenu(false);
          setGitActionsMenuPosition(null);
        }}
        hasGitRepo={!!gitStatus}
        repoPath={repoPath}
        onRefresh={handleManualRefresh}
        onOpenRemoteManager={() => setShowRemoteManager(true)}
        onOpenTagManager={() => setShowTagManager(true)}
      />

      <GitRemoteManager
        isOpen={showRemoteManager}
        onClose={() => setShowRemoteManager(false)}
        repoPath={repoPath}
        onRefresh={handleManualRefresh}
      />

      <GitTagManager
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
        repoPath={repoPath}
        onRefresh={handleManualRefresh}
      />
    </>
  );
};

export default memo(GitView);
