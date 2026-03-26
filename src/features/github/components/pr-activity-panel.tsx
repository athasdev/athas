import { RefreshCw } from "lucide-react";
import { Button } from "@/ui/button";
import type { Commit } from "../types/pr-viewer";
import { CommentItem } from "./comment-item";
import { CommitItem } from "./commit-item";
import GitHubMarkdown from "./github-markdown";

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
  issueBaseUrl: string;
  repoPath?: string;
  activityItems: Array<ActivityItemComment | ActivityItemCommit>;
  isLoadingContent: boolean;
  contentError: string | null;
  onRetry: () => void;
}

export function PRActivityPanel({
  body,
  issueBaseUrl,
  repoPath,
  activityItems,
  isLoadingContent,
  contentError,
  onRetry,
}: PRActivityPanelProps) {
  return (
    <div className="min-w-0 space-y-5">
      {body ? (
        <GitHubMarkdown
          content={body}
          className="github-markdown-pr"
          contentClassName="github-markdown-pr-content"
          issueBaseUrl={issueBaseUrl}
          repoPath={repoPath}
        />
      ) : (
        <p className="ui-font ui-text-sm italic text-text-lighter">No description provided</p>
      )}

      <div className="space-y-2">
        {isLoadingContent && activityItems.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <RefreshCw className="animate-spin text-text-lighter" />
            <span className="ml-2 ui-font ui-text-sm text-text-lighter">Loading activity...</span>
          </div>
        ) : contentError ? (
          <div className="flex items-center justify-center p-8 text-center">
            <div>
              <p className="ui-font ui-text-sm text-error">{contentError}</p>
              <Button
                onClick={onRetry}
                variant="outline"
                size="xs"
                className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
              >
                Retry
              </Button>
            </div>
          </div>
        ) : activityItems.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <p className="ui-font ui-text-sm text-text-lighter">No activity</p>
          </div>
        ) : (
          <div className="space-y-1">
            {activityItems.map((item) =>
              item.type === "comment" ? (
                <CommentItem
                  key={item.id}
                  comment={item.comment}
                  issueBaseUrl={issueBaseUrl}
                  repoPath={repoPath}
                />
              ) : (
                <CommitItem
                  key={item.id}
                  commit={item.commit}
                  issueBaseUrl={issueBaseUrl}
                  repoPath={repoPath}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
