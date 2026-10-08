import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export type WorkflowRunPendingAction = "rerun" | "rerun-failed" | "cancel";

interface GitHubActionsState {
  /** Re-run or cancel requests still in flight, by run id, shared by the sidebar and the viewer. */
  pendingActions: Record<number, WorkflowRunPendingAction>;
  actions: {
    setPendingAction: (runId: number, action: WorkflowRunPendingAction | null) => void;
  };
}

export const useGitHubActionsStore = createSelectors(
  create<GitHubActionsState>()((set) => ({
    pendingActions: {},
    actions: {
      setPendingAction: (runId, action) =>
        set((state) => {
          const pendingActions = { ...state.pendingActions };
          if (action) pendingActions[runId] = action;
          else delete pendingActions[runId];
          return { pendingActions };
        }),
    },
  })),
);
