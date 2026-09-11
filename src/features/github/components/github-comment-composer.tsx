import { type RefObject } from "react";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { GitHubAvatar } from "./github-avatar";
import { GitHubMarkdownEditor } from "./github-markdown-editor";

interface GitHubCommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  disabled?: boolean;
  placeholder?: string;
  currentUser?: string | null;
  containerRef?: RefObject<HTMLDivElement | null>;
}

/** The "leave a comment" box at the end of a conversation. Cmd+Enter submits. */
export function GitHubCommentComposer({
  value,
  onChange,
  onSubmit,
  isSubmitting,
  disabled = false,
  placeholder = "Leave a comment...",
  currentUser,
  containerRef,
}: GitHubCommentComposerProps) {
  const canSubmit = !disabled && !isSubmitting && value.trim().length > 0;
  const submit = () => {
    if (canSubmit) onSubmit();
  };

  return (
    <div
      ref={containerRef}
      className="flex items-start gap-3 rounded-lg border border-border/70 bg-surface/35 p-3"
    >
      {currentUser ? (
        <GitHubAvatar login={currentUser} displaySize="md" className="mt-1 shrink-0" />
      ) : null}
      <div className="min-w-0 flex-1 space-y-3">
        <GitHubMarkdownEditor
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          minHeight={120}
          disabled={disabled || isSubmitting}
          onSubmit={submit}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="accent"
            disabled={!canSubmit}
            onClick={submit}
            shortcut="mod+enter"
          >
            {isSubmitting ? <Spinner label="Commenting" compact /> : null}
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
