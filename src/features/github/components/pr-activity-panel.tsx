import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/ui/button";
import type { Commit } from "../types/pr-viewer";
import { CommentItem } from "./comment-item";
import { CommitItem } from "./commit-item";
import GitHubMarkdown from "./github-markdown";

interface ActivityItemComment {
  id: string;
  type: "comment";
  createdAt: number;
  comment: {
    author: { login: string };
    body: string;
    createdAt: string;
  };
}

interface ActivityItemCommit {
  id: string;
  type: "commit";
  createdAt: number;
  commit: Commit;
}

interface PRActivityPanelProps {
  body: string;
  issueBaseUrl: string;
  repoPath?: string;
  activityItems: Array<ActivityItemComment | ActivityItemCommit>;
  isLoadingContent: boolean;
  contentError: string | null;
  onRetry: () => void;
}

export function PRActivityPanel({
  body,
  issueBaseUrl,
  repoPath,
  activityItems,
  isLoadingContent,
  contentError,
  onRetry,
}: PRActivityPanelProps) {
  const [visibleActivityCount, setVisibleActivityCount] = useState(12);
  const visibleActivityItems = useMemo(
    () => activityItems.slice(0, visibleActivityCount),
    [activityItems, visibleActivityCount],
  );

  useEffect(() => {
    setVisibleActivityCount(12);
  }, [activityItems]);

  useEffect(() => {
    if (activityItems.length <= visibleActivityCount) return;

    let cancelled = false;
    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const schedule = idleApi.requestIdleCallback;

    const revealMore = () => {
      if (cancelled) return;
      setVisibleActivityCount((current) => Math.min(current + 12, activityItems.length));
    };

    if (typeof schedule === "function") {
      const idleId = schedule(revealMore, { timeout: 200 });
      return () => {
        cancelled = true;
        idleApi.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = window.setTimeout(revealMore, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [activityItems.length, visibleActivityCount]);

  return (
    <div className="min-w-0 space-y-5">
      {body ? (
        <GitHubMarkdown
          content={body}
          className="github-markdown-pr"
          contentClassName="github-markdown-pr-content"
          issueBaseUrl={issueBaseUrl}
          repoPath={repoPath}
        />
      ) : (
        <p className="ui-font ui-text-sm italic text-text-lighter">No description provided</p>
      )}

      <div className="space-y-2">
        {isLoadingContent && activityItems.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <RefreshCw className="animate-spin text-text-lighter" />
            <span className="ml-2 ui-font ui-text-sm text-text-lighter">Loading activity...</span>
          </div>
        ) : contentError ? (
          <div className="flex items-center justify-center p-8 text-center">
            <div>
              <p className="ui-font ui-text-sm text-error">{contentError}</p>
              <Button
                onClick={onRetry}
                variant="outline"
                size="xs"
                className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
              >
                Retry
              </Button>
            </div>
          </div>
        ) : activityItems.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <p className="ui-font ui-text-sm text-text-lighter">No activity</p>
          </div>
        ) : (
          <div className="space-y-1">
            {visibleActivityItems.map((item) =>
              item.type === "comment" ? (
                <CommentItem
                  key={item.id}
                  comment={item.comment}
                  issueBaseUrl={issueBaseUrl}
                  repoPath={repoPath}
                />
              ) : (
                <CommitItem
                  key={item.id}
                  commit={item.commit}
                  issueBaseUrl={issueBaseUrl}
                  repoPath={repoPath}
                />
              ),
            )}
            {activityItems.length > visibleActivityItems.length ? (
              <div className="ui-font ui-text-sm px-1 py-2 text-text-lighter">
                {`Loading ${activityItems.length - visibleActivityItems.length} more activity items...`}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
