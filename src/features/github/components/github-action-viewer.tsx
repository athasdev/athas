import { openExternalUrl } from "@/utils/external-url";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  BoltIcon,
  ChevronDownIcon,
  OpenExternalIcon,
  StopIcon,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { openCommitDiffBuffer } from "@/features/git/services/open-commit-diff-buffer";
import { ViewerErrorState, ViewerLoadingState } from "@/ui/viewer-state";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Progress } from "@/ui/progress";
import { ResourceActionsMenu, ResourceSummary, ResourceWorkspace } from "@/ui/resource";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { saveTextFileWithDialog } from "@/utils/file-dialogs";
import { fetchWorkflowJobLogs, resolveNotificationWorkflowRun } from "../api/github-actions-api";
import { useNow } from "../hooks/use-now";
import { useWorkflowRunActions } from "../hooks/use-workflow-run-actions";
import { useGitHubActionsStore } from "../stores/github-actions.store";
import type {
  GitHubActionNotificationTarget,
  WorkflowRunDetails,
  WorkflowRunJob,
  WorkflowRunListItem,
} from "../types/github.types";
import { githubKeys, workflowRunDetailsQuery, workflowRunsQuery } from "../services/github-queries";
import { getQueryErrorMessage } from "@/utils/query-client";
import {
  getGitHubWorkflowRunsUrl,
  getRepositoryUrlFromEntityUrl,
} from "../utils/github-link-utils";
import { copyToClipboard, getTimeAgo } from "../services/github-viewer-utils";
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
import { GitHubBranchChip, GitHubCommitChip, GitHubMetaChip, GitHubUserChip } from "./github-chips";
import {
  WORKFLOW_TONE_BADGE_TONE,
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

function getRunDetailsPollInterval(details: WorkflowRunDetails | undefined) {
  if (!details) return false;
  return getWorkflowRunState(details.status, details.conclusion).isActive
    ? ACTIVE_RUN_POLL_INTERVAL_MS
    : false;
}

const areJobLogsAvailable = (job: WorkflowRunJob | null) => {
  if (!job) return false;
  const state = getWorkflowRunState(job.status, job.conclusion);
  return state.phase !== "queued" && state.phase !== "waiting" && state.phase !== "skipped";
};

const GitHubActionViewer = memo((props: GitHubActionViewerProps) => {
  const { runId, notification, repoPath, bufferId } = props;
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const buffer = useBufferStore((state) => state.buffers.find((item) => item.id === bufferId));
  const { rerunRun, cancelRun } = useWorkflowRunActions();
  const pendingActions = useGitHubActionsStore.use.pendingActions();
  const queryClient = useQueryClient();
  const [resolvedRunId, setResolvedRunId] = useState<number | null>(runId ?? null);
  const selectListedRun = useCallback(
    (runs: WorkflowRunListItem[]) =>
      resolvedRunId === null
        ? null
        : (runs.find((run) => run.databaseId === resolvedRunId) ?? null),
    [resolvedRunId],
  );
  const listedRun =
    useQuery({
      ...workflowRunsQuery(repoPath ?? null),
      enabled: false,
      select: selectListedRun,
    }).data ?? null;
  const detailsQuery = useQuery({
    ...workflowRunDetailsQuery(repoPath ?? null, resolvedRunId),
    refetchInterval: (query) => getRunDetailsPollInterval(query.state.data),
  });
  const details = detailsQuery.data ?? null;
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const isLoading = isResolving || (detailsQuery.isFetching && !details);
  const isRefreshing = detailsQuery.isFetching && Boolean(details);
  // Background refreshes keep showing the last run they loaded; only a run that never loaded
  // shows its error.
  const error =
    resolveError ??
    (resolvedRunId !== null && !repoPath
      ? "No repository selected."
      : details
        ? null
        : getQueryErrorMessage(detailsQuery.error));
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

    setIsResolving(true);
    setResolveError(null);
    try {
      const run = await resolveNotificationWorkflowRun(
        notification.repositoryFullName,
        notification.checkSuiteId,
        notification.title,
        notification.updatedAt,
      );
      if (!run) {
        setResolveError("Could not match this notification to a GitHub Actions run.");
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
      setResolveError(describeError(nextError));
    } finally {
      setIsResolving(false);
    }
  }, [buffer, notification, repoPath, updateBuffer]);

  useEffect(() => {
    if (resolvedRunId !== null || !notification) return;
    void resolveNotification();
  }, [notification, resolveNotification, resolvedRunId]);

  const refreshWorkflowRun = useCallback(() => {
    if (!repoPath || resolvedRunId === null) return;
    void queryClient.invalidateQueries({
      queryKey: githubKeys.workflowRun(repoPath, resolvedRunId),
    });
  }, [queryClient, repoPath, resolvedRunId]);

  useEffect(() => {
    if (!details || !listedRun) return;
    const listedState = getWorkflowRunState(listedRun.status, listedRun.conclusion);
    const detailState = getWorkflowRunState(details.status, details.conclusion);
    if (listedState.phase !== detailState.phase || listedRun.runAttempt !== details.runAttempt) {
      refreshWorkflowRun();
    }
  }, [details, listedRun, refreshWorkflowRun]);

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
        const raw = await fetchWorkflowJobLogs(repoPath, jobId);
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
    void openExternalUrl(details.url);
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
      const filePath = await saveTextFileWithDialog(
        {
          defaultPath: `run-${details?.runNumber ?? resolvedRunId ?? "log"}-${subjectName}.log`,
          filters: [{ name: "Log", extensions: ["log", "txt"] }],
        },
        () => formatWorkflowLogText(visibleLines, showTimestamps),
      );
      if (!filePath) return;
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
    refreshWorkflowRun();
    if (selectedJobId !== null) void loadJobLogs(selectedJobId, true);
  }, [loadJobLogs, refreshWorkflowRun, resolveNotification, resolvedRunId, selectedJobId]);

  const repositoryUrl = getRepositoryUrlFromEntityUrl(details?.url);
  const handleOpenCommit = useCallback(async () => {
    if (!details?.headSha) return;
    if (repoPath) {
      const bufferId = await openCommitDiffBuffer({
        repoPath,
        commitHash: details.headSha,
        message: details.headCommitMessage ?? getWorkflowRunTitle(details),
        author: details.actor?.login ?? "",
        date: details.runStartedAt ?? details.createdAt ?? undefined,
      });
      if (bufferId) return;
    }
    if (repositoryUrl) void openExternalUrl(`${repositoryUrl}/commit/${details.headSha}`);
    else toast.error("Commit is not available.");
  }, [details, repoPath, repositoryUrl]);

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
          : "default";
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
        variant="ghost"
        tone="danger"
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
    <ResourceWorkspace
      summary={
        details ? (
          <ResourceSummary
            actions={
              <>
                {isRefreshing ? <Spinner label="Refreshing" compact /> : null}
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
                <ResourceActionsMenu label="Action run actions">
                  <DropdownMenuItem disabled={isLoading} onClick={handleRefresh}>
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyRunLink}>Copy link</DropdownMenuItem>
                  {details?.headSha ? (
                    <DropdownMenuItem
                      onClick={() =>
                        void copyToClipboard(details.headSha ?? "", "Commit SHA copied")
                      }
                    >
                      Copy commit SHA
                    </DropdownMenuItem>
                  ) : null}
                </ResourceActionsMenu>
              </>
            }
            icon={<WorkflowStatusIcon status={details.status} conclusion={details.conclusion} />}
            title={<span className="block truncate">{runTitle}</span>}
            badges={
              <>
                <Badge tone={WORKFLOW_TONE_BADGE_TONE[runState.tone]}>{runState.label}</Badge>
                {details.runAttempt && details.runAttempt > 1 ? (
                  <Badge tone="warning">Attempt {details.runAttempt}</Badge>
                ) : null}
              </>
            }
            description={
              details.headCommitMessage && details.headCommitMessage !== runTitle
                ? details.headCommitMessage
                : null
            }
            meta={
              <>
                {details.workflowName ? (
                  <GitHubMetaChip
                    icon={<BoltIcon />}
                    title={`Open ${details.workflowName} runs on GitHub`}
                    href={
                      repositoryUrl
                        ? getGitHubWorkflowRunsUrl(repositoryUrl, details.workflowName)
                        : null
                    }
                  >
                    {details.workflowName}
                  </GitHubMetaChip>
                ) : null}
                <GitHubMetaChip mono title="Open run on GitHub" href={details.url}>
                  {getWorkflowRunLabel(details)}
                </GitHubMetaChip>
                {details.headBranch ? (
                  <GitHubBranchChip name={details.headBranch} repositoryUrl={repositoryUrl} />
                ) : null}
                {details.headSha ? (
                  <GitHubCommitChip
                    sha={details.headSha}
                    repositoryUrl={repositoryUrl}
                    onOpen={() => void handleOpenCommit()}
                  />
                ) : null}
                {details.event ? (
                  <GitHubMetaChip title="Event">{details.event}</GitHubMetaChip>
                ) : null}
                {details.actor ? (
                  <GitHubUserChip
                    login={details.actor.login}
                    avatarUrl={details.actor.avatarUrl}
                    title={`Triggered by ${details.actor.login}. Open profile on GitHub`}
                  />
                ) : null}
                {startedLabel ? (
                  <GitHubMetaChip title={new Date(startedLabel).toLocaleString()}>
                    {runState.isActive ? "Started" : "Ran"} {getTimeAgo(startedLabel)}
                  </GitHubMetaChip>
                ) : null}
                {duration ? (
                  <GitHubMetaChip title={runState.isActive ? "Elapsed" : "Duration"}>
                    <span
                      className={cn(
                        "tabular-nums",
                        runState.isActive && WORKFLOW_TONE_TEXT_CLASS.accent,
                      )}
                    >
                      {duration}
                    </span>
                  </GitHubMetaChip>
                ) : null}
              </>
            }
            aside={
              jobSummary.total > 0 ? (
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
              ) : null
            }
          />
        ) : null
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
        <div className="flex min-h-0 flex-1 @max-[48rem]/resource:flex-col">
          <div className="flex w-72 shrink-0 flex-col border-border border-r bg-surface @max-[48rem]/resource:max-h-64 @max-[48rem]/resource:w-full @max-[48rem]/resource:border-r-0 @max-[48rem]/resource:border-b">
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
            onOpenOnGitHub={
              selectedJob?.url ? () => void openExternalUrl(selectedJob.url ?? "") : null
            }
          />
        </div>
      ) : (
        <ViewerLoadingState label="Loading action run" layout="fill" />
      )}
    </ResourceWorkspace>
  );
});

GitHubActionViewer.displayName = "GitHubActionViewer";

export default GitHubActionViewer;
