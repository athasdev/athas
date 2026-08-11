import { FunnelIcon as Funnel } from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { Avatar } from "@/ui/avatar";
import { EmptyState } from "@/ui/empty";
import { SidebarHeaderIconButton, SidebarHeader, SidebarSearchPopover } from "@/ui/sidebar";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { AuthUser } from "@/features/window/services/auth-api";
import { formatRelativeDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import { cn } from "@/utils/cn";
import type { GitCommit } from "../types/git.types";
import { useGitStore } from "../stores/git.store";
import { getGitAuthorAvatarUrl } from "../utils/git-author-avatar";

interface GitCommitHistoryProps {
  onViewCommitDiff?: (commitHash: string, filePath?: string) => void;
  repoPath?: string;
  ahead?: number;
  behind?: number;
}

interface CommitItemProps {
  commit: GitCommit;
  onViewCommitDiff: (commitHash: string) => void;
  isSelected: boolean;
  syncState: "local" | "pushed";
  repoPath?: string;
  account: AuthUser | null;
}

type HistorySearchScope = "all" | "message" | "author" | "hash";

const HISTORY_SEARCH_SCOPE_LABELS: Record<HistorySearchScope, string> = {
  all: "All Fields",
  message: "Message",
  author: "Author",
  hash: "Hash",
};

function getCommitSearchFields(commit: GitCommit, scope: HistorySearchScope) {
  if (scope === "message") return [commit.message, commit.description ?? ""];
  if (scope === "author") return [commit.author, commit.email ?? ""];
  if (scope === "hash") return [commit.hash, commit.hash.substring(0, 7)];

  return [
    commit.message,
    commit.description ?? "",
    commit.author,
    commit.email ?? "",
    commit.hash,
    commit.hash.substring(0, 7),
  ];
}

const CommitItem = memo(
  ({ commit, onViewCommitDiff, isSelected, syncState, repoPath, account }: CommitItemProps) => {
    const handleCommitClick = useCallback(() => {
      onViewCommitDiff(commit.hash);
    }, [commit.hash, onViewCommitDiff]);

    const shortHash = commit.hash.substring(0, 7);
    const avatarUrl = getGitAuthorAvatarUrl(commit, account);

    return (
      <div className="mb-0.5">
        <button
          type="button"
          onClick={handleCommitClick}
          className={cn(
            "ui-text-sm flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-accent/80 focus-visible:bg-accent/80",
            isSelected && "bg-primary/10",
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
          <Avatar name={commit.author} src={avatarUrl} className="mt-0.5 size-6" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "truncate leading-tight",
                  syncState === "local" ? "text-primary" : "text-foreground",
                )}
              >
                {commit.message}
              </span>
              {syncState === "local" ? (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              ) : null}
            </span>
            <span className="ui-text-sm mt-1 flex min-w-0 items-center gap-2 text-subtle-foreground">
              <span className="truncate">{commit.author}</span>
              <span className="shrink-0">{formatRelativeDate(commit.date)}</span>
              <span className="shrink-0 font-mono">{shortHash}</span>
            </span>
          </span>
        </button>
      </div>
    );
  },
);

const GitCommitHistory = ({
  onViewCommitDiff,
  repoPath,
  ahead = 0,
  behind = 0,
}: GitCommitHistoryProps) => {
  const commits = useGitStore((state) => state.commits);
  const hasMoreCommits = useGitStore((state) => state.hasMoreCommits);
  const isLoadingMoreCommits = useGitStore((state) => state.isLoadingMoreCommits);
  const actions = useGitStore((state) => state.actions);
  const account = useAuthStore((state) => state.user);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const scrollSetupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollSetupRafRef = useRef<number | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historySearchScope, setHistorySearchScope] = useState<HistorySearchScope>("all");

  const handleViewCommitDiff = useCallback(
    (commitHash: string, filePath?: string) => {
      setSelectedCommitHash(commitHash);
      onViewCommitDiff?.(commitHash, filePath);
    },
    [onViewCommitDiff],
  );

  const filteredCommits = useMemo(() => {
    const query = historySearchQuery.trim();
    if (!query) return commits;

    return commits.filter((commit) =>
      matchesSearchQuery(query, getCommitSearchFields(commit, historySearchScope)),
    );
  }, [commits, historySearchQuery, historySearchScope]);

  const commitSyncStateByHash = useMemo(() => {
    const syncState = new Map<string, "local" | "pushed">();
    commits.forEach((commit, index) => {
      syncState.set(commit.hash, index < ahead ? "local" : "pushed");
    });
    return syncState;
  }, [ahead, commits]);

  const hasHistoryRows = commits.length > 0;
  const hasHistoryFilter = historySearchScope !== "all";

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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden select-none">
      <SidebarHeader className="px-3">
        <SidebarSearchPopover
          value={historySearchQuery}
          onChange={setHistorySearchQuery}
          placeholder="Search history"
          aria-label="Search history"
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarHeaderIconButton
                active={hasHistoryFilter}
                tooltip={`Filter: ${HISTORY_SEARCH_SCOPE_LABELS[historySearchScope]}`}
                tooltipSide="bottom"
                aria-label="Filter history"
              />
            }
          >
            <Funnel />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={historySearchScope}
              onValueChange={(scope) => setHistorySearchScope(scope as HistorySearchScope)}
            >
              {(Object.keys(HISTORY_SEARCH_SCOPE_LABELS) as HistorySearchScope[]).map((scope) => (
                <DropdownMenuRadioItem key={scope} value={scope} closeOnClick>
                  {HISTORY_SEARCH_SCOPE_LABELS[scope]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      {(ahead > 0 || behind > 0) && (
        <div className="space-y-1 px-2 pb-1">
          {ahead > 0 ? (
            <div className="ui-text-sm text-subtle-foreground">
              <span className="text-primary">{ahead}</span>{" "}
              {`local commit${ahead !== 1 ? "s" : ""} not pushed`}
            </div>
          ) : null}
          {behind > 0 ? (
            <div className="ui-text-sm text-subtle-foreground">
              <span className="text-primary">{behind}</span>{" "}
              {`remote commit${behind !== 1 ? "s" : ""} not pulled`}
            </div>
          ) : null}
        </div>
      )}

      <div
        className="scrollbar-none relative min-h-0 flex-1 overflow-y-scroll bg-transparent pb-1"
        ref={scrollContainerRef}
      >
        {!hasHistoryRows ? (
          <EmptyState message="No commits" />
        ) : filteredCommits.length === 0 ? (
          <EmptyState message="No commits match the current filters" />
        ) : (
          <>
            {filteredCommits.map((commit) => (
              <CommitItem
                key={commit.hash}
                commit={commit}
                onViewCommitDiff={handleViewCommitDiff}
                isSelected={commit.hash === selectedCommitHash}
                syncState={commitSyncStateByHash.get(commit.hash) ?? "pushed"}
                repoPath={repoPath}
                account={account}
              />
            ))}

            {isLoadingMoreCommits && (
              <div className="flex justify-center px-3 py-1.5 text-subtle-foreground">
                <Spinner label="Loading commits" showLabel compact />
              </div>
            )}

            {!hasMoreCommits && commits.length > 0 && (
              <div className="ui-text-sm px-3 py-1.5 text-center text-subtle-foreground">
                end of history
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default GitCommitHistory;
