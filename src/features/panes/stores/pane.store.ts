import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import { createSelectors } from "@/utils/zustand-selectors";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import type { PaneGroup, PaneNode, SplitDirection, SplitPlacement } from "../types/pane.types";
import {
  addBufferToPane,
  closePane,
  distributeFlattenedPaneSplit,
  findPaneGroup,
  findPaneGroupByBufferId,
  findPaneNode,
  getAdjacentPane,
  getAllPaneGroups,
  getFirstPaneGroup,
  moveBufferBetweenPanes,
  normalizePaneTree,
  removeBufferFromPane,
  resizeFlattenedPaneSplit,
  setActivePaneBuffer,
  setPaneBufferPinned,
  setPaneLocked,
  setPanePreviewBuffer,
  splitPane,
  reorderPaneBuffers,
  updatePaneSizes,
} from "../utils/pane-tree";

interface PaneState {
  root: PaneNode;
  bottomRoot: PaneNode;
  activePaneId: string;
  mostRecentActivePaneIds: string[];
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
  activatePaneBuffer: (paneId: string, bufferId: string | null) => void;
  addBufferToPane: (paneId: string, bufferId: string, setActive?: boolean) => void;
  removeBufferFromPane: (paneId: string, bufferId: string, preserveEmptyPane?: boolean) => void;
  moveBufferToPane: (
    bufferId: string,
    fromPaneId: string,
    toPaneId: string,
    preserveEmptySource?: boolean,
  ) => void;
  setPanePreviewBuffer: (paneId: string, bufferId: string | null) => void;
  setPaneBufferPinned: (paneId: string, bufferId: string, pinned: boolean) => void;
  setPaneLocked: (paneId: string, locked: boolean) => void;
  setBufferPinnedEverywhere: (bufferId: string, pinned: boolean) => void;
  clearPreviewBufferEverywhere: (bufferId: string) => void;
  reorderPaneBuffers: (paneId: string, startIndex: number, endIndex: number) => void;
  updatePaneSizes: (splitId: string, sizes: [number, number]) => void;
  resizePaneSplit: (splitId: string, index: number, sizes: [number, number]) => void;
  distributePaneSplit: (splitId: string) => void;
  navigateToPane: (direction: "left" | "right" | "up" | "down") => void;
  switchToNextBufferInPane: () => void;
  switchToPreviousBufferInPane: () => void;
  getActivePane: () => PaneGroup | null;
  getPaneById: (paneId: string) => PaneGroup | null;
  getPaneByBufferId: (bufferId: string) => PaneGroup | null;
  getAllPaneGroups: () => PaneGroup[];
  togglePaneFullscreen: (paneId: string) => void;
  exitPaneFullscreen: () => void;
  restoreLayout: (layout: PaneLayoutSnapshot) => void;
  reset: () => void;
}

export interface PaneLayoutSnapshot {
  root: PaneNode;
  bottomRoot: PaneNode;
  activePaneId: string;
  mostRecentActivePaneIds?: string[];
  fullscreenPaneId: string | null;
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
  mostRecentActivePaneIds: [ROOT_PANE_ID],
  fullscreenPaneId: null,
};

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

function getPaneIds(state: Pick<PaneState, "root" | "bottomRoot">) {
  return new Set([
    ...getAllPaneGroups(state.root).map((pane) => pane.id),
    ...getAllPaneGroups(state.bottomRoot).map((pane) => pane.id),
  ]);
}

function findPaneTree(
  state: Pick<PaneState, "root" | "bottomRoot">,
  paneId: string,
): "root" | "bottom" | null {
  if (findPaneGroup(state.root, paneId)) {
    return "root";
  }

  if (findPaneGroup(state.bottomRoot, paneId)) {
    return "bottom";
  }

  return null;
}

function setMostRecentActivePane(state: PaneState, paneId: string) {
  const paneIds = [
    ...getAllPaneGroups(state.root).map((pane) => pane.id),
    ...getAllPaneGroups(state.bottomRoot).map((pane) => pane.id),
  ];
  const paneIdSet = new Set(paneIds);
  if (!paneIdSet.has(paneId)) return;

  const nextPaneIds = [paneId];
  const nextPaneIdSet = new Set(nextPaneIds);

  for (const id of state.mostRecentActivePaneIds) {
    if (id !== paneId && paneIdSet.has(id) && !nextPaneIdSet.has(id)) {
      nextPaneIds.push(id);
      nextPaneIdSet.add(id);
    }
  }

  for (const id of paneIds) {
    if (!nextPaneIdSet.has(id)) {
      nextPaneIds.push(id);
      nextPaneIdSet.add(id);
    }
  }

  state.mostRecentActivePaneIds = nextPaneIds;
}

