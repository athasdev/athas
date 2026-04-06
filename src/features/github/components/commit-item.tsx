import { Copy, ExternalLink } from "lucide-react";
import { memo } from "react";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";
import type { Commit } from "../types/pr-viewer";
import { copyToClipboard, getTimeAgo } from "../utils/pr-viewer-utils";
import GitHubMarkdown from "./github-markdown";

interface CommitItemProps {
  commit: Commit;
  issueBaseUrl?: string;
  repoPath?: string;
}

export const CommitItem = memo(({ commit, issueBaseUrl, repoPath }: CommitItemProps) => {
  const author = commit.authors[0];
  const shortSha = commit.oid.slice(0, 7);
  const authorName = author?.login || author?.name || "Unknown";
  const avatarLogin = (author?.login || "").trim();

  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5">
      <img
        src={`https://github.com/${encodeURIComponent(avatarLogin || "github")}.png?size=32`}
        alt={authorName}
        className="size-6 shrink-0 rounded-full bg-secondary-bg"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <code className="ui-text-sm rounded bg-primary-bg px-1.5 py-0.5 font-mono text-text-lighter">
            {shortSha}
          </code>
          <p className="ui-text-sm font-medium text-text">{commit.messageHeadline}</p>
        </div>
        {commit.messageBody && (
          <div className="mt-0.5">
            <GitHubMarkdown
              content={commit.messageBody}
              className="github-markdown-pr"
              contentClassName="ui-text-sm leading-6 text-text-lighter"
              issueBaseUrl={issueBaseUrl}
              repoPath={repoPath}
            />
          </div>
        )}
        <div className="ui-text-sm mt-1 flex flex-wrap items-center gap-2 text-text-lighter">
          <span className="font-mono text-text-lighter">{authorName}</span>
          <span>committed {getTimeAgo(commit.authoredDate)}</span>
          <Tooltip content="Copy full commit SHA" side="top">
            <Button
              onClick={() => void copyToClipboard(commit.oid, "Commit SHA copied")}
              variant="ghost"
              size="icon-xs"
              className="rounded text-text-lighter"
              aria-label="Copy commit SHA"
            >
              <Copy />
            </Button>
          </Tooltip>
          {commit.url && (
            <Tooltip content="Open commit on GitHub" side="top">
              <Button
                onClick={() => window.open(commit.url, "_blank", "noopener,noreferrer")}
                variant="ghost"
                size="icon-xs"
                className="rounded text-text-lighter"
                aria-label="Open commit in browser"
              >
                <ExternalLink />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
});

CommitItem.displayName = "CommitItem";
