import { useEffect, useMemo, useState } from "react";
import {
  ViewerErrorState,
  ViewerLoadingState,
  ViewerState,
} from "@/features/viewer/components/viewer-state";
import { ResourceContentSection } from "@/ui/resource";
import { CommentItem } from "./comment-item";
import { GitHubInlineMarkdown } from "./github-inline-editors";

interface ActivityItemComment {
  id: string;
  comment: {
    author: { login: string };
    body: string;
    createdAt: string;
  };
}

interface PRActivityPanelProps {
  body: string;
  repositoryUrl: string;
  repoPath?: string;
  activityItems: ActivityItemComment[];
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
    <div className="w-full min-w-0 space-y-8">
      <ResourceContentSection title="Description">
        <GitHubInlineMarkdown
          value={body}
          emptyLabel="No description provided"
          repositoryUrl={repositoryUrl}
          repoPath={repoPath}
          onSave={onBodySave}
        />
      </ResourceContentSection>

      <ResourceContentSection title="Activity">
        {isLoadingContent && activityItems.length === 0 ? (
          <ViewerLoadingState label="Loading activity" layout="section" className="min-h-0" />
        ) : contentError ? (
          <ViewerErrorState
            message={contentError}
            actionLabel="Retry"
            onAction={onRetry}
            layout="section"
            className="min-h-0"
          />
        ) : activityItems.length === 0 ? (
          <ViewerState description="No activity" layout="section" className="min-h-0" />
        ) : (
          <div className="w-full space-y-3">
            {visibleActivityItems.map((item) => (
              <CommentItem
                key={item.id}
                comment={item.comment}
                repositoryUrl={repositoryUrl}
                repoPath={repoPath}
              />
            ))}
            {activityItems.length > visibleActivityItems.length ? (
              <div className="font-sans ui-text-sm px-1 py-2 text-subtle-foreground">
                {`Loading ${activityItems.length - visibleActivityItems.length} more activity items...`}
              </div>
            ) : null}
          </div>
        )}
      </ResourceContentSection>
    </div>
  );
}
