import { openUrl } from "@tauri-apps/plugin-opener";
import { CopyIcon as Copy, GithubLogoIcon as GithubLogo } from "@/ui/icons";
import type { KeyboardEvent, MouseEvent } from "react";
import { memo } from "react";
import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import type { Commit } from "../types/github-pr-viewer.types";
import { copyToClipboard, getTimeAgo } from "../utils/github-viewer-utils";
import { GitHubAvatar } from "./github-avatar";

interface CommitItemProps {
  commit: Commit;
  issueBaseUrl?: string;
  repoPath?: string;
}

export const CommitItem = memo(({ commit, repoPath }: CommitItemProps) => {
  const author = commit.authors[0];
  const shortSha = commit.oid.slice(0, 7);
  const authorName = author?.login || author?.name || "Unknown";
  const avatarLogin = (author?.login || "").trim();
  const canOpenCommit = Boolean(repoPath && commit.oid);
  const bodyPreview = commit.messageBody.replace(/\s+/g, " ").trim();

  const openCommitInBrowser = () => {
    if (commit.url) {
      void openUrl(commit.url);
    }
  };

  const openCommit = async () => {
    if (!repoPath || !commit.oid) {
      toast.error("Commit diff is not available.");
      return;
    }

    const bufferId = await openCommitDiffBuffer({
      repoPath,
      commitHash: commit.oid,
      message: commit.messageHeadline,
      description: commit.messageBody,
      author: authorName,
      date: commit.authoredDate,
    });

    if (bufferId) {
      return;
    }

    toast.error("Commit diff is not available.");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canOpenCommit || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    void openCommit();
  };

  const stopActionClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      role={canOpenCommit ? "button" : undefined}
      tabIndex={canOpenCommit ? 0 : undefined}
      onClick={canOpenCommit ? () => void openCommit() : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
        canOpenCommit &&
          "cursor-pointer hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
      )}
      aria-label={canOpenCommit ? `Open commit ${shortSha}` : undefined}
    >
      <GitHubAvatar login={avatarLogin} name={authorName} size={32} className="size-6" />
      <div className="min-w-0 flex-1">
        <p className="ui-text-sm min-w-0 truncate font-medium text-text">
          {commit.messageHeadline}
        </p>
        {bodyPreview ? (
          <p className="ui-text-sm mt-0.5 line-clamp-1 text-text-lighter">{bodyPreview}</p>
        ) : null}
      </div>
      <div className="ui-text-sm ml-2 flex shrink-0 items-center gap-1.5 text-text-lighter">
        <span className="hidden max-w-36 truncate font-mono text-text-lighter sm:inline">
          {authorName}
        </span>
        <span className="hidden sm:inline">&middot;</span>
        <span>{getTimeAgo(commit.authoredDate)}</span>
        <span>&middot;</span>
        <code className="font-mono text-text-lighter">{shortSha}</code>
        <span className="ml-0.5 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Tooltip content="Copy full commit SHA" side="top">
            <Button
              onClick={(event) => {
                stopActionClick(event);
                void copyToClipboard(commit.oid, "Commit SHA copied");
              }}
              variant="ghost"
              size="icon-xs"
              className="text-text-lighter"
              aria-label="Copy commit SHA"
            >
              <Copy />
            </Button>
          </Tooltip>
          {commit.url && (
            <Tooltip content="Open commit on GitHub" side="top">
              <Button
                onClick={(event) => {
                  stopActionClick(event);
                  openCommitInBrowser();
                }}
                variant="ghost"
                size="icon-xs"
                className="text-text-lighter"
                aria-label="Open commit in browser"
              >
                <GithubLogo />
              </Button>
            </Tooltip>
          )}
        </span>
      </div>
    </div>
  );
});

CommitItem.displayName = "CommitItem";
