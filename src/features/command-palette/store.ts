import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

export const MAX_NUM_REMEMBERED_ACTIONS = 10;

interface ActionsStore {
  lastEnteredActionsStack: string[];
  pushAction: (actionId: string) => void;
  clearStack: () => void;

  favoritedActions: string[];
  toggleFavoriteAction: (actionId: string) => boolean;
}

export const useActionsStore = createSelectors(
  create<ActionsStore>()(
    persist(
      (set) => ({
        lastEnteredActionsStack: [],
        favoritedActions: [],

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

        toggleFavoriteAction: (actionId) => {
          let didFavorite = false;

          set((state) => {
            const alreadyFav = state.favoritedActions.includes(actionId);

            didFavorite = !alreadyFav; // true if adding, false if removing

            const newFavActions = alreadyFav
              ? state.favoritedActions.filter((id) => id !== actionId)
              : [...state.favoritedActions, actionId];

            return { favoritedActions: newFavActions };
          });

          return didFavorite;
        },
      }),
      { name: "actions-storage" },
    ),
  ),
);
