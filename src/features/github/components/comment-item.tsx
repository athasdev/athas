import { openExternalUrl } from "@/utils/external-url";
import { memo, useState, type ReactNode } from "react";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { DotsIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { writeClipboardText } from "@/utils/clipboard";
import { getTimeAgo } from "../services/github-viewer-utils";
import { getGitHubUserUrl } from "../utils/github-link-utils";
import { GitHubAvatar } from "./github-avatar";
import { GitHubMetaChip, GitHubUserChip } from "./github-chips";
import { GitHubTimelineMarker } from "./github-timeline";
import GitHubMarkdown from "./github-markdown";
import { GitHubMarkdownEditor } from "./github-markdown-editor";

interface CommentItemProps {
  comment: {
    author: { login: string; avatarUrl?: string | null };
    body: string;
    createdAt: string;
    updatedAt?: string;
    url?: string;
  };
  /** What the author did, shown after their name, such as "commented". */
  action?: string;
  /** Replaces the author's avatar on the timeline, such as a review's verdict icon. */
  marker?: ReactNode;
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
    action = "commented",
    marker,
    repositoryUrl,
    repoPath,
    canManage = false,
    isBusy = false,
    onEdit,
    onDelete,
  }: CommentItemProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(comment.body);
    const wasEdited = Boolean(comment.updatedAt && comment.updatedAt !== comment.createdAt);
    const canEdit = canManage && Boolean(onEdit);
    const canDelete = canManage && Boolean(onDelete);
    const hasMenu = canEdit || canDelete || Boolean(comment.url);

    const startEditing = () => {
      setDraft(comment.body);
      setIsEditing(true);
    };

    const save = () => {
      if (!onEdit || isBusy || !draft.trim()) return;
      void onEdit(draft).then((saved) => {
        if (saved) setIsEditing(false);
      });
    };

    const handleDelete = async () => {
      if (!onDelete) return;
      const confirmed = await showConfirmDialog("Delete this comment permanently?", {
        title: "Delete comment",
        confirmLabel: "Delete",
      });
      if (confirmed) await onDelete();
    };

    return (
      <article className="group/comment min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          {marker ?? (
            <GitHubTimelineMarker>
              <GitHubAvatar
                login={comment.author.login}
                avatarUrl={comment.author.avatarUrl}
                size={48}
                displaySize="md"
              />
            </GitHubTimelineMarker>
          )}
          <div className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 font-sans ui-text-sm text-subtle-foreground">
            {marker ? (
              <GitHubUserChip
                login={comment.author.login}
                avatarUrl={comment.author.avatarUrl}
                className="font-medium text-foreground"
              />
            ) : (
              <GitHubMetaChip
                title={`Open ${comment.author.login} on GitHub`}
                href={getGitHubUserUrl(comment.author.login)}
                className="font-medium text-foreground"
              >
                {comment.author.login}
              </GitHubMetaChip>
            )}
            <span>{action}</span>
            <GitHubMetaChip
              title={new Date(comment.createdAt).toLocaleString()}
              href={comment.url ?? null}
            >
              {getTimeAgo(comment.createdAt)}
            </GitHubMetaChip>
            {wasEdited ? <span className="shrink-0">· edited</span> : null}
          </div>
          {hasMenu ? (
            <span className="flex shrink-0 opacity-0 transition-opacity duration-fast group-hover/comment:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label="Comment actions"
                      disabled={isBusy}
                    />
                  }
                >
                  {isBusy ? <Spinner label="Updating comment" compact /> : <DotsIcon />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit ? (
                    <DropdownMenuItem onClick={startEditing}>Edit</DropdownMenuItem>
                  ) : null}
                  {comment.url ? (
                    <>
                      <DropdownMenuItem onClick={() => void openExternalUrl(comment.url ?? "")}>
                        Open on GitHub
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void writeClipboardText(comment.url ?? "")}>
                        Copy link
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {canDelete ? (
                    <DropdownMenuItem onClick={() => void handleDelete()}>Delete</DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          ) : null}
        </div>
        <div className="mt-1 space-y-3 pl-9">
          {isEditing && onEdit ? (
            <>
              <GitHubMarkdownEditor
                value={draft}
                onChange={setDraft}
                placeholder="Edit comment..."
                minHeight={140}
                autoFocus
                disabled={isBusy}
                onSubmit={save}
                onCancel={() => setIsEditing(false)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => setIsEditing(false)}
                  shortcut="escape"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  disabled={isBusy || !draft.trim()}
                  onClick={save}
                  shortcut="mod+enter"
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
              contentClassName="ui-text-sm leading-6 text-foreground"
              repositoryUrl={repositoryUrl}
              repoPath={repoPath}
            />
          )}
        </div>
      </article>
    );
  },
);

CommentItem.displayName = "CommentItem";
