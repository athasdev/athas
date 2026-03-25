import { Copy, ExternalLink } from "lucide-react";
import { memo } from "react";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";
import type { Commit } from "../types/pr-viewer";
import { copyToClipboard, getTimeAgo } from "../utils/pr-viewer-utils";
import GitHubMarkdown from "./github-markdown";

interface CommitItemProps {
  commit: Commit;
}

export const CommitItem = memo(({ commit }: CommitItemProps) => {
  const author = commit.authors[0];
  const shortSha = commit.oid.slice(0, 7);
  const authorName = author?.login || author?.name || "Unknown";
  const avatarLogin = (author?.login || "").trim();

  return (
    <div className="flex items-start gap-3 rounded-lg bg-secondary-bg/35 px-4 py-3 hover:bg-hover/50">
      <img
        src={`https://github.com/${encodeURIComponent(avatarLogin || "github")}.png?size=32`}
        alt={authorName}
        className="size-6 shrink-0 rounded-full bg-secondary-bg"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text">{commit.messageHeadline}</p>
        {commit.messageBody && (
          <div className="mt-1">
            <GitHubMarkdown content={commit.messageBody} className="text-text-lighter text-xs" />
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-text-lighter text-xs">
          <span className="font-medium">{authorName}</span>
          <span>committed {getTimeAgo(commit.authoredDate)}</span>
          <code className="rounded bg-primary-bg px-1.5 py-0.5 font-mono">{shortSha}</code>
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
