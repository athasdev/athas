import { Clock, Hash, User } from "lucide-react";
import { type MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCommitDiff } from "@/features/version-control/git/controllers/git";
import { useGitStore } from "@/features/version-control/git/controllers/git-store";

interface GitCommitHistoryProps {
  onViewCommitDiff?: (commitHash: string, filePath?: string) => void;
  repoPath?: string;
}

const EMPTY_FILES_ARRAY: any[] = [];
const HOVER_CLOSE_DELAY_MS = 250;
const MAX_VISIBLE_FILES = 5;
const FILE_ROW_HEIGHT = 26;

interface CommitItemProps {
  commit: any;
  isActive: boolean;
  onHover: (commit: any, target: HTMLElement) => void;
  onHoverEnd: () => void;
  onViewCommitDiff: (commitHash: string) => void;
}

const CommitItem = memo(
  ({ commit, isActive, onHover, onHoverEnd, onViewCommitDiff }: CommitItemProps) => {
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

    const handleCommitClick = useCallback(() => {
      onViewCommitDiff(commit.hash);
    }, [commit.hash, onViewCommitDiff]);

    const handleMouseEnter = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        onHover(commit, event.currentTarget);
      },
      [commit, onHover],
    );

    return (
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={onHoverEnd}
        onClick={handleCommitClick}
        className={`cursor-pointer px-3 py-2 hover:bg-hover ${isActive ? "bg-hover" : ""}`}
      >
        <div className="flex items-start gap-2">
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
    );
  },
);

interface CommitHoverPreviewProps {
  commit: any;
  files: any[];
  isLoading: boolean;
  isCopied: boolean;
  anchorRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
    scrollbarWidth: number;
  };
  onKeepOpen: () => void;
  onRequestClose: () => void;
  onCopyHash: (hash: string) => void;
  onViewCommitDiff: (commitHash: string, filePath?: string) => void;
}

const CommitHoverPreview = memo(
  ({
    commit,
    files,
    isLoading,
    isCopied,
    anchorRect,
    onKeepOpen,
    onRequestClose,
    onCopyHash,
    onViewCommitDiff,
  }: CommitHoverPreviewProps) => {
    const handleCopyClick = useCallback(() => {
      onCopyHash(commit.hash);
    }, [commit.hash, onCopyHash]);

    const handleFileClick = useCallback(
      (filePath: string) => {
        onViewCommitDiff(commit.hash, filePath);
      },
      [commit.hash, onViewCommitDiff],
    );

    const portalTarget = typeof document !== "undefined" ? document.body : null;

    const { top, right, scrollbarWidth } = anchorRect;
    const filesScrollable = files.length > MAX_VISIBLE_FILES;
    const listMaxHeight = filesScrollable ? MAX_VISIBLE_FILES * FILE_ROW_HEIGHT : undefined;
    const windowHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    const windowWidth = typeof window !== "undefined" ? window.innerWidth : 0;

    const estimatedHeight = useMemo(() => {
      if (isLoading) return 160;
      const visibleCount = Math.min(files.length, MAX_VISIBLE_FILES);
      const base = files.length === 0 ? 140 : visibleCount * FILE_ROW_HEIGHT + 120;
      return Math.min(Math.max(base, 140), 340);
    }, [files.length, isLoading]);

    const cardWidth = 260;
    const viewportPadding = 12;

    const verticalPosition = (() => {
      if (!windowHeight) return top;
      const minTop = viewportPadding;
      const maxTop = Math.max(windowHeight - estimatedHeight - viewportPadding, viewportPadding);
      return Math.min(Math.max(top, minTop), maxTop);
    })();

    const desiredLeft = right + scrollbarWidth + 4;
    const horizontalPosition = (() => {
      if (!windowWidth) return desiredLeft;
      const maxLeft = windowWidth - cardWidth - viewportPadding;
      const clamped = Math.min(desiredLeft, maxLeft);
      return Math.max(clamped, viewportPadding);
    })();

    if (!portalTarget) {
      return null;
    }

    return createPortal(
      <div
        className="pointer-events-auto fixed z-50 w-60 rounded border border-border bg-secondary-bg p-3 text-[9px] shadow-lg"
        style={{ top: verticalPosition, left: horizontalPosition, width: cardWidth }}
        onMouseEnter={onKeepOpen}
        onMouseLeave={onRequestClose}
      >
        <div className="mb-2">
          <div className="mb-1 font-medium text-text leading-tight">{commit.message}</div>
          <div className="flex items-center justify-between text-text-lighter">
            <span className="flex items-center gap-1">
              <User size={8} />
              {commit.author}
            </span>
            <button
              onClick={handleCopyClick}
              className="ui-font inline-flex items-center gap-1 rounded bg-secondary-bg px-2 py-0.5 text-[8px] transition-colors hover:bg-hover"
            >
              <Hash size={6} />
              {isCopied ? "Copied" : commit.hash.substring(0, 7)}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-text-lighter italic">Loading files...</div>
        ) : files.length === 0 ? (
          <div className="text-text-lighter italic">No files changed</div>
        ) : (
          <div className="space-y-1">
            <div className="mb-1 text-text-lighter">
              {files.length} file{files.length !== 1 ? "s" : ""} changed
            </div>
            <div
              className={`${filesScrollable ? "scrollbar-thin pr-1" : ""} space-y-1`}
              style={{
                maxHeight: listMaxHeight,
                overflowY: filesScrollable ? "auto" : "visible",
              }}
            >
              {files.map((file, index) => (
                <FileItem key={index} file={file} onFileClick={handleFileClick} />
              ))}
            </div>
          </div>
        )}
      </div>,
      portalTarget,
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
    return "text-yellow-400";
  }, [file.is_new, file.is_deleted]);

  const statusChar = useMemo(() => {
    if (file.is_new) return "A";
    if (file.is_deleted) return "D";
    return "M";
  }, [file.is_new, file.is_deleted]);

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded bg-primary-bg px-2 py-1 hover:bg-hover"
      onClick={handleClick}
    >
      <span className={`ui-font ${statusColor}`}>{statusChar}</span>
      <span className="truncate text-text">{file.file_path}</span>
      {file.is_renamed && file.old_path && (
        <span className="text-text-lighter">← {file.old_path}</span>
      )}
    </div>
  );
});

