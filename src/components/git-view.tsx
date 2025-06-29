import React, { useState, useEffect } from "react";
import {
  GitBranch,
  GitCommit as GitCommitIcon,
  Plus,
  Minus,
  RotateCcw,
  Check,
  FileIcon,
  FilePlus,
  FileX,
  Edit3,
  RefreshCw,
  Clock,
  ChevronDown,
  Trash2,
  Upload,
  Download,
  GitPullRequest,
  GitMerge,
  Settings,
} from "lucide-react";
import {
  getGitStatus,
  stageFile,
  unstageFile,
  stageAllFiles,
  unstageAllFiles,
  commitChanges,
  getGitLog,
  getBranches,
  checkoutBranch,
  createBranch,
  deleteBranch,
  getFileDiff,
  getCommitDiff,
  GitFile,
  GitStatus,
  GitCommit,
  GitDiff,
} from "../utils/git";

interface GitViewProps {
  repoPath?: string;
  onFileSelect?: (path: string, isDir: boolean) => void;
}

const GitView = ({ repoPath, onFileSelect }: GitViewProps) => {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showGitActionsMenu, setShowGitActionsMenu] = useState(false);
  const [gitActionsMenuPosition, setGitActionsMenuPosition] = useState<{x: number, y: number} | null>(null);

  // Load Git status, commits, and branches
  const loadGitData = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      const [status, commits, branches] = await Promise.all([
        getGitStatus(repoPath),
        getGitLog(repoPath),
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
    const handleClickOutside = (event: MouseEvent) => {
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
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showBranchDropdown, showGitActionsMenu]);

  const handleStageFile = async (filePath: string) => {
    if (!repoPath) return;

    const success = await stageFile(repoPath, filePath);
    if (success) {
      await loadGitData();
    }
  };

  const handleUnstageFile = async (filePath: string) => {
    if (!repoPath) return;

    const success = await unstageFile(repoPath, filePath);
    if (success) {
      await loadGitData();
    }
  };

  const handleStageAll = async () => {
    if (!repoPath) return;

    const success = await stageAllFiles(repoPath);
    if (success) {
      await loadGitData();
    }
  };

  const handleUnstageAll = async () => {
    if (!repoPath) return;

    const success = await unstageAllFiles(repoPath);
    if (success) {
      await loadGitData();
    }
  };

  const handleCommit = async () => {
    if (!repoPath || !commitMessage.trim()) return;

    const success = await commitChanges(repoPath, commitMessage.trim());
    if (success) {
      setCommitMessage("");
      await loadGitData();
    }
  };

  const handleBranchChange = async (branchName: string) => {
    if (!repoPath || !branchName) return;

    const success = await checkoutBranch(repoPath, branchName);
    if (success) {
      setShowBranchDropdown(false);
      await loadGitData();
    }
  };

  const handleCreateBranch = async () => {
    if (!repoPath || !newBranchName.trim()) return;

    const success = await createBranch(
      repoPath,
      newBranchName.trim(),
      gitStatus?.branch,
    );
    if (success) {
      setNewBranchName("");
      setIsCreatingBranch(false);
      await loadGitData();
    }
  };

  const handleDeleteBranch = async (branchName: string) => {
    if (!repoPath || !branchName || branchName === gitStatus?.branch) return;

    const success = await deleteBranch(repoPath, branchName);
    if (success) {
      await loadGitData();
    }
  };

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
    const confirmed = confirm("Are you sure you want to discard all changes? This cannot be undone.");
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

  const handleViewFileDiff = async (
    filePath: string,
    staged: boolean = false,
  ) => {
    if (!repoPath || !onFileSelect) return;

    try {
        const diff = await getFileDiff(repoPath, filePath, staged);

        if (diff && diff.lines.length > 0) {
            // Your existing logic to store in localStorage and open buffer
            const diffFileName = `${filePath.split("/").pop()}.diff`;
            const virtualPath = `diff://${staged ? "staged" : "unstaged"}/${diffFileName}`;

            // Store the diff object and open the buffer
            localStorage.setItem(`diff-content-${virtualPath}`, JSON.stringify(diff));
            onFileSelect(virtualPath, false);
        } else {
            // Handle case where there are no changes to display
            alert(`No ${staged ? 'staged' : 'unstaged'} changes for this file.`);
        }
    } catch (error) {
        // This is the new, important part
        console.error("Error getting file diff:", error);
        alert(`Failed to get diff for ${filePath}:\n${error}`);
    }
  };

  const handleViewCommitDiff = async (
    commitHash: string,
    filePath?: string,
  ) => {
    if (!repoPath || !onFileSelect) return;

    try {
      const diffs = await getCommitDiff(repoPath, commitHash, filePath);
      const diff = diffs[0]; // For now, assume single file diff view from commit
  
      if (diff && diff.lines.length > 0) {
        const diffFileName = `${diff.file_path.split("/").pop()}.diff`;
        const virtualPath = `diff://commit/${commitHash}/${diffFileName}`;
  
        localStorage.setItem(`diff-content-${virtualPath}`, JSON.stringify(diff));
        onFileSelect(virtualPath, false);
      } else {
        alert(`No changes in this commit for the specified file.`);
      }
    } catch (error) {
        console.error("Error getting commit diff:", error);
        alert(`Failed to get diff for commit ${commitHash}:\n${error}`);
    }
  };

  const getFileIcon = (file: GitFile) => {
    switch (file.status) {
      case "added":
        return <FilePlus size={10} className="text-[var(--text-color)]" />;
      case "deleted":
        return <FileX size={10} className="text-[var(--text-color)]" />;
      case "modified":
        return <Edit3 size={10} className="text-[var(--text-color)]" />;
      case "untracked":
        return <FileIcon size={10} className="text-[var(--text-lighter)]" />;
      case "renamed":
        return <RotateCcw size={10} className="text-[var(--text-color)]" />;
      default:
        return <FileIcon size={10} className="text-[var(--text-lighter)]" />;
    }
  };

  const getStatusText = (file: GitFile) => {
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
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setGitActionsMenuPosition({
          x: rect.left,
          y: rect.bottom + 5,
        });
        setShowGitActionsMenu(!showGitActionsMenu);
        setShowBranchDropdown(false);
      }}
      className="flex items-center gap-1 text-xs text-[var(--text-color)] font-medium hover:bg-[var(--hover-color)] px-2 py-1 rounded cursor-pointer"
      title="Git Actions"
    >
      <GitBranch size={12} className="text-[var(--text-lighter)]" />
      <span>Git</span>
    </button>
  );

  const renderGitActionsMenu = () => (
    showGitActionsMenu && gitActionsMenuPosition && (
      <div
        className="fixed bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 py-1 min-w-[180px]"
        style={{
          left: gitActionsMenuPosition.x,
          top: gitActionsMenuPosition.y,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        {gitStatus && (
          <>
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlePush();
                setShowGitActionsMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
            >
              <Upload size={12} />
              Push Changes
            </button>
            
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlePull();
                setShowGitActionsMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
            >
              <Download size={12} />
              Pull Changes
            </button>
            
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleFetch();
                setShowGitActionsMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
            >
              <GitPullRequest size={12} />
              Fetch
            </button>
            
            <div className="border-t border-[var(--border-color)] my-1"></div>
            
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDiscardAllChanges();
                setShowGitActionsMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-red-400 hover:bg-[var(--hover-color)] flex items-center gap-2"
            >
              <RotateCcw size={12} />
              Discard All Changes
            </button>
          </>
        )}
        
        {!gitStatus && (
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleInitRepository();
              setShowGitActionsMenu(false);
            }}
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
          >
            <Settings size={12} />
            Initialize Repository
          </button>
        )}
      </div>
    )
  );

  if (!repoPath) {
    return (
      <>
        <div className="flex flex-col h-full bg-[var(--secondary-bg)]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
            {renderGitButton()}
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center text-[var(--text-lighter)] font-mono text-xs">
              <div className="mb-1">No Git repository detected</div>
              <div className="text-[10px] opacity-75">
                Open a Git project folder
              </div>
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
        <div className="flex flex-col h-full bg-[var(--secondary-bg)]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
            {renderGitButton()}
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center text-[var(--text-lighter)] font-mono text-xs">
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
        <div className="flex flex-col h-full bg-[var(--secondary-bg)]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
            {renderGitButton()}
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center text-[var(--text-lighter)] font-mono text-xs">
              <div className="mb-1">Not a Git repository</div>
              <div className="text-[10px] opacity-75">
                Initialize with: git init
              </div>
            </div>
          </div>
        </div>
        {renderGitActionsMenu()}
      </>
    );
  }

  const stagedFiles = gitStatus.files.filter((f) => f.staged);
  const unstagedFiles = gitStatus.files.filter((f) => !f.staged);

  return (
    <>
      <div className="flex flex-col h-full bg-[var(--secondary-bg)] font-mono text-xs">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
          {renderGitButton()}
        <div className="relative flex-1">
          <button
            onClick={() => setShowBranchDropdown(!showBranchDropdown)}
            className="flex items-center gap-1 text-xs text-[var(--text-color)] font-medium hover:bg-[var(--hover-color)] px-2 py-1 rounded"
          >
            <span>{gitStatus.branch}</span>
            <ChevronDown size={8} />
          </button>

          {/* Branch Dropdown */}
          {showBranchDropdown && (
            <div 
              className="absolute top-full left-0 mt-1 bg-[var(--primary-bg)] border border-[var(--border-color)] rounded shadow-lg z-10 min-w-48"
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
            >
              <div className="p-2 border-b border-[var(--border-color)]">
                <div className="flex gap-1">
                  <input
                    type="text"
                    placeholder="New branch name..."
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    className="flex-1 bg-[var(--secondary-bg)] text-[var(--text-color)] border border-[var(--border-color)] px-2 py-1 text-[10px] rounded focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" && newBranchName.trim()) {
                        e.preventDefault();
                        handleCreateBranch();
                      }
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  />
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (newBranchName.trim()) {
                        handleCreateBranch();
                      }
                    }}
                    disabled={!newBranchName.trim()}
                    className="px-2 py-1 text-[10px] bg-[var(--hover-color)] text-[var(--text-color)] border border-[var(--border-color)] rounded hover:bg-[var(--secondary-bg)] disabled:opacity-50"
                  >
                    <Plus size={8} />
                  </button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {branches.map((branch) => (
                  <div
                    key={branch}
                    className="flex items-center justify-between px-3 py-1 hover:bg-[var(--hover-color)] group"
                  >
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleBranchChange(branch);
                      }}
                      className={`flex-1 text-left text-[10px] ${
                        branch === gitStatus.branch
                          ? "text-[var(--text-color)] font-medium"
                          : "text-[var(--text-lighter)]"
                      }`}
                    >
                      {branch === gitStatus.branch && (
                        <GitBranch size={8} className="inline mr-1" />
                      )}
                      {branch}
                    </button>
                    {branch !== gitStatus.branch && (
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteBranch(branch);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1"
                        title="Delete branch"
                      >
                        <Trash2 size={8} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
          <span className="text-[10px] text-[var(--text-lighter)]">
            {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
            {gitStatus.ahead > 0 && gitStatus.behind > 0 && " "}
            {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
          </span>
        )}

        <button
          onClick={loadGitData}
          disabled={isLoading}
          className="p-1 text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={10} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hidden">
        {/* Staged Changes */}
        <div className="border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 px-3 py-1 bg-[var(--secondary-bg)] text-[var(--text-lighter)]">
            <span className="flex items-center gap-1">
              <Check size={10} />
              <span>staged ({stagedFiles.length})</span>
            </span>
            <div className="flex-1" />
            {stagedFiles.length > 0 && (
              <button
                onClick={handleUnstageAll}
                className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
                title="Unstage all"
              >
                <Minus size={10} />
              </button>
            )}
          </div>

          {stagedFiles.length === 0 ? (
            <div className="px-3 py-2 bg-[var(--primary-bg)] text-[var(--text-lighter)] text-[10px] italic">
              No staged changes
            </div>
          ) : (
            <div className="bg-[var(--primary-bg)]">
              {stagedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--hover-color)] group cursor-pointer"
                  onClick={() => handleViewFileDiff(file.path, true)}
                >
                  <span className="text-[10px] text-[var(--text-lighter)] w-3 text-center font-medium">
                    {getStatusText(file)}
                  </span>
                  {getFileIcon(file)}
                  <span className="flex-1 text-[10px] text-[var(--text-color)] truncate">
                    {file.path.split("/").pop()}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnstageFile(file.path);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
                    title="Unstage"
                  >
                    <Minus size={8} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Unstaged Changes */}
        <div className="border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 px-3 py-1 bg-[var(--secondary-bg)] text-[var(--text-lighter)]">
            <span className="flex items-center gap-1">
              <Edit3 size={10} />
              <span>changes ({unstagedFiles.length})</span>
            </span>
            <div className="flex-1" />
            {unstagedFiles.length > 0 && (
              <button
                onClick={handleStageAll}
                className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
                title="Stage all"
              >
                <Plus size={10} />
              </button>
            )}
          </div>

          {unstagedFiles.length === 0 ? (
            <div className="px-3 py-2 bg-[var(--primary-bg)] text-[var(--text-lighter)] text-[10px] italic">
              No unstaged changes
            </div>
          ) : (
            <div className="bg-[var(--primary-bg)]">
              {unstagedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--hover-color)] group cursor-pointer"
                  onClick={() => handleViewFileDiff(file.path, false)}
                >
                  <span className="text-[10px] text-[var(--text-lighter)] w-3 text-center font-medium">
                    {getStatusText(file)}
                  </span>
                  {getFileIcon(file)}
                  <span className="flex-1 text-[10px] text-[var(--text-color)] truncate">
                    {file.path.split("/").pop()}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStageFile(file.path);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
                    title="Stage"
                  >
                    <Plus size={8} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Clean State */}
        {stagedFiles.length === 0 && unstagedFiles.length === 0 && (
          <div className="border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2 px-3 py-1 bg-[var(--secondary-bg)] text-[var(--text-lighter)]">
              <Check size={10} />
              <span>clean</span>
            </div>
            <div className="px-3 py-2 bg-[var(--primary-bg)] text-[var(--text-lighter)] text-[10px] italic">
              No changes detected
            </div>
          </div>
        )}

        {/* Commits History */}
        <div className="border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 px-3 py-1 bg-[var(--secondary-bg)] text-[var(--text-lighter)]">
            <Clock size={10} />
            <span>commits ({commits.length})</span>
          </div>

          {commits.length === 0 ? (
            <div className="px-3 py-2 bg-[var(--primary-bg)] text-[var(--text-lighter)] text-[10px] italic">
              No commits found
            </div>
          ) : (
            <div className="bg-[var(--primary-bg)]">
              {commits.map((commit, index) => (
                <div
                  key={commit.hash}
                  className="px-3 py-2 hover:bg-[var(--hover-color)] border-b border-[var(--border-color)] last:border-b-0 cursor-pointer"
                  onClick={() => handleViewCommitDiff(commit.hash)}
                  title="Click to view commit changes"
                >
                  <div className="flex items-start gap-2 mb-1">
                    <GitCommitIcon
                      size={10}
                      className="text-[var(--text-lighter)] mt-0.5 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-[var(--text-color)] font-medium leading-tight mb-1">
                        {commit.message}
                      </div>
                      <div className="flex items-center gap-3 text-[9px] text-[var(--text-lighter)]">
                        <span className="flex items-center gap-1">
                          <Clock size={8} />
                          {commit.date}
                        </span>
                        <span className="font-mono">
                          {commit.hash.substring(0, 7)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Commit Section */}
      {stagedFiles.length > 0 && (
        <div className="border-t border-[var(--border-color)] bg-[var(--secondary-bg)]">
          <div className="p-2">
            <div className="flex items-center gap-2 mb-2">
              <GitCommitIcon size={10} className="text-[var(--text-lighter)]" />
              <span className="text-[10px] text-[var(--text-color)] font-medium">
                commit message
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Enter commit message..."
                className="flex-1 bg-[var(--primary-bg)] text-[var(--text-color)] border border-[var(--border-color)] px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && commitMessage.trim()) {
                    handleCommit();
                  }
                }}
              />
              <button
                onClick={handleCommit}
                disabled={!commitMessage.trim()}
                className={`px-2 py-1 text-[10px] font-mono border transition-colors duration-150 ${
                  commitMessage.trim()
                    ? "bg-[var(--primary-bg)] border-[var(--border-color)] text-[var(--text-color)] hover:bg-[var(--hover-color)]"
                    : "bg-[var(--secondary-bg)] border-[var(--border-color)] text-[var(--text-lighter)] cursor-not-allowed"
                }`}
              >
                Commit
              </button>
            </div>
          </div>
        </div>
      )}

        </div>
        {renderGitActionsMenu()}
      </>
    );
  };

export default GitView;
