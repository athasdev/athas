import { invoke } from "@tauri-apps/api/core";
import { Copy, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import type { IssueDetails } from "../types/github";
import { copyToClipboard } from "../utils/pr-viewer-utils";
import { CommentItem } from "./comment-item";
import GitHubMarkdown from "./github-markdown";

interface GitHubIssueViewerProps {
  issueNumber: number;
  repoPath?: string;
  bufferId: string;
}

const ISSUE_CACHE_TTL_MS = 120_000;
const issueCache = new Map<string, { fetchedAt: number; details: IssueDetails }>();

const GitHubIssueViewer = memo(({ issueNumber, repoPath, bufferId }: GitHubIssueViewerProps) => {
  const buffers = useBufferStore.use.buffers();
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const [details, setDetails] = useState<IssueDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const buffer = buffers.find((item) => item.id === bufferId);
  const issueBaseUrl = useMemo(
    () => details?.url.replace(/\/issues\/\d+$/, "") ?? undefined,
    [details?.url],
  );

  const fetchIssue = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cacheKey = `${repoPath}::${issueNumber}`;
      const cached = issueCache.get(cacheKey);
      if (cached && !force && Date.now() - cached.fetchedAt < ISSUE_CACHE_TTL_MS) {
        setDetails(cached.details);
        setError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextDetails = await invoke<IssueDetails>("github_get_issue_details", {
          repoPath,
          issueNumber,
        });
        issueCache.set(cacheKey, { fetchedAt: Date.now(), details: nextDetails });
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

  const handleOpenInBrowser = useCallback(() => {
    if (!details?.url) {
      toast.error("Issue link is not available.");
      return;
    }
    window.open(details.url, "_blank", "noopener,noreferrer");
  }, [details?.url]);

  const handleCopyIssueLink = useCallback(() => {
    if (!details?.url) {
      toast.error("Issue link is not available.");
      return;
    }
    void copyToClipboard(details.url, "Issue link copied");
  }, [details?.url]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-primary-bg">
      {isLoading && (
        <div className="h-px w-full overflow-hidden bg-border">
          <div className="h-full w-1/3 animate-pulse bg-accent/70" />
        </div>
      )}

      <div className="shrink-0 px-3 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="ui-font ui-text-lg leading-tight font-medium text-text">
              {details?.title ?? buffer?.name ?? `Issue #${issueNumber}`}
            </h1>
            <div className="ui-font ui-text-sm mt-1 flex flex-wrap items-center gap-x-2 text-text-lighter">
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
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip content="Refresh issue" side="bottom">
              <Button onClick={() => void fetchIssue(true)} variant="ghost" size="icon-sm" aria-label="Refresh issue">
                <RefreshCw className={isLoading ? "animate-spin" : ""} />
              </Button>
            </Tooltip>
            <Tooltip content="Open on GitHub" side="bottom">
              <Button onClick={handleOpenInBrowser} variant="ghost" size="icon-sm" aria-label="Open issue on GitHub">
                <ExternalLink />
              </Button>
            </Tooltip>
            <Tooltip content="Copy issue link" side="bottom">
              <Button onClick={handleCopyIssueLink} variant="ghost" size="icon-sm" aria-label="Copy issue link">
                <Copy />
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="min-w-0 px-3 pb-4 sm:px-5">
        {error ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <p className="ui-font ui-text-sm text-error">{error}</p>
              <Button
                onClick={() => void fetchIssue(true)}
                variant="outline"
                size="xs"
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
                details.comments.map((comment, index) => (
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
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});

GitHubIssueViewer.displayName = "GitHubIssueViewer";

export default GitHubIssueViewer;
