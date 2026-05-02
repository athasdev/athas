import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import { createSelectors } from "@/utils/zustand-selectors";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import type { PaneGroup, PaneNode, SplitDirection, SplitPlacement } from "../types/pane";
import {
  addBufferToPane,
  closePane,
  findPaneGroup,
  findPaneGroupByBufferId,
  findPaneNode,
  getAdjacentPane,
  getAllPaneGroups,
  getFirstPaneGroup,
  moveBufferBetweenPanes,
  removeBufferFromPane,
  setActivePaneBuffer,
  splitPane,
  reorderPaneBuffers,
  updatePaneSizes,
} from "../utils/pane-tree";

interface PaneState {
  root: PaneNode;
  bottomRoot: PaneNode;
  activePaneId: string;
  fullscreenPaneId: string | null;
  actions: PaneActions;
}

interface PaneActions {
  splitPane: (
    paneId: string,
    direction: SplitDirection,
    bufferId?: string,
    placement?: SplitPlacement,
  ) => string | null;
  closePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  addBufferToPane: (paneId: string, bufferId: string, setActive?: boolean) => void;
  removeBufferFromPane: (paneId: string, bufferId: string, preserveEmptyPane?: boolean) => void;
  moveBufferToPane: (
    bufferId: string,
    fromPaneId: string,
    toPaneId: string,
    preserveEmptySource?: boolean,
  ) => void;
  setActivePaneBuffer: (paneId: string, bufferId: string | null) => void;
  reorderPaneBuffers: (paneId: string, startIndex: number, endIndex: number) => void;
  updatePaneSizes: (splitId: string, sizes: [number, number]) => void;
  navigateToPane: (direction: "left" | "right" | "up" | "down") => void;
  switchToNextBufferInPane: () => void;
  switchToPreviousBufferInPane: () => void;
  getActivePane: () => PaneGroup | null;
  getPaneById: (paneId: string) => PaneGroup | null;
  getPaneByBufferId: (bufferId: string) => PaneGroup | null;
  getAllPaneGroups: () => PaneGroup[];
  togglePaneFullscreen: (paneId: string) => void;
  exitPaneFullscreen: () => void;
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

function createInitialBottomRoot(): PaneGroup {
  return {
    id: BOTTOM_PANE_ID,
    type: "group",
    bufferIds: [],
    activeBufferId: null,
  };
}

const initialState = {
  root: createInitialRoot(),
  bottomRoot: createInitialBottomRoot(),
  activePaneId: ROOT_PANE_ID,
  fullscreenPaneId: null,
};

function isBottomPaneId(paneId: string) {
  return paneId === BOTTOM_PANE_ID;
}

function hasPane(root: PaneNode, paneId: string) {
  return findPaneGroup(root, paneId) !== null;
}

function getTreeForPane(
  state: Pick<PaneState, "root" | "bottomRoot">,
  paneId: string,
): "root" | "bottom" {
  if (hasPane(state.root, paneId)) return "root";
  if (hasPane(state.bottomRoot, paneId)) return "bottom";
  return paneId === BOTTOM_PANE_ID ? "bottom" : "root";
}

function collapseEmptyPaneInTree(tree: PaneNode, paneId: string, fallbackId: string) {
  const pane = findPaneGroup(tree, paneId);
  if (!pane || pane.bufferIds.length > 0) {
    return tree;
  }

  const allGroups = getAllPaneGroups(tree);
  if (allGroups.length <= 1) {
    return fallbackId === ROOT_PANE_ID ? createInitialRoot() : createInitialBottomRoot();
  }

  return (
    closePane(tree, paneId) ??
    (fallbackId === ROOT_PANE_ID ? createInitialRoot() : createInitialBottomRoot())
  );
}

const usePaneStoreBase = createWithEqualityFn<PaneState>()(
  immer((set, get) => ({
    ...initialState,
    actions: {
      splitPane: (paneId, direction, bufferId, placement = "after") => {
        let newPaneId: string | null = null;
        set((state) => {
          const targetTree = getTreeForPane(state, paneId);
          const currentTree = targetTree === "root" ? state.root : state.bottomRoot;
          const existingPaneIds = new Set(getAllPaneGroups(currentTree).map((pane) => pane.id));
          const nextTree = splitPane(currentTree, paneId, direction, bufferId, placement);
          if (nextTree !== currentTree) {
            if (targetTree === "root") {
              state.root = nextTree;
            } else {
              state.bottomRoot = nextTree;
            }
            const allGroups = getAllPaneGroups(nextTree);
            const newPane = allGroups.find((g) => !existingPaneIds.has(g.id));
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
          const targetTree = getTreeForPane(state, paneId);
          const currentTree = targetTree === "root" ? state.root : state.bottomRoot;
          const fallbackId = targetTree === "root" ? ROOT_PANE_ID : BOTTOM_PANE_ID;
          const nextTree = closePane(currentTree, paneId);
          if (nextTree) {
            if (targetTree === "root") {
              state.root = nextTree;
            } else {
              state.bottomRoot = nextTree;
            }
            if (state.fullscreenPaneId === paneId) {
              state.fullscreenPaneId = null;
            }
            if (state.activePaneId === paneId) {
              const firstGroup = getFirstPaneGroup(nextTree);
              state.activePaneId = firstGroup.id;
            }
          } else if (fallbackId === ROOT_PANE_ID) {
            state.root = createInitialRoot();
            if (state.activePaneId === paneId) {
              state.activePaneId = ROOT_PANE_ID;
            }
          } else {
            state.bottomRoot = createInitialBottomRoot();
            if (state.activePaneId === paneId) {
              state.activePaneId = ROOT_PANE_ID;
            }
          }
        });
      },

      setActivePane: (paneId) => {
        set((state) => {
          const pane = findPaneGroup(state.root, paneId) ?? findPaneGroup(state.bottomRoot, paneId);
          if (pane) {
            state.activePaneId = paneId;
          }
        });
      },

      addBufferToPane: (paneId, bufferId, setActive = true) => {
        set((state) => {
          const targetTree = getTreeForPane(state, paneId);
          if (targetTree === "root") {
            state.root = addBufferToPane(state.root, paneId, bufferId, setActive);
          } else {
            state.bottomRoot = addBufferToPane(state.bottomRoot, paneId, bufferId, setActive);
          }
        });
      },

      removeBufferFromPane: (paneId, bufferId, preserveEmptyPane = false) => {
        set((state) => {
          const targetTree = getTreeForPane(state, paneId);
          if (targetTree === "root") {
            state.root = removeBufferFromPane(state.root, paneId, bufferId);
            if (!preserveEmptyPane) {
              state.root = collapseEmptyPaneInTree(state.root, paneId, ROOT_PANE_ID);
            }
            if (state.activePaneId === paneId && !findPaneGroup(state.root, paneId)) {
              state.activePaneId = getFirstPaneGroup(state.root).id;
            }
          } else {
            state.bottomRoot = removeBufferFromPane(state.bottomRoot, paneId, bufferId);
            if (!preserveEmptyPane) {
              state.bottomRoot = collapseEmptyPaneInTree(state.bottomRoot, paneId, BOTTOM_PANE_ID);
            }
            if (state.activePaneId === paneId && !findPaneGroup(state.bottomRoot, paneId)) {
              state.activePaneId = getFirstPaneGroup(state.bottomRoot).id;
            }
          }
        });
      },

      moveBufferToPane: (bufferId, fromPaneId, toPaneId, preserveEmptySource = false) => {
        set((state) => {
          const fromTree = getTreeForPane(state, fromPaneId);
          const toTree = getTreeForPane(state, toPaneId);

          if (fromTree === toTree) {
            if (fromTree === "root") {
              state.root = moveBufferBetweenPanes(state.root, bufferId, fromPaneId, toPaneId);
              if (!preserveEmptySource) {
                state.root = collapseEmptyPaneInTree(state.root, fromPaneId, ROOT_PANE_ID);
              }
            } else {
              state.bottomRoot = moveBufferBetweenPanes(
                state.bottomRoot,
                bufferId,
                fromPaneId,
                toPaneId,
              );
              if (!preserveEmptySource) {
                state.bottomRoot = collapseEmptyPaneInTree(
                  state.bottomRoot,
                  fromPaneId,
                  BOTTOM_PANE_ID,
                );
              }
            }
          } else {
            if (fromTree === "root") {
              state.root = removeBufferFromPane(state.root, fromPaneId, bufferId);
              if (!preserveEmptySource) {
                state.root = collapseEmptyPaneInTree(state.root, fromPaneId, ROOT_PANE_ID);
              }
              state.bottomRoot = addBufferToPane(state.bottomRoot, toPaneId, bufferId, true);
            } else {
              state.bottomRoot = removeBufferFromPane(state.bottomRoot, fromPaneId, bufferId);
              if (!preserveEmptySource) {
                state.bottomRoot = collapseEmptyPaneInTree(
                  state.bottomRoot,
                  fromPaneId,
                  BOTTOM_PANE_ID,
                );
              }
              state.root = addBufferToPane(state.root, toPaneId, bufferId, true);
            }
          }

          state.activePaneId = toPaneId;
        });
      },

      setActivePaneBuffer: (paneId, bufferId) => {
        set((state) => {
          const targetTree = getTreeForPane(state, paneId);
          if (targetTree === "root") {
            state.root = setActivePaneBuffer(state.root, paneId, bufferId);
          } else {
            state.bottomRoot = setActivePaneBuffer(state.bottomRoot, paneId, bufferId);
          }
        });
      },

      reorderPaneBuffers: (paneId, startIndex, endIndex) => {
        set((state) => {
          const targetTree = getTreeForPane(state, paneId);
          if (targetTree === "root") {
            state.root = reorderPaneBuffers(state.root, paneId, startIndex, endIndex);
          } else {
            state.bottomRoot = reorderPaneBuffers(state.bottomRoot, paneId, startIndex, endIndex);
          }
        });
      },

      updatePaneSizes: (splitId, sizes) => {
        set((state) => {
          if (findPaneNode(state.root, splitId)) {
            state.root = updatePaneSizes(state.root, splitId, sizes);
          } else {
            state.bottomRoot = updatePaneSizes(state.bottomRoot, splitId, sizes);
          }
        });
      },

      navigateToPane: (direction) => {
        const state = get();
        const activeTree = getTreeForPane(state, state.activePaneId);
        const tree = activeTree === "root" ? state.root : state.bottomRoot;
        const adjacent = getAdjacentPane(tree, state.activePaneId, direction);
        if (adjacent) {
          set((s) => {
            s.activePaneId = adjacent.id;
          });
        }
      },

      switchToNextBufferInPane: () => {
        const state = get();
        const activePane =
          findPaneGroup(state.root, state.activePaneId) ??
          findPaneGroup(state.bottomRoot, state.activePaneId);
        if (!activePane || activePane.bufferIds.length <= 1) return;

        const currentIndex = activePane.activeBufferId
          ? activePane.bufferIds.indexOf(activePane.activeBufferId)
          : -1;
        const nextIndex = (currentIndex + 1) % activePane.bufferIds.length;
        const nextBufferId = activePane.bufferIds[nextIndex];

        set((s) => {
          if (findPaneGroup(s.root, activePane.id)) {
            s.root = setActivePaneBuffer(s.root, activePane.id, nextBufferId);
          } else {
            s.bottomRoot = setActivePaneBuffer(s.bottomRoot, activePane.id, nextBufferId);
          }
        });
      },

      switchToPreviousBufferInPane: () => {
        const state = get();
        const activePane =
          findPaneGroup(state.root, state.activePaneId) ??
          findPaneGroup(state.bottomRoot, state.activePaneId);
        if (!activePane || activePane.bufferIds.length <= 1) return;

        const currentIndex = activePane.activeBufferId
          ? activePane.bufferIds.indexOf(activePane.activeBufferId)
          : 0;
        const prevIndex =
          (currentIndex - 1 + activePane.bufferIds.length) % activePane.bufferIds.length;
        const prevBufferId = activePane.bufferIds[prevIndex];

        set((s) => {
          if (findPaneGroup(s.root, activePane.id)) {
            s.root = setActivePaneBuffer(s.root, activePane.id, prevBufferId);
          } else {
            s.bottomRoot = setActivePaneBuffer(s.bottomRoot, activePane.id, prevBufferId);
          }
        });
      },

      getActivePane: () => {
        const state = get();
        return (
          findPaneGroup(state.root, state.activePaneId) ??
          findPaneGroup(state.bottomRoot, state.activePaneId)
        );
      },

      getPaneById: (paneId) => {
        const state = get();
        return findPaneGroup(state.root, paneId) ?? findPaneGroup(state.bottomRoot, paneId);
      },

      getPaneByBufferId: (bufferId) => {
        const state = get();
        return (
          findPaneGroupByBufferId(state.root, bufferId) ??
          findPaneGroupByBufferId(state.bottomRoot, bufferId)
        );
      },

      getAllPaneGroups: () => {
        const state = get();
        return [...getAllPaneGroups(state.root), ...getAllPaneGroups(state.bottomRoot)];
      },

      togglePaneFullscreen: (paneId) => {
        set((state) => {
          const pane = findPaneGroup(state.root, paneId) ?? findPaneGroup(state.bottomRoot, paneId);
          if (!pane) return;

          state.fullscreenPaneId = state.fullscreenPaneId === paneId ? null : paneId;
          state.activePaneId = paneId;
        });
      },

      exitPaneFullscreen: () => {
        set((state) => {
          state.fullscreenPaneId = null;
        });
      },

      reset: () => {
        set((state) => {
          state.root = createInitialRoot();
          state.bottomRoot = createInitialBottomRoot();
          state.activePaneId = ROOT_PANE_ID;
          state.fullscreenPaneId = null;
        });
      },
    },
  })),
  isEqual,
);

export const usePaneStore = createSelectors(usePaneStoreBase);