const GitCommitHistory = ({ onViewCommitDiff, repoPath }: GitCommitHistoryProps) => {
  const { commits, hasMoreCommits, isLoadingMoreCommits, actions } = useGitStore();
  const [commitFiles, setCommitFiles] = useState<Record<string, any[]>>({});
  const [loadingCommits, setLoadingCommits] = useState<Set<string>>(new Set());
  const [copiedHashes, setCopiedHashes] = useState<Set<string>>(new Set());
  const [hoveredCommit, setHoveredCommit] = useState<{
    commit: any;
    anchorRect: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      width: number;
      height: number;
      scrollbarWidth: number;
    };
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollTop = useRef(0);
  const copyHashTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const scrollSetupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollSetupRafRef = useRef<number | null>(null);

  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const scheduleHoverClear = useCallback(() => {
    clearHoverTimeout();
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCommit(null);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimeout]);

  const handleCommitHover = useCallback(
    (commit: any, target: HTMLElement) => {
      clearHoverTimeout();

      const container = scrollContainerRef.current;
      if (!container) return;

      const targetRect = target.getBoundingClientRect();
      const scrollbarWidth = Math.max(container.offsetWidth - container.clientWidth, 0);
      setHoveredCommit({
        commit,
        anchorRect: {
          top: targetRect.top,
          bottom: targetRect.bottom,
          left: targetRect.left,
          right: targetRect.right,
          width: targetRect.width,
          height: targetRect.height,
          scrollbarWidth,
        },
      });

      if (!commitFiles[commit.hash] && repoPath) {
        setLoadingCommits((prev) => {
          if (prev.has(commit.hash)) return prev;
          const next = new Set(prev);
          next.add(commit.hash);
          return next;
        });

        getCommitDiff(repoPath, commit.hash)
          .then((diffs) => {
            setCommitFiles((prev) => ({
              ...prev,
              [commit.hash]: diffs || [],
            }));
          })
          .catch(() => {})
          .finally(() => {
            setLoadingCommits((prev) => {
              const next = new Set(prev);
              next.delete(commit.hash);
              return next;
            });
          });
      }
    },
    [clearHoverTimeout, commitFiles, repoPath],
  );

  const handleCommitHoverEnd = useCallback(() => {
    scheduleHoverClear();
  }, [scheduleHoverClear]);

  const copyCommitHash = useCallback((hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHashes((prev) => new Set(prev).add(hash));
    const existingTimeout = copyHashTimeoutRef.current.get(hash);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    const timeoutId = setTimeout(() => {
      setCopiedHashes((prev) => {
        const next = new Set(prev);
        next.delete(hash);
        return next;
      });
      copyHashTimeoutRef.current.delete(hash);
    }, 1000);
    copyHashTimeoutRef.current.set(hash, timeoutId);
  }, []);

  const handleViewCommitDiff = useCallback(
    (commitHash: string, filePath?: string) => {
      onViewCommitDiff?.(commitHash, filePath);
    },
    [onViewCommitDiff],
  );

  useEffect(() => {
    return () => {
      clearHoverTimeout();
    };
  }, [clearHoverTimeout]);

  useEffect(() => {
    if (!repoPath) return;

    let scrollHandler: (() => void) | null = null;
    let isListenerAttached = false;

    const handleScroll = () => {
      const container = scrollContainerRef.current;
      if (!container) return;

      if (hoveredCommit) {
        clearHoverTimeout();
        setHoveredCommit(null);
      }

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
      if (scrollSetupRafRef.current) {
        cancelAnimationFrame(scrollSetupRafRef.current);
      }
      scrollSetupRafRef.current = requestAnimationFrame(() => {
        if (!setupScrollListener()) {
          if (scrollSetupTimeoutRef.current) {
            clearTimeout(scrollSetupTimeoutRef.current);
          }
          scrollSetupTimeoutRef.current = setTimeout(() => {
            setupScrollListener();
            scrollSetupTimeoutRef.current = null;
          }, 100);
        }
        scrollSetupRafRef.current = null;
      });
    }

    return () => {
      if (scrollSetupRafRef.current) {
        cancelAnimationFrame(scrollSetupRafRef.current);
        scrollSetupRafRef.current = null;
      }
      if (scrollSetupTimeoutRef.current) {
        clearTimeout(scrollSetupTimeoutRef.current);
        scrollSetupTimeoutRef.current = null;
      }
      copyHashTimeoutRef.current.forEach((timeout) => clearTimeout(timeout));
      copyHashTimeoutRef.current.clear();
      removeScrollListener();
    };
  }, [
    commits.length,
    hasMoreCommits,
    isLoadingMoreCommits,
    repoPath,
    actions,
    hoveredCommit,
    clearHoverTimeout,
  ]);

  useEffect(() => {
    if (!hoveredCommit) return;
    const stillExists = commits.some((commit) => commit.hash === hoveredCommit.commit.hash);
    if (!stillExists) {
      setHoveredCommit(null);
    }
  }, [commits, hoveredCommit]);

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

      <div className="relative">
        <div ref={scrollContainerRef} className="max-h-96 overflow-y-auto bg-primary-bg">
          {commits.map((commit) => (
            <CommitItem
              key={commit.hash}
              commit={commit}
              isActive={hoveredCommit?.commit.hash === commit.hash}
              onHover={handleCommitHover}
              onHoverEnd={handleCommitHoverEnd}
              onViewCommitDiff={handleViewCommitDiff}
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

        {hoveredCommit && (
          <CommitHoverPreview
            commit={hoveredCommit.commit}
            files={commitFiles[hoveredCommit.commit.hash] || EMPTY_FILES_ARRAY}
            isLoading={loadingCommits.has(hoveredCommit.commit.hash)}
            isCopied={copiedHashes.has(hoveredCommit.commit.hash)}
            anchorRect={hoveredCommit.anchorRect}
            onKeepOpen={clearHoverTimeout}
            onRequestClose={scheduleHoverClear}
            onCopyHash={copyCommitHash}
            onViewCommitDiff={handleViewCommitDiff}
          />
        )}
      </div>
    </div>
  );
};

export default GitCommitHistory;
