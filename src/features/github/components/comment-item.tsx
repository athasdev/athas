import { openUrl } from "@tauri-apps/plugin-opener";
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
import { DotsIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { writeClipboardText } from "@/utils/clipboard";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { GitHubMetaChip, GitHubUserChip } from "./github-chips";
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
      <Card variant="default" className="bg-surface/35">
        <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2.5">
          <div className="ui-text-sm flex min-w-0 flex-1 items-center gap-2">
            <GitHubUserChip
              login={comment.author.login}
              avatarUrl={comment.author.avatarUrl}
              className="min-w-0 font-medium text-foreground"
              avatarSize="md"
            />
            <GitHubMetaChip
              title={new Date(comment.createdAt).toLocaleString()}
              href={comment.url ?? null}
            >
              {getTimeAgo(comment.createdAt)}
            </GitHubMetaChip>
            {wasEdited ? <span className="shrink-0 text-subtle-foreground">edited</span> : null}
          </div>
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    aria-label="Comment actions"
                    disabled={isBusy}
                  />
                }
              >
                {isBusy ? <Spinner label="Updating comment" compact /> : <DotsIcon />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit ? <DropdownMenuItem onClick={startEditing}>Edit</DropdownMenuItem> : null}
                {comment.url ? (
                  <>
                    <DropdownMenuItem onClick={() => void openUrl(comment.url ?? "")}>
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
