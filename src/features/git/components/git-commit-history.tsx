import {
  ClockCounterClockwiseIcon as ClockCounterClockwise,
  FileTextIcon as FileText,
  GitBranchIcon as GitBranch,
  GitCommitIcon as CommitIcon,
  WarningCircleIcon as WarningCircle,
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/utils/sidebar-resource-drag";
import Badge from "@/ui/badge";
import { LoadingIndicator } from "@/ui/loading";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import type { GitCommit, GitFile } from "../types/git.types";
import { useGitStore } from "../stores/git.store";
import GitSidebarSectionHeader from "./git-sidebar-section-header";

interface GitCommitHistoryProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onViewCommitDiff?: (commitHash: string, filePath?: string) => void;
  onViewWorkingTreeDiff?: () => void;
  repoPath?: string;
  showHeader?: boolean;
  uncommittedFiles?: GitFile[];
  currentBranch?: string;
}

interface CommitItemProps {
  commit: GitCommit;
  onViewCommitDiff: (commitHash: string) => void;
  isSelected: boolean;
  repoPath?: string;
}

interface WorkingTreeItemProps {
  files: GitFile[];
  branch?: string;
  onViewWorkingTreeDiff?: () => void;
}

const summarizeFiles = (files: GitFile[]) => {
  const staged = files.filter((file) => file.staged).length;
  const unstaged = files.length - staged;
  const untracked = files.filter((file) => file.status === "untracked").length;

  return { staged, unstaged, untracked };
};

const getCommitDetailDate = (date: string) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleString();
};

const WorkingTreeItem = memo(function WorkingTreeItem({
  files,
  branch,
  onViewWorkingTreeDiff,
}: WorkingTreeItemProps) {
  const { staged, unstaged, untracked } = summarizeFiles(files);
  const fileLabel = `${files.length} file${files.length === 1 ? "" : "s"}`;

  return (
    <div className="group/history-item relative mx-1 mb-1.5">
      <button
        type="button"
        onClick={onViewWorkingTreeDiff}
        className={cn(
          "ui-text-sm flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2.5 text-left outline-none transition-colors",
          "border-git-modified/35 bg-git-modified/8 hover:bg-git-modified/12 focus-visible:border-accent focus-visible:bg-git-modified/12",
        )}
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-git-modified/12 text-git-modified">
          <WarningCircle className="size-4" weight="duotone" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-text">Uncommitted Changes</span>
          </span>
          <span className="ui-text-xs mt-1 flex min-w-0 items-center gap-2 text-text-lighter">
            <span className="truncate">{branch || "Current branch"}</span>
            <span className="shrink-0">{fileLabel}</span>
          </span>
        </span>
      </button>

      <div className="pointer-events-none absolute inset-x-0 top-full z-30 mt-1 rounded-lg border border-border/70 bg-secondary-bg/95 p-2.5 opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover/history-item:opacity-100 group-focus-within/history-item:opacity-100">
        <div className="flex items-center gap-2 text-text">
          <WarningCircle className="size-4 text-git-modified" weight="duotone" />
          <span className="ui-text-sm font-medium">Uncommitted working tree</span>
        </div>
        <div className="ui-text-xs mt-2 grid grid-cols-3 gap-1.5 text-text-lighter">
          <span className="rounded-md border border-border/60 bg-primary-bg/70 px-1.5 py-1">
            {staged} staged
          </span>
          <span className="rounded-md border border-border/60 bg-primary-bg/70 px-1.5 py-1">
            {unstaged} unstaged
          </span>
          <span className="rounded-md border border-border/60 bg-primary-bg/70 px-1.5 py-1">
            {untracked} untracked
          </span>
        </div>
      </div>
    </div>
  );
});

const CommitItem = memo(({ commit, onViewCommitDiff, isSelected, repoPath }: CommitItemProps) => {
  const handleCommitClick = useCallback(() => {
    onViewCommitDiff(commit.hash);
  }, [commit.hash, onViewCommitDiff]);

  const shortHash = commit.hash.substring(0, 7);
  const details = [commit.author, commit.email].filter(Boolean).join(" · ");

  return (
    <div className="group/history-item relative mx-1 mb-1.5">
      <button
        type="button"
        onClick={handleCommitClick}
        className={cn(
          "ui-text-sm flex w-full cursor-pointer items-start gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left outline-none transition-colors hover:border-border/55 hover:bg-hover/80 focus-visible:border-accent focus-visible:bg-hover/80",
          isSelected && "border-accent/35 bg-accent/8",
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
            name: `Commit ${shortHash}`,
          });
        }}
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/8 text-text-lighter">
          <CommitIcon className="size-4" weight="duotone" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-text leading-tight">{commit.message}</span>
            <Badge size="compact" className="shrink-0">
              Commit {shortHash}
            </Badge>
          </span>
          <span className="ui-text-xs mt-1 flex min-w-0 items-center gap-2 text-text-lighter">
            <span className="truncate">{commit.author}</span>
            <span className="shrink-0">{formatRelativeDate(commit.date)}</span>
          </span>
        </span>
      </button>

      <div className="pointer-events-none absolute inset-x-0 top-full z-30 mt-1 rounded-lg border border-border/70 bg-secondary-bg/95 p-2.5 opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover/history-item:opacity-100 group-focus-within/history-item:opacity-100">
        <div className="flex min-w-0 items-center gap-2 text-text">
          <CommitIcon className="size-4 shrink-0 text-accent" weight="duotone" />
          <span className="ui-text-sm min-w-0 truncate font-medium">{commit.message}</span>
        </div>
        {commit.description && (
          <div className="ui-text-xs mt-1.5 line-clamp-2 text-text-lighter">
            {commit.description}
          </div>
        )}
        <div className="ui-text-xs mt-2 space-y-1 text-text-lighter">
          <div className="flex items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate">{shortHash}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <FileText className="size-3.5 shrink-0" />
            <span className="truncate">{details || commit.author}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ClockCounterClockwise className="size-3.5 shrink-0" />
            <span className="truncate">{getCommitDetailDate(commit.date)}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

const GitCommitHistory = ({
  isCollapsed,
  onToggle,
  onViewCommitDiff,
  onViewWorkingTreeDiff,
  repoPath,
  showHeader = true,
  uncommittedFiles = [],
  currentBranch,
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
  const hasUncommittedChanges = uncommittedFiles.length > 0;
  const hasHistoryRows = commits.length > 0 || hasUncommittedChanges;
  const visibleUncommittedFiles = useMemo(() => uncommittedFiles, [uncommittedFiles]);

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
            {!hasHistoryRows ? (
              <div className="ui-text-sm px-2.5 py-2 text-text-lighter italic">No commits</div>
            ) : (
              <>
                {hasUncommittedChanges && (
                  <WorkingTreeItem
                    files={visibleUncommittedFiles}
                    branch={currentBranch}
                    onViewWorkingTreeDiff={onViewWorkingTreeDiff}
                  />
                )}

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
                  <div className="flex justify-center px-3 py-1.5 text-text-lighter">
                    <LoadingIndicator label="Loading commits" showLabel compact />
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
