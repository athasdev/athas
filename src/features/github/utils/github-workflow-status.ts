import type { WorkflowRunJob, WorkflowRunStep, WorkflowRunSummary } from "../types/github.types";

export type WorkflowRunTone = "success" | "error" | "warning" | "accent" | "muted";

export type WorkflowRunPhase =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "action-required"
  | "neutral"
  | "running"
  | "queued"
  | "waiting"
  | "unknown";

export interface WorkflowRunState {
  phase: WorkflowRunPhase;
  label: string;
  tone: WorkflowRunTone;
  isActive: boolean;
  isFailed: boolean;
}

const ACTIVE_STATUSES = new Set(["queued", "pending", "requested", "in_progress", "waiting"]);
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

function humanize(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

export function getWorkflowRunState(
  status?: string | null,
  conclusion?: string | null,
): WorkflowRunState {
  const normalizedStatus = status?.toLowerCase() ?? "";
  const normalizedConclusion = conclusion?.toLowerCase() ?? "";

  if (normalizedConclusion === "success") {
    return {
      phase: "success",
      label: "Success",
      tone: "success",
      isActive: false,
      isFailed: false,
    };
  }
  if (FAILED_CONCLUSIONS.has(normalizedConclusion)) {
    return {
      phase: "failure",
      label: normalizedConclusion === "timed_out" ? "Timed out" : "Failed",
      tone: "error",
      isActive: false,
      isFailed: true,
    };
  }
  if (normalizedConclusion === "cancelled") {
    return {
      phase: "cancelled",
      label: "Cancelled",
      tone: "muted",
      isActive: false,
      isFailed: false,
    };
  }
  if (normalizedConclusion === "skipped") {
    return { phase: "skipped", label: "Skipped", tone: "muted", isActive: false, isFailed: false };
  }
  if (normalizedConclusion === "action_required") {
    return {
      phase: "action-required",
      label: "Action required",
      tone: "warning",
      isActive: false,
      isFailed: false,
    };
  }
  if (normalizedConclusion === "neutral" || normalizedConclusion === "stale") {
    return {
      phase: "neutral",
      label: humanize(normalizedConclusion),
      tone: "muted",
      isActive: false,
      isFailed: false,
    };
  }
  if (normalizedStatus === "in_progress") {
    return { phase: "running", label: "Running", tone: "accent", isActive: true, isFailed: false };
  }
  if (normalizedStatus === "waiting") {
    return { phase: "waiting", label: "Waiting", tone: "warning", isActive: true, isFailed: false };
  }
  if (ACTIVE_STATUSES.has(normalizedStatus)) {
    return { phase: "queued", label: "Queued", tone: "warning", isActive: true, isFailed: false };
  }

  return {
    phase: "unknown",
    label: humanize(normalizedConclusion || normalizedStatus),
    tone: "muted",
    isActive: false,
    isFailed: false,
  };
}

export function isWorkflowRunActive(run: Pick<WorkflowRunSummary, "status" | "conclusion">) {
  return getWorkflowRunState(run.status, run.conclusion).isActive;
}

export function isWorkflowRunFailed(run: Pick<WorkflowRunSummary, "status" | "conclusion">) {
  return getWorkflowRunState(run.status, run.conclusion).isFailed;
}

export function getWorkflowRunTitle(
  run: Pick<WorkflowRunSummary, "displayTitle" | "name" | "workflowName" | "databaseId">,
) {
  return run.displayTitle || run.name || run.workflowName || `Run #${run.databaseId}`;
}

export function getWorkflowRunLabel(run: Pick<WorkflowRunSummary, "runNumber" | "databaseId">) {
  return `#${run.runNumber ?? run.databaseId}`;
}

function toTime(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function formatWorkflowDuration(durationMs: number | null) {
  if (durationMs === null || durationMs < 0) return null;

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export interface WorkflowTiming {
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  isLive: boolean;
}

function getTiming(
  startedAtValue: string | null | undefined,
  completedAtValue: string | null | undefined,
  isActive: boolean,
  now: number,
): WorkflowTiming {
  const startedAt = toTime(startedAtValue);
  const endedAt = isActive ? null : toTime(completedAtValue);

  if (startedAt === null) {
    return { startedAt: null, endedAt, durationMs: null, isLive: false };
  }

  const end = isActive ? now : endedAt;
  return {
    startedAt,
    endedAt,
    durationMs: end === null ? null : Math.max(0, end - startedAt),
    isLive: isActive,
  };
}

export function getWorkflowRunTiming(
  run: Pick<
    WorkflowRunSummary,
    "status" | "conclusion" | "runStartedAt" | "createdAt" | "updatedAt"
  >,
  now = Date.now(),
): WorkflowTiming {
  const state = getWorkflowRunState(run.status, run.conclusion);
  return getTiming(run.runStartedAt ?? run.createdAt, run.updatedAt, state.isActive, now);
}

export function getWorkflowJobTiming(
  job: Pick<WorkflowRunJob, "status" | "conclusion" | "startedAt" | "completedAt">,
  now = Date.now(),
): WorkflowTiming {
  const state = getWorkflowRunState(job.status, job.conclusion);
  return getTiming(job.startedAt, job.completedAt, state.isActive, now);
}

export function getWorkflowStepTiming(
  step: Pick<WorkflowRunStep, "status" | "conclusion" | "startedAt" | "completedAt">,
  now = Date.now(),
): WorkflowTiming {
  const state = getWorkflowRunState(step.status, step.conclusion);
  return getTiming(step.startedAt, step.completedAt, state.isActive, now);
}

export interface WorkflowJobSummary {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  skipped: number;
  cancelled: number;
  completed: number;
}

export function summarizeWorkflowJobs(jobs: WorkflowRunJob[]): WorkflowJobSummary {
  const summary: WorkflowJobSummary = {
    total: jobs.length,
    succeeded: 0,
    failed: 0,
    running: 0,
    queued: 0,
    skipped: 0,
    cancelled: 0,
    completed: 0,
  };

  for (const job of jobs) {
    const state = getWorkflowRunState(job.status, job.conclusion);
    if (state.phase === "success") summary.succeeded += 1;
    else if (state.isFailed) summary.failed += 1;
    else if (state.phase === "running") summary.running += 1;
    else if (state.isActive) summary.queued += 1;
    else if (state.phase === "skipped") summary.skipped += 1;
    else if (state.phase === "cancelled") summary.cancelled += 1;
    if (!state.isActive) summary.completed += 1;
  }

  return summary;
}

export function pickInitialWorkflowJob(jobs: WorkflowRunJob[]): WorkflowRunJob | null {
  return (
    jobs.find((job) => isWorkflowRunFailed(job)) ??
    jobs.find((job) => getWorkflowRunState(job.status, job.conclusion).phase === "running") ??
    jobs.find((job) => isWorkflowRunActive(job)) ??
    jobs[0] ??
    null
  );
}

export function pickInitialWorkflowStepIndex(steps: WorkflowRunStep[]): number | null {
  if (steps.length === 0) return null;

  const failedIndex = steps.findIndex((step) => isWorkflowRunFailed(step));
  if (failedIndex >= 0) return failedIndex;

  const runningIndex = steps.findIndex(
    (step) => getWorkflowRunState(step.status, step.conclusion).phase === "running",
  );
  if (runningIndex >= 0) return runningIndex;

  return 0;
}
