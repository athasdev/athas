import {
  Download,
  Edit3,
  FileIcon,
  FilePlus,
  FileX,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  RotateCcw,
  Settings,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type GitCommit,
  type GitFile,
  type GitStatus,
  getBranches,
  getCommitDiff,
  getFileDiff,
  getGitLog,
  getGitStatus,
} from "../../utils/git";
import { safeLocalStorageSetItem, truncateJsonArrayData } from "../../utils/storage";

// Import modular components
import GitActionsMenu from "./git-actions-menu";
import GitBranchManager from "./git-branch-manager";
import GitCommitHistory from "./git-commit-history";
import GitCommitPanel from "./git-commit-panel";
import GitStashManager from "./git-stash-manager";
import GitStatusPanel from "./git-status-panel";

interface GitViewProps {
  repoPath?: string;
  onFileSelect?: (path: string, isDir: boolean) => void;
}

const GitView = ({ repoPath, onFileSelect }: GitViewProps) => {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [_branches, setBranches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showGitActionsMenu, setShowGitActionsMenu] = useState(false);
  const [gitActionsMenuPosition, setGitActionsMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Modal states
  const [showStashManager, setShowStashManager] = useState(false);

  // Load Git status, commits, and branches
  const loadGitData = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const [status, commits, branches] = await Promise.all([
        getGitStatus(repoPath),
        getGitLog(repoPath, 50), // Limit to 50 recent commits
        getBranches(repoPath),
      ]);
      setGitStatus(status);
      setCommits(commits);
      setBranches(branches);
    } catch (error) {
      console.error("Failed to load git data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Load git status on mount and when repo path changes
  useEffect(() => {
    loadGitData();
  }, [repoPath]);

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

  // Additional Git Actions
  const handlePush = async () => {
    if (!repoPath) return;
    try {
      // Implement push functionality
      console.log("Pushing changes...");
      // await pushChanges(repoPath);
      await loadGitData();
    } catch (error) {
      console.error("Failed to push:", error);
    }
  };

  const handlePull = async () => {
    if (!repoPath) return;
    try {
      // Implement pull functionality
      console.log("Pulling changes...");
      // await pullChanges(repoPath);
      await loadGitData();
    } catch (error) {
      console.error("Failed to pull:", error);
    }
  };

  const handleFetch = async () => {
    if (!repoPath) return;
    try {
      // Implement fetch functionality
      console.log("Fetching changes...");
      // await fetchChanges(repoPath);
      await loadGitData();
    } catch (error) {
      console.error("Failed to fetch:", error);
    }
  };

  const handleDiscardAllChanges = async () => {
    if (!repoPath) return;
    const confirmed = confirm(
      "Are you sure you want to discard all changes? This cannot be undone.",
    );
    if (!confirmed) return;

    try {
      // Implement discard all functionality
      console.log("Discarding all changes...");
      // await discardAllChanges(repoPath);
      await loadGitData();
    } catch (error) {
      console.error("Failed to discard changes:", error);
    }
  };

  const handleInitRepository = async () => {
    if (!repoPath) return;
    try {
      // Implement git init functionality
      console.log("Initializing repository...");
      // await initRepository(repoPath);
      await loadGitData();
    } catch (error) {
      console.error("Failed to initialize repository:", error);
    }
  };

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

      const diff = await getFileDiff(repoPath, actualFilePath, staged);

      if (diff && (diff.lines.length > 0 || diff.is_image)) {
        const diffFileName = `${actualFilePath.split("/").pop()}.diff`;
        const virtualPath = `diff://${staged ? "staged" : "unstaged"}/${diffFileName}`;
        const diffJson = JSON.stringify(diff);

        const success = safeLocalStorageSetItem(`diff-content-${virtualPath}`, diffJson, {
          clearPrefix: "diff-content-",
          truncateData: data => truncateJsonArrayData(data, 1000),
          onSuccess: () => {
            onFileSelect(virtualPath, false);
          },
          onTruncated: (_originalSize, _truncatedSize) => {
            onFileSelect(virtualPath, false);
            if (diff.is_image) {
              console.log(`Image diff displayed successfully.\nFile: ${actualFilePath}`);
            } else {
              alert(
                `File diff was too large and has been truncated to the first 1000 lines.\nOriginal diff had ${diff.lines.length} lines.`,
              );
            }
          },
          onQuotaExceeded: _error => {
            alert(
              `Failed to display diff: The file diff is too large to display.\nFile: ${actualFilePath}\nTry viewing smaller portions of the file.`,
            );
          },
        });

        if (!success) {
          console.error("Failed to store file diff");
        }
      } else {
        alert(
          `No ${staged ? "staged" : "unstaged"} changes for this file.\nFile: ${actualFilePath}`,
        );
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
        const diff = filePath ? diffs.find(d => d.file_path === filePath) || diffs[0] : diffs[0]; // Show specific file or first diff
        const diffFileName = `${diff.file_path.split("/").pop()}.diff`;
        const virtualPath = `diff://commit/${commitHash}/${diffFileName}`;
        const diffJson = JSON.stringify(diff);

        const success = safeLocalStorageSetItem(`diff-content-${virtualPath}`, diffJson, {
          clearPrefix: "diff-content-",
          truncateData: data => truncateJsonArrayData(data, 1000),
          onSuccess: () => {
            onFileSelect(virtualPath, false);
          },
          onTruncated: (_originalSize, _truncatedSize) => {
            onFileSelect(virtualPath, false);
            alert(
              `Diff was too large and has been truncated to the first 1000 lines.\nOriginal diff had ${diff.lines.length} lines.`,
            );
          },
          onQuotaExceeded: _error => {
            alert(
              `Failed to display diff: The commit diff is too large to display.\nCommit: ${commitHash}\nConsider viewing individual files instead.`,
            );
          },
        });

        if (!success) {
          console.error("Failed to store commit diff");
        }
      } else {
        alert(`No changes in this commit for the specified file.`);
      }
    } catch (error) {
      console.error("Error getting commit diff:", error);
      alert(`Failed to get diff for commit ${commitHash}:\n${error}`);
    }
  };

  /* @ts-ignore */
  const _getFileIcon = (file: GitFile) => {
    switch (file.status) {
      case "added":
        return <FilePlus size={10} className="text-text" />;
      case "deleted":
        return <FileX size={10} className="text-text" />;
      case "modified":
        return <Edit3 size={10} className="text-text" />;
      case "untracked":
        return <FileIcon size={10} className="text-text-lighter" />;
      case "renamed":
        return <RotateCcw size={10} className="text-text" />;
      default:
        return <FileIcon size={10} className="text-text-lighter" />;
    }
  };

  /* @ts-ignore */
  const _getStatusText = (file: GitFile) => {
    switch (file.status) {
      case "added":
        return "A";
      case "deleted":
        return "D";
      case "modified":
        return "M";
      case "untracked":
        return "U";
      case "renamed":
        return "R";
      default:
        return "?";
    }
  };

  const renderGitButton = () => (
    <button
      onClick={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        setGitActionsMenuPosition({
          x: rect.left,
          y: rect.bottom + 5,
        });
        setShowGitActionsMenu(!showGitActionsMenu);
        setShowBranchDropdown(false);
      }}
      className="flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 font-medium text-text text-xs hover:bg-hover"
      title="Git Actions"
    >
      <GitBranch size={12} className="text-text-lighter" />
      <span>Git</span>
    </button>
  );

  const renderGitActionsMenu = () =>
    showGitActionsMenu &&
    gitActionsMenuPosition && (
      <div
        className="fixed z-50 min-w-[180px] rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
        style={{
          left: gitActionsMenuPosition.x,
          top: gitActionsMenuPosition.y,
        }}
        onMouseDown={e => {
          e.stopPropagation();
        }}
      >
        {gitStatus && (
          <>
            <button
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                handlePush();
                setShowGitActionsMenu(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
            >
              <Upload size={12} />
              Push Changes
            </button>

            <button
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                handlePull();
                setShowGitActionsMenu(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
            >
              <Download size={12} />
              Pull Changes
            </button>

            <button
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                handleFetch();
                setShowGitActionsMenu(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
            >
              <GitPullRequest size={12} />
              Fetch
            </button>

            <div className="my-1 border-border border-t"></div>

            <button
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                handleDiscardAllChanges();
                setShowGitActionsMenu(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-red-400 text-xs hover:bg-hover"
            >
              <RotateCcw size={12} />
              Discard All Changes
            </button>
          </>
        )}

        {!gitStatus && (
          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              handleInitRepository();
              setShowGitActionsMenu(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
          >
            <Settings size={12} />
            Initialize Repository
          </button>
        )}
      </div>
    );

  if (!repoPath) {
    return (
      <>
        <div className="flex h-full flex-col bg-secondary-bg">
          <div className="flex items-center gap-2 border-border border-b px-3 py-2">
            {renderGitButton()}
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="text-center font-mono text-text-lighter text-xs">
              <div className="mb-1">No Git repository detected</div>
              <div className="text-[10px] opacity-75">Open a Git project folder</div>
            </div>
          </div>
        </div>
        {renderGitActionsMenu()}
      </>
    );
  }

  if (isLoading && !gitStatus) {
    return (
      <>
        <div className="flex h-full flex-col bg-secondary-bg">
          <div className="flex items-center gap-2 border-border border-b px-3 py-2">
            {renderGitButton()}
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="text-center font-mono text-text-lighter text-xs">
              Loading Git status...
            </div>
          </div>
        </div>
        {renderGitActionsMenu()}
      </>
    );
  }

  if (!gitStatus) {
    return (
      <>
        <div className="flex h-full flex-col bg-secondary-bg">
          <div className="flex items-center gap-2 border-border border-b px-3 py-2">
            {renderGitButton()}
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="text-center font-mono text-text-lighter text-xs">
              <div className="mb-1">Not a Git repository</div>
              <div className="text-[10px] opacity-75">Initialize with: git init</div>
            </div>
          </div>
        </div>
        {renderGitActionsMenu()}
      </>
    );
  }

  const stagedFiles = gitStatus.files.filter(f => f.staged);

  return (
    <>
      <div className="flex h-full flex-col bg-secondary-bg font-mono text-xs">
        {/* Header */}
        <div className="flex items-center gap-2 border-border border-b px-3 py-2">
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

          <div className="flex-1" />

          <button
            onClick={loadGitData}
            disabled={isLoading}
            className="p-1 text-text-lighter transition-colors hover:text-text disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={10} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Content */}
        <div className="scrollbar-hidden flex-1 overflow-y-auto">
          <GitStatusPanel
            files={gitStatus.files}
            onFileSelect={handleViewFileDiff}
            onOpenFile={handleOpenOriginalFile}
            onRefresh={loadGitData}
            repoPath={repoPath}
          />

          <GitCommitHistory
            commits={commits}
            onViewCommitDiff={handleViewCommitDiff}
            repoPath={repoPath}
          />
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
        onRefresh={loadGitData}
        onOpenStashManager={() => setShowStashManager(true)}
      />

      <GitStashManager
        isOpen={showStashManager}
        onClose={() => setShowStashManager(false)}
        repoPath={repoPath}
        onRefresh={loadGitData}
      />
    </>
  );
};

export default GitView;
