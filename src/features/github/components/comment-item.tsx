import { memo } from "react";
import { getTimeAgo } from "../utils/pr-viewer-utils";
import GitHubMarkdown from "./github-markdown";

interface CommentItemProps {
  comment: {
    author: { login: string };
    body: string;
    createdAt: string;
  };
}

export const CommentItem = memo(({ comment }: CommentItemProps) => {
  const authorLogin = comment.author.login;

  return (
    <div className="flex gap-3 rounded-lg bg-secondary-bg/35 px-4 py-4">
      <img
        src={`https://github.com/${authorLogin}.png?size=40`}
        alt={authorLogin}
        className="h-8 w-8 shrink-0 rounded-full bg-secondary-bg"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-text">{authorLogin}</span>
          <span className="text-text-lighter text-xs">{getTimeAgo(comment.createdAt)}</span>
        </div>
        <div className="mt-2">
          <GitHubMarkdown content={comment.body} />
        </div>
      </div>
    </div>
  );
});

CommentItem.displayName = "CommentItem";
