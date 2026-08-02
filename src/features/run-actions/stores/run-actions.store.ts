import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import type { CustomRunAction } from "../types/run-action.types";

interface RunActionsState {
  actions: CustomRunAction[];
  storeActions: {
    addAction: (action: Omit<CustomRunAction, "id">) => void;
    updateAction: (id: string, updates: Partial<CustomRunAction>) => void;
    deleteAction: (id: string) => void;
    getAction: (id: string) => CustomRunAction | undefined;
    getActionsForWorkspace: (workspacePath?: string) => CustomRunAction[];
    reorderActions: (startIndex: number, endIndex: number) => void;
  };
}

const useRunActionsStoreBase = create<RunActionsState>()(
  persist(
    (set, get) => ({
      actions: [],
      storeActions: {
        addAction: (action) => {
          const id = `action_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
          set((state) => ({
            actions: [...state.actions, { ...action, id }],
          }));
        },
        updateAction: (id, updates) => {
          set((state) => ({
            actions: state.actions.map((action) =>
              action.id === id ? { ...action, ...updates } : action,
            ),
          }));
        },
        deleteAction: (id) => {
          set((state) => ({
            actions: state.actions.filter((action) => action.id !== id),
          }));
        },
        getAction: (id) => get().actions.find((action) => action.id === id),
        getActionsForWorkspace: (workspacePath) => {
          const actions = get().actions;
          if (!workspacePath) {
            return actions.filter((action) => !action.workspacePath);
          }

          const scopedActions = actions.filter((action) => action.workspacePath === workspacePath);
          const sharedActions = actions.filter((action) => !action.workspacePath);
          return [...scopedActions, ...sharedActions];
        },
        reorderActions: (startIndex, endIndex) => {
          set((state) => {
            const result = Array.from(state.actions);
            const [removed] = result.splice(startIndex, 1);
            if (!removed) return state;
            result.splice(endIndex, 0, removed);
            return { actions: result };
          });
        },
      },
    }),
    {
      name: "terminal-custom-actions",
      partialize: (state) => ({ actions: state.actions }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<RunActionsState>),
        storeActions: currentState.storeActions,
      }),
    },
  ),
);

export const useRunActionsStore = createSelectors(useRunActionsStoreBase);
