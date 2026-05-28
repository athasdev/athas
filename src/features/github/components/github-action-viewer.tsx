import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle as CheckCircle2,
  Clock,
  Pulse as Activity,
  Copy,
  ArrowSquareOut as ExternalLink,
  ArrowClockwise as RefreshCw,
  FileText,
  XCircle,
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import { toast } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import type { WorkflowRunDetails, WorkflowRunJob } from "../types/github";
import { GITHUB_ACTION_DETAILS_TTL_MS, githubActionDetailsCache } from "../utils/github-data-cache";
import { copyToClipboard } from "../utils/github-viewer-utils";
import {
  GitHubViewerHeader,
  GitHubViewerLoadingState,
  GitHubViewerShell,
} from "./github-viewer-shell";

interface GitHubActionViewerProps {
  runId: number;
  repoPath?: string;
  bufferId: string;
}

const areJobLogsDownloadable = (job: WorkflowRunJob | null) =>
  Boolean(job?.completedAt || job?.conclusion || job?.status?.toLowerCase() === "completed");

const getWorkflowRunStatus = (status?: string | null, conclusion?: string | null) => {
  const normalizedStatus = status?.toLowerCase() ?? "";
  const normalizedConclusion = conclusion?.toLowerCase() ?? "";

  if (normalizedConclusion === "success") {
    return { label: "Success", icon: CheckCircle2, className: "text-success", animate: false };
  }

  if (
    normalizedConclusion === "failure" ||
    normalizedConclusion === "timed_out" ||
    normalizedConclusion === "startup_failure"
  ) {
    return { label: "Failed", icon: XCircle, className: "text-error", animate: false };
  }

  if (normalizedConclusion === "cancelled" || normalizedConclusion === "skipped") {
    return {
      label: normalizedConclusion === "skipped" ? "Skipped" : "Cancelled",
      icon: XCircle,
      className: "text-text-lighter",
      animate: false,
    };
  }

  if (
    normalizedStatus === "in_progress" ||
    normalizedStatus === "waiting" ||
    normalizedStatus === "requested"
  ) {
    return { label: "Running", icon: null, className: "text-accent", animate: true };
  }

  if (normalizedStatus === "queued" || normalizedStatus === "pending") {
    return { label: "Queued", icon: Clock, className: "text-warning", animate: false };
  }

  return {
    label: normalizedConclusion || normalizedStatus || "Unknown",
    icon: Activity,
    className: "text-text-lighter",
    animate: false,
  };
};

function WorkflowStatusIcon({
  status,
  conclusion,
  className,
}: {
  status?: string | null;
  conclusion?: string | null;
  className?: string;
}) {
  const state = getWorkflowRunStatus(status, conclusion);
  const Icon = state.icon;

  return (
    <span title={state.label} aria-label={state.label} className={cn(state.className, className)}>
      {state.animate || !Icon ? (
        <LoadingIndicator label={state.label} compact />
      ) : (
        <Icon className="size-4" weight="fill" />
      )}
    </span>
  );
}

