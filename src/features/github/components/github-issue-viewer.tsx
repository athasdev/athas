import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CopyIcon as Copy,
  GithubLogoIcon as GithubLogo,
  ChatCircleTextIcon as MessageSquare,
  PencilSimpleIcon as Pencil,
  ArrowClockwiseIcon as RefreshCw,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import { toast } from "@/ui/toast";
import type { IssueDetails } from "../types/github.types";
import {
  GITHUB_ISSUE_DETAILS_TTL_MS,
  githubIssueDetailsCache,
  githubIssueListCache,
} from "../utils/github-data-cache";
import { copyToClipboard } from "../utils/github-viewer-utils";
import { CommentItem } from "./comment-item";
import { GitHubAvatar } from "./github-avatar";
import GitHubMarkdown from "./github-markdown";
import { GitHubTitleBodyForm } from "./github-title-body-form";
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
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const buffer = useBufferStore((state) => state.buffers.find((item) => item.id === bufferId));
  const [details, setDetails] = useState<IssueDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [visibleCommentCount, setVisibleCommentCount] = useState(8);
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
    setIsEditingDetails(false);
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

  const handleSaveDetails = useCallback(
    async ({ title, body }: { title: string; body: string }) => {
      if (!repoPath || !details || !buffer || buffer.type !== "githubIssue") return;

      setIsSavingDetails(true);
      try {
        const nextDetails = await invoke<IssueDetails>("github_update_issue", {
          repoPath,
          issueNumber,
          title,
          body,
        });
        const cacheKey = `${repoPath}::${issueNumber}`;
        githubIssueDetailsCache.set(cacheKey, nextDetails);
        githubIssueListCache.clear();
        setDetails(nextDetails);
        updateBuffer({
          ...buffer,
          name: nextDetails.title,
          url: nextDetails.url,
        });
        setIsEditingDetails(false);
        toast.success(`Updated issue #${issueNumber}`);
      } catch (nextError) {
        toast.error(nextError instanceof Error ? nextError.message : "Failed to update issue");
      } finally {
        setIsSavingDetails(false);
      }
    },
    [buffer, details, issueNumber, repoPath, updateBuffer],
  );

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
                    <GitHubAvatar
                      login={details.author.login}
                      avatarUrl={details.author.avatarUrl}
                      size={32}
                      className="size-4"
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
              <Button
                onClick={() => void fetchIssue(true)}
                variant="ghost"
                tooltip="Refresh issue"
                tooltipSide="bottom"
                size="icon-xs"
              >
                {isLoading && details ? (
                  <LoadingIndicator label="Loading issue" compact />
                ) : (
                  <RefreshCw />
                )}
              </Button>
              <Button
                onClick={handleOpenInBrowser}
                variant="ghost"
                tooltip="Open issue on GitHub"
                tooltipSide="bottom"
                size="icon-xs"
              >
                <GithubLogo />
              </Button>
              <Button
                onClick={() => setIsEditingDetails(true)}
                variant="ghost"
                tooltip="Edit issue"
                tooltipSide="bottom"
                size="icon-xs"
              >
                <Pencil />
              </Button>
              <Button
                onClick={handleCopyIssueLink}
                variant="ghost"
                tooltip="Copy issue link"
                tooltipSide="bottom"
                size="icon-xs"
              >
                <Copy />
              </Button>
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
            <p className="font-sans ui-text-sm text-error">{error}</p>
            <Button
              onClick={() => void fetchIssue(true)}
              variant="default"
              size="xs"
              className="mt-2 border border-error/40 text-error/90 hover:bg-error/10"
            >
              Retry
            </Button>
          </div>
        </div>
      ) : details ? (
        <div className="w-full space-y-5">
          {isEditingDetails ? (
            <GitHubTitleBodyForm
              title={details.title}
              body={details.body}
              titlePlaceholder="Issue title"
              submitLabel="Save"
              isSubmitting={isSavingDetails}
              onCancel={() => setIsEditingDetails(false)}
              onSubmit={(value) => void handleSaveDetails(value)}
            />
          ) : details.body ? (
            <GitHubMarkdown
              content={details.body}
              className="github-markdown-pr w-full"
              contentClassName="github-markdown-pr-content w-full max-w-none"
              issueBaseUrl={issueBaseUrl}
              repoPath={repoPath}
            />
          ) : (
            <p className="font-sans ui-text-sm italic text-text-lighter">No description provided</p>
          )}

          <div className="w-full space-y-1">
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
                <p className="font-sans ui-text-sm">No comments</p>
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
