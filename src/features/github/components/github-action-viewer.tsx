import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircleIcon as CheckCircle2,
  ClockIcon as Clock,
  PulseIcon as Activity,
  CopyIcon as Copy,
  MagnifyingGlassIcon as Search,
  ArrowClockwiseIcon as RefreshCw,
  XCircleIcon as XCircle,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { ViewerErrorState, ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription } from "@/ui/empty";
import { DropdownMenuItem } from "@/ui/dropdown";
import Input from "@/ui/input";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/utils/cn";
import type {
  GitHubActionNotificationTarget,
  WorkflowRunDetails,
  WorkflowRunJob,
  WorkflowRunListItem,
  WorkflowRunStep,
} from "../types/github.types";
import { GITHUB_ACTION_DETAILS_TTL_MS, githubActionDetailsCache } from "../utils/github-data-cache";
import { copyToClipboard } from "../utils/github-viewer-utils";
import {
  GitHubMetadataItem,
  GitHubMetadataList,
  GitHubViewerActionsMenu,
  GitHubViewerBody,
  GitHubViewerHeader,
  GitHubViewerShell,
  GitHubViewerTitle,
} from "./github-viewer-shell";

interface GitHubActionViewerProps {
  runId?: number;
  notification?: GitHubActionNotificationTarget;
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
    return { label: "Failed", icon: XCircle, className: "text-destructive", animate: false };
  }

  if (normalizedConclusion === "cancelled" || normalizedConclusion === "skipped") {
    return {
      label: normalizedConclusion === "skipped" ? "Skipped" : "Cancelled",
      icon: XCircle,
      className: "text-subtle-foreground",
      animate: false,
    };
  }

  if (
    normalizedStatus === "in_progress" ||
    normalizedStatus === "waiting" ||
    normalizedStatus === "requested"
  ) {
    return { label: "Running", icon: null, className: "text-primary", animate: true };
  }

  if (normalizedStatus === "queued" || normalizedStatus === "pending") {
    return { label: "Queued", icon: Clock, className: "text-warning", animate: false };
  }

  return {
    label: normalizedConclusion || normalizedStatus || "Unknown",
    icon: Activity,
    className: "text-subtle-foreground",
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
        <Spinner label={state.label} compact />
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

const stripLogTimestamp = (line: string) => {
  return line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/, "");
};

const normalizeLogTitle = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/^run\s+/, "")
    .replace(/\s+/g, " ");
};

const getLogGroupTitle = (line: string) => {
  const cleanLine = stripLogTimestamp(line).trim();
  if (!cleanLine.startsWith("##[group]")) return null;
  return cleanLine.replace(/^##\[group\]/, "").trim();
};

const parseWorkflowLogChunks = (logs: string) => {
  const lines = logs.split(/\r?\n/);
  const chunks: Array<{ title: string; text: string }> = [];
  let currentTitle: string | null = null;
  let currentStart = 0;

  lines.forEach((line, index) => {
    const nextTitle = getLogGroupTitle(line);
    if (nextTitle) {
      if (currentTitle && currentStart < index) {
        chunks.push({
          title: currentTitle,
          text: lines.slice(currentStart, index).join("\n").trim(),
        });
      }

      currentTitle = nextTitle;
      currentStart = index;
      return;
    }

    if (currentTitle && stripLogTimestamp(line).trim() === "##[endgroup]") {
      chunks.push({
        title: currentTitle,
        text: lines
          .slice(currentStart, index + 1)
          .join("\n")
          .trim(),
      });
      currentTitle = null;
      currentStart = index + 1;
    }
  });

  if (currentTitle && currentStart < lines.length) {
    chunks.push({
      title: currentTitle,
      text: lines.slice(currentStart).join("\n").trim(),
    });
  }

  return chunks.filter((chunk) => chunk.text.length > 0);
};

const getStepLogChunk = (
  chunks: Array<{ title: string; text: string }>,
  step: WorkflowRunStep,
  stepIndex: number,
) => {
  const normalizedStepName = normalizeLogTitle(step.name);
  const matchingChunk = chunks.find((chunk) => {
    const normalizedChunkTitle = normalizeLogTitle(chunk.title);
    return (
      normalizedChunkTitle === normalizedStepName ||
      normalizedChunkTitle.includes(normalizedStepName) ||
      normalizedStepName.includes(normalizedChunkTitle)
    );
  });

  return matchingChunk ?? chunks[stepIndex] ?? null;
};

const getSelectedStepLogs = (
  logs: string | undefined,
  steps: WorkflowRunStep[],
  selectedStepIndex: number | null,
) => {
  if (!logs || selectedStepIndex === null || !steps[selectedStepIndex]) return logs;

  const chunks = parseWorkflowLogChunks(logs);
  if (chunks.length === 0) return logs;

  return getStepLogChunk(chunks, steps[selectedStepIndex], selectedStepIndex)?.text ?? logs;
};

const filterLogLines = (logs: string | undefined, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!logs || !normalizedQuery) return logs;

  return logs
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().includes(normalizedQuery))
    .join("\n");
};

