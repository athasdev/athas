import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import { createSelectors } from "@/utils/zustand-selectors";
import { ROOT_PANE_ID } from "../constants/pane";
import type { PaneGroup, PaneNode, SplitDirection } from "../types/pane";
import {
  addBufferToPane,
  closePane,
  findPaneGroup,
  findPaneGroupByBufferId,
  getAdjacentPane,
  getAllPaneGroups,
  getFirstPaneGroup,
  moveBufferBetweenPanes,
  removeBufferFromPane,
  setActivePaneBuffer,
  splitPane,
  updatePaneSizes,
} from "../utils/pane-tree";

interface PaneState {
  root: PaneNode;
  activePaneId: string;
  actions: PaneActions;
}

interface PaneActions {
  splitPane: (paneId: string, direction: SplitDirection, bufferId?: string) => string | null;
  closePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  addBufferToPane: (paneId: string, bufferId: string, setActive?: boolean) => void;
  removeBufferFromPane: (paneId: string, bufferId: string) => void;
  moveBufferToPane: (bufferId: string, fromPaneId: string, toPaneId: string) => void;
  setActivePaneBuffer: (paneId: string, bufferId: string | null) => void;
  updatePaneSizes: (splitId: string, sizes: [number, number]) => void;
  navigateToPane: (direction: "left" | "right" | "up" | "down") => void;
  switchToNextBufferInPane: () => void;
  switchToPreviousBufferInPane: () => void;
  getActivePane: () => PaneGroup | null;
  getPaneByBufferId: (bufferId: string) => PaneGroup | null;
  getAllPaneGroups: () => PaneGroup[];
  reset: () => void;
}

function createInitialRoot(): PaneGroup {
  return {
    id: ROOT_PANE_ID,
    type: "group",
    bufferIds: [],
    activeBufferId: null,
  };
}

const initialState = {
  root: createInitialRoot(),
  activePaneId: ROOT_PANE_ID,
};

const usePaneStoreBase = createWithEqualityFn<PaneState>()(
  immer((set, get) => ({
    ...initialState,
    actions: {
      splitPane: (paneId, direction, bufferId) => {
        let newPaneId: string | null = null;
        set((state) => {
          const newRoot = splitPane(state.root, paneId, direction, bufferId);
          if (newRoot !== state.root) {
            state.root = newRoot;
            const allGroups = getAllPaneGroups(newRoot);
            const newPane = allGroups.find((g) => g.id !== paneId && g.bufferIds.length <= 1);
            if (newPane) {
              newPaneId = newPane.id;
              state.activePaneId = newPane.id;
            }
          }
        });
        return newPaneId;
      },

      closePane: (paneId) => {
        set((state) => {
          const newRoot = closePane(state.root, paneId);
          if (newRoot) {
            state.root = newRoot;
            if (state.activePaneId === paneId) {
              const firstGroup = getFirstPaneGroup(newRoot);
              state.activePaneId = firstGroup.id;
            }
          }
        });
      },

      setActivePane: (paneId) => {
        set((state) => {
          const pane = findPaneGroup(state.root, paneId);
          if (pane) {
            state.activePaneId = paneId;
          }
        });
      },

      addBufferToPane: (paneId, bufferId, setActive = true) => {
        set((state) => {
          state.root = addBufferToPane(state.root, paneId, bufferId, setActive);
        });
      },

      removeBufferFromPane: (paneId, bufferId) => {
        set((state) => {
          state.root = removeBufferFromPane(state.root, paneId, bufferId);
          const pane = findPaneGroup(state.root, paneId);
          if (pane && pane.bufferIds.length === 0) {
            const allGroups = getAllPaneGroups(state.root);
            if (allGroups.length > 1) {
              const newRoot = closePane(state.root, paneId);
              if (newRoot) {
                state.root = newRoot;
                if (state.activePaneId === paneId) {
                  const firstGroup = getFirstPaneGroup(newRoot);
                  state.activePaneId = firstGroup.id;
                }
              }
            }
          }
        });
      },

      moveBufferToPane: (bufferId, fromPaneId, toPaneId) => {
        set((state) => {
          state.root = moveBufferBetweenPanes(state.root, bufferId, fromPaneId, toPaneId);
          state.activePaneId = toPaneId;
        });
      },

      setActivePaneBuffer: (paneId, bufferId) => {
        set((state) => {
          state.root = setActivePaneBuffer(state.root, paneId, bufferId);
        });
      },

      updatePaneSizes: (splitId, sizes) => {
        set((state) => {
          state.root = updatePaneSizes(state.root, splitId, sizes);
        });
      },

      navigateToPane: (direction) => {
        const state = get();
        const adjacent = getAdjacentPane(state.root, state.activePaneId, direction);
        if (adjacent) {
          set((s) => {
            s.activePaneId = adjacent.id;
          });
        }
      },

      switchToNextBufferInPane: () => {
        const state = get();
        const activePane = findPaneGroup(state.root, state.activePaneId);
        if (!activePane || activePane.bufferIds.length <= 1) return;

        const currentIndex = activePane.activeBufferId
          ? activePane.bufferIds.indexOf(activePane.activeBufferId)
          : -1;
        const nextIndex = (currentIndex + 1) % activePane.bufferIds.length;
        const nextBufferId = activePane.bufferIds[nextIndex];

        set((s) => {
          s.root = setActivePaneBuffer(s.root, activePane.id, nextBufferId);
        });
      },

      switchToPreviousBufferInPane: () => {
        const state = get();
        const activePane = findPaneGroup(state.root, state.activePaneId);
        if (!activePane || activePane.bufferIds.length <= 1) return;

        const currentIndex = activePane.activeBufferId
          ? activePane.bufferIds.indexOf(activePane.activeBufferId)
          : 0;
        const prevIndex =
          (currentIndex - 1 + activePane.bufferIds.length) % activePane.bufferIds.length;
        const prevBufferId = activePane.bufferIds[prevIndex];

        set((s) => {
          s.root = setActivePaneBuffer(s.root, activePane.id, prevBufferId);
        });
      },

      getActivePane: () => {
        const state = get();
        return findPaneGroup(state.root, state.activePaneId);
      },

      getPaneByBufferId: (bufferId) => {
        const state = get();
        return findPaneGroupByBufferId(state.root, bufferId);
      },

      getAllPaneGroups: () => {
        const state = get();
        return getAllPaneGroups(state.root);
      },

      reset: () => {
        set((state) => {
          state.root = createInitialRoot();
          state.activePaneId = ROOT_PANE_ID;
        });
      },
    },
  })),
  isEqual,
);

export const usePaneStore = createSelectors(usePaneStoreBase);
