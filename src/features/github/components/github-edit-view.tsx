import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { GitHubFormContent } from "@/features/panes/types/pane-content.types";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import type { IssueDetails, PullRequestDetails } from "../types/github.types";
import { useGitHubStore } from "../stores/github.store";
import { githubIssueDetailsCache, githubIssueListCache } from "../utils/github-data-cache";
import {
  type GitHubEditableResource,
  loadGitHubEditableResource,
} from "../utils/github-editable-resource";
import { getRepositoryDisplayName } from "../utils/github-viewer-utils";
import { GitHubTitleBodyForm } from "./github-title-body-form";
import { GitHubViewerHeader, GitHubViewerShell } from "./github-viewer-shell";

export function GitHubEditView({ buffer }: { buffer: GitHubFormContent }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resource, setResource] = useState<GitHubEditableResource | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const closeBuffer = useBufferStore.use.actions().closeBufferForce;
  const openIssue = useBufferStore.use.actions().openGitHubIssueBuffer;
  const openPullRequest = useBufferStore.use.actions().openPRBuffer;
  const selectPR = useGitHubStore((state) => state.actions.selectPR);
  const fetchPRs = useGitHubStore((state) => state.actions.fetchPRs);
  const number = buffer.resourceNumber;
  const resourceName = buffer.formKind === "pull-request" ? "pull request" : "issue";

  const loadResource = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (!number) {
      setLoadError(`Missing ${resourceName} number.`);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const nextResource = await loadGitHubEditableResource({
        repoPath: buffer.repoPath,
        resourceNumber: number,
        kind: buffer.formKind === "pull-request" ? "pull-request" : "issue",
      });
      if (requestId !== loadRequestRef.current) return;
      setResource(nextResource);
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setResource(null);
      setLoadError(error instanceof Error ? error.message : `Failed to load ${resourceName}`);
    } finally {
      if (requestId === loadRequestRef.current) setIsLoading(false);
    }
  }, [buffer.formKind, buffer.repoPath, number, resourceName]);

  useEffect(() => {
    void loadResource();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadResource]);

  const close = () => closeBuffer(buffer.id);
  const submit = async ({
    title,
    body,
    labels,
    assignees,
  }: {
    title: string;
    body: string;
    labels: string[];
    assignees: string[];
  }) => {
    if (!number || isSubmitting) return;
    setIsSubmitting(true);

    try {
      if (buffer.formKind === "issue") {
        const details = await invoke<IssueDetails>("github_update_issue", {
          repoPath: buffer.repoPath,
          issueNumber: number,
          title,
          body,
          labels,
          assignees,
        });
        githubIssueDetailsCache.set(`${buffer.repoPath}::${number}`, details);
        githubIssueListCache.clear();
        close();
        openIssue({
          issueNumber: number,
          repoPath: buffer.repoPath,
          title: details.title,
          authorAvatarUrl: details.author.avatarUrl ?? undefined,
          url: details.url,
        });
      } else {
        const details = await invoke<PullRequestDetails>("github_update_pull_request", {
          repoPath: buffer.repoPath,
          prNumber: number,
          title,
          body,
          labels,
          assignees,
        });
        await selectPR(buffer.repoPath, number, { force: true });
        void fetchPRs(buffer.repoPath, { force: true });
        close();
        openPullRequest(number, {
          title: details.title,
          repoPath: buffer.repoPath,
        });
      }
      toast.success(`Updated ${resourceName} #${number}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to update ${resourceName}`);
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
              <span>{`Edit ${resourceName} #${number}`}</span>
              <span className="truncate font-normal text-subtle-foreground">
                in {getRepositoryDisplayName(buffer.repoPath)}
              </span>
            </span>
          }
        />
      }
      contentClassName="pt-2"
    >
      {isLoading ? (
        <div className="flex min-h-72 items-center justify-center">
          <Spinner label={`Loading ${resourceName}`} />
        </div>
      ) : loadError || !resource ? (
        <div className="mx-auto flex min-h-72 max-w-xl flex-col items-center justify-center gap-3 text-center">
          <p className="text-destructive ui-text-sm">
            {loadError ?? `Failed to load ${resourceName}`}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="xs" onClick={close}>
              Cancel
            </Button>
            <Button type="button" variant="accent" size="xs" onClick={() => void loadResource()}>
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <GitHubTitleBodyForm
          title={resource.title}
          body={resource.body}
          labels={resource.labels}
          initialLabelNames={resource.selectedLabelNames}
          initialAssignees={resource.assignees}
          titlePlaceholder={
            buffer.formKind === "pull-request" ? "Pull request title" : "Issue title"
          }
          submitLabel="Save"
          isSubmitting={isSubmitting}
          onCancel={close}
          onSubmit={(value) => void submit(value)}
        />
      )}
    </GitHubViewerShell>
  );
}
