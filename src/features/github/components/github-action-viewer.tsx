import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Pulse as Activity,
  Copy,
  ArrowSquareOut as ExternalLink,
  ArrowClockwise as RefreshCw,
  FileText,
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import type { WorkflowRunDetails } from "../types/github";
import { GITHUB_ACTION_DETAILS_TTL_MS, githubActionDetailsCache } from "../utils/github-data-cache";
import { copyToClipboard } from "../utils/pr-viewer-utils";

interface GitHubActionViewerProps {
  runId: number;
  repoPath?: string;
  bufferId: string;
}

const GitHubActionViewer = memo(({ runId, repoPath, bufferId }: GitHubActionViewerProps) => {
  const buffers = useBufferStore.use.buffers();
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const [details, setDetails] = useState<WorkflowRunDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleJobCount, setVisibleJobCount] = useState(10);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jobLogs, setJobLogs] = useState<Record<number, string>>({});
  const [jobLogErrors, setJobLogErrors] = useState<Record<number, string>>({});
  const [loadingJobLogId, setLoadingJobLogId] = useState<number | null>(null);
  const buffer = buffers.find((item) => item.id === bufferId);
  const visibleJobs = useMemo(
    () => details?.jobs.slice(0, visibleJobCount) ?? [],
    [details?.jobs, visibleJobCount],
  );
  const selectedJob = useMemo(
    () => details?.jobs.find((job) => job.id === selectedJobId) ?? null,
    [details?.jobs, selectedJobId],
  );

  const fetchWorkflowRun = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cacheKey = `${repoPath}::${runId}`;
      const cached = githubActionDetailsCache.getFreshValue(cacheKey, GITHUB_ACTION_DETAILS_TTL_MS);
      if (cached && !force) {
        setDetails(cached);
        setError(null);
        setIsLoading(false);
        return;
      }

      const stale = githubActionDetailsCache.getSnapshot(cacheKey)?.value;
      if (stale && !force) {
        setDetails(stale);
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextDetails = await githubActionDetailsCache.load(
          cacheKey,
          () =>
            invoke<WorkflowRunDetails>("github_get_workflow_run_details", {
              repoPath,
              runId,
            }),
          { force, ttlMs: GITHUB_ACTION_DETAILS_TTL_MS },
        );
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

  useEffect(() => {
    setVisibleJobCount(10);
    setSelectedJobId(null);
    setJobLogs({});
    setJobLogErrors({});
    setLoadingJobLogId(null);
  }, [details?.databaseId]);

  useEffect(() => {
    if (!details?.jobs.length || selectedJobId !== null) return;

    const failedJob =
      details.jobs.find((job) => job.conclusion === "failure" || job.conclusion === "cancelled") ??
      details.jobs.find((job) => job.id);
    setSelectedJobId(failedJob?.id ?? null);
  }, [details?.jobs, selectedJobId]);

  useEffect(() => {
    const totalJobs = details?.jobs.length ?? 0;
    if (totalJobs <= visibleJobCount) return;

    let cancelled = false;
    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const schedule = idleApi.requestIdleCallback;

    const revealMore = () => {
      if (cancelled) return;
      setVisibleJobCount((current) => Math.min(current + 10, totalJobs));
    };

    if (typeof schedule === "function") {
      const idleId = schedule(revealMore, { timeout: 200 });
      return () => {
        cancelled = true;
        idleApi.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = window.setTimeout(revealMore, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [details?.jobs.length, visibleJobCount]);

  const handleOpenInBrowser = useCallback(() => {
    if (!details?.url) {
      toast.error("Run link is not available.");
      return;
    }
    void openUrl(details.url);
  }, [details?.url]);

  const handleCopyRunLink = useCallback(() => {
    if (!details?.url) {
      toast.error("Run link is not available.");
      return;
    }
    void copyToClipboard(details.url, "Run link copied");
  }, [details?.url]);

  const loadJobLogs = useCallback(
    async (jobId: number, force = false) => {
      if (!repoPath) {
        toast.error("No repository selected.");
        return;
      }

      if (jobLogs[jobId] && !force) {
        return;
      }

      setLoadingJobLogId(jobId);
      setJobLogErrors((current) => {
        const next = { ...current };
        delete next[jobId];
        return next;
      });

      try {
        const logs = await invoke<string>("github_get_workflow_job_logs", {
          repoPath,
          jobId,
        });
        setJobLogs((current) => ({ ...current, [jobId]: logs }));
      } catch (nextError) {
        setJobLogErrors((current) => ({
          ...current,
          [jobId]: nextError instanceof Error ? nextError.message : String(nextError),
        }));
      } finally {
        setLoadingJobLogId((current) => (current === jobId ? null : current));
      }
    },
    [jobLogs, repoPath],
  );

  useEffect(() => {
    if (selectedJobId === null) return;
    void loadJobLogs(selectedJobId);
  }, [loadJobLogs, selectedJobId]);

  const handleSelectJob = useCallback((jobId: number | null) => {
    setSelectedJobId(jobId);
  }, []);

  const handleCopyJobLogs = useCallback(() => {
    if (!selectedJobId || !jobLogs[selectedJobId]) {
      toast.error("Job logs are not loaded.");
      return;
    }

    void copyToClipboard(jobLogs[selectedJobId], "Job logs copied");
  }, [jobLogs, selectedJobId]);

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
                  <span className="inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary-bg/80 px-1.5 py-0.5 editor-font text-text-lighter">
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
                  <code className="rounded bg-secondary-bg/80 px-1.5 py-0.5 editor-font text-text-lighter">
                    {details.headSha.slice(0, 7)}
                  </code>
                </>
              ) : null}
            </div>

            <div className="space-y-2">
              {visibleJobs.map((job) => (
                <div
                  key={`${job.id ?? job.name}-${job.startedAt ?? ""}`}
                  className="rounded-lg bg-secondary-bg/20 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => handleSelectJob(job.id ?? null)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="ui-text-sm text-text">{job.name}</span>
                      <span className="ui-text-sm ml-2 text-text-lighter">
                        {[job.status, job.conclusion].filter(Boolean).join(" · ").toLowerCase()}
                      </span>
                    </button>
                    {job.id ? (
                      <Button
                        type="button"
                        onClick={() => handleSelectJob(job.id ?? null)}
                        variant="ghost"
                        size="xs"
                        active={selectedJobId === job.id}
                        className="shrink-0 text-text-lighter"
                      >
                        <FileText />
                        Log
                      </Button>
                    ) : null}
                  </div>
                  {job.runnerName || (job.labels ?? []).length > 0 ? (
                    <div className="ui-text-xs mt-1 flex flex-wrap gap-x-2 gap-y-1 text-text-lighter">
                      {job.runnerName ? <span>{job.runnerName}</span> : null}
                      {(job.labels ?? []).slice(0, 4).map((label) => (
                        <span
                          key={label}
                          className="rounded bg-secondary-bg/80 px-1.5 py-0.5 text-text-lighter"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
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
              {details.jobs.length > visibleJobs.length ? (
                <div className="ui-font ui-text-sm px-1 py-2 text-text-lighter">
                  {`Loading ${details.jobs.length - visibleJobs.length} more jobs...`}
                </div>
              ) : null}
            </div>

            {selectedJob ? (
              <div className="rounded-lg border border-border/70 bg-secondary-bg/20">
                <div className="flex items-center justify-between gap-2 border-border/70 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="ui-text-sm truncate text-text">{selectedJob.name}</div>
                    <div className="ui-text-xs text-text-lighter">
                      {[selectedJob.status, selectedJob.conclusion]
                        .filter(Boolean)
                        .join(" · ")
                        .toLowerCase()}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {selectedJob.id ? (
                      <Button
                        type="button"
                        onClick={() => void loadJobLogs(selectedJob.id!, true)}
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Refresh job logs"
                      >
                        <RefreshCw
                          className={loadingJobLogId === selectedJob.id ? "animate-spin" : ""}
                        />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      onClick={handleCopyJobLogs}
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Copy job logs"
                    >
                      <Copy />
                    </Button>
                  </div>
                </div>
                <div className="max-h-[55vh] overflow-auto p-3">
                  {selectedJob.id &&
                  loadingJobLogId === selectedJob.id &&
                  !jobLogs[selectedJob.id] ? (
                    <div className="ui-text-sm flex items-center gap-2 text-text-lighter">
                      <RefreshCw className="animate-spin" />
                      Loading logs...
                    </div>
                  ) : selectedJob.id && jobLogErrors[selectedJob.id] ? (
                    <div className="space-y-2">
                      <p className="ui-text-sm text-error">{jobLogErrors[selectedJob.id]}</p>
                      <Button
                        type="button"
                        onClick={() => void loadJobLogs(selectedJob.id!, true)}
                        variant="outline"
                        size="xs"
                        className="border-error/40 text-error/90 hover:bg-error/10"
                      >
                        Retry
                      </Button>
                    </div>
                  ) : selectedJob.id && jobLogs[selectedJob.id] ? (
                    <pre className="ui-text-xs whitespace-pre-wrap break-words font-mono leading-5 text-text-light">
                      {jobLogs[selectedJob.id]}
                    </pre>
                  ) : (
                    <p className="ui-text-sm text-text-lighter">No logs available for this job.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

GitHubActionViewer.displayName = "GitHubActionViewer";

export default GitHubActionViewer;
