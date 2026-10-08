import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";
import { migrateLegacyPaletteId } from "../constants/legacy-palette-ids";

const MAX_NUM_REMEMBERED_ACTIONS = 10;

interface ActionsStore {
  lastEnteredActionsStack: string[];
  actions: {
    pushAction: (actionId: string) => void;
    clearStack: () => void;
  };
}

export const useActionsStore = createSelectors(
  create<ActionsStore>()(
    persist(
      (set) => ({
        lastEnteredActionsStack: [],

        actions: {
          pushAction: (actionId) => {
            set((state) => {
              let newStack = state.lastEnteredActionsStack.filter((id) => id !== actionId);
              newStack = [actionId, ...newStack];

              if (newStack.length > MAX_NUM_REMEMBERED_ACTIONS) {
                newStack = newStack.slice(0, MAX_NUM_REMEMBERED_ACTIONS);
              }

              return { lastEnteredActionsStack: newStack };
            });
          },

          clearStack: () => {
            set(() => ({ lastEnteredActionsStack: [] }));
          },
        },
      }),
      {
        name: "actions-storage",
        version: 1,
        storage: createSafeJSONStorage<Pick<ActionsStore, "lastEnteredActionsStack">>(),
        partialize: ({ lastEnteredActionsStack }) => ({ lastEnteredActionsStack }),
        migrate: (persistedState, version) => {
          const state = persistedState as Partial<Pick<ActionsStore, "lastEnteredActionsStack">>;
          const stack = Array.isArray(state?.lastEnteredActionsStack)
            ? state.lastEnteredActionsStack
            : [];
          if (version >= 1) return { lastEnteredActionsStack: stack };

          return {
            lastEnteredActionsStack: [...new Set(stack.map(migrateLegacyPaletteId))],
          };
        },
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...(persistedState as Pick<ActionsStore, "lastEnteredActionsStack">),
          actions: currentState.actions,
        }),
      },
    ),
  ),
);
