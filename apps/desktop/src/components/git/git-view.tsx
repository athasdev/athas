import { GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useBufferStore } from "../../stores/buffer-store";
import { useGitStore } from "../../stores/git-store";
import { getBranches, getCommitDiff, getFileDiff, getGitLog, getGitStatus } from "../../utils/git";
import type { MultiFileDiff } from "../diff-viewer/utils/types";

// Import modular components
import GitActionsMenu from "./git-actions-menu";
import GitBranchManager from "./git-branch-manager";
import GitCommitHistory from "./git-commit-history";
import GitCommitPanel from "./git-commit-panel";
import GitRemoteManager from "./git-remote-manager";
import GitStashManager from "./git-stash-manager";
import GitStatusPanel from "./git-status-panel";
import GitTagManager from "./git-tag-manager";

interface GitViewProps {
  repoPath?: string;
  onFileSelect?: (path: string, isDir: boolean) => void;
}

const GitView = ({ repoPath, onFileSelect }: GitViewProps) => {
  const { gitStatus, isLoadingGitData, isRefreshing, actions } = useGitStore();
  const { setIsLoadingGitData, setIsRefreshing } = actions;
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showGitActionsMenu, setShowGitActionsMenu] = useState(false);
  const [gitActionsMenuPosition, setGitActionsMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Modal states
  const [showStashManager, setShowStashManager] = useState(false);
  const [showRemoteManager, setShowRemoteManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);

  // Load Git status, commits, and branches
  const loadGitData = useCallback(async () => {
    if (!repoPath) return;

    setIsLoadingGitData(true);
    try {
      const [status, commits, branches] = await Promise.all([
        getGitStatus(repoPath),
        getGitLog(repoPath, 50, 0),
        getBranches(repoPath),
      ]);

      actions.loadFreshGitData({ gitStatus: status, commits, branches });

      // Note: DiffViewer now handles its own refresh via git-status-changed event
    } catch (error) {
      console.error("Failed to load git data:", error);
    } finally {
      setIsLoadingGitData(false);
    }
  }, [repoPath, actions]);

  // Handler for manual refresh with minimum display time
  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        loadGitData(),
        new Promise((resolve) => setTimeout(resolve, 500)), // Minimum display time
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadGitData, actions]);

  // Load git status on mount and when repo path changes
  useEffect(() => {
    loadGitData();
  }, [loadGitData]);

  // Listen for git status changes (from staging/unstaging hunks)
  useEffect(() => {
    const handleGitStatusChanged = () => {
      loadGitData();
    };

    window.addEventListener("git-status-changed", handleGitStatusChanged);
    return () => {
      window.removeEventListener("git-status-changed", handleGitStatusChanged);
    };
  }, [loadGitData]);

  // Listen for file changes and refresh git status
  useEffect(() => {
    let refreshTimeout: NodeJS.Timeout | null = null;

    const handleFileChange = (event: CustomEvent) => {
      const { path } = event.detail;

      // Only refresh if the changed file is within the repo
      if (repoPath && path.startsWith(repoPath)) {
        // Clear any existing timeout
        if (refreshTimeout) {
          clearTimeout(refreshTimeout);
        }

        // Debounce the refresh to avoid too many calls
        refreshTimeout = setTimeout(() => {
          loadGitData();
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
  }, [repoPath, loadGitData]);

  // Close dropdowns when clicking outside
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
      // Handle special Git path formats
      let actualFilePath = filePath;

      // Handle renamed files: "oldfile -> newfile"
      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        // For opening the file, always use the new name
        actualFilePath = parts[1].trim();
      }

      // Handle quoted filenames: "\"filename\""
      if (actualFilePath.startsWith('"') && actualFilePath.endsWith('"')) {
        actualFilePath = actualFilePath.slice(1, -1);
      }

      // Construct the full path
      const fullPath = `${repoPath}/${actualFilePath}`;

      // Open the file directly (not as a diff)
      onFileSelect(fullPath, false);
    } catch (error) {
      console.error("Error opening file:", error);
      alert(`Failed to open file ${filePath}:\n${error}`);
    }
  };

  const handleViewFileDiff = async (filePath: string, staged: boolean = false) => {
    if (!repoPath || !onFileSelect) return;

    try {
      // Handle special Git path formats
      let actualFilePath = filePath;

      // Handle renamed files: "oldfile -> newfile"
      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        if (staged) {
          // For staged renames, show the new file
          actualFilePath = parts[1].trim();
        } else {
          // For unstaged renames, show the old file
          actualFilePath = parts[0].trim();
        }
      }

      // Handle quoted filenames: "\"filename\""
      if (actualFilePath.startsWith('"') && actualFilePath.endsWith('"')) {
        actualFilePath = actualFilePath.slice(1, -1);
      }

      // Find the file in gitStatus to check its status
      const file = gitStatus?.files.find((f) => f.path === actualFilePath);

      // For untracked files, open the file directly instead of trying to show a diff
      if (file && file.status === "untracked" && !staged) {
        handleOpenOriginalFile(actualFilePath);
        return;
      }

      const diff = await getFileDiff(repoPath, actualFilePath, staged);

      if (diff && (diff.lines.length > 0 || diff.is_image)) {
        // Encode the full file path in the virtual path
        const encodedPath = encodeURIComponent(actualFilePath);
        const virtualPath = `diff://${staged ? "staged" : "unstaged"}/${encodedPath}`;
        const displayName = `${actualFilePath.split("/").pop()} (${
          staged ? "staged" : "unstaged"
        })`;

        // Open buffer with diff data directly
        useBufferStore.getState().actions.openBuffer(
          virtualPath,
          displayName,
          JSON.stringify(diff), // Keep for backwards compatibility
          false, // isImage
          false, // isSQLite
          true, // isDiff
          true, // isVirtual
          diff, // Pass the diff data directly
        );
      } else {
        // Instead of showing an alert, fall back to opening the file
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
          // Show specific file diff (when clicking on individual file in expanded commit)
          const diff = diffs.find((d) => d.file_path === filePath) || diffs[0];
          const diffFileName = `${diff.file_path.split("/").pop()}.diff`;
          const virtualPath = `diff://commit/${commitHash}/${diffFileName}`;

          // Open buffer with single diff data
          useBufferStore.getState().actions.openBuffer(
            virtualPath,
            diffFileName,
            JSON.stringify(diff), // Keep for backwards compatibility
            false, // isImage
            false, // isSQLite
            true, // isDiff
            true, // isVirtual
            diff, // Pass the diff data directly
          );
        } else {
          // Show all files in commit (when clicking on commit itself)
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

          // Open buffer with multi-file diff data
          useBufferStore.getState().actions.openBuffer(
            virtualPath,
            displayName,
            JSON.stringify(multiDiff), // Keep for backwards compatibility
            false, // isImage
            false, // isSQLite
            true, // isDiff
            true, // isVirtual
            multiDiff, // Pass the multi-diff data directly
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

  const renderGitButton = () => (
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
        "flex cursor-pointer items-center gap-1 rounded px-2 py-1.5",
        "font-medium text-text text-xs hover:bg-hover",
      )}
      title="Git Actions"
    >
      <GitBranch size={12} className="text-text-lighter" />
      <span>Git</span>
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
          <div className="flex items-center gap-2">{renderGitButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center font-mono text-text-lighter text-xs">
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
          <div className="flex items-center gap-2">{renderGitButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center font-mono text-text-lighter text-xs">
            Loading Git status...
          </div>
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
          <div className="flex items-center gap-2">{renderGitButton()}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center font-mono text-text-lighter text-xs">
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
      <div className="flex h-full select-none flex-col bg-secondary-bg font-mono text-xs">
        {/* Header */}
        <div
          className={cn(
            "flex items-center justify-between border-border border-b",
            "bg-secondary-bg px-2 py-1.5",
          )}
        >
          <div className="flex items-center gap-2">
            {renderGitButton()}

            <GitBranchManager
              currentBranch={gitStatus.branch}
              repoPath={repoPath}
              onBranchChange={loadGitData}
            />

            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="text-[10px] text-text-lighter">
                {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
                {gitStatus.ahead > 0 && gitStatus.behind > 0 && " "}
                {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
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
            >
              <RefreshCw
                size={12}
                className={isLoadingGitData || isRefreshing ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="scrollbar-hidden flex-1 overflow-y-auto">
          <GitStatusPanel
            files={gitStatus.files}
            onFileSelect={handleViewFileDiff}
            onOpenFile={handleOpenOriginalFile}
            onRefresh={handleManualRefresh}
            repoPath={repoPath}
          />

          <GitCommitHistory onViewCommitDiff={handleViewCommitDiff} repoPath={repoPath} />
        </div>

        {/* Commit Panel */}
        <GitCommitPanel
          stagedFilesCount={stagedFiles.length}
          repoPath={repoPath}
          onCommitSuccess={loadGitData}
        />
      </div>

      {/* Menus and Modals */}
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
        onOpenStashManager={() => setShowStashManager(true)}
        onOpenRemoteManager={() => setShowRemoteManager(true)}
        onOpenTagManager={() => setShowTagManager(true)}
      />

      <GitStashManager
        isOpen={showStashManager}
        onClose={() => setShowStashManager(false)}
        repoPath={repoPath}
        onRefresh={handleManualRefresh}
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

export default GitView;
