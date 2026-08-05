import { useEffect, useMemo, useState } from "react";
import type { Commit } from "../types/github-pr-viewer.types";
import { CommentItem } from "./comment-item";
import { CommitItem } from "./commit-item";
import { GitHubInlineMarkdown } from "./github-inline-editors";
import { GitHubViewerLoadingState, GitHubViewerState } from "./github-viewer-shell";

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
  repositoryUrl: string;
  repoPath?: string;
  activityItems: Array<ActivityItemComment | ActivityItemCommit>;
  isLoadingContent: boolean;
  contentError: string | null;
  onRetry: () => void;
  onBodySave: (body: string) => Promise<boolean>;
}

export function PRActivityPanel({
  body,
  repositoryUrl,
  repoPath,
  activityItems,
  isLoadingContent,
  contentError,
  onRetry,
  onBodySave,
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
    <div className="min-w-0 w-full space-y-8">
      <section className="space-y-3">
        <h2 className="font-sans ui-text-sm font-normal text-subtle-foreground">Description</h2>
        <GitHubInlineMarkdown
          value={body}
          emptyLabel="No description provided"
          repositoryUrl={repositoryUrl}
          repoPath={repoPath}
          onSave={onBodySave}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-sans ui-text-sm font-normal text-subtle-foreground">Activity</h2>
        {isLoadingContent && activityItems.length === 0 ? (
          <GitHubViewerLoadingState label="Loading activity" className="min-h-0" />
        ) : contentError ? (
          <GitHubViewerState
            description={contentError}
            actionLabel="Retry"
            onAction={onRetry}
            tone="error"
            className="min-h-0"
          />
        ) : activityItems.length === 0 ? (
          <GitHubViewerState description="No activity" className="min-h-0" />
        ) : (
          <div className="w-full space-y-3">
            {visibleActivityItems.map((item) =>
              item.type === "comment" ? (
                <CommentItem
                  key={item.id}
                  comment={item.comment}
                  repositoryUrl={repositoryUrl}
                  repoPath={repoPath}
                />
              ) : (
                <CommitItem key={item.id} commit={item.commit} repoPath={repoPath} />
              ),
            )}
            {activityItems.length > visibleActivityItems.length ? (
              <div className="font-sans ui-text-sm px-1 py-2 text-subtle-foreground">
                {`Loading ${activityItems.length - visibleActivityItems.length} more activity items...`}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
