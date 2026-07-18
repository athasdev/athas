import { CheckIcon as Check, MagnifyingGlassIcon as Search } from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/utils/sidebar-resource-drag";
import type { MenuItem } from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { Avatar } from "@/ui/avatar";
import { SidebarSearchFilterRow } from "@/ui/sidebar";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { AuthUser } from "@/features/window/services/auth-api";
import { formatRelativeDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import { cn } from "@/utils/cn";
import type { GitCommit } from "../types/git.types";
import { useGitStore } from "../stores/git.store";
import { getGitAuthorAvatarUrl } from "../utils/git-author-avatar";
import GitSidebarSectionHeader from "./git-sidebar-section-header";

interface GitCommitHistoryProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onViewCommitDiff?: (commitHash: string, filePath?: string) => void;
  repoPath?: string;
  showHeader?: boolean;
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
            "ui-text-sm flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-hover/80 focus-visible:bg-hover/80",
            isSelected && "bg-accent/10",
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
                  syncState === "local" ? "text-accent" : "text-text",
                )}
              >
                {commit.message}
              </span>
              {syncState === "local" ? (
                <span className="size-1.5 shrink-0 rounded-full bg-accent" />
              ) : null}
            </span>
            <span className="ui-text-sm mt-1 flex min-w-0 items-center gap-2 text-text-lighter">
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
  isCollapsed,
  onToggle,
  onViewCommitDiff,
  repoPath,
  showHeader = true,
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
  const [isFilterOpen, setIsFilterOpen] = useState(false);

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

  const filterMenuItems = useMemo<MenuItem[]>(
    () =>
      (Object.keys(HISTORY_SEARCH_SCOPE_LABELS) as HistorySearchScope[]).map((scope) => ({
        id: scope,
        label: HISTORY_SEARCH_SCOPE_LABELS[scope],
        keybinding:
          historySearchScope === scope ? <Check className="size-3.5 text-accent" /> : null,
        onClick: () => {
          setHistorySearchScope(scope);
          setIsFilterOpen(false);
        },
      })),
    [historySearchScope],
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
          showHeader && "rounded-xl border border-border/60 bg-primary-bg/55",
        )}
      >
        {showHeader ? (
          <div className="shrink-0 py-1">
            <GitSidebarSectionHeader
              title="History"
              collapsible
              isCollapsed={isCollapsed}
              onToggle={onToggle}
            />
          </div>
        ) : null}

        {!isCollapsed && (
          <>
            <SidebarSearchFilterRow
              value={historySearchQuery}
              onChange={setHistorySearchQuery}
              searchIcon={Search}
              placeholder="Search history"
              searchAriaLabel="Search history"
              filterOpen={isFilterOpen}
              onFilterOpenChange={setIsFilterOpen}
              filterItems={filterMenuItems}
              filterActive={hasHistoryFilter}
              filterTooltip={`Filter: ${HISTORY_SEARCH_SCOPE_LABELS[historySearchScope]}`}
              filterAriaLabel="Filter history"
              filterCloseOnSelect={false}
              filterMenuClassName="w-fit min-w-fit"
              className="px-1 pb-1 pt-0"
            />

            {(ahead > 0 || behind > 0) && (
              <div className="space-y-1 px-2 pb-1">
                {ahead > 0 ? (
                  <div className="ui-text-sm text-text-lighter">
                    <span className="text-accent">{ahead}</span>{" "}
                    {`local commit${ahead !== 1 ? "s" : ""} not pushed`}
                  </div>
                ) : null}
                {behind > 0 ? (
                  <div className="ui-text-sm text-text-lighter">
                    <span className="text-accent">{behind}</span>{" "}
                    {`remote commit${behind !== 1 ? "s" : ""} not pulled`}
                  </div>
                ) : null}
              </div>
            )}

            <div
              className={cn(
                "scrollbar-none relative min-h-0 flex-1 overflow-y-scroll pb-1",
                showHeader ? "bg-primary-bg/70" : "bg-transparent",
              )}
              ref={scrollContainerRef}
            >
              {!hasHistoryRows ? (
                <div className="ui-text-sm px-2.5 py-2 text-text-lighter italic">No commits</div>
              ) : filteredCommits.length === 0 ? (
                <div className="ui-text-sm px-2.5 py-2 text-text-lighter italic">
                  No commits match the current filters
                </div>
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
                    <div className="flex justify-center px-3 py-1.5 text-text-lighter">
                      <Spinner label="Loading commits" showLabel compact />
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
          </>
        )}
      </div>
    </div>
  );
};

export default GitCommitHistory;
