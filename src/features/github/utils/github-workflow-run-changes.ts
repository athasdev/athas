import type { WorkflowRunListItem } from "../types/github.types";
import { getWorkflowRunState } from "./github-workflow-status";

export type WorkflowRunChangeType = "started" | "completed";

export interface WorkflowRunChange {
  type: WorkflowRunChangeType;
  run: WorkflowRunListItem;
  previous: WorkflowRunListItem | null;
}

const DEFAULT_RECENT_WINDOW_MS = 10 * 60_000;

function isRecent(value: string | null, now: number, windowMs: number) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && now - time <= windowMs;
}

export function diffWorkflowRuns(
  previous: WorkflowRunListItem[] | null,
  next: WorkflowRunListItem[],
  options: { now?: number; recentWindowMs?: number } = {},
): WorkflowRunChange[] {
  if (!previous) return [];

  const now = options.now ?? Date.now();
  const recentWindowMs = options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const previousById = new Map(previous.map((run) => [run.databaseId, run]));
  const changes: WorkflowRunChange[] = [];

  for (const run of next) {
    const state = getWorkflowRunState(run.status, run.conclusion);
    const previousRun = previousById.get(run.databaseId) ?? null;

    if (!previousRun) {
      if (state.isActive) {
        changes.push({ type: "started", run, previous: null });
      } else if (isRecent(run.updatedAt, now, recentWindowMs)) {
        changes.push({ type: "completed", run, previous: null });
      }
      continue;
    }

    const previousState = getWorkflowRunState(previousRun.status, previousRun.conclusion);
    const attemptChanged =
      run.runAttempt !== null &&
      previousRun.runAttempt !== null &&
      run.runAttempt !== previousRun.runAttempt;

    if (state.isActive && (!previousState.isActive || attemptChanged)) {
      changes.push({ type: "started", run, previous: previousRun });
    } else if (!state.isActive && previousState.isActive) {
      changes.push({ type: "completed", run, previous: previousRun });
    }
  }

  return changes;
}
