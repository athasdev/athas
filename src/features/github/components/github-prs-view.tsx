import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { cn } from "@/utils/cn";
import { useGitHubStore } from "../store";
import type { PRFilter, PullRequest } from "../types";

const filterLabels: Record<PRFilter, string> = {
  all: "All PRs",
  "my-prs": "My PRs",
  "review-requests": "Review Requests",
};

interface PRListItemProps {
  pr: PullRequest;
  onSelect: () => void;
  onOpenExternal: () => void;
  onCheckout: () => void;
}

const PRListItem = memo(({ pr, onSelect, onOpenExternal, onCheckout }: PRListItemProps) => {
  const timeAgo = getTimeAgo(pr.createdAt);

  return (
    <div className="group rounded-lg border border-border/50 bg-primary-bg/70 px-2.5 py-2 transition-colors hover:bg-hover">
      <div className="flex items-start gap-2">
        <GitPullRequest
          size={14}
          className={cn(
            "mt-0.5 shrink-0",
            pr.state === "MERGED"
              ? "text-purple-500"
              : pr.state === "CLOSED"
                ? "text-red-500"
                : "text-green-500",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-lighter">#{pr.number}</span>
            {pr.isDraft && (
              <span className="rounded bg-text-lighter/20 px-1 py-0.5 text-[9px] text-text-lighter">
                Draft
              </span>
            )}
            {pr.reviewDecision && (
              <span
                className={cn(
                  "rounded px-1 py-0.5 text-[9px]",
                  pr.reviewDecision === "APPROVED"
                    ? "bg-green-500/20 text-green-500"
                    : pr.reviewDecision === "CHANGES_REQUESTED"
                      ? "bg-red-500/20 text-red-500"
                      : "bg-yellow-500/20 text-yellow-500",
                )}
              >
                {pr.reviewDecision === "APPROVED"
                  ? "Approved"
                  : pr.reviewDecision === "CHANGES_REQUESTED"
                    ? "Changes"
                    : "Review"}
              </span>
            )}
          </div>
          <button
            onClick={onSelect}
            className="block w-full truncate text-left text-text text-xs hover:underline"
          >
            {pr.title}
          </button>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-text-lighter">
            <span>{pr.author.login}</span>
            <span>{timeAgo}</span>
            <span className="text-green-500">+{pr.additions}</span>
            <span className="text-red-500">-{pr.deletions}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-text-lighter">
            <GitBranch size={10} />
            <span className="truncate">
              {pr.headRef} → {pr.baseRef}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCheckout();
            }}
            className="rounded p-1 text-text-lighter hover:bg-selected hover:text-text"
            title="Checkout PR branch"
          >
            <GitBranch size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenExternal();
            }}
            className="rounded p-1 text-text-lighter hover:bg-selected hover:text-text"
            title="Open in browser"
          >
            <ExternalLink size={12} />
          </button>
        </div>
      </div>
    </div>
  );
});

PRListItem.displayName = "PRListItem";

const GitHubPRsView = memo(() => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const { prs, isLoading, error, currentFilter, isAuthenticated } = useGitHubStore();
  const { fetchPRs, setFilter, checkAuth, openPRInBrowser, checkoutPR } = useGitHubStore().actions;
  const { openPRBuffer } = useBufferStore.use.actions();

  const [isFilterOpen, setIsFilterOpen] = useState(false);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (rootFolderPath && isAuthenticated) {
      fetchPRs(rootFolderPath);
    }
  }, [rootFolderPath, isAuthenticated, currentFilter, fetchPRs]);

  const handleRefresh = useCallback(() => {
    if (rootFolderPath) {
      fetchPRs(rootFolderPath);
    }
  }, [rootFolderPath, fetchPRs]);

  const handleFilterChange = useCallback(
    (filter: PRFilter) => {
      setFilter(filter);
      setIsFilterOpen(false);
    },
    [setFilter],
  );

  const handleSelectPR = useCallback(
    (prNumber: number) => {
      openPRBuffer(prNumber);
    },
    [openPRBuffer],
  );

  const handleOpenPR = useCallback(
    (prNumber: number) => {
      if (rootFolderPath) {
        openPRInBrowser(rootFolderPath, prNumber);
      }
    },
    [rootFolderPath, openPRInBrowser],
  );

  const handleCheckoutPR = useCallback(
    async (prNumber: number) => {
      if (rootFolderPath) {
        try {
          await checkoutPR(rootFolderPath, prNumber);
        } catch (err) {
          console.error("Failed to checkout PR:", err);
        }
      }
    },
    [rootFolderPath, checkoutPR],
  );

  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary-bg/85 px-2.5 py-2">
          <span className="font-medium text-text text-xs">Pull Requests</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-border/60 bg-secondary-bg/60 p-4 text-center">
          <AlertCircle size={24} className="mb-2 text-text-lighter" />
          <p className="text-text text-xs">GitHub CLI not authenticated</p>
          <p className="mt-1 text-[10px] text-text-lighter">Run `gh auth login` in terminal</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {/* Header */}
      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary-bg/85 px-2.5 py-2">
        <div className="relative">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-text text-xs hover:bg-hover"
          >
            {filterLabels[currentFilter]}
            <ChevronDown size={12} />
          </button>
          {isFilterOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsFilterOpen(false)} />
              <div className="absolute top-full left-0 z-20 mt-1 rounded border border-border bg-primary-bg py-1">
                {(Object.keys(filterLabels) as PRFilter[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => handleFilterChange(filter)}
                    className={cn(
                      "block w-full px-3 py-1 text-left text-xs hover:bg-hover",
                      filter === currentFilter ? "text-accent" : "text-text",
                    )}
                  >
                    {filterLabels[filter]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="rounded p-1 text-text-lighter hover:bg-hover hover:text-text disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Content */}
      <div className="scrollbar-hidden flex-1 overflow-y-auto rounded-xl border border-border/60 bg-secondary-bg/60 p-2">
        {error ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <AlertCircle size={20} className="mb-2 text-error" />
            <p className="text-error text-xs">{error}</p>
            <button onClick={handleRefresh} className="mt-2 text-accent text-xs hover:underline">
              Try again
            </button>
          </div>
        ) : isLoading && prs.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <RefreshCw size={16} className="animate-spin text-text-lighter" />
          </div>
        ) : prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <GitPullRequest size={20} className="mb-2 text-text-lighter" />
            <p className="text-text-lighter text-xs">No pull requests</p>
          </div>
        ) : (
          <div className="space-y-2">
            {prs.map((pr) => (
              <PRListItem
                key={pr.number}
                pr={pr}
                onSelect={() => handleSelectPR(pr.number)}
                onOpenExternal={() => handleOpenPR(pr.number)}
                onCheckout={() => handleCheckoutPR(pr.number)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

GitHubPRsView.displayName = "GitHubPRsView";

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

export default GitHubPRsView;
