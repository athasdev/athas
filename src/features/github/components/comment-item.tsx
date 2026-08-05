import { DotsThreeIcon as MoreHorizontal } from "@/ui/icons";
import { memo, useState } from "react";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { showConfirmDialog } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { GitHubAvatar } from "./github-avatar";
import GitHubMarkdown from "./github-markdown";
import { GitHubMarkdownEditor } from "./github-markdown-editor";

interface CommentItemProps {
  comment: {
    author: { login: string };
    body: string;
    createdAt: string;
    updatedAt?: string;
  };
  repositoryUrl?: string;
  repoPath?: string;
  canManage?: boolean;
  isBusy?: boolean;
  onEdit?: (body: string) => Promise<boolean>;
  onDelete?: () => Promise<void>;
}

export const CommentItem = memo(
  ({
    comment,
    repositoryUrl,
    repoPath,
    canManage = false,
    isBusy = false,
    onEdit,
    onDelete,
  }: CommentItemProps) => {
    const authorLogin = comment.author.login;
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(comment.body);
    const wasEdited = Boolean(comment.updatedAt && comment.updatedAt !== comment.createdAt);

    const handleDelete = async () => {
      if (!onDelete) return;
      const confirmed = await showConfirmDialog("Delete this comment permanently?", {
        title: "Delete comment",
        confirmLabel: "Delete",
      });
      if (confirmed) await onDelete();
    };

    return (
      <Card variant="default" size="flush" className="bg-surface/35">
        <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2.5">
          <GitHubAvatar login={authorLogin} size={40} className="size-6" />
          <div className="ui-text-sm flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate font-medium text-foreground">{authorLogin}</span>
            <span className="shrink-0 text-subtle-foreground">{getTimeAgo(comment.createdAt)}</span>
            {wasEdited ? <span className="shrink-0 text-subtle-foreground">edited</span> : null}
          </div>
          {canManage && onEdit && onDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Comment actions"
                    disabled={isBusy}
                  />
                }
              >
                {isBusy ? <Spinner label="Updating comment" compact /> : <MoreHorizontal />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setDraft(comment.body);
                    setIsEditing(true);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleDelete()}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <div className="space-y-3 px-3 py-3">
          {isEditing && onEdit ? (
            <>
              <GitHubMarkdownEditor
                value={draft}
                onChange={setDraft}
                placeholder="Edit comment..."
                minHeight={140}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isBusy}
                  onClick={() => setIsEditing(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  size="xs"
                  disabled={isBusy || !draft.trim()}
                  onClick={() => {
                    void onEdit(draft).then((saved) => {
                      if (saved) setIsEditing(false);
                    });
                  }}
                >
                  {isBusy ? <Spinner label="Saving" compact /> : null}
                  Save
                </Button>
              </div>
            </>
          ) : (
            <GitHubMarkdown
              content={comment.body}
              className="github-markdown-pr"
              contentClassName="ui-text-sm leading-6 text-muted-foreground"
              repositoryUrl={repositoryUrl}
              repoPath={repoPath}
            />
          )}
        </div>
      </Card>
    );
  },
);

CommentItem.displayName = "CommentItem";
