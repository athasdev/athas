import { invoke } from "@tauri-apps/api/core";
import { Activity, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import type { WorkflowRunDetails } from "../types/github";
import { copyToClipboard } from "../utils/pr-viewer-utils";

interface GitHubActionViewerProps {
  runId: number;
  repoPath?: string;
  bufferId: string;
}

const ACTION_CACHE_TTL_MS = 120_000;
const workflowRunCache = new Map<string, { fetchedAt: number; details: WorkflowRunDetails }>();

const GitHubActionViewer = memo(({ runId, repoPath, bufferId }: GitHubActionViewerProps) => {
  const buffers = useBufferStore.use.buffers();
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const [details, setDetails] = useState<WorkflowRunDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const buffer = buffers.find((item) => item.id === bufferId);

  const fetchWorkflowRun = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cacheKey = `${repoPath}::${runId}`;
      const cached = workflowRunCache.get(cacheKey);
      if (cached && !force && Date.now() - cached.fetchedAt < ACTION_CACHE_TTL_MS) {
        setDetails(cached.details);
        setError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextDetails = await invoke<WorkflowRunDetails>("github_get_workflow_run_details", {
          repoPath,
          runId,
        });
        workflowRunCache.set(cacheKey, { fetchedAt: Date.now(), details: nextDetails });
        setDetails(nextDetails);
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setIsLoading(false);
      }
    },
    [repoPath, runId],
  );

  useEffect(() => {
    void fetchWorkflowRun();
  }, [fetchWorkflowRun]);

  useEffect(() => {
    if (!details || !buffer || buffer.type !== "githubAction") return;

    const nextName =
      details.displayTitle || details.name || details.workflowName || `Run #${runId}`;
    if (buffer.name === nextName && buffer.url === details.url) return;

    updateBuffer({
      ...buffer,
      name: nextName,
      url: details.url,
    });
  }, [buffer, details, runId, updateBuffer]);

  const handleOpenInBrowser = useCallback(() => {
    if (!details?.url) {
      toast.error("Run link is not available.");
      return;
    }
    window.open(details.url, "_blank", "noopener,noreferrer");
  }, [details?.url]);

  const handleCopyRunLink = useCallback(() => {
    if (!details?.url) {
      toast.error("Run link is not available.");
      return;
    }
    void copyToClipboard(details.url, "Run link copied");
  }, [details?.url]);

  const runTitle = useMemo(
    () =>
      details?.displayTitle ||
      details?.name ||
      details?.workflowName ||
      buffer?.name ||
      `Run #${runId}`,
    [buffer?.name, details?.displayTitle, details?.name, details?.workflowName, runId],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-primary-bg">
      {isLoading && (
        <div className="h-px w-full overflow-hidden bg-border">
          <div className="h-full w-1/3 animate-pulse bg-accent/70" />
        </div>
      )}

      <div className="shrink-0 px-3 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="ui-font ui-text-lg leading-tight font-medium text-text">{runTitle}</h1>
            <div className="ui-font ui-text-sm mt-1 flex flex-wrap items-center gap-x-2 text-text-lighter">
              <span>{`Run #${runId}`}</span>
              {details?.workflowName ? (
                <>
                  <span>&middot;</span>
                  <span>{details.workflowName}</span>
                </>
              ) : null}
              {details?.headBranch ? (
                <>
                  <span>&middot;</span>
                  <span className="inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary-bg/80 px-1.5 py-0.5 font-mono text-text-lighter">
                    <span className="truncate">{details.headBranch}</span>
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip content="Refresh action run" side="bottom">
              <Button
                onClick={() => void fetchWorkflowRun(true)}
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh action run"
              >
                <RefreshCw className={isLoading ? "animate-spin" : ""} />
              </Button>
            </Tooltip>
            <Tooltip content="Open on GitHub" side="bottom">
              <Button
                onClick={handleOpenInBrowser}
                variant="ghost"
                size="icon-sm"
                aria-label="Open action run on GitHub"
              >
                <ExternalLink />
              </Button>
            </Tooltip>
            <Tooltip content="Copy run link" side="bottom">
              <Button
                onClick={handleCopyRunLink}
                variant="ghost"
                size="icon-sm"
                aria-label="Copy run link"
              >
                <Copy />
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="min-w-0 px-3 pb-4 sm:px-5">
        {error ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <p className="ui-font ui-text-sm text-error">{error}</p>
              <Button
                onClick={() => void fetchWorkflowRun(true)}
                variant="outline"
                size="xs"
                className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
              >
                Retry
              </Button>
            </div>
          </div>
        ) : details ? (
          <div className="space-y-4">
            <div className="ui-font ui-text-sm flex flex-wrap items-center gap-x-2 gap-y-1 text-text-lighter">
              <span>{details.status?.toLowerCase() ?? "unknown status"}</span>
              {details.conclusion ? (
                <>
                  <span>&middot;</span>
                  <span>{details.conclusion.toLowerCase()}</span>
                </>
              ) : null}
              {details.event ? (
                <>
                  <span>&middot;</span>
                  <span>{details.event}</span>
                </>
              ) : null}
              {details.headSha ? (
                <>
                  <span>&middot;</span>
                  <code className="rounded bg-secondary-bg/80 px-1.5 py-0.5 font-mono text-text-lighter">
                    {details.headSha.slice(0, 7)}
                  </code>
                </>
              ) : null}
            </div>

            <div className="space-y-2">
              {details.jobs.map((job) => (
                <div
                  key={`${job.name}-${job.startedAt ?? ""}`}
                  className="rounded-lg bg-secondary-bg/20 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="ui-text-sm text-text">{job.name}</span>
                    <span className="ui-text-sm text-text-lighter">
                      {[job.status, job.conclusion].filter(Boolean).join(" · ").toLowerCase()}
                    </span>
                  </div>
                  {job.steps.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {job.steps.map((step, index) => (
                        <div
                          key={`${job.name}-${step.name}-${index}`}
                          className="ui-text-sm flex items-center gap-2 text-text-lighter"
                        >
                          <Activity className="size-3.5" />
                          <span className="truncate">{step.name}</span>
                          <span className="truncate">
                            {[step.status, step.conclusion]
                              .filter(Boolean)
                              .join(" · ")
                              .toLowerCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});

GitHubActionViewer.displayName = "GitHubActionViewer";

export default GitHubActionViewer;
