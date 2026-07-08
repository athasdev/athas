import { openUrl } from "@tauri-apps/plugin-opener";
import { CopyIcon as Copy, GithubLogoIcon as GithubLogo } from "@phosphor-icons/react";
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
        "flex w-full min-w-0 items-center gap-2 rounded-[var(--app-radius-menu-item)] px-2 py-1.5 transition-colors",
        canOpenCommit &&
          "cursor-pointer hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
      )}
      aria-label={canOpenCommit ? `Open commit ${shortSha}` : undefined}
    >
      <GitHubAvatar login={avatarLogin} name={authorName} size={32} className="size-5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <code className="ui-text-sm shrink-0 rounded-[var(--app-radius-control-sm)] bg-primary-bg px-1.5 py-0.5 editor-font text-text-lighter">
            {shortSha}
          </code>
          <p className="ui-text-sm min-w-0 truncate font-medium text-text">
            {commit.messageHeadline}
          </p>
        </div>
        {bodyPreview ? (
          <p className="ui-text-sm mt-0.5 line-clamp-1 text-text-lighter">{bodyPreview}</p>
        ) : null}
      </div>
      <div className="ui-text-sm ml-2 flex shrink-0 items-center gap-2 text-text-lighter">
        <span className="hidden max-w-36 truncate editor-font text-text-lighter sm:inline">
          {authorName}
        </span>
        <span>committed {getTimeAgo(commit.authoredDate)}</span>
        <Tooltip content="Copy full commit SHA" side="top">
          <Button
            onClick={(event) => {
              stopActionClick(event);
              void copyToClipboard(commit.oid, "Commit SHA copied");
            }}
            variant="ghost"
            compact
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
              compact
              className="text-text-lighter"
              aria-label="Open commit in browser"
            >
              <GithubLogo />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
});

CommitItem.displayName = "CommitItem";
