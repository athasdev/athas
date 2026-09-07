import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  BoltIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GitCommitIcon,
  OpenExternalIcon,
  StopIcon,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { ViewerErrorState, ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Progress } from "@/ui/progress";
import {
  ResourceViewer,
  ResourceViewerActionsMenu,
  ResourceViewerHeader,
  ResourceViewerTitle,
} from "@/ui/resource";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { useNow } from "../hooks/use-now";
import { getWorkflowRunsEntry, useGitHubActionsStore } from "../stores/github-actions.store";
import type {
  GitHubActionNotificationTarget,
  WorkflowRunDetails,
  WorkflowRunJob,
  WorkflowRunListItem,
} from "../types/github.types";
import { GITHUB_ACTION_DETAILS_TTL_MS, githubActionDetailsCache } from "../utils/github-data-cache";
import { copyToClipboard, getTimeAgo } from "../utils/github-viewer-utils";
import {
  filterWorkflowLog,
  findFirstProblemLine,
  formatWorkflowLogText,
  mapWorkflowLogToSteps,
  parseWorkflowLog,
  sliceWorkflowLog,
  type WorkflowLogLine,
} from "../utils/github-workflow-logs";
import {
  formatWorkflowDuration,
  getWorkflowRunLabel,
  getWorkflowRunState,
  getWorkflowRunTiming,
  getWorkflowRunTitle,
  pickInitialWorkflowJob,
  pickInitialWorkflowStepIndex,
  summarizeWorkflowJobs,
} from "../utils/github-workflow-status";
import { GitHubActionJobsPanel } from "./github-action-jobs-panel";
import { GitHubActionLogPanel } from "./github-action-log-panel";
import { GitHubAvatar } from "./github-avatar";
import {
  WORKFLOW_TONE_BADGE_VARIANT,
  WORKFLOW_TONE_TEXT_CLASS,
  WorkflowStatusIcon,
} from "./github-workflow-status-icon";

interface GitHubActionViewerProps {
  runId?: number;
  notification?: GitHubActionNotificationTarget;
  repoPath?: string;
  bufferId: string;
}

interface JobLogState {
  lines: WorkflowLogLine[];
  fetchedAt: number;
}

const ACTIVE_RUN_POLL_INTERVAL_MS = 15_000;
const ACTIVE_LOG_POLL_INTERVAL_MS = 15_000;

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

const areJobLogsAvailable = (job: WorkflowRunJob | null) => {
  if (!job) return false;
  const state = getWorkflowRunState(job.status, job.conclusion);
  return state.phase !== "queued" && state.phase !== "waiting" && state.phase !== "skipped";
};