const getLogLineSegments = (line: string, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [{ text: line, isMatch: false }];

  const lowerLine = line.toLowerCase();
  const segments: Array<{ text: string; isMatch: boolean }> = [];
  let currentIndex = 0;

  while (currentIndex < line.length) {
    const matchIndex = lowerLine.indexOf(normalizedQuery, currentIndex);
    if (matchIndex < 0) break;

    if (matchIndex > currentIndex) {
      segments.push({ text: line.slice(currentIndex, matchIndex), isMatch: false });
    }

    const matchEnd = matchIndex + normalizedQuery.length;
    segments.push({ text: line.slice(matchIndex, matchEnd), isMatch: true });
    currentIndex = matchEnd;
  }

  if (currentIndex < line.length) {
    segments.push({ text: line.slice(currentIndex), isMatch: false });
  }

  return segments.length > 0 ? segments : [{ text: line, isMatch: false }];
};

const GitHubActionViewer = memo((props: GitHubActionViewerProps) => {
  const { runId, notification, repoPath, bufferId } = props;
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const buffer = useBufferStore((state) => state.buffers.find((item) => item.id === bufferId));
  const [resolvedRunId, setResolvedRunId] = useState<number | null>(runId ?? null);
  const [details, setDetails] = useState<WorkflowRunDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleJobCount, setVisibleJobCount] = useState(10);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [jobLogs, setJobLogs] = useState<Record<number, string>>({});
  const [jobLogErrors, setJobLogErrors] = useState<Record<number, string>>({});
  const [loadingJobLogId, setLoadingJobLogId] = useState<number | null>(null);
  const [isLogSearchVisible, setIsLogSearchVisible] = useState(false);
  const [logSearchQuery, setLogSearchQuery] = useState("");
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

  useEffect(() => {
    if (runId !== undefined) setResolvedRunId(runId);
  }, [runId]);

  const resolveNotification = useCallback(async () => {
    if (!notification || !repoPath) return;

    setIsLoading(true);
    setError(null);
    try {
      const run = await invoke<WorkflowRunListItem | null>(
        "github_resolve_notification_workflow_run",
        {
          repositoryFullName: notification.repositoryFullName,
          checkSuiteId: notification.checkSuiteId,
          notificationTitle: notification.title,
          notificationUpdatedAt: notification.updatedAt,
        },
      );
      if (!run) {
        setError("Could not match this notification to a GitHub Actions run.");
        return;
      }

      setResolvedRunId(run.databaseId);
      if (buffer?.type === "githubAction") {
        updateBuffer({
          ...buffer,
          runId: run.databaseId,
          name: run.displayTitle || run.name || run.workflowName || notification.title,
          url: run.url,
        });
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsLoading(false);
    }
  }, [buffer, notification, repoPath, updateBuffer]);

  useEffect(() => {
    if (resolvedRunId !== null || !notification) return;
    void resolveNotification();
  }, [notification, resolveNotification, resolvedRunId]);

  const fetchWorkflowRun = useCallback(
    async (force = false) => {
      if (resolvedRunId === null) return;
      if (!repoPath) {
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cacheKey = `${repoPath}::${resolvedRunId}`;
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
              runId: resolvedRunId,
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
    [repoPath, resolvedRunId],
  );

  useEffect(() => {
    void fetchWorkflowRun();
  }, [fetchWorkflowRun]);

  useEffect(() => {
    if (!details || !buffer || buffer.type !== "githubAction") return;

    const nextName =
      details.displayTitle || details.name || details.workflowName || `Run #${resolvedRunId}`;
    if (buffer.name === nextName && buffer.url === details.url) return;

    updateBuffer({
      ...buffer,
      name: nextName,
      url: details.url,
    });
  }, [buffer, details, resolvedRunId, updateBuffer]);

  useEffect(() => {
    setVisibleJobCount(10);
    setSelectedJobId(null);
    setSelectedStepIndex(null);
    setJobLogs({});
    setJobLogErrors({});
    setLoadingJobLogId(null);
    setIsLogSearchVisible(false);
    setLogSearchQuery("");
  }, [details?.databaseId]);

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

  const handleSelectJob = useCallback((job: WorkflowRunJob) => {
    if (job.id == null) {
      setSelectedJobId(null);
      setSelectedStepIndex(null);
      return;
    }

    setSelectedJobId(job.id);
    setSelectedStepIndex(job.steps.length > 0 ? 0 : null);
  }, []);

  const runTitle = useMemo(
    () =>
      details?.displayTitle ||
      details?.name ||
      details?.workflowName ||
      buffer?.name ||
      (resolvedRunId === null ? "Resolving action run" : `Run #${resolvedRunId}`),
    [buffer?.name, details?.displayTitle, details?.name, details?.workflowName, resolvedRunId],
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
  const selectedStep = useMemo(
    () => (selectedJob && selectedStepIndex !== null ? selectedJob.steps[selectedStepIndex] : null),
    [selectedJob, selectedStepIndex],
  );
  const selectedStepLogs = useMemo(
    () =>
      selectedJob?.id
        ? getSelectedStepLogs(jobLogs[selectedJob.id], selectedJob.steps, selectedStepIndex)
        : undefined,
    [jobLogs, selectedJob, selectedStepIndex],
  );
  const filteredStepLogs = useMemo(
    () => filterLogLines(selectedStepLogs, logSearchQuery),
    [logSearchQuery, selectedStepLogs],
  );
  const hasLogSearchQuery = Boolean(logSearchQuery.trim());
  const handleCopySelectedLogs = useCallback(() => {
    if (!selectedStepLogs) {
      toast.error("Step logs are not loaded.");
      return;
    }

    void copyToClipboard(selectedStepLogs, "Step logs copied");
  }, [selectedStepLogs]);
  const handleToggleLogSearch = useCallback(() => {
    setIsLogSearchVisible((current) => {
      const next = !current;
      if (!next) setLogSearchQuery("");
      return next;
    });
  }, []);

  return (
    <GitHubViewerShell
      header={
        <GitHubViewerHeader
          title={
            <GitHubViewerTitle
              kind="Workflow run"
              number={resolvedRunId ?? undefined}
              title={runTitle}
              stats={
                details ? (
                  <WorkflowStatusIcon
                    status={details.status}
                    conclusion={details.conclusion}
                    className="shrink-0"
                  />
                ) : null
              }
            />
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
            <GitHubViewerActionsMenu label="Action run actions">
              <DropdownMenuItem
                disabled={isLoading && Boolean(details)}
                onClick={() =>
                  void (resolvedRunId === null ? resolveNotification() : fetchWorkflowRun(true))
                }
              >
                {isLoading && details ? "Refreshing..." : "Refresh"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenInBrowser}>Open on GitHub</DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyRunLink}>Copy link</DropdownMenuItem>
            </GitHubViewerActionsMenu>
          }
        />
      }
    >
      {error ? (
        <ViewerErrorState
          message={error}
          actionLabel="Retry"
          onAction={() =>
            void (resolvedRunId === null ? resolveNotification() : fetchWorkflowRun(true))
          }
          layout="section"
        />
      ) : details ? (
        <GitHubViewerBody className="space-y-4">
          <GitHubMetadataList>
            {runSummaryItems.map((item) => (
              <GitHubMetadataItem key={item.label} label={item.label} mono={item.mono}>
                {item.value}
              </GitHubMetadataItem>
            ))}
          </GitHubMetadataList>

          <div className="space-y-2">
            {visibleJobs.map((job) => {
              const isSelectedJob = job.id != null && selectedJobId === job.id;
              const jobMeta = [
                formatDuration(job.startedAt, job.completedAt),
                job.startedAt ? formatRunTime(job.startedAt) : null,
                job.runnerName,
                job.labels.length > 0 ? job.labels.join(", ") : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <section key={`${job.id ?? job.name}-${job.startedAt ?? ""}`}>
                  <Item
                    render={<button type="button" />}
                    variant={isSelectedJob ? "muted" : "default"}
                    onClick={() => handleSelectJob(job)}
                    className="min-w-0 flex-nowrap text-left"
                  >
                    <ItemMedia variant="icon">
                      <WorkflowStatusIcon status={job.status} conclusion={job.conclusion} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="w-full">
                        <span className="min-w-0 flex-1 truncate">{job.name}</span>
                        <span className="shrink-0 font-normal text-subtle-foreground">
                          {getWorkflowRunStatus(job.status, job.conclusion).label}
                        </span>
                      </ItemTitle>
                      {jobMeta ? (
                        <ItemDescription className="line-clamp-1">{jobMeta}</ItemDescription>
                      ) : null}
                    </ItemContent>
                  </Item>

                  {isSelectedJob ? (
                    <div className="mx-2 mb-2 flex min-h-64 overflow-hidden rounded-xl border border-border/70 bg-background">
                      <ScrollArea
                        className="min-h-0 w-64 shrink-0 border-border/70 border-r bg-surface/20"
                        contentClassName="p-1.5"
                        orientation="both"
                      >
                        {job.steps.length > 0 ? (
                          job.steps.map((step, index) => (
                            <Item
                              render={<button type="button" />}
                              key={`${job.name}-${step.name}-${index}`}
                              variant={selectedStepIndex === index ? "muted" : "default"}
                              onClick={() => setSelectedStepIndex(index)}
                              className="min-w-0 flex-nowrap text-left"
                            >
                              <ItemMedia variant="icon">
                                <WorkflowStatusIcon
                                  status={step.status}
                                  conclusion={step.conclusion}
                                />
                              </ItemMedia>
                              <ItemContent>
                                <ItemTitle className="w-full font-normal">{step.name}</ItemTitle>
                              </ItemContent>
                            </Item>
                          ))
                        ) : (
                          <Empty className="min-h-0 flex-none items-start rounded-none px-2 py-2 text-left">
                            <EmptyDescription>No steps reported.</EmptyDescription>
                          </Empty>
                        )}
                      </ScrollArea>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 border-border/70 border-b px-3 py-2">
                          <div className="min-w-0">
                            <div className="ui-text-sm truncate text-foreground">
                              {selectedStep?.name ?? job.name}
                            </div>
                            <div className="ui-text-sm text-subtle-foreground">
                              {selectedStep
                                ? getWorkflowRunStatus(selectedStep.status, selectedStep.conclusion)
                                    .label
                                : getWorkflowRunStatus(job.status, job.conclusion).label}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {isLogSearchVisible ? (
                              <Input
                                value={logSearchQuery}
                                onChange={(event) => setLogSearchQuery(event.target.value)}
                                className="w-40 bg-surface/40"
                                placeholder="Search logs"
                                aria-label="Search logs"
                              />
                            ) : null}
                            <Button
                              type="button"
                              onClick={handleToggleLogSearch}
                              variant="ghost"
                              iconOnly
                              tooltip={isLogSearchVisible ? "Hide log search" : "Search logs"}
                            >
                              <Search />
                            </Button>
                            {job.id ? (
                              <Button
                                type="button"
                                onClick={() => void loadJobLogs(job.id!, true)}
                                variant="ghost"
                                iconOnly
                                tooltip="Refresh job logs"
                                disabled={!areJobLogsDownloadable(job)}
                              >
                                {loadingJobLogId === job.id ? (
                                  <Spinner label="Loading job logs" compact />
                                ) : (
                                  <RefreshCw />
                                )}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              onClick={handleCopySelectedLogs}
                              variant="ghost"
                              tooltip="Copy job logs"
                              disabled={!job.id || !selectedStepLogs}
                              iconOnly
                            >
                              <Copy />
                            </Button>
                          </div>
                        </div>

                        <div className="max-h-[52vh] overflow-auto p-3">
                          {!areJobLogsDownloadable(job) ? (
                            <p className="ui-text-sm text-subtle-foreground">
                              Logs are available after this job finishes.
                            </p>
                          ) : job.id && loadingJobLogId === job.id && !jobLogs[job.id] ? (
                            <div className="ui-text-sm flex items-center gap-2 text-subtle-foreground">
                              <Spinner label="Loading logs" showLabel compact />
                            </div>
                          ) : job.id && jobLogErrors[job.id] ? (
                            <div className="space-y-2">
                              <p className="ui-text-sm text-destructive">{jobLogErrors[job.id]}</p>
                              <Button
                                type="button"
                                onClick={() => void loadJobLogs(job.id!, true)}
                                variant="default"
                                className="border border-destructive/40 text-destructive/90 hover:bg-destructive/10"
                              >
                                Retry
                              </Button>
                            </div>
                          ) : filteredStepLogs ? (
                            <pre className="ui-text-sm whitespace-pre-wrap wrap-break-word font-mono leading-5 text-muted-foreground">
                              {filteredStepLogs.split(/\r?\n/).map((line, lineIndex, lines) => (
                                <span key={`${lineIndex}-${line}`}>
                                  {getLogLineSegments(line, logSearchQuery).map(
                                    (segment, segmentIndex) =>
                                      segment.isMatch ? (
                                        <mark
                                          key={segmentIndex}
                                          className="rounded bg-warning/20 px-0.5 text-foreground"
                                        >
                                          {segment.text}
                                        </mark>
                                      ) : (
                                        <span key={segmentIndex}>{segment.text}</span>
                                      ),
                                  )}
                                  {lineIndex < lines.length - 1 ? "\n" : null}
                                </span>
                              ))}
                            </pre>
                          ) : hasLogSearchQuery && selectedStepLogs ? (
                            <Empty className="min-h-0 items-start rounded-none p-0 text-left">
                              <EmptyDescription>No log lines match this search.</EmptyDescription>
                            </Empty>
                          ) : (
                            <Empty className="min-h-0 items-start rounded-none p-0 text-left">
                              <EmptyDescription>No logs available for this step.</EmptyDescription>
                            </Empty>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
            {details.jobs.length > visibleJobs.length ? (
              <div className="px-1 py-2">
                <Spinner
                  label={`Loading ${details.jobs.length - visibleJobs.length} more jobs`}
                  showLabel
                  compact
                />
              </div>
            ) : null}
          </div>
        </GitHubViewerBody>
      ) : (
        <ViewerLoadingState label="Loading action run" layout="section" />
      )}
    </GitHubViewerShell>
  );
});

GitHubActionViewer.displayName = "GitHubActionViewer";

export default GitHubActionViewer;
