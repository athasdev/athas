import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

export interface CustomTerminalAction {
  id: string;
  name: string;
  command: string;
  icon?: string;
}

interface CustomActionsState {
  actions: CustomTerminalAction[];
  storeActions: {
    addAction: (action: Omit<CustomTerminalAction, "id">) => void;
    updateAction: (id: string, updates: Partial<CustomTerminalAction>) => void;
    deleteAction: (id: string) => void;
    getAction: (id: string) => CustomTerminalAction | undefined;
    reorderActions: (startIndex: number, endIndex: number) => void;
  };
}

const useCustomActionsStoreBase = create<CustomActionsState>()(
  persist(
    (set, get) => ({
      actions: [],
      storeActions: {
        addAction: (action) => {
          const id = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          set((state) => ({
            actions: [...state.actions, { ...action, id }],
          }));
        },
        updateAction: (id, updates) => {
          set((state) => ({
            actions: state.actions.map((a) => (a.id === id ? { ...a, ...updates } : a)),
          }));
        },
        deleteAction: (id) => {
          set((state) => ({
            actions: state.actions.filter((a) => a.id !== id),
          }));
        },
        getAction: (id) => {
          return get().actions.find((a) => a.id === id);
        },
        reorderActions: (startIndex, endIndex) => {
          set((state) => {
            const result = Array.from(state.actions);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            return { actions: result };
          });
        },
      },
    }),
    {
      name: "terminal-custom-actions",
    },
  ),
);

export const useCustomActionsStore = createSelectors(useCustomActionsStoreBase);
