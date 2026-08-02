import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChatCircleTextIcon as MessageSquare,
  DotOutlineIcon as CircleDot,
  DotsThreeIcon as MoreHorizontal,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription } from "@/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import Tooltip from "@/ui/tooltip";
import type { IssueDetails } from "../types/github.types";
import { GITHUB_ISSUE_DETAILS_TTL_MS, githubIssueDetailsCache } from "../utils/github-data-cache";
import { copyToClipboard, getTimeAgo } from "../utils/github-viewer-utils";
import { CommentItem } from "./comment-item";
import { GitHubAvatar } from "./github-avatar";
import GitHubMarkdown from "./github-markdown";
import { LabelBadges } from "./pr-status";
import {
  GitHubDetailLayout,
  GitHubDetailSection,
  GitHubDetailSidebar,
  GitHubViewerHeader,
  GitHubViewerLoadingState,
  GitHubViewerShell,
  GitHubViewerState,
} from "./github-viewer-shell";

interface GitHubIssueViewerProps {
  issueNumber: number;
  repoPath?: string;
  bufferId: string;
}

const GitHubIssueViewer = memo(({ issueNumber, repoPath, bufferId }: GitHubIssueViewerProps) => {
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const openGitHubFormBuffer = useBufferStore.use.actions().openGitHubFormBuffer;
  const buffer = useBufferStore((state) => state.buffers.find((item) => item.id === bufferId));
  const [details, setDetails] = useState<IssueDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCommentCount, setVisibleCommentCount] = useState(8);
  const repositoryUrl = useMemo(
    () => details?.url.replace(/\/issues\/\d+$/, "") ?? undefined,
    [details?.url],
  );
  const visibleComments = useMemo(
    () => details?.comments.slice(0, visibleCommentCount) ?? [],
    [details?.comments, visibleCommentCount],
  );

  const fetchIssue = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cacheKey = `${repoPath}::${issueNumber}`;
      const cached = githubIssueDetailsCache.getFreshValue(cacheKey, GITHUB_ISSUE_DETAILS_TTL_MS);
      if (cached && !force) {
        setDetails(cached);
        setError(null);
        setIsLoading(false);
        return;
      }

      const stale = githubIssueDetailsCache.getSnapshot(cacheKey)?.value;
      if (stale && !force) {
        setDetails(stale);
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextDetails = await githubIssueDetailsCache.load(
          cacheKey,
          () =>
            invoke<IssueDetails>("github_get_issue_details", {
              repoPath,
              issueNumber,
            }),
          { force, ttlMs: GITHUB_ISSUE_DETAILS_TTL_MS },
        );
        setDetails(nextDetails);
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setIsLoading(false);
      }
    },
    [issueNumber, repoPath],
  );

  useEffect(() => {
    void fetchIssue();
  }, [fetchIssue]);

  useEffect(() => {
    if (!details || !buffer || buffer.type !== "githubIssue") return;

    const authorAvatarUrl =
      details.author.avatarUrl ||
      `https://github.com/${encodeURIComponent(details.author.login || "github")}.png?size=32`;

    if (
      buffer.name === details.title &&
      buffer.authorAvatarUrl === authorAvatarUrl &&
      buffer.url === details.url
    ) {
      return;
    }

    updateBuffer({
      ...buffer,
      name: details.title,
      authorAvatarUrl,
      url: details.url,
    });
  }, [buffer, details, updateBuffer]);

  useEffect(() => {
    setVisibleCommentCount(8);
  }, [details?.number]);

  useEffect(() => {
    const totalComments = details?.comments.length ?? 0;
    if (totalComments <= visibleCommentCount) return;

    let cancelled = false;
    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const schedule = idleApi.requestIdleCallback;

    const revealMore = () => {
      if (cancelled) return;
      setVisibleCommentCount((current) => Math.min(current + 12, totalComments));
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
  }, [details?.comments.length, visibleCommentCount]);

  const handleOpenInBrowser = useCallback(() => {
    if (!details?.url) {
      toast.error("Issue link is not available.");
      return;
    }
    void openUrl(details.url);
  }, [details?.url]);

  const handleCopyIssueLink = useCallback(() => {
    if (!details?.url) {
      toast.error("Issue link is not available.");
      return;
    }
    void copyToClipboard(details.url, "Issue link copied");
  }, [details?.url]);

  return (
    <GitHubViewerShell
      header={
        <GitHubViewerHeader
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-subtle-foreground">{`Issue #${issueNumber}`}</span>
              <span className="text-subtle-foreground/60">&rsaquo;</span>
              <span className="min-w-0 truncate">
                {details?.title ?? buffer?.name ?? "Loading issue"}
              </span>
            </span>
          }
          actions={
            <>
              <Button
                onClick={() => {
                  if (!repoPath || !details) return;
                  openGitHubFormBuffer({
                    repoPath,
                    formKind: "issue",
                    operation: "edit",
                    resourceNumber: issueNumber,
                  });
                }}
                disabled={!details}
                variant="ghost"
                size="xs"
              >
                Edit
              </Button>
              <DropdownMenu>
                <Tooltip content="Issue actions" side="bottom">
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Issue actions"
                      />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    disabled={isLoading && Boolean(details)}
                    onClick={() => void fetchIssue(true)}
                  >
                    {isLoading && details ? "Refreshing..." : "Refresh"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleOpenInBrowser}>Open on GitHub</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyIssueLink}>Copy link</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      }
    >
      {error ? (
        <GitHubViewerState
          description={error}
          actionLabel="Retry"
          onAction={() => void fetchIssue(true)}
          tone="error"
        />
      ) : details ? (
        <GitHubDetailLayout
          sidebar={
            <GitHubDetailSidebar>
              <GitHubDetailSection label="Status">
                <div className="flex items-center gap-2">
                  <CircleDot
                    className={
                      details.state.toLowerCase() === "open"
                        ? "text-success"
                        : "text-subtle-foreground"
                    }
                  />
                  <span className="capitalize">{details.state.toLowerCase()}</span>
                </div>
              </GitHubDetailSection>

              <GitHubDetailSection label="Assignees">
                {details.assignees.length > 0 ? (
                  <div className="space-y-2">
                    {details.assignees.map((assignee) => (
                      <div key={assignee.login} className="flex min-w-0 items-center gap-2">
                        <GitHubAvatar
                          login={assignee.login}
                          avatarUrl={assignee.avatarUrl}
                          size={32}
                          className="size-5"
                        />
                        <span className="min-w-0 truncate">{assignee.login}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-subtle-foreground">Unassigned</span>
                )}
              </GitHubDetailSection>

              <GitHubDetailSection label="Labels">
                {details.labels.length > 0 ? (
                  <LabelBadges labels={details.labels} />
                ) : (
                  <span className="text-subtle-foreground">No labels</span>
                )}
              </GitHubDetailSection>

              <GitHubDetailSection label="Activity">
                <div className="space-y-1 text-subtle-foreground">
                  <p>{`${details.comments.length} comments`}</p>
                  <p>{`Opened ${getTimeAgo(details.createdAt)}`}</p>
                </div>
              </GitHubDetailSection>
            </GitHubDetailSidebar>
          }
        >
          <div className="space-y-8">
            <section className="space-y-2">
              <h1 className="font-sans text-2xl leading-tight font-semibold tracking-tight text-foreground">
                {details.title}
              </h1>
              <div className="font-sans ui-text-sm flex items-center gap-2 text-subtle-foreground">
                <GitHubAvatar
                  login={details.author.login}
                  avatarUrl={details.author.avatarUrl}
                  size={32}
                  className="size-5"
                />
                <span className="text-foreground">{details.author.login}</span>
                <span>&middot;</span>
                <span>{getTimeAgo(details.createdAt)}</span>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="font-sans ui-text-sm font-normal text-subtle-foreground">
                Description
              </h2>
              {details.body ? (
                <GitHubMarkdown
                  content={details.body}
                  className="github-markdown-pr w-full"
                  contentClassName="github-markdown-pr-content w-full max-w-none"
                  repositoryUrl={repositoryUrl}
                  repoPath={repoPath}
                />
              ) : (
                <p className="font-sans ui-text-sm italic text-subtle-foreground">
                  No description provided
                </p>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="font-sans ui-text-sm font-normal text-subtle-foreground">Activity</h2>
              <div className="w-full space-y-3">
                {details.comments.length > 0 ? (
                  visibleComments.map((comment, index) => (
                    <CommentItem
                      key={`${comment.author.login}-${comment.createdAt}-${index}`}
                      comment={comment}
                      repositoryUrl={repositoryUrl}
                      repoPath={repoPath}
                    />
                  ))
                ) : (
                  <Empty
                    density="compact"
                    className="min-h-0 flex-none items-start rounded-lg border border-border/60 bg-surface/25 px-3 py-4 text-left"
                  >
                    <EmptyDescription className="flex items-center gap-2">
                      <MessageSquare className="size-4" />
                      No comments yet
                    </EmptyDescription>
                  </Empty>
                )}
                {details.comments.length > visibleComments.length ? (
                  <div className="px-1 py-2">
                    <Spinner
                      label={`Loading ${details.comments.length - visibleComments.length} more comments`}
                      showLabel
                      compact
                    />
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </GitHubDetailLayout>
      ) : (
        <GitHubViewerLoadingState label="Loading issue" />
      )}
    </GitHubViewerShell>
  );
});

GitHubIssueViewer.displayName = "GitHubIssueViewer";

export default GitHubIssueViewer;
