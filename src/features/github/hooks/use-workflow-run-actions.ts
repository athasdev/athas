import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refetchAfterMutation } from "@/utils/query-client";
import { cancelWorkflowRun, rerunWorkflowRun } from "../api/github-actions-api";
import { githubKeys } from "../services/github-queries";
import {
  useGitHubActionsStore,
  type WorkflowRunPendingAction,
} from "../stores/github-actions.store";

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useWorkflowRunActions() {
  const queryClient = useQueryClient();
  const setPendingAction = useGitHubActionsStore.use.actions().setPendingAction;

  const runAction = useCallback(
    async (
      repoPath: string,
      runId: number,
      action: WorkflowRunPendingAction,
      task: () => Promise<unknown>,
    ) => {
      setPendingAction(runId, action);
      try {
        await task();
        void queryClient.invalidateQueries({ queryKey: githubKeys.workflowRun(repoPath, runId) });
        await refetchAfterMutation(queryClient, githubKeys.workflowRuns(repoPath));
        return true;
      } catch (error) {
        throw new Error(describeError(error));
      } finally {
        setPendingAction(runId, null);
      }
    },
    [queryClient, setPendingAction],
  );

  const rerunRun = useCallback(
    (repoPath: string, runId: number, failedJobsOnly: boolean) =>
      runAction(repoPath, runId, failedJobsOnly ? "rerun-failed" : "rerun", () =>
        rerunWorkflowRun(repoPath, runId, failedJobsOnly),
      ),
    [runAction],
  );

  const cancelRun = useCallback(
    (repoPath: string, runId: number) =>
      runAction(repoPath, runId, "cancel", () => cancelWorkflowRun(repoPath, runId)),
    [runAction],
  );

  return { rerunRun, cancelRun };
}