function getFallbackActivePaneId(state: PaneState) {
  const paneIds = getPaneIds(state);
  return (
    state.mostRecentActivePaneIds.find((paneId) => paneIds.has(paneId)) ??
    getFirstPaneGroup(state.root).id
  );
}

function getFallbackPaneIdInTree(tree: PaneNode, history: string[], closingPaneId: string) {
  const paneIds = new Set(getAllPaneGroups(tree).map((pane) => pane.id));
  return (
    history.find((paneId) => paneId !== closingPaneId && paneIds.has(paneId)) ??
    getFirstPaneGroup(tree).id
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
              setMostRecentActivePane(state, newPane.id);
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
          const closingPane = findPaneGroup(currentTree, paneId);
          const nextTree = closePane(currentTree, paneId);
          if (nextTree) {
            const fallbackPaneId = getFallbackPaneIdInTree(
              nextTree,
              state.mostRecentActivePaneIds,
              paneId,
            );
            let mergedTree = nextTree;
            if (closingPane) {
              for (const bufferId of closingPane.bufferIds) {
                mergedTree = addBufferToPane(mergedTree, fallbackPaneId, bufferId, false);
              }
              if (state.activePaneId === paneId && closingPane.activeBufferId) {
                mergedTree = setActivePaneBuffer(
                  mergedTree,
                  fallbackPaneId,
                  closingPane.activeBufferId,
                );
              }
            }

            if (targetTree === "root") {
              state.root = mergedTree;
            } else {
              state.bottomRoot = mergedTree;
            }
            if (state.fullscreenPaneId === paneId) {
              state.fullscreenPaneId = null;
            }
            if (state.activePaneId === paneId) {
              state.activePaneId = fallbackPaneId;
            }
          } else if (fallbackId === ROOT_PANE_ID) {
            state.root = createInitialRoot();
            if (state.activePaneId === paneId) {
              state.activePaneId = ROOT_PANE_ID;
            }
          } else {
            state.bottomRoot = createInitialBottomRoot();
            if (state.activePaneId === paneId) {
              state.activePaneId = getFallbackActivePaneId(state);
            }
          }
          setMostRecentActivePane(state, state.activePaneId);
        });
      },

      setActivePane: (paneId) => {
        set((state) => {
          if (!findPaneTree(state, paneId)) return;

          state.activePaneId = paneId;
          setMostRecentActivePane(state, paneId);
        });
      },

      activatePaneBuffer: (paneId, bufferId) => {
        set((state) => {
          const targetTree = findPaneTree(state, paneId);
          if (!targetTree) return;

          if (targetTree === "root") {
            state.root = setActivePaneBuffer(state.root, paneId, bufferId);
          } else {
            state.bottomRoot = setActivePaneBuffer(state.bottomRoot, paneId, bufferId);
          }
          state.activePaneId = paneId;
          setMostRecentActivePane(state, paneId);
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
              state.activePaneId = getFallbackActivePaneId(state);
            }
          } else {
            state.bottomRoot = removeBufferFromPane(state.bottomRoot, paneId, bufferId);
            if (!preserveEmptyPane) {
              state.bottomRoot = collapseEmptyPaneInTree(state.bottomRoot, paneId, BOTTOM_PANE_ID);
            }
            if (state.activePaneId === paneId && !findPaneGroup(state.bottomRoot, paneId)) {
              state.activePaneId = getFallbackActivePaneId(state);
            }
          }
          setMostRecentActivePane(state, state.activePaneId);
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
          setMostRecentActivePane(state, toPaneId);
        });
      },

      setPanePreviewBuffer: (paneId, bufferId) => {
        set((state) => {
          const targetTree = getTreeForPane(state, paneId);
          if (targetTree === "root") {
            state.root = setPanePreviewBuffer(state.root, paneId, bufferId);
          } else {
            state.bottomRoot = setPanePreviewBuffer(state.bottomRoot, paneId, bufferId);
          }
        });
      },

      setPaneBufferPinned: (paneId, bufferId, pinned) => {
        set((state) => {
          const targetTree = getTreeForPane(state, paneId);
          if (targetTree === "root") {
            state.root = setPaneBufferPinned(state.root, paneId, bufferId, pinned);
          } else {
            state.bottomRoot = setPaneBufferPinned(state.bottomRoot, paneId, bufferId, pinned);
          }
        });
      },

      setPaneLocked: (paneId, locked) => {
        set((state) => {
          const targetTree = getTreeForPane(state, paneId);
          if (targetTree === "root") {
            state.root = setPaneLocked(state.root, paneId, locked);
          } else {
            state.bottomRoot = setPaneLocked(state.bottomRoot, paneId, locked);
          }
        });
      },

      setBufferPinnedEverywhere: (bufferId, pinned) => {
        set((state) => {
          for (const pane of getAllPaneGroups(state.root)) {
            if (pane.bufferIds.includes(bufferId)) {
              state.root = setPaneBufferPinned(state.root, pane.id, bufferId, pinned);
            }
          }
          for (const pane of getAllPaneGroups(state.bottomRoot)) {
            if (pane.bufferIds.includes(bufferId)) {
              state.bottomRoot = setPaneBufferPinned(state.bottomRoot, pane.id, bufferId, pinned);
            }
          }
        });
      },

      clearPreviewBufferEverywhere: (bufferId) => {
        set((state) => {
          for (const pane of getAllPaneGroups(state.root)) {
            if (pane.previewBufferId === bufferId) {
              state.root = setPanePreviewBuffer(state.root, pane.id, null);
            }
          }
          for (const pane of getAllPaneGroups(state.bottomRoot)) {
            if (pane.previewBufferId === bufferId) {
              state.bottomRoot = setPanePreviewBuffer(state.bottomRoot, pane.id, null);
            }
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

      resizePaneSplit: (splitId, index, sizes) => {
        set((state) => {
          if (findPaneNode(state.root, splitId)) {
            state.root = resizeFlattenedPaneSplit(state.root, splitId, index, sizes);
          } else {
            state.bottomRoot = resizeFlattenedPaneSplit(state.bottomRoot, splitId, index, sizes);
          }
        });
      },

      distributePaneSplit: (splitId) => {
        set((state) => {
          if (findPaneNode(state.root, splitId)) {
            state.root = distributeFlattenedPaneSplit(state.root, splitId);
          } else {
            state.bottomRoot = distributeFlattenedPaneSplit(state.bottomRoot, splitId);
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
            setMostRecentActivePane(s, adjacent.id);
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

        get().actions.activatePaneBuffer(activePane.id, nextBufferId);
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

        get().actions.activatePaneBuffer(activePane.id, prevBufferId);
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
          if (!findPaneTree(state, paneId)) return;

          state.fullscreenPaneId = state.fullscreenPaneId === paneId ? null : paneId;
          state.activePaneId = paneId;
          setMostRecentActivePane(state, paneId);
        });
      },

      exitPaneFullscreen: () => {
        set((state) => {
          state.fullscreenPaneId = null;
        });
      },

      restoreLayout: (layout) => {
        set((state) => {
          const activePane =
            findPaneGroup(layout.root, layout.activePaneId) ??
            findPaneGroup(layout.bottomRoot, layout.activePaneId);
          const fullscreenPane = layout.fullscreenPaneId
            ? (findPaneGroup(layout.root, layout.fullscreenPaneId) ??
              findPaneGroup(layout.bottomRoot, layout.fullscreenPaneId))
            : null;

          state.root = normalizePaneTree(layout.root);
          state.bottomRoot = normalizePaneTree(layout.bottomRoot);
          state.mostRecentActivePaneIds = [
            ...(layout.mostRecentActivePaneIds ?? []),
            layout.activePaneId,
          ];
          state.activePaneId = activePane?.id ?? getFallbackActivePaneId(state);
          state.fullscreenPaneId = fullscreenPane?.id ?? null;
          setMostRecentActivePane(state, state.activePaneId);
        });
      },

      reset: () => {
        set((state) => {
          state.root = createInitialRoot();
          state.bottomRoot = createInitialBottomRoot();
          state.activePaneId = ROOT_PANE_ID;
          state.mostRecentActivePaneIds = [ROOT_PANE_ID];
          state.fullscreenPaneId = null;
        });
      },
    },
  })),
  isEqual,
);

export const usePaneStore = createSelectors(usePaneStoreBase);
