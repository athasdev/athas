import { ChevronDown, ChevronRight, Clock, Hash, User } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGitStore } from "@/stores/git-store";
import { getCommitDiff } from "@/utils/git";

interface GitCommitHistoryProps {
  onViewCommitDiff?: (commitHash: string, filePath?: string) => void;
  repoPath?: string;
}

const EMPTY_FILES_ARRAY: any[] = [];

interface CommitItemProps {
  commit: any;
  expandedCommits: Set<string>;
  commitFiles: Record<string, any[]>;
  loadingCommits: Set<string>;
  copiedHashes: Set<string>;
  onToggleExpansion: (commitHash: string) => void;
  onViewCommitDiff: (commitHash: string, filePath?: string) => void;
  onCopyHash: (hash: string) => void;
}

const CommitItem = memo(
  ({
    commit,
    expandedCommits,
    commitFiles,
    loadingCommits,
    copiedHashes,
    onToggleExpansion,
    onViewCommitDiff,
    onCopyHash,
  }: CommitItemProps) => {
    const isExpanded = expandedCommits.has(commit.hash);
    const files = commitFiles[commit.hash] || EMPTY_FILES_ARRAY;
    const isLoading = loadingCommits.has(commit.hash);
    const isCopied = copiedHashes.has(commit.hash);

    const handleCommitClick = useCallback(() => {
      onViewCommitDiff(commit.hash);
    }, [commit.hash, onViewCommitDiff]);

    const handleToggleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggleExpansion(commit.hash);
      },
      [commit.hash, onToggleExpansion],
    );

    const _handleCopyClick = useCallback(() => {
      onCopyHash(commit.hash);
    }, [commit.hash, onCopyHash]);

    const formattedDate = useMemo(() => {
      try {
        const date = new Date(commit.date);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          if (diffHours === 0) {
            const diffMins = Math.floor(diffMs / (1000 * 60));
            return diffMins <= 1 ? "just now" : `${diffMins}m ago`;
          }
          return `${diffHours}h ago`;
        } else if (diffDays === 1) {
          return "yesterday";
        } else if (diffDays < 7) {
          return `${diffDays}d ago`;
        } else {
          return date.toLocaleDateString();
        }
      } catch {
        return commit.date;
      }
    }, [commit.date]);

    return (
      <div className="border-border border-b last:border-b-0">
        {/* Commit Header */}
        <div className="cursor-pointer px-3 py-2 hover:bg-hover" onClick={handleCommitClick}>
          <div className="flex items-start gap-2">
            <button
              onClick={handleToggleClick}
              className="mt-0.5 text-text-lighter transition-colors hover:text-text"
            >
              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="mb-1 font-medium text-[10px] text-text leading-tight">
                {commit.message}
              </div>

              <div className="flex items-center gap-3 text-[9px] text-text-lighter">
                <span className="flex items-center gap-1">
                  <User size={8} />
                  {commit.author}
                </span>

                <span className="flex items-center gap-1">
                  <Clock size={8} />
                  {formattedDate}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Expanded Commit Details */}
        {isExpanded && (
          <ExpandedCommitDetails
            commit={commit}
            files={files}
            isLoading={isLoading}
            isCopied={isCopied}
            onViewCommitDiff={onViewCommitDiff}
            onCopyHash={onCopyHash}
          />
        )}
      </div>
    );
  },
);

interface ExpandedCommitDetailsProps {
  commit: any;
  files: any[];
  isLoading: boolean;
  isCopied: boolean;
  onViewCommitDiff: (commitHash: string, filePath?: string) => void;
  onCopyHash: (hash: string) => void;
}

