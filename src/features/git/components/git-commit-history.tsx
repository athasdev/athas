import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useCallback, useEffect, useRef } from "react";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import { useGitStore } from "../stores/git-store";

interface GitCommitHistoryProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onViewCommitDiff?: (commitHash: string, filePath?: string) => void;
  repoPath?: string;
  showHeader?: boolean;
}

interface CommitItemProps {
  commit: any;
  onViewCommitDiff: (commitHash: string) => void;
}

const CommitItem = memo(({ commit, onViewCommitDiff }: CommitItemProps) => {
  const handleCommitClick = useCallback(() => {
    onViewCommitDiff(commit.hash);
  }, [commit.hash, onViewCommitDiff]);

  return (
    <div
      onClick={handleCommitClick}
      className="mx-1 mb-1 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-hover"
    >
      <div className="truncate text-inherit text-text leading-tight">{commit.message}</div>
      <div className="flex items-center gap-2 text-[0.82em] text-text-lighter">
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
        {showHeader && (
          <button
            type="button"
            className="sticky top-0 z-20 flex w-full shrink-0 cursor-pointer items-center gap-1 border-border/50 border-b bg-secondary-bg/90 px-2.5 py-1.5 text-text-lighter backdrop-blur-sm hover:bg-hover"
            onClick={onToggle}
          >
            {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            <span className="font-medium text-[0.9em] text-text">History</span>
            <div className="flex-1" />
            <span className="rounded-full bg-primary-bg px-1.5 text-[0.74em]">
              {commits.length}
            </span>
          </button>
        )}

        {!isCollapsed && (
          <div
            className={cn(
              "scrollbar-none relative min-h-0 flex-1 overflow-y-scroll p-1",
              showHeader ? "bg-primary-bg/70" : "bg-transparent",
            )}
            ref={scrollContainerRef}
          >
            {commits.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[0.84em] text-text-lighter italic">No commits</div>
            ) : (
              <>
                {commits.map((commit) => (
                  <CommitItem
                    key={commit.hash}
                    commit={commit}
                    onViewCommitDiff={handleViewCommitDiff}
                  />
                ))}

                {isLoadingMoreCommits && (
                  <div className="px-3 py-1.5 text-center text-[0.84em] text-text-lighter">
                    Loading...
                  </div>
                )}

                {!hasMoreCommits && commits.length > 0 && (
                  <div className="px-3 py-1.5 text-center text-[0.84em] text-text-lighter">
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
