import { FunnelIcon as Funnel } from "@/ui/icons";
import { memo, useCallback, useMemo } from "react";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { SidebarIconButton, SidebarSearchPopover, SidebarSection } from "@/ui/sidebar";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { AuthUser } from "@/features/window/services/auth-api";
import { formatRelativeDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import { cn } from "@/utils/cn";
import type { GitCommit } from "../types/git.types";
import { useGitStore } from "../stores/git.store";
import { getGitAuthorAvatarUrl } from "../utils/git-author-avatar";

interface GitCommitHistoryProps {
  onSelectCommit?: (commit: GitCommit) => void;
  repoPath?: string;
  ahead?: number;
  behind?: number;
  searchQuery: string;
  searchScope: HistorySearchScope;
}

interface CommitItemProps {
  commit: GitCommit;
  onSelectCommit: (commit: GitCommit) => void;
  syncState: "local" | "pushed";
  repoPath?: string;
  account: AuthUser | null;
}

export type HistorySearchScope = "all" | "message" | "author" | "hash";

const HISTORY_SEARCH_SCOPE_LABELS: Record<HistorySearchScope, string> = {
  all: "All Fields",
  message: "Message",
  author: "Author",
  hash: "Hash",
};

export function GitCommitHistoryControls({
  searchQuery,
  searchScope,
  onSearchQueryChange,
  onSearchScopeChange,
}: {
  searchQuery: string;
  searchScope: HistorySearchScope;
  onSearchQueryChange: (query: string) => void;
  onSearchScopeChange: (scope: HistorySearchScope) => void;
}) {
  return (
    <>
      <SidebarSearchPopover
        value={searchQuery}
        onChange={onSearchQueryChange}
        placeholder="Search history"
        aria-label="Search history"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarIconButton
              active={searchScope !== "all"}
              tooltip={`Filter: ${HISTORY_SEARCH_SCOPE_LABELS[searchScope]}`}
              tooltipSide="bottom"
              aria-label="Filter history"
            />
          }
        >
          <Funnel />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup
            value={searchScope}
            onValueChange={(scope) => onSearchScopeChange(scope as HistorySearchScope)}
          >
            {(Object.keys(HISTORY_SEARCH_SCOPE_LABELS) as HistorySearchScope[]).map((scope) => (
              <DropdownMenuRadioItem key={scope} value={scope} closeOnClick>
                {HISTORY_SEARCH_SCOPE_LABELS[scope]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

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

function getCommitDateGroup(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Older";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const thisWeek = new Date(today);
  thisWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(thisWeek.getDate() - 7);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= thisWeek) return "This Week";
  if (date >= lastWeek) return "Last Week";
  return "Older";
}

const CommitItem = memo(
  ({ commit, onSelectCommit, syncState, repoPath, account }: CommitItemProps) => {
    const handleCommitClick = useCallback(() => {
      onSelectCommit(commit);
    }, [commit, onSelectCommit]);

    const shortHash = commit.hash.substring(0, 7);
    const avatarUrl = getGitAuthorAvatarUrl(commit, account);

    return (
      <div className="mb-0.5">
        <button
          type="button"
          onClick={handleCommitClick}
          className={cn(
            "ui-text-sm flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-accent/80 focus-visible:bg-accent/80",
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
  onSelectCommit,
  repoPath,
  ahead = 0,
  behind = 0,
  searchQuery,
  searchScope,
}: GitCommitHistoryProps) => {
  const commits = useGitStore((state) => state.commits);
  const hasMoreCommits = useGitStore((state) => state.hasMoreCommits);
  const isLoadingMoreCommits = useGitStore((state) => state.isLoadingMoreCommits);
  const actions = useGitStore((state) => state.actions);
  const account = useAuthStore((state) => state.user);

  const handleSelectCommit = useCallback(
    (commit: GitCommit) => {
      onSelectCommit?.(commit);
    },
    [onSelectCommit],
  );

  const filteredCommits = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return commits;

    return commits.filter((commit) =>
      matchesSearchQuery(query, getCommitSearchFields(commit, searchScope)),
    );
  }, [commits, searchQuery, searchScope]);

  const commitSyncStateByHash = useMemo(() => {
    const syncState = new Map<string, "local" | "pushed">();
    commits.forEach((commit, index) => {
      syncState.set(commit.hash, index < ahead ? "local" : "pushed");
    });
    return syncState;
  }, [ahead, commits]);

  const commitGroups = useMemo(() => {
    const groups = new Map<string, GitCommit[]>();

    filteredCommits.forEach((commit) => {
      const label = getCommitDateGroup(commit.date);
      const group = groups.get(label);
      if (group) group.push(commit);
      else groups.set(label, [commit]);
    });

    return Array.from(groups, ([label, groupedCommits]) => ({ label, commits: groupedCommits }));
  }, [filteredCommits]);

  const hasHistoryRows = commits.length > 0;

  const handleLoadMore = useCallback(() => {
    if (!repoPath || isLoadingMoreCommits) return;
    void actions.loadMoreCommits(repoPath);
  }, [actions, isLoadingMoreCommits, repoPath]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden select-none">
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

      <div className="custom-scrollbar-auto relative min-h-0 flex-1 overflow-y-auto bg-transparent pr-2.5 [scrollbar-gutter:stable]">
        <div className="px-2 py-2">
          {!hasHistoryRows ? (
            <EmptyState layout="sidebar" message="No commits" />
          ) : filteredCommits.length === 0 ? (
            <EmptyState layout="sidebar" message="No commits match the current filters" />
          ) : (
            <>
              {commitGroups.map((group) => (
                <SidebarSection key={group.label} title={group.label} count={group.commits.length}>
                  {group.commits.map((commit) => (
                    <CommitItem
                      key={commit.hash}
                      commit={commit}
                      onSelectCommit={handleSelectCommit}
                      syncState={commitSyncStateByHash.get(commit.hash) ?? "pushed"}
                      repoPath={repoPath}
                      account={account}
                    />
                  ))}
                </SidebarSection>
              ))}
            </>
          )}

          {hasMoreCommits ? (
            <div className="pt-2">
              <Button
                size="sm"
                className="w-full"
                onClick={handleLoadMore}
                disabled={!repoPath || isLoadingMoreCommits}
              >
                {isLoadingMoreCommits ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : commits.length > 0 ? (
            <div className="ui-text-sm px-3 py-1.5 text-center text-subtle-foreground">
              end of history
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default GitCommitHistory;