const ExpandedCommitDetails = memo(
  ({
    commit,
    files,
    isLoading,
    isCopied,
    onViewCommitDiff,
    onCopyHash,
  }: ExpandedCommitDetailsProps) => {
    const handleCopyClick = useCallback(() => {
      onCopyHash(commit.hash);
    }, [commit.hash, onCopyHash]);

    const handleFileClick = useCallback(
      (filePath: string) => {
        onViewCommitDiff(commit.hash, filePath);
      },
      [commit.hash, onViewCommitDiff],
    );

    if (isLoading) {
      return (
        <div className="bg-primary-bg px-8 py-2">
          <div className="text-[9px] text-text-lighter italic">Loading files...</div>
        </div>
      );
    }

    if (files.length === 0) {
      return (
        <div className="bg-primary-bg px-8 py-2">
          <div className="text-[9px] text-text-lighter italic">No files changed</div>
        </div>
      );
    }

    return (
      <div className="bg-primary-bg px-8 py-2">
        <div className="space-y-1">
          <div className="mb-1 flex items-center justify-between text-[9px] text-text-lighter">
            <span>
              {files.length} file{files.length !== 1 ? "s" : ""} changed
            </span>
            <button
              onClick={handleCopyClick}
              className="inline-flex items-center gap-1 rounded bg-secondary-bg px-2 py-0.5 font-mono text-[8px] transition-colors hover:bg-hover"
            >
              <Hash size={6} />
              {isCopied ? "Copied" : commit.hash.substring(0, 7)}
            </button>
          </div>
          {files.map((file, fileIndex) => (
            <FileItem key={fileIndex} file={file} onFileClick={handleFileClick} />
          ))}
        </div>
      </div>
    );
  },
);

interface FileItemProps {
  file: any;
  onFileClick: (filePath: string) => void;
}

const FileItem = memo(({ file, onFileClick }: FileItemProps) => {
  const handleClick = useCallback(() => {
    onFileClick(file.file_path);
  }, [file.file_path, onFileClick]);

  const statusColor = useMemo(() => {
    if (file.is_new) return "text-green-400";
    if (file.is_deleted) return "text-red-400";
    return "text-yellow-400"; // modified
  }, [file.is_new, file.is_deleted]);

  const statusChar = useMemo(() => {
    if (file.is_new) return "A";
    if (file.is_deleted) return "D";
    return "M"; // modified
  }, [file.is_new, file.is_deleted]);

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[9px] hover:bg-hover"
      onClick={handleClick}
    >
      <span className={`font-mono ${statusColor}`}>{statusChar}</span>
      <span className="truncate text-text">{file.file_path}</span>
      {file.is_renamed && file.old_path && (
        <span className="text-text-lighter">← {file.old_path}</span>
      )}
    </div>
  );
});

