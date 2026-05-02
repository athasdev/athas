import { memo, useCallback, useEffect, useRef, useState } from "react";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/sidebar-resource-drag";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import type { GitCommit } from "../types/git-types";
import { useGitStore } from "../stores/git-store";
import GitSidebarSectionHeader from "./git-sidebar-section-header";

interface GitCommitHistoryProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onViewCommitDiff?: (commitHash: string, filePath?: string) => void;
  repoPath?: string;
  showHeader?: boolean;
}

interface CommitItemProps {
  commit: GitCommit;
  onViewCommitDiff: (commitHash: string) => void;
  isSelected: boolean;
  repoPath?: string;
}

const CommitItem = memo(({ commit, onViewCommitDiff, isSelected, repoPath }: CommitItemProps) => {
  const handleCommitClick = useCallback(() => {
    onViewCommitDiff(commit.hash);
  }, [commit.hash, onViewCommitDiff]);

  return (
    <div
      onClick={handleCommitClick}
      className={cn(
        "ui-text-sm mx-1 mb-1 cursor-pointer rounded-lg px-2.5 py-2 transition-[transform,background-color,opacity] hover:bg-hover",
        repoPath && "cursor-grab active:cursor-grabbing",
        isSelected && "bg-hover",
      )}
      draggable={!!repoPath}
      onDragStart={(event) => {
        if (!repoPath) return;
        writeSidebarResourceDragData(event.dataTransfer, {
          type: "git-commit",
          repoPath,
          commitHash: commit.hash,
          message: commit.message,
          author: commit.author,
          date: commit.date,
          name: `Commit ${commit.hash.substring(0, 7)}`,
        });
      }}
    >
      <div className="truncate text-inherit text-text leading-tight">{commit.message}</div>
      <div className="ui-text-sm mt-1 flex items-center gap-2 text-text-lighter">
        <span className="truncate">{commit.author}</span>
        <span className="shrink-0">{formatRelativeDate(commit.date)}</span>
      </div>
    </div>
  );
});

const GitCommitHistory = ({
  isCollapsed,
  onToggle,
  onViewCommitDiff,
  repoPath,
  showHeader = true,
}: GitCommitHistoryProps) => {
  const { commits, hasMoreCommits, isLoadingMoreCommits, actions } = useGitStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const scrollSetupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollSetupRafRef = useRef<number | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);

  const handleViewCommitDiff = useCallback(
    (commitHash: string, filePath?: string) => {
      setSelectedCommitHash(commitHash);
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
      removeScrollListener();
    };
  }, [commits.length, hasMoreCommits, isLoadingMoreCommits, repoPath, actions]);

  return (
    <div
      className={cn(
        "select-none",
        isCollapsed ? "shrink-0" : "flex h-full min-h-0 flex-1 flex-col",
      )}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          showHeader && "rounded-lg border border-border/60 bg-primary-bg/55",
        )}
      >
        <div className="shrink-0 px-1 py-1">
          {showHeader ? (
            <GitSidebarSectionHeader
              title="History"
              collapsible
              isCollapsed={isCollapsed}
              onToggle={onToggle}
            />
          ) : (
            <GitSidebarSectionHeader title="History" />
          )}
        </div>

        {!isCollapsed && (
          <div
            className={cn(
              "scrollbar-none relative min-h-0 flex-1 overflow-y-scroll px-1 pb-1",
              showHeader ? "bg-primary-bg/70" : "bg-transparent",
            )}
            ref={scrollContainerRef}
          >
            {commits.length === 0 ? (
              <div className="ui-text-sm px-2.5 py-2 text-text-lighter italic">No commits</div>
            ) : (
              <>
                {commits.map((commit) => (
                  <CommitItem
                    key={commit.hash}
                    commit={commit}
                    onViewCommitDiff={handleViewCommitDiff}
                    isSelected={commit.hash === selectedCommitHash}
                    repoPath={repoPath}
                  />
                ))}

                {isLoadingMoreCommits && (
                  <div className="ui-text-sm px-3 py-1.5 text-center text-text-lighter">
                    Loading...
                  </div>
                )}

                {!hasMoreCommits && commits.length > 0 && (
                  <div className="ui-text-sm px-3 py-1.5 text-center text-text-lighter">
                    end of history
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GitCommitHistory;
