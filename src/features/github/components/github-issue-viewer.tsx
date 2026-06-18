import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CopyIcon as Copy,
  GithubLogoIcon as GithubLogo,
  ChatCircleTextIcon as MessageSquare,
  ArrowClockwiseIcon as RefreshCw,
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import { toast } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import type { IssueDetails } from "../types/github.types";
import { GITHUB_ISSUE_DETAILS_TTL_MS, githubIssueDetailsCache } from "../utils/github-data-cache";
import { copyToClipboard } from "../utils/github-viewer-utils";
import { CommentItem } from "./comment-item";
import GitHubMarkdown from "./github-markdown";
import { AssigneesList, LabelBadges } from "./pr-status";
import {
  GitHubViewerHeader,
  GitHubViewerLoadingState,
  GitHubViewerShell,
} from "./github-viewer-shell";

interface GitHubIssueViewerProps {
  issueNumber: number;
  repoPath?: string;
  bufferId: string;
}

const GitHubIssueViewer = memo(({ issueNumber, repoPath, bufferId }: GitHubIssueViewerProps) => {
  const buffers = useBufferStore.use.buffers();
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const [details, setDetails] = useState<IssueDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCommentCount, setVisibleCommentCount] = useState(8);
  const buffer = buffers.find((item) => item.id === bufferId);
  const issueBaseUrl = useMemo(
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
          title={details?.title ?? buffer?.name ?? `Issue #${issueNumber}`}
          meta={
            <>
              <span>{`Issue #${issueNumber}`}</span>
              {details?.author.login ? (
                <>
                  <span>&middot;</span>
                  <span className="inline-flex items-center gap-2">
                    <img
                      src={
                        details.author.avatarUrl ||
                        `https://github.com/${encodeURIComponent(details.author.login)}.png?size=32`
                      }
                      alt={details.author.login}
                      className="size-4 rounded-full bg-secondary-bg"
                      loading="lazy"
                    />
                    <span>{details.author.login}</span>
                  </span>
                </>
              ) : null}
              {details?.state ? (
                <>
                  <span>&middot;</span>
                  <span className="capitalize">{details.state.toLowerCase()}</span>
                </>
              ) : null}
              {details?.comments.length ? (
                <>
                  <span>&middot;</span>
                  <span>{`${details.comments.length} comments`}</span>
                </>
              ) : null}
            </>
          }
          actions={
            <>
              <Tooltip content="Refresh issue" side="bottom">
                <Button
                  onClick={() => void fetchIssue(true)}
                  variant="ghost"
                  compact
                  aria-label="Refresh issue"
                >
                  {isLoading && details ? (
                    <LoadingIndicator label="Loading issue" compact />
                  ) : (
                    <RefreshCw />
                  )}
                </Button>
              </Tooltip>
              <Tooltip content="Open on GitHub" side="bottom">
                <Button
                  onClick={handleOpenInBrowser}
                  variant="ghost"
                  aria-label="Open issue on GitHub"
                  compact
                >
                  <GithubLogo />
                </Button>
              </Tooltip>
              <Tooltip content="Copy issue link" side="bottom">
                <Button
                  onClick={handleCopyIssueLink}
                  variant="ghost"
                  aria-label="Copy issue link"
                  compact
                >
                  <Copy />
                </Button>
              </Tooltip>
            </>
          }
        >
          {details ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <AssigneesList assignees={details.assignees ?? []} />
              <LabelBadges labels={details.labels ?? []} />
            </div>
          ) : null}
        </GitHubViewerHeader>
      }
    >
      {error ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <p className="ui-font ui-text-sm text-error">{error}</p>
            <Button
              onClick={() => void fetchIssue(true)}
              variant="default"
              compact
              className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
            >
              Retry
            </Button>
          </div>
        </div>
      ) : details ? (
        <div className="space-y-5">
          {details.body ? (
            <GitHubMarkdown
              content={details.body}
              className="github-markdown-pr"
              contentClassName="github-markdown-pr-content"
              issueBaseUrl={issueBaseUrl}
              repoPath={repoPath}
            />
          ) : (
            <p className="ui-font ui-text-sm italic text-text-lighter">No description provided</p>
          )}

          <div className="space-y-1">
            {details.comments.length > 0 ? (
              visibleComments.map((comment, index) => (
                <CommentItem
                  key={`${comment.author.login}-${comment.createdAt}-${index}`}
                  comment={comment}
                  issueBaseUrl={issueBaseUrl}
                  repoPath={repoPath}
                />
              ))
            ) : (
              <div className="flex items-center gap-2 px-1 py-2 text-text-lighter">
                <MessageSquare className="size-4" />
                <p className="ui-font ui-text-sm">No comments</p>
              </div>
            )}
            {details.comments.length > visibleComments.length ? (
              <div className="px-1 py-2">
                <LoadingIndicator
                  label={`Loading ${details.comments.length - visibleComments.length} more comments`}
                  showLabel
                  compact
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <GitHubViewerLoadingState label="Loading issue" />
      )}
    </GitHubViewerShell>
  );
});

GitHubIssueViewer.displayName = "GitHubIssueViewer";

export default GitHubIssueViewer;