function MetaChip({
  icon,
  children,
  mono,
  title,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-subtle-foreground ui-text-sm",
        mono && "font-mono",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

const GitHubActionViewer = memo((props: GitHubActionViewerProps) => {
  const { runId, notification, repoPath, bufferId } = props;
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const buffer = useBufferStore((state) => state.buffers.find((item) => item.id === bufferId));
  const { rerunRun, cancelRun } = useGitHubActionsStore.use.actions();
  const pendingActions = useGitHubActionsStore.use.pendingActions();
  const [resolvedRunId, setResolvedRunId] = useState<number | null>(runId ?? null);
  const listedRun = useGitHubActionsStore((state) =>
    resolvedRunId === null
      ? null
      : (getWorkflowRunsEntry(state.entries, repoPath ?? null).runs.find(
          (run) => run.databaseId === resolvedRunId,
        ) ?? null),
  );
  const [details, setDetails] = useState<WorkflowRunDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [jobLogs, setJobLogs] = useState<Record<number, JobLogState>>({});
  const [jobLogErrors, setJobLogErrors] = useState<Record<number, string>>({});
  const [loadingJobLogId, setLoadingJobLogId] = useState<number | null>(null);
  const [logQuery, setLogQuery] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);
  const [highlightLineIndex, setHighlightLineIndex] = useState<number | null>(null);

  const runState = useMemo(
    () => getWorkflowRunState(details?.status, details?.conclusion),
    [details?.conclusion, details?.status],
  );
  const now = useNow(1_000, runState.isActive);
  const jobs = details?.jobs ?? [];
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const selectedJobState = selectedJob
    ? getWorkflowRunState(selectedJob.status, selectedJob.conclusion)
    : null;
  const selectedStep =
    selectedJob && selectedStepIndex !== null
      ? (selectedJob.steps[selectedStepIndex] ?? null)
      : null;
  const jobSummary = useMemo(() => summarizeWorkflowJobs(jobs), [jobs]);
  const pendingAction = resolvedRunId === null ? undefined : pendingActions[resolvedRunId];

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
          name: getWorkflowRunTitle(run),
          url: run.url,
        });
      }
    } catch (nextError) {
      setError(describeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }, [buffer, notification, repoPath, updateBuffer]);

  useEffect(() => {
    if (resolvedRunId !== null || !notification) return;
    void resolveNotification();
  }, [notification, resolveNotification, resolvedRunId]);

  const fetchWorkflowRun = useCallback(
    async (options: { force?: boolean; quiet?: boolean } = {}) => {
      if (resolvedRunId === null) return;
      if (!repoPath) {
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cacheKey = `${repoPath}::${resolvedRunId}`;
      const cached = githubActionDetailsCache.getFreshValue(cacheKey, GITHUB_ACTION_DETAILS_TTL_MS);
      if (cached && !options.force) {
        setDetails(cached);
        setError(null);
        setIsLoading(false);
        if (!getWorkflowRunState(cached.status, cached.conclusion).isActive) return;
      }

      const stale = githubActionDetailsCache.getSnapshot(cacheKey)?.value;
      if (stale && !options.force) setDetails(stale);

      if (options.quiet) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      try {
        const nextDetails = await githubActionDetailsCache.load(
          cacheKey,
          () =>
            invoke<WorkflowRunDetails>("github_get_workflow_run_details", {
              repoPath,
              runId: resolvedRunId,
            }),
          { force: true, ttlMs: GITHUB_ACTION_DETAILS_TTL_MS },
        );
        setDetails(nextDetails);
        setError(null);
      } catch (nextError) {
        if (!options.quiet) setError(describeError(nextError));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [repoPath, resolvedRunId],
  );

  useEffect(() => {
    void fetchWorkflowRun();
  }, [fetchWorkflowRun]);

  useEffect(() => {
    if (!runState.isActive || !details) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchWorkflowRun({ force: true, quiet: true });
      }
    }, ACTIVE_RUN_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [details, fetchWorkflowRun, runState.isActive]);

  useEffect(() => {
    if (!details || !listedRun) return;
    const listedState = getWorkflowRunState(listedRun.status, listedRun.conclusion);
    const detailState = getWorkflowRunState(details.status, details.conclusion);
    if (listedState.phase !== detailState.phase || listedRun.runAttempt !== details.runAttempt) {
      void fetchWorkflowRun({ force: true, quiet: true });
    }
  }, [details, fetchWorkflowRun, listedRun]);

  useEffect(() => {
    if (!details || !buffer || buffer.type !== "githubAction") return;

    const nextName = getWorkflowRunTitle(details);
    if (buffer.name === nextName && buffer.url === details.url) return;

    updateBuffer({ ...buffer, name: nextName, url: details.url });
  }, [buffer, details, updateBuffer]);

  useEffect(() => {
    setSelectedJobId(null);
    setSelectedStepIndex(null);
    setJobLogs({});
    setJobLogErrors({});
    setLoadingJobLogId(null);
    setLogQuery("");
    setHighlightLineIndex(null);
  }, [details?.databaseId]);

  useEffect(() => {
    if (!details || selectedJobId !== null) return;
    const initialJob = pickInitialWorkflowJob(details.jobs);
    if (!initialJob || initialJob.id == null) return;
    setSelectedJobId(initialJob.id);
    setSelectedStepIndex(pickInitialWorkflowStepIndex(initialJob.steps));
  }, [details, selectedJobId]);

  const loadJobLogs = useCallback(
    async (jobId: number, force = false) => {
      if (!repoPath) return;
      const job = details?.jobs.find((item) => item.id === jobId) ?? null;
      if (!areJobLogsAvailable(job)) return;
      if (jobLogs[jobId] && !force) return;

      setLoadingJobLogId(jobId);
      setJobLogErrors((current) => {
        const next = { ...current };
        delete next[jobId];
        return next;
      });

      try {
        const raw = await invoke<string>("github_get_workflow_job_logs", { repoPath, jobId });
        setJobLogs((current) => ({
          ...current,
          [jobId]: { lines: parseWorkflowLog(raw), fetchedAt: Date.now() },
        }));
      } catch (nextError) {
        setJobLogErrors((current) => ({ ...current, [jobId]: describeError(nextError) }));
      } finally {
        setLoadingJobLogId((current) => (current === jobId ? null : current));
      }
    },
    [details?.jobs, jobLogs, repoPath],
  );

  useEffect(() => {
    if (selectedJobId === null) return;
    void loadJobLogs(selectedJobId);
  }, [loadJobLogs, selectedJobId]);

  useEffect(() => {
    if (selectedJobId === null || !selectedJobState?.isActive) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadJobLogs(selectedJobId, true);
    }, ACTIVE_LOG_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadJobLogs, selectedJobId, selectedJobState?.isActive]);

  // Fetch the final log exactly once when the selected job goes from running
  // to finished. Keyed on the transition rather than on fetch timestamps so a
  // fast response can never schedule another fetch.
  const selectedJobIsActive = selectedJobState?.isActive ?? false;
  const previousJobActivityRef = useRef<{ jobId: number | null; isActive: boolean }>({
    jobId: null,
    isActive: false,
  });
  useEffect(() => {
    const previous = previousJobActivityRef.current;
    previousJobActivityRef.current = { jobId: selectedJobId, isActive: selectedJobIsActive };
    if (selectedJobId === null || previous.jobId !== selectedJobId) return;
    if (previous.isActive && !selectedJobIsActive) void loadJobLogs(selectedJobId, true);
  }, [loadJobLogs, selectedJobId, selectedJobIsActive]);

  const jobLogLines = selectedJobId !== null ? (jobLogs[selectedJobId]?.lines ?? []) : [];
  const stepRanges = useMemo(
    () => (selectedJob ? mapWorkflowLogToSteps(jobLogLines, selectedJob.steps) : []),
    [jobLogLines, selectedJob],
  );
  const stepLines = useMemo(
    () =>
      sliceWorkflowLog(
        jobLogLines,
        selectedStepIndex !== null ? (stepRanges[selectedStepIndex] ?? null) : null,
      ),
    [jobLogLines, selectedStepIndex, stepRanges],
  );
  const visibleLines = useMemo(() => filterWorkflowLog(stepLines, logQuery), [logQuery, stepLines]);

  useEffect(() => {
    if (logQuery.trim()) {
      setHighlightLineIndex(null);
      return;
    }
    const subject = selectedStep ?? selectedJob;
    const shouldHighlight = subject
      ? getWorkflowRunState(subject.status, subject.conclusion).isFailed
      : false;
    setHighlightLineIndex(shouldHighlight ? findFirstProblemLine(stepLines) : null);
  }, [logQuery, selectedJob, selectedStep, stepLines]);

  const handleSelectJob = useCallback((job: WorkflowRunJob) => {
    if (job.id == null) return;
    setSelectedJobId(job.id);
    setSelectedStepIndex(pickInitialWorkflowStepIndex(job.steps));
    setLogQuery("");
  }, []);

  const handleSelectStep = useCallback((job: WorkflowRunJob, stepIndex: number) => {
    if (job.id == null) return;
    setSelectedJobId(job.id);
    setSelectedStepIndex(stepIndex);
  }, []);

  const runAction = useCallback(async (task: () => Promise<boolean>, successMessage: string) => {
    try {
      await task();
      toast.success(successMessage);
    } catch (actionError) {
      toast.error(describeError(actionError));
    }
  }, []);

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

  const handleCopyLogs = useCallback(() => {
    if (visibleLines.length === 0) {
      toast.error("No log lines to copy.");
      return;
    }
    void copyToClipboard(formatWorkflowLogText(visibleLines, showTimestamps), "Logs copied");
  }, [showTimestamps, visibleLines]);

  const handleExportLogs = useCallback(async () => {
    if (visibleLines.length === 0) {
      toast.error("No log lines to export.");
      return;
    }
    const subjectName = (selectedStep?.name ?? selectedJob?.name ?? "job").replace(
      /[^a-zA-Z0-9_-]+/g,
      "_",
    );
    try {
      const filePath = await save({
        defaultPath: `run-${details?.runNumber ?? resolvedRunId ?? "log"}-${subjectName}.log`,
        filters: [{ name: "Log", extensions: ["log", "txt"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, formatWorkflowLogText(visibleLines, showTimestamps));
      toast.success("Log exported");
    } catch (exportError) {
      toast.error(describeError(exportError));
    }
  }, [
    details?.runNumber,
    resolvedRunId,
    selectedJob?.name,
    selectedStep?.name,
    showTimestamps,
    visibleLines,
  ]);

  const handleRefresh = useCallback(() => {
    if (resolvedRunId === null) {
      void resolveNotification();
      return;
    }
    void fetchWorkflowRun({ force: true, quiet: Boolean(details) });
    if (selectedJobId !== null) void loadJobLogs(selectedJobId, true);
  }, [details, fetchWorkflowRun, loadJobLogs, resolveNotification, resolvedRunId, selectedJobId]);

  const runTitle = details
    ? getWorkflowRunTitle(details)
    : (buffer?.name ?? (resolvedRunId === null ? "Resolving action run" : `Run #${resolvedRunId}`));
  const timing = details ? getWorkflowRunTiming(details, now) : null;
  const duration = timing ? formatWorkflowDuration(timing.durationMs) : null;
  const startedLabel = details?.runStartedAt ?? details?.createdAt;
  const progressValue =
    jobSummary.total > 0 ? Math.round((jobSummary.completed / jobSummary.total) * 100) : 0;
  const progressTone =
    jobSummary.failed > 0
      ? "error"
      : runState.phase === "success"
        ? "success"
        : runState.isActive
          ? "accent"
          : "muted";
  const jobsLabel =
    jobSummary.failed > 0
      ? `${jobSummary.failed} of ${jobSummary.total} jobs failed`
      : runState.isActive
        ? `${jobSummary.completed} of ${jobSummary.total} jobs finished`
        : `${jobSummary.succeeded} of ${jobSummary.total} jobs passed`;

  const rerunButton =
    details && repoPath && !runState.isActive ? (
      runState.isFailed ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="default" disabled={Boolean(pendingAction)} />}
          >
            {pendingAction ? <Spinner label="Working" compact /> : <ArrowClockwiseIcon />}
            Re-run
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                void runAction(
                  () => rerunRun(repoPath, details.databaseId, true),
                  "Re-run of failed jobs queued",
                )
              }
            >
              <ArrowCounterClockwiseIcon />
              Re-run failed jobs
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void runAction(() => rerunRun(repoPath, details.databaseId, false), "Re-run queued")
              }
            >
              <ArrowClockwiseIcon />
              Re-run all jobs
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="default"
          disabled={Boolean(pendingAction)}
          onClick={() =>
            void runAction(() => rerunRun(repoPath, details.databaseId, false), "Re-run queued")
          }
        >
          {pendingAction ? <Spinner label="Working" compact /> : <ArrowClockwiseIcon />}
          Re-run
        </Button>
      )
    ) : null;

  const cancelButton =
    details && repoPath && runState.isActive ? (
      <Button
        type="button"
        variant="danger"
        disabled={Boolean(pendingAction)}
        onClick={() =>
          void runAction(() => cancelRun(repoPath, details.databaseId), "Cancellation requested")
        }
      >
        {pendingAction ? <Spinner label="Working" compact /> : <StopIcon />}
        Cancel
      </Button>
    ) : null;

  return (
    <ResourceViewer
      scrollMode="workspace"
      header={
        <ResourceViewerHeader
          title={
            <ResourceViewerTitle
              ariaLabel="GitHub action run"
              kind="Workflow run"
              number={details?.runNumber ?? resolvedRunId ?? undefined}
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
            details ? (
              <>
                <span className={WORKFLOW_TONE_TEXT_CLASS[runState.tone]}>{runState.label}</span>
                {jobSummary.total > 0 ? (
                  <>
                    <span>&middot;</span>
                    <span>{jobsLabel}</span>
                  </>
                ) : null}
                {isRefreshing ? <Spinner label="Refreshing" compact /> : null}
              </>
            ) : null
          }
          actions={
            <>
              {cancelButton}
              {rerunButton}
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="Open on GitHub"
                onClick={handleOpenInBrowser}
                disabled={!details?.url}
              >
                <OpenExternalIcon />
              </Button>
              <ResourceViewerActionsMenu label="Action run actions">
                <DropdownMenuItem disabled={isLoading} onClick={handleRefresh}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyRunLink}>Copy link</DropdownMenuItem>
                {details?.headSha ? (
                  <DropdownMenuItem
                    onClick={() => void copyToClipboard(details.headSha ?? "", "Commit SHA copied")}
                  >
                    Copy commit SHA
                  </DropdownMenuItem>
                ) : null}
              </ResourceViewerActionsMenu>
            </>
          }
        />
      }
    >
      {error ? (
        <ViewerErrorState
          message={error}
          actionLabel="Retry"
          onAction={handleRefresh}
          layout="fill"
        />
      ) : details ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-3 border-border/60 border-b px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1 basis-80">
              <div className="flex min-w-0 items-center gap-2">
                <WorkflowStatusIcon
                  status={details.status}
                  conclusion={details.conclusion}
                  className="shrink-0 [&_svg]:size-5"
                />
                <h1 className="min-w-0 truncate font-semibold text-foreground ui-text-lg">
                  {runTitle}
                </h1>
                <Badge variant={WORKFLOW_TONE_BADGE_VARIANT[runState.tone]}>{runState.label}</Badge>
                {details.runAttempt && details.runAttempt > 1 ? (
                  <Badge variant="warning">Attempt {details.runAttempt}</Badge>
                ) : null}
              </div>
              {details.headCommitMessage && details.headCommitMessage !== runTitle ? (
                <p className="mt-1 truncate text-subtle-foreground ui-text-sm">
                  {details.headCommitMessage}
                </p>
              ) : null}
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                {details.workflowName ? (
                  <MetaChip icon={<BoltIcon />} title="Workflow">
                    {details.workflowName}
                  </MetaChip>
                ) : null}
                <MetaChip title="Run number" mono>
                  {getWorkflowRunLabel(details)}
                </MetaChip>
                {details.headBranch ? (
                  <MetaChip icon={<GitBranchIcon />} title="Branch" mono>
                    {details.headBranch}
                  </MetaChip>
                ) : null}
                {details.headSha ? (
                  <MetaChip icon={<GitCommitIcon />} title="Commit" mono>
                    {details.headSha.slice(0, 7)}
                  </MetaChip>
                ) : null}
                {details.event ? <MetaChip title="Event">{details.event}</MetaChip> : null}
                {details.actor ? (
                  <MetaChip
                    title="Triggered by"
                    icon={
                      <GitHubAvatar
                        login={details.actor.login}
                        avatarUrl={details.actor.avatarUrl}
                        size={32}
                        className="size-4"
                      />
                    }
                  >
                    {details.actor.login}
                  </MetaChip>
                ) : null}
                {startedLabel ? (
                  <MetaChip title={new Date(startedLabel).toLocaleString()}>
                    {runState.isActive ? "Started" : "Ran"} {getTimeAgo(startedLabel)}
                  </MetaChip>
                ) : null}
                {duration ? (
                  <MetaChip title={runState.isActive ? "Elapsed" : "Duration"}>
                    <span
                      className={cn(
                        "tabular-nums",
                        runState.isActive && WORKFLOW_TONE_TEXT_CLASS.accent,
                      )}
                    >
                      {duration}
                    </span>
                  </MetaChip>
                ) : null}
              </div>
            </div>
            {jobSummary.total > 0 ? (
              <div className="w-full max-w-80 shrink-0 basis-72">
                <Progress
                  value={progressValue}
                  tone={progressTone}
                  aria-label="Job progress"
                  className="gap-1.5"
                >
                  <div className="flex w-full items-center justify-between gap-2 text-subtle-foreground ui-text-sm">
                    <span className="truncate">{jobsLabel}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      {jobSummary.failed > 0 ? (
                        <span className={WORKFLOW_TONE_TEXT_CLASS.error}>
                          {jobSummary.failed} failed
                        </span>
                      ) : null}
                      {jobSummary.running > 0 ? (
                        <span className={WORKFLOW_TONE_TEXT_CLASS.accent}>
                          {jobSummary.running} running
                        </span>
                      ) : null}
                      {jobSummary.queued > 0 ? (
                        <span className={WORKFLOW_TONE_TEXT_CLASS.warning}>
                          {jobSummary.queued} queued
                        </span>
                      ) : null}
                      {jobSummary.succeeded > 0 ? (
                        <span className={WORKFLOW_TONE_TEXT_CLASS.success}>
                          {jobSummary.succeeded} passed
                        </span>
                      ) : null}
                    </span>
                  </div>
                </Progress>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 @max-[48rem]/resource-viewer:flex-col">
            <div className="flex w-72 shrink-0 flex-col border-border/60 border-r bg-surface/35 @max-[48rem]/resource-viewer:max-h-64 @max-[48rem]/resource-viewer:w-full @max-[48rem]/resource-viewer:border-r-0 @max-[48rem]/resource-viewer:border-b">
              <GitHubActionJobsPanel
                jobs={jobs}
                selectedJobId={selectedJobId}
                selectedStepIndex={selectedStepIndex}
                now={now}
                onSelectJob={handleSelectJob}
                onSelectStep={handleSelectStep}
              />
            </div>
            <GitHubActionLogPanel
              job={selectedJob}
              step={selectedStep}
              lines={visibleLines}
              now={now}
              repoPath={repoPath ?? null}
              isLoading={selectedJobId !== null && loadingJobLogId === selectedJobId}
              isLogsAvailable={areJobLogsAvailable(selectedJob)}
              error={selectedJobId !== null ? (jobLogErrors[selectedJobId] ?? null) : null}
              query={logQuery}
              onQueryChange={setLogQuery}
              showTimestamps={showTimestamps}
              onToggleTimestamps={() => setShowTimestamps((value) => !value)}
              wrap={wrapLines}
              onToggleWrap={() => setWrapLines((value) => !value)}
              highlightLineIndex={highlightLineIndex}
              isLive={Boolean(selectedJobState?.isActive)}
              onRefresh={() => selectedJobId !== null && void loadJobLogs(selectedJobId, true)}
              onCopy={handleCopyLogs}
              onExport={() => void handleExportLogs()}
              onOpenOnGitHub={selectedJob?.url ? () => void openUrl(selectedJob.url ?? "") : null}
            />
          </div>
        </div>
      ) : (
        <ViewerLoadingState label="Loading action run" layout="fill" />
      )}
    </ResourceViewer>
  );
});

GitHubActionViewer.displayName = "GitHubActionViewer";

export default GitHubActionViewer;
