import { memo } from "react";
import { getTimeAgo } from "../utils/pr-viewer-utils";
import GitHubMarkdown from "./github-markdown";

interface CommentItemProps {
  comment: {
    author: { login: string };
    body: string;
    createdAt: string;
  };
  issueBaseUrl?: string;
  repoPath?: string;
}

export const CommentItem = memo(({ comment, issueBaseUrl, repoPath }: CommentItemProps) => {
  const authorLogin = comment.author.login;

  return (
    <div className="flex gap-2.5 px-1 py-1.5">
      <img
        src={`https://github.com/${authorLogin}.png?size=40`}
        alt={authorLogin}
        className="size-6 shrink-0 rounded-full bg-secondary-bg"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="ui-text-sm flex items-center gap-2">
          <span className="text-text">{authorLogin}</span>
          <span className="text-text-lighter">{getTimeAgo(comment.createdAt)}</span>
        </div>
        <div className="mt-1">
          <GitHubMarkdown
            content={comment.body}
            className="github-markdown-pr"
            contentClassName="ui-text-sm leading-6 text-text-light"
            issueBaseUrl={issueBaseUrl}
            repoPath={repoPath}
          />
        </div>
      </div>
    </div>
  );
});

CommentItem.displayName = "CommentItem";
