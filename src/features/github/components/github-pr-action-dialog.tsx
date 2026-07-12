import { useEffect, useMemo, useState } from "react";
import Dialog from "@/ui/dialog";
import { Button } from "@/ui/button";
import Textarea from "@/ui/textarea";

export type GitHubPRActionKind = "comment" | "approve" | "request-changes" | "merge" | "close";

interface GitHubPRActionDialogProps {
  kind: GitHubPRActionKind;
  prNumber: number;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (value: { body: string; method?: "merge" | "squash" | "rebase" }) => void;
}

const actionCopy: Record<
  GitHubPRActionKind,
  {
    title: string;
    description: string;
    placeholder?: string;
    submitLabel: string;
    requiresBody?: boolean;
    tone?: "danger";
  }
> = {
  comment: {
    title: "Add comment",
    description: "Add a conversation comment to this pull request.",
    placeholder: "Write a comment...",
    submitLabel: "Comment",
    requiresBody: true,
  },
  approve: {
    title: "Approve pull request",
    description: "Submit an approving review. A message is optional.",
    placeholder: "Optional review note...",
    submitLabel: "Approve",
  },
  "request-changes": {
    title: "Request changes",
    description: "Submit a review that blocks the pull request until changes are made.",
    placeholder: "Describe the requested changes...",
    submitLabel: "Request changes",
    requiresBody: true,
    tone: "danger",
  },
  merge: {
    title: "Merge pull request",
    description: "Merge this pull request using the selected merge method.",
    submitLabel: "Merge",
  },
  close: {
    title: "Close pull request",
    description: "Close this pull request without merging it.",
    submitLabel: "Close PR",
    tone: "danger",
  },
};

export function GitHubPRActionDialog({
  kind,
  prNumber,
  isSubmitting,
  onClose,
  onSubmit,
}: GitHubPRActionDialogProps) {
  const copy = actionCopy[kind];
  const [body, setBody] = useState("");
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("squash");

  useEffect(() => {
    setBody("");
    setMethod("squash");
  }, [kind]);

  const canSubmit = useMemo(() => {
    if (isSubmitting) return false;
    if (copy.requiresBody && !body.trim()) return false;
    return true;
  }, [body, copy.requiresBody, isSubmitting]);

  return (
    <Dialog
      title={`${copy.title} #${prNumber}`}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => onSubmit({ body, method })}
            disabled={!canSubmit}
            className={copy.tone === "danger" ? "border-error/40 text-error/90" : undefined}
          >
            {isSubmitting ? "Working..." : copy.submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="font-sans ui-text-sm text-text-lighter">{copy.description}</p>

        {kind === "merge" ? (
          <div className="grid grid-cols-3 gap-2">
            {(["squash", "merge", "rebase"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={method === option ? "default" : "ghost"}
                onClick={() => setMethod(option)}
                className="justify-center capitalize"
              >
                {option}
              </Button>
            ))}
          </div>
        ) : null}

        {copy.placeholder ? (
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={copy.placeholder}
            className="min-h-32"
            autoFocus
          />
        ) : null}
      </div>
    </Dialog>
  );
}