const GitCommitHistory = ({ onViewCommitDiff, repoPath }: GitCommitHistoryProps) => {
  const { commits, hasMoreCommits, isLoadingMoreCommits, actions } = useGitStore();
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [commitFiles, setCommitFiles] = useState<Record<string, any[]>>({});
  const [loadingCommits, setLoadingCommits] = useState<Set<string>>(new Set());
  const [copiedHashes, setCopiedHashes] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);

  const toggleCommitExpansion = useCallback(
    (commitHash: string) => {
      setExpandedCommits((prev) => {
        const newExpanded = new Set(prev);

        if (prev.has(commitHash)) {
          newExpanded.delete(commitHash);
          return newExpanded;
        } else {
          newExpanded.add(commitHash);

          if (!commitFiles[commitHash] && repoPath) {
            setLoadingCommits((prev) => new Set(prev).add(commitHash));

            getCommitDiff(repoPath, commitHash)
              .then((diffs) => {
                setCommitFiles((prev) => ({
                  ...prev,
                  [commitHash]: diffs || [],
                }));
              })
              .catch(() => {})
              .finally(() => {
                setLoadingCommits((prev) => {
                  const newSet = new Set(prev);
                  newSet.delete(commitHash);
                  return newSet;
                });
              });
          }

          return newExpanded;
        }
      });
    },
    [commitFiles, repoPath],
  );

  const copyCommitHash = useCallback((hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHashes((prev) => new Set(prev).add(hash));
    setTimeout(() => {
      setCopiedHashes((prev) => {
        const newSet = new Set(prev);
        newSet.delete(hash);
        return newSet;
      });
    }, 1000);
  }, []);

  const handleViewCommitDiff = useCallback(
    (commitHash: string, filePath?: string) => {
      onViewCommitDiff?.(commitHash, filePath);
    },
    [onViewCommitDiff],
  );

  useEffect(() => {
    if (!repoPath) return;

    let scrollHandler: (() => void) | null = null;
    let isListenerAttached = false;

    const handleScroll = () => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const isScrollingDown = scrollTop > lastScrollTop.current;
      lastScrollTop.current = scrollTop;

      const scrollPercent = (scrollTop + clientHeight) / scrollHeight;

      if (isScrollingDown && scrollPercent >= 0.8) {
        if (hasMoreCommits && !isLoadingMoreCommits) {
          actions.loadMoreCommits(repoPath);
        }
      }
    };

    const setupScrollListener = () => {
      const container = scrollContainerRef.current;
      if (!container || isListenerAttached) return false;

      if (container.scrollHeight > container.clientHeight && hasMoreCommits) {
        container.addEventListener("scroll", handleScroll);
        isListenerAttached = true;
        scrollHandler = handleScroll;
        return true;
      }
      return false;
    };

    const removeScrollListener = () => {
      const container = scrollContainerRef.current;
      if (container && isListenerAttached && scrollHandler) {
        container.removeEventListener("scroll", scrollHandler);
        isListenerAttached = false;
        scrollHandler = null;
      }
    };

    if (commits.length === 0) {
      lastScrollTop.current = 0;
    }

    if (!setupScrollListener()) {
      const rafId = requestAnimationFrame(() => {
        if (!setupScrollListener()) {
          const timeoutId = setTimeout(() => {
            setupScrollListener();
          }, 100);

          return () => clearTimeout(timeoutId);
        }
      });

      return () => {
        cancelAnimationFrame(rafId);
        removeScrollListener();
      };
    }

    return removeScrollListener;
  }, [commits.length, hasMoreCommits, isLoadingMoreCommits, repoPath, actions]);

  if (commits.length === 0) {
    return (
      <div className="border-border border-b">
        <div className="flex items-center gap-2 bg-secondary-bg px-3 py-1 text-text-lighter">
          <Clock size={10} />
          <span className="cursor-default">commits</span>
        </div>
        <div className="cursor-default bg-primary-bg px-3 py-2 text-[10px] text-text-lighter italic">
          No commits found
        </div>
      </div>
    );
  }

  return (
    <div className="border-border border-b">
      <div className="flex items-center gap-2 bg-secondary-bg px-3 py-1 text-text-lighter">
        <Clock size={10} />
        <span className="cursor-default">commits</span>
      </div>

      <div ref={scrollContainerRef} className="max-h-96 overflow-y-auto bg-primary-bg">
        {commits.map((commit) => (
          <CommitItem
            key={commit.hash}
            commit={commit}
            expandedCommits={expandedCommits}
            commitFiles={commitFiles}
            loadingCommits={loadingCommits}
            copiedHashes={copiedHashes}
            onToggleExpansion={toggleCommitExpansion}
            onViewCommitDiff={handleViewCommitDiff}
            onCopyHash={copyCommitHash}
          />
        ))}

        {isLoadingMoreCommits && (
          <div className="border-border border-t bg-primary-bg px-3 py-2 text-center text-[10px] text-text-lighter">
            Loading older commits...
          </div>
        )}

        {!hasMoreCommits && commits.length > 0 && (
          <div className="border-border border-t bg-primary-bg px-3 py-2 text-center text-[10px] text-text-lighter">
            — end of history —
          </div>
        )}
      </div>
    </div>
  );
};

export default GitCommitHistory;