const formatRunTime = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDuration = (startedAt?: string | null, completedAt?: string | null) => {
  if (!startedAt || !completedAt) return null;
  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(completed) || completed < started) return null;

  const totalSeconds = Math.round((completed - started) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

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
  const selectedJobLogsDownloadable = useMemo(
    () => areJobLogsDownloadable(selectedJob),
    [selectedJob],
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

      const job = details?.jobs.find((item) => item.id === jobId) ?? null;
      if (!areJobLogsDownloadable(job)) {
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
    [details?.jobs, jobLogs, repoPath],
  );

  useEffect(() => {
    if (selectedJobId === null || !selectedJobLogsDownloadable) return;
    void loadJobLogs(selectedJobId);
  }, [loadJobLogs, selectedJobId, selectedJobLogsDownloadable]);

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
  const runStatus = useMemo(
    () => getWorkflowRunStatus(details?.status, details?.conclusion),
    [details?.conclusion, details?.status],
  );
  const runSummaryItems = useMemo(() => {
    if (!details) return [];

    return [
      details.workflowName ? { label: "Workflow", value: details.workflowName, mono: true } : null,
      details.headBranch ? { label: "Branch", value: details.headBranch, mono: true } : null,
      details.event ? { label: "Event", value: details.event } : null,
      details.updatedAt ? { label: "Updated", value: formatRunTime(details.updatedAt) } : null,
      details.headSha ? { label: "Commit", value: details.headSha.slice(0, 7), mono: true } : null,
      { label: "Run", value: `#${details.databaseId}`, mono: true },
    ].filter((item): item is { label: string; value: string; mono?: boolean } =>
      Boolean(item?.value),
    );
  }, [details]);
  const jobSummary = useMemo(() => {
    const jobs = details?.jobs ?? [];
    return {
      total: jobs.length,
      failed: jobs.filter((job) => job.conclusion === "failure" || job.conclusion === "cancelled")
        .length,
      running: jobs.filter(
        (job) =>
          job.status === "in_progress" || job.status === "queued" || job.status === "waiting",
      ).length,
    };
  }, [details?.jobs]);

  return (
    <GitHubViewerShell
      header={
        <GitHubViewerHeader
          title={
            <span className="flex min-w-0 items-center gap-2">
              {details ? (
                <WorkflowStatusIcon
                  status={details.status}
                  conclusion={details.conclusion}
                  className="shrink-0"
                />
              ) : null}
              <span className="min-w-0 truncate">{runTitle}</span>
            </span>
          }
          meta={
            <>
              {details ? <span className={runStatus.className}>{runStatus.label}</span> : null}
              {jobSummary.total > 0 ? (
                <>
                  <span>&middot;</span>
                  <span>
                    {jobSummary.failed > 0
                      ? `${jobSummary.failed} failed`
                      : jobSummary.running > 0
                        ? `${jobSummary.running} running`
                        : `${jobSummary.total} jobs`}
                  </span>
                </>
              ) : null}
            </>
          }
          actions={
            <>
              <Tooltip content="Refresh action run" side="bottom">
                <Button
                  onClick={() => void fetchWorkflowRun(true)}
                  variant="ghost"
                  compact
                  aria-label="Refresh action run"
                >
                  {isLoading && details ? (
                    <LoadingIndicator label="Loading action run" compact />
                  ) : (
                    <RefreshCw />
                  )}
                </Button>
              </Tooltip>
              <Tooltip content="Open on GitHub" side="bottom">
                <Button
                  onClick={handleOpenInBrowser}
                  variant="ghost"
                  aria-label="Open action run on GitHub"
                  compact
                >
                  <ExternalLink />
                </Button>
              </Tooltip>
              <Tooltip content="Copy run link" side="bottom">
                <Button
                  onClick={handleCopyRunLink}
                  variant="ghost"
                  aria-label="Copy run link"
                  compact
                >
                  <Copy />
                </Button>
              </Tooltip>
            </>
          }
        />
      }
    >
      {error ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <p className="ui-font ui-text-sm text-error">{error}</p>
            <Button
              onClick={() => void fetchWorkflowRun(true)}
              variant="default"
              compact
              className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
            >
              Retry
            </Button>
          </div>
        </div>
      ) : details ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {runSummaryItems.map((item) => (
              <div
                key={item.label}
                className="min-w-0 rounded-md border border-border/60 bg-secondary-bg/20 px-2.5 py-2"
              >
                <div className="ui-text-xs text-text-lighter">{item.label}</div>
                <div
                  className={cn(
                    "mt-0.5 truncate text-text",
                    item.mono ? "ui-text-xs editor-font" : "ui-text-sm",
                  )}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {visibleJobs.map((job) => (
              <button
                type="button"
                key={`${job.id ?? job.name}-${job.startedAt ?? ""}`}
                onClick={() => handleSelectJob(job.id ?? null)}
                className={cn(
                  "w-full rounded-md border border-transparent bg-secondary-bg/20 px-3 py-2 text-left transition-[background-color,border-color]",
                  "hover:border-border/70 hover:bg-hover/50 focus-visible:border-accent/70 focus-visible:outline-none",
                  selectedJobId === job.id && "border-border/80 bg-hover/60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <WorkflowStatusIcon
                      status={job.status}
                      conclusion={job.conclusion}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="ui-text-sm min-w-0 truncate text-text">{job.name}</span>
                        <span className="ui-text-xs text-text-lighter">
                          {getWorkflowRunStatus(job.status, job.conclusion).label}
                        </span>
                      </div>
                      <div className="ui-text-xs mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-text-lighter">
                        {formatDuration(job.startedAt, job.completedAt) ? (
                          <span>{formatDuration(job.startedAt, job.completedAt)}</span>
                        ) : null}
                        {job.startedAt ? <span>{formatRunTime(job.startedAt)}</span> : null}
                        {job.runnerName ? <span>{job.runnerName}</span> : null}
                        {(job.labels ?? []).slice(0, 3).map((label) => (
                          <span
                            key={label}
                            className="rounded bg-secondary-bg/80 px-1.5 py-0.5 text-text-lighter"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {job.id ? (
                    <span
                      className={cn(
                        "ui-text-sm inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-text-lighter",
                        selectedJobId === job.id && "bg-secondary-bg text-text",
                      )}
                    >
                      <FileText />
                      Log
                    </span>
                  ) : null}
                </div>
                {job.steps.length > 0 && (
                  <div className="mt-2 grid gap-1 pl-6">
                    {job.steps.slice(0, 8).map((step, index) => (
                      <div
                        key={`${job.name}-${step.name}-${index}`}
                        className="ui-text-sm flex items-center gap-2 text-text-lighter"
                      >
                        <WorkflowStatusIcon
                          status={step.status}
                          conclusion={step.conclusion}
                          className="shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate">{step.name}</span>
                        <span className="ui-text-xs shrink-0 text-text-lighter">
                          {getWorkflowRunStatus(step.status, step.conclusion).label}
                        </span>
                      </div>
                    ))}
                    {job.steps.length > 8 ? (
                      <div className="ui-text-xs text-text-lighter">
                        {`${job.steps.length - 8} more steps`}
                      </div>
                    ) : null}
                  </div>
                )}
              </button>
            ))}
            {details.jobs.length > visibleJobs.length ? (
              <div className="px-1 py-2">
                <LoadingIndicator
                  label={`Loading ${details.jobs.length - visibleJobs.length} more jobs`}
                  showLabel
                  compact
                />
              </div>
            ) : null}
          </div>

          {selectedJob ? (
            <div className="rounded-md border border-border/70 bg-secondary-bg/20">
              <div className="flex items-center justify-between gap-2 border-border/70 border-b px-3 py-2">
                <div className="flex min-w-0 items-start gap-2">
                  <WorkflowStatusIcon
                    status={selectedJob.status}
                    conclusion={selectedJob.conclusion}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="ui-text-sm truncate text-text">{selectedJob.name}</div>
                    <div className="ui-text-xs flex flex-wrap items-center gap-x-2 text-text-lighter">
                      <span>
                        {getWorkflowRunStatus(selectedJob.status, selectedJob.conclusion).label}
                      </span>
                      {formatDuration(selectedJob.startedAt, selectedJob.completedAt) ? (
                        <span>
                          {formatDuration(selectedJob.startedAt, selectedJob.completedAt)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {selectedJob.id ? (
                    <Button
                      type="button"
                      onClick={() => void loadJobLogs(selectedJob.id!, true)}
                      variant="ghost"
                      compact
                      aria-label="Refresh job logs"
                      disabled={!selectedJobLogsDownloadable}
                    >
                      {loadingJobLogId === selectedJob.id ? (
                        <LoadingIndicator label="Loading job logs" compact />
                      ) : (
                        <RefreshCw />
                      )}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={handleCopyJobLogs}
                    variant="ghost"
                    aria-label="Copy job logs"
                    disabled={!selectedJob.id || !jobLogs[selectedJob.id]}
                    compact
                  >
                    <Copy />
                  </Button>
                </div>
              </div>
              <div className="max-h-[55vh] overflow-auto p-3">
                {!selectedJobLogsDownloadable ? (
                  <p className="ui-text-sm text-text-lighter">
                    Logs are available after this job finishes.
                  </p>
                ) : selectedJob.id &&
                  loadingJobLogId === selectedJob.id &&
                  !jobLogs[selectedJob.id] ? (
                  <div className="ui-text-sm flex items-center gap-2 text-text-lighter">
                    <LoadingIndicator label="Loading logs" showLabel compact />
                  </div>
                ) : selectedJob.id && jobLogErrors[selectedJob.id] ? (
                  <div className="space-y-2">
                    <p className="ui-text-sm text-error">{jobLogErrors[selectedJob.id]}</p>
                    <Button
                      type="button"
                      onClick={() => void loadJobLogs(selectedJob.id!, true)}
                      variant="default"
                      compact
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
      ) : (
        <GitHubViewerLoadingState label="Loading action run" />
      )}
    </GitHubViewerShell>
  );
});

GitHubActionViewer.displayName = "GitHubActionViewer";

export default GitHubActionViewer;
