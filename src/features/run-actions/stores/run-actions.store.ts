import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";
import type { CustomRunAction } from "../types/run-action.types";

interface RunActionsState {
  runActions: CustomRunAction[];
  actions: {
    addAction: (action: Omit<CustomRunAction, "id">) => void;
    updateAction: (id: string, updates: Partial<CustomRunAction>) => void;
    deleteAction: (id: string) => void;
    getAction: (id: string) => CustomRunAction | undefined;
    getActionsForWorkspace: (workspacePath?: string) => CustomRunAction[];
    reorderActions: (startIndex: number, endIndex: number) => void;
  };
}

type PersistedRunActionsState = Pick<RunActionsState, "runActions">;

const useRunActionsStoreBase = create<RunActionsState>()(
  persist(
    (set, get) => ({
      runActions: [],
      actions: {
        addAction: (action) => {
          const id = `action_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
          set((state) => ({
            runActions: [...state.runActions, { ...action, id }],
          }));
        },
        updateAction: (id, updates) => {
          set((state) => ({
            runActions: state.runActions.map((action) =>
              action.id === id ? { ...action, ...updates } : action,
            ),
          }));
        },
        deleteAction: (id) => {
          set((state) => ({
            runActions: state.runActions.filter((action) => action.id !== id),
          }));
        },
        getAction: (id) => get().runActions.find((action) => action.id === id),
        getActionsForWorkspace: (workspacePath) => {
          const actions = get().runActions;
          if (!workspacePath) {
            return actions.filter((action) => !action.workspacePath);
          }

          const scopedActions = actions.filter((action) => action.workspacePath === workspacePath);
          const sharedActions = actions.filter((action) => !action.workspacePath);
          return [...scopedActions, ...sharedActions];
        },
        reorderActions: (startIndex, endIndex) => {
          set((state) => {
            const result = Array.from(state.runActions);
            const [removed] = result.splice(startIndex, 1);
            if (!removed) return state;
            result.splice(endIndex, 0, removed);
            return { runActions: result };
          });
        },
      },
    }),
    {
      name: "terminal-custom-actions",
      version: 1,
      storage: createSafeJSONStorage<PersistedRunActionsState>(),
      partialize: ({ runActions }) => ({ runActions }),
      migrate: (persistedState): PersistedRunActionsState => {
        if (!persistedState || typeof persistedState !== "object") {
          return { runActions: [] };
        }

        const state = persistedState as Partial<PersistedRunActionsState> & {
          actions?: CustomRunAction[];
        };
        return {
          runActions: Array.isArray(state.runActions)
            ? state.runActions
            : Array.isArray(state.actions)
              ? state.actions
              : [],
        };
      },
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as PersistedRunActionsState),
        actions: currentState.actions,
      }),
    },
  ),
);

export const useRunActionsStore = createSelectors(useRunActionsStoreBase);
