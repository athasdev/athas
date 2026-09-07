import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type { WorkflowRunListItem } from "../types/github.types";

export const GITHUB_ACTION_RUNS_TTL_MS = 60_000;

export interface WorkflowRunsEntry {
  runs: WorkflowRunListItem[];
  fetchedAt: number | null;
  isLoading: boolean;
  error: string | null;
}

export type WorkflowRunPendingAction = "rerun" | "rerun-failed" | "cancel";

interface GitHubActionsState {
  entries: Record<string, WorkflowRunsEntry>;
  pendingActions: Record<number, WorkflowRunPendingAction>;
  actions: {
    loadRuns: (
      repoPath: string,
      options?: { force?: boolean; quiet?: boolean },
    ) => Promise<WorkflowRunListItem[] | null>;
    invalidateRuns: (repoPath: string) => void;
    rerunRun: (repoPath: string, runId: number, failedJobsOnly: boolean) => Promise<boolean>;
    cancelRun: (repoPath: string, runId: number) => Promise<boolean>;
  };
}

const EMPTY_ENTRY: WorkflowRunsEntry = { runs: [], fetchedAt: null, isLoading: false, error: null };
const inflightLoads = new Map<string, Promise<WorkflowRunListItem[] | null>>();

export function getWorkflowRunsEntry(
  entries: Record<string, WorkflowRunsEntry>,
  repoPath: string | null,
): WorkflowRunsEntry {
  return (repoPath && entries[repoPath]) || EMPTY_ENTRY;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useGitHubActionsStore = createSelectors(
  create<GitHubActionsState>()((set, get) => {
    const patchEntry = (repoPath: string, patch: Partial<WorkflowRunsEntry>) =>
      set((state) => ({
        entries: {
          ...state.entries,
          [repoPath]: { ...getWorkflowRunsEntry(state.entries, repoPath), ...patch },
        },
      }));

    const withPendingAction = async (
      runId: number,
      action: WorkflowRunPendingAction,
      task: () => Promise<void>,
    ) => {
      set((state) => ({ pendingActions: { ...state.pendingActions, [runId]: action } }));
      try {
        await task();
        return true;
      } catch (error) {
        throw new Error(describeError(error));
      } finally {
        set((state) => {
          const pendingActions = { ...state.pendingActions };
          delete pendingActions[runId];
          return { pendingActions };
        });
      }
    };

    return {
      entries: {},
      pendingActions: {},
      actions: {
        loadRuns: (repoPath, options = {}) => {
          const entry = getWorkflowRunsEntry(get().entries, repoPath);
          const isFresh =
            entry.fetchedAt !== null && Date.now() - entry.fetchedAt < GITHUB_ACTION_RUNS_TTL_MS;
          if (isFresh && !options.force) return Promise.resolve(entry.runs);

          const inflight = inflightLoads.get(repoPath);
          if (inflight) return inflight;

          if (!options.quiet || entry.fetchedAt === null) {
            patchEntry(repoPath, { isLoading: true, error: null });
          }

          const request = invoke<WorkflowRunListItem[]>("github_list_workflow_runs", { repoPath })
            .then((runs) => {
              patchEntry(repoPath, { runs, fetchedAt: Date.now(), isLoading: false, error: null });
              return runs;
            })
            .catch((error: unknown) => {
              patchEntry(repoPath, { isLoading: false, error: describeError(error) });
              return null;
            })
            .finally(() => {
              inflightLoads.delete(repoPath);
            });

          inflightLoads.set(repoPath, request);
          return request;
        },
        invalidateRuns: (repoPath) => {
          const entry = get().entries[repoPath];
          if (!entry) return;
          patchEntry(repoPath, { fetchedAt: null });
        },
        rerunRun: (repoPath, runId, failedJobsOnly) =>
          withPendingAction(runId, failedJobsOnly ? "rerun-failed" : "rerun", async () => {
            await invoke("github_rerun_workflow_run", { repoPath, runId, failedJobsOnly });
            await get().actions.loadRuns(repoPath, { force: true, quiet: true });
          }),
        cancelRun: (repoPath, runId) =>
          withPendingAction(runId, "cancel", async () => {
            await invoke("github_cancel_workflow_run", { repoPath, runId });
            await get().actions.loadRuns(repoPath, { force: true, quiet: true });
          }),
      },
    };
  }),
);
