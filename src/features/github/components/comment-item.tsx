import { memo } from "react";
import { Card } from "@/ui/card";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { GitHubAvatar } from "./github-avatar";
import GitHubMarkdown from "./github-markdown";

interface CommentItemProps {
  comment: {
    author: { login: string };
    body: string;
    createdAt: string;
  };
  repositoryUrl?: string;
  repoPath?: string;
}

export const CommentItem = memo(({ comment, repositoryUrl, repoPath }: CommentItemProps) => {
  const authorLogin = comment.author.login;

  return (
    <Card variant="default" size="flush" className="bg-surface/35">
      <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2.5">
        <GitHubAvatar login={authorLogin} size={40} className="size-6" />
        <div className="ui-text-sm flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">{authorLogin}</span>
          <span className="shrink-0 text-subtle-foreground">{getTimeAgo(comment.createdAt)}</span>
        </div>
      </div>
      <div className="px-3 py-3">
        <GitHubMarkdown
          content={comment.body}
          className="github-markdown-pr"
          contentClassName="ui-text-sm leading-6 text-muted-foreground"
          repositoryUrl={repositoryUrl}
          repoPath={repoPath}
        />
      </div>
    </Card>
  );
});

CommentItem.displayName = "CommentItem";
