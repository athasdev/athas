import { useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { GitHubMarkdownEditor } from "./github-markdown-editor";

export type GitHubPRInlineActionKind = "comment" | "approve" | "request-changes" | "merge";
export type GitHubPRMergeMethod = "merge" | "squash" | "rebase";

const actionCopy = {
  comment: {
    title: "Add comment",
    placeholder: "Write a comment...",
    submitLabel: "Comment",
    requiresBody: true,
  },
  approve: {
    title: "Approve pull request",
    placeholder: "Optional review note...",
    submitLabel: "Approve",
    requiresBody: false,
  },
  "request-changes": {
    title: "Request changes",
    placeholder: "Describe the requested changes...",
    submitLabel: "Request changes",
    requiresBody: true,
  },
  merge: {
    title: "Merge pull request",
    submitLabel: "Merge",
    requiresBody: false,
  },
} as const;

interface GitHubPRInlineActionProps {
  kind: GitHubPRInlineActionKind;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (body: string, method: GitHubPRMergeMethod) => Promise<void>;
}

export function GitHubPRInlineAction({
  kind,
  isSubmitting,
  onCancel,
  onSubmit,
}: GitHubPRInlineActionProps) {
  const [body, setBody] = useState("");
  const [method, setMethod] = useState<GitHubPRMergeMethod>("squash");
  const copy = actionCopy[kind];
  const canSubmit = useMemo(
    () => !isSubmitting && (!copy.requiresBody || body.trim().length > 0),
    [body, copy.requiresBody, isSubmitting],
  );

  useEffect(() => {
    setBody("");
    setMethod("squash");
  }, [kind]);

  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-surface/35 p-3">
      <h2 className="font-sans ui-text-sm font-medium text-foreground">{copy.title}</h2>
      {kind === "merge" ? (
        <div className="flex flex-wrap items-center gap-1">
          {(["squash", "merge", "rebase"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant="ghost"
              active={method === option}
              onClick={() => setMethod(option)}
              size="xs"
              className="capitalize"
              disabled={isSubmitting}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <GitHubMarkdownEditor
          value={body}
          onChange={setBody}
          placeholder={"placeholder" in copy ? copy.placeholder : "Write a review..."}
          autoFocus
          minHeight={160}
          disabled={isSubmitting}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="xs" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="accent"
          size="xs"
          onClick={() => void onSubmit(body, method)}
          disabled={!canSubmit}
        >
          {isSubmitting ? <Spinner label="Working" compact /> : null}
          {copy.submitLabel}
        </Button>
      </div>
    </section>
  );
}
