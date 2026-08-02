import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { GitHubFormContent } from "@/features/panes/types/pane-content.types";
import { Button } from "@/ui/button";
import { toast } from "sonner";
import { useGitHubStore } from "../stores/github.store";
import { getRepositoryDisplayName } from "../utils/github-viewer-utils";
import { GitHubMarkdownEditor } from "./github-markdown-editor";
import { GitHubViewerHeader, GitHubViewerShell } from "./github-viewer-shell";

const actionCopy = {
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
  },
} as const;

export function GitHubPRActionView({ buffer }: { buffer: GitHubFormContent }) {
  const kind = buffer.actionKind ?? "comment";
  const copy = actionCopy[kind];
  const prNumber = buffer.resourceNumber;
  const [body, setBody] = useState("");
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("squash");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const closeBuffer = useBufferStore.use.actions().closeBufferForce;
  const openPullRequest = useBufferStore.use.actions().openPRBuffer;
  const { selectPR, fetchPRs, fetchPRContent } = useGitHubStore((state) => state.actions);
  const canSubmit = useMemo(
    () =>
      !isSubmitting && (!("requiresBody" in copy) || !copy.requiresBody || body.trim().length > 0),
    [body, copy, isSubmitting],
  );

  const close = () => closeBuffer(buffer.id);
  const submit = async () => {
    if (!prNumber || !canSubmit) return;
    setIsSubmitting(true);
    try {
      if (kind === "comment") {
        await invoke("github_add_pr_comment", { repoPath: buffer.repoPath, prNumber, body });
      } else if (kind === "approve" || kind === "request-changes") {
        await invoke("github_submit_pr_review", {
          repoPath: buffer.repoPath,
          prNumber,
          event: kind === "approve" ? "APPROVE" : "REQUEST_CHANGES",
          body,
        });
      } else if (kind === "merge") {
        await invoke("github_merge_pull_request", {
          repoPath: buffer.repoPath,
          prNumber,
          method,
        });
      } else {
        await invoke("github_close_pull_request", { repoPath: buffer.repoPath, prNumber });
      }

      await selectPR(buffer.repoPath, prNumber, { force: true });
      void fetchPRs(buffer.repoPath, { force: true });
      void fetchPRContent(buffer.repoPath, prNumber, {
        force: true,
        mode:
          kind === "comment" || kind === "approve" || kind === "request-changes"
            ? "comments"
            : "full",
      });
      close();
      openPullRequest(prNumber, { repoPath: buffer.repoPath });
      toast.success(`${copy.submitLabel} completed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pull request action failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <GitHubViewerShell
      header={
        <GitHubViewerHeader
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span>{`${copy.title} #${prNumber}`}</span>
              <span className="truncate font-normal text-subtle-foreground">
                in {getRepositoryDisplayName(buffer.repoPath)}
              </span>
            </span>
          }
        />
      }
    >
      <div className="mx-auto w-full max-w-4xl pt-7 pb-16">
        <div className="space-y-2 pb-6">
          <h1 className="font-sans text-2xl leading-tight font-semibold tracking-tight text-foreground">
            {copy.title}
          </h1>
          <p className="font-sans ui-text-sm text-subtle-foreground">{copy.description}</p>
        </div>
        {kind === "merge" ? (
          <div className="flex flex-wrap items-center gap-1 border-border/60 border-y py-3">
            {(["squash", "merge", "rebase"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant="ghost"
                active={method === option}
                onClick={() => setMethod(option)}
                size="xs"
                className="capitalize"
              >
                {option}
              </Button>
            ))}
          </div>
        ) : null}
        {"placeholder" in copy ? (
          <GitHubMarkdownEditor
            value={body}
            onChange={setBody}
            placeholder={copy.placeholder}
            autoFocus
            minHeight={240}
          />
        ) : null}
        <div className="flex justify-end gap-2 border-border/60 border-t pt-3">
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {isSubmitting ? "Working..." : copy.submitLabel}
          </Button>
        </div>
      </div>
    </GitHubViewerShell>
  );
}
