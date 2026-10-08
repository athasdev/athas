import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { createSelectors } from "@/utils/zustand-selectors";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import type { PaneGroup, PaneNode, SplitDirection, SplitPlacement } from "../types/pane.types";
import { resolveWritablePaneForBuffer } from "../services/pane-routing";
import {
  addBufferToPane,
  closePane,
  clearPanePreviewBufferEverywhere,
  distributeFlattenedPaneSplit,
  findPaneGroup,
  findPaneGroupByBufferId,
  findPaneNode,
  getAdjacentPane,
  getAllPaneGroups,
  getFirstPaneGroup,
  isBufferPinnedInTree,
  moveBufferBetweenPanes,
  moveBufferWithinPane,
  normalizePaneTree,
  removeBufferFromPane,
  resizeFlattenedPaneSplit,
  setActivePaneBuffer,
  setPaneBufferPinned,
  setPaneBufferPinnedEverywhere,
  setPaneLocked,
  setPanePreviewBuffer,
  splitPane,
  reorderPaneBuffers,
  updatePaneSizes,
} from "../services/pane-tree";

interface PaneState {
  root: PaneNode;
  bottomRoot: PaneNode;
  activePaneId: string;
  mostRecentActivePaneIds: string[];
  fullscreenPaneId: string | null;
  actions: PaneActions;
}

export interface PlaceBufferOptions {
  /** Pane to show the buffer in. Falls back to normal routing when it no longer exists. */
  paneId?: string;
  /** Focus the pane that already holds the buffer instead of adding it to the writable pane. */
  reveal?: boolean;
  /**
   * `true` makes the buffer the target pane's preview tab (ignored for pinned buffers),
   * `false` promotes it everywhere, `undefined` leaves its preview state alone.
   */
  preview?: boolean;
  /** Tab position for a buffer the target pane does not hold yet; the end by default. */
  index?: number;
  /** Buffers taken out of every pane first, keeping panes they empty (replaced preview, new tab). */
  replaceBufferIds?: readonly string[];
  /** Buffers taken out of every pane first, closing panes they empty (auto eviction). */
  closeBufferIds?: readonly string[];
}

export interface RemoveBuffersOptions {
  preserveEmptyPanes?: boolean;
  /** Buffer to activate and focus afterwards, in its pane or the writable pane. */
  revealBufferId?: string | null;
}

interface PaneActions {
  /**
   * Shows a buffer in a pane, activates it and focuses that pane, all in one update. Returns the
   * pane id, or null when no pane could take it.
   */
  placeBuffer: (bufferId: string, options?: PlaceBufferOptions) => string | null;
  /** Takes buffers out of every pane in one update and optionally reveals a replacement. */
  removeBuffers: (bufferIds: readonly string[], options?: RemoveBuffersOptions) => void;
  /** Moves a tab before `beforeBufferId` (or to the end) within its pane. */
  moveBufferInPane: (paneId: string, bufferId: string, beforeBufferId: string | null) => void;
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

  if (tree.type === "group") {
    return fallbackId === ROOT_PANE_ID ? createInitialRoot() : createInitialBottomRoot();
  }

  return (
    closePane(tree, paneId) ??
    (fallbackId === ROOT_PANE_ID ? createInitialRoot() : createInitialBottomRoot())
  );
}

function addPaneIds(root: PaneNode, paneIds: Set<string>) {
  if (root.type === "group") {
    paneIds.add(root.id);
    return;
  }

  addPaneIds(root.children[0], paneIds);
  addPaneIds(root.children[1], paneIds);
}

function collectPaneIds(root: PaneNode, paneIds: string[]) {
  if (root.type === "group") {
    paneIds.push(root.id);
    return;
  }

  collectPaneIds(root.children[0], paneIds);
  collectPaneIds(root.children[1], paneIds);
}

function findPaneNotInSet(root: PaneNode, paneIds: Set<string>): PaneGroup | null {
  if (root.type === "group") {
    return paneIds.has(root.id) ? null : root;
  }

  return findPaneNotInSet(root.children[0], paneIds) ?? findPaneNotInSet(root.children[1], paneIds);
}

function getPaneIds(state: Pick<PaneState, "root" | "bottomRoot">) {
  const paneIds = new Set<string>();
  addPaneIds(state.root, paneIds);
  addPaneIds(state.bottomRoot, paneIds);
  return paneIds;
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
  const paneIds: string[] = [];
  collectPaneIds(state.root, paneIds);
  collectPaneIds(state.bottomRoot, paneIds);
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

  const previousPaneIds = state.mostRecentActivePaneIds;
  if (
    previousPaneIds.length === nextPaneIds.length &&
    previousPaneIds.every((id, index) => id === nextPaneIds[index])
  ) {
    return;
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
  const paneIds = new Set<string>();
  addPaneIds(tree, paneIds);
  return (
    history.find((paneId) => paneId !== closingPaneId && paneIds.has(paneId)) ??
    getFirstPaneGroup(tree).id
  );
}

type LayoutState = Pick<
  PaneState,
  "root" | "bottomRoot" | "activePaneId" | "mostRecentActivePaneIds" | "fullscreenPaneId"
>;

function updateTreeOfPane(
  state: LayoutState,
  paneId: string,
  update: (tree: PaneNode) => PaneNode,
) {
  if (getTreeForPane(state, paneId) === "root") {
    state.root = update(state.root);
  } else {
    state.bottomRoot = update(state.bottomRoot);
  }
}

function findPaneInState(state: LayoutState, paneId: string): PaneGroup | null {
  return findPaneGroup(state.root, paneId) ?? findPaneGroup(state.bottomRoot, paneId);
}

function isBufferPinnedInState(state: LayoutState, bufferId: string) {
  return (
    isBufferPinnedInTree(state.root, bufferId) || isBufferPinnedInTree(state.bottomRoot, bufferId)
  );
}

function focusPaneInState(state: PaneState, paneId: string) {
  state.activePaneId = paneId;
  setMostRecentActivePane(state, paneId);
}

function removeBufferEverywhereInState(state: PaneState, bufferId: string, preserveEmpty: boolean) {
  for (const which of ["root", "bottom"] as const) {
    const fallbackId = which === "root" ? ROOT_PANE_ID : BOTTOM_PANE_ID;
    let tree = which === "root" ? state.root : state.bottomRoot;
    for (const pane of getAllPaneGroups(tree)) {
      if (!pane.bufferIds.includes(bufferId)) continue;
      tree = removeBufferFromPane(tree, pane.id, bufferId);
      if (!preserveEmpty) tree = collapseEmptyPaneInTree(tree, pane.id, fallbackId);
    }
    if (which === "root") state.root = tree;
    else state.bottomRoot = tree;
  }
  if (!findPaneInState(state, state.activePaneId)) {
    state.activePaneId = getFallbackActivePaneId(state);
  }
}

/** The pane that already shows the buffer, preferring the focused one. */
function findRevealPaneId(state: LayoutState, bufferId: string): string | null {
  const activePane = findPaneInState(state, state.activePaneId);
  if (activePane?.bufferIds.includes(bufferId)) return activePane.id;
  return (
    findPaneGroupByBufferId(state.root, bufferId)?.id ??
    findPaneGroupByBufferId(state.bottomRoot, bufferId)?.id ??
    null
  );
}

function splitPaneInState(
  state: PaneState,
  paneId: string,
  direction: SplitDirection,
  bufferId: string | undefined,
  placement: SplitPlacement,
): string | null {
  const targetTree = getTreeForPane(state, paneId);
  const currentTree = targetTree === "root" ? state.root : state.bottomRoot;
  const existingPaneIds = new Set<string>();
  addPaneIds(currentTree, existingPaneIds);
  let nextTree = splitPane(currentTree, paneId, direction, bufferId, placement);
  if (nextTree === currentTree) return null;

  const newPane = findPaneNotInSet(nextTree, existingPaneIds);
  if (newPane && bufferId) {
    // A split copy is a definite tab and keeps the buffer's pin.
    if (isBufferPinnedInState(state, bufferId)) {
      nextTree = setPaneBufferPinned(nextTree, newPane.id, bufferId, true);
    }
  }
  if (targetTree === "root") {
    state.root = nextTree;
  } else {
    state.bottomRoot = nextTree;
  }
  if (bufferId) {
    state.root = clearPanePreviewBufferEverywhere(state.root, bufferId);
    state.bottomRoot = clearPanePreviewBufferEverywhere(state.bottomRoot, bufferId);
  }
  if (!newPane) return null;
  focusPaneInState(state, newPane.id);
  return newPane.id;
}

/** The pane new buffers go to: the focused pane unless it is locked, else a new split beside it. */
function resolveWritablePaneIdInState(state: PaneState, bufferId?: string): string | null {
  const activePane = findPaneInState(state, state.activePaneId);
  if (!activePane) return null;
  const writablePane = resolveWritablePaneForBuffer({
    activePane,
    bottomRoot: state.bottomRoot,
    bufferId,
    mostRecentActivePaneIds: state.mostRecentActivePaneIds,
    root: state.root,
  });
  if (writablePane) return writablePane.id;
  return splitPaneInState(state, activePane.id, "horizontal", undefined, "after") ?? activePane.id;
}

function showBufferInState(
  state: PaneState,
  bufferId: string,
  options: Pick<PlaceBufferOptions, "paneId" | "reveal" | "preview" | "index">,
): string | null {
  let targetPaneId =
    options.paneId && findPaneInState(state, options.paneId) ? options.paneId : null;
  if (!targetPaneId && options.reveal) targetPaneId = findRevealPaneId(state, bufferId);
  if (!targetPaneId) targetPaneId = resolveWritablePaneIdInState(state, bufferId);
  if (!targetPaneId) return null;

  const paneId = targetPaneId;
  const pinned = isBufferPinnedInState(state, bufferId);
  updateTreeOfPane(state, paneId, (tree) => {
    let next = addBufferToPane(tree, paneId, bufferId, true, options.index);
    if (pinned) next = setPaneBufferPinned(next, paneId, bufferId, true);
    if (options.preview === true && !pinned) next = setPanePreviewBuffer(next, paneId, bufferId);
    return next;
  });
  if (options.preview === false) {
    state.root = clearPanePreviewBufferEverywhere(state.root, bufferId);
    state.bottomRoot = clearPanePreviewBufferEverywhere(state.bottomRoot, bufferId);
  }
  focusPaneInState(state, paneId);
  return paneId;
}

const createPaneStore = () =>
  createStore<PaneState>()(
    immer((set, get) => ({
      ...initialState,
      actions: {
        placeBuffer: (bufferId, options = {}) => {
          let placedPaneId: string | null = null;
          set((state) => {
            for (const id of options.replaceBufferIds ?? []) {
              if (id !== bufferId) removeBufferEverywhereInState(state, id, true);
            }
            for (const id of options.closeBufferIds ?? []) {
              if (id !== bufferId) removeBufferEverywhereInState(state, id, false);
            }
            placedPaneId = showBufferInState(state, bufferId, options);
          });
          return placedPaneId;
        },

        removeBuffers: (bufferIds, options = {}) => {
          set((state) => {
            for (const bufferId of bufferIds) {
              removeBufferEverywhereInState(state, bufferId, options.preserveEmptyPanes ?? false);
            }
            if (options.revealBufferId) {
              showBufferInState(state, options.revealBufferId, { reveal: true });
            }
            setMostRecentActivePane(state, state.activePaneId);
          });
        },

        moveBufferInPane: (paneId, bufferId, beforeBufferId) => {
          set((state) => {
            updateTreeOfPane(state, paneId, (tree) =>
              moveBufferWithinPane(tree, paneId, bufferId, beforeBufferId),
            );
          });
        },

        splitPane: (paneId, direction, bufferId, placement = "after") => {
          let newPaneId: string | null = null;
          set((state) => {
            newPaneId = splitPaneInState(state, paneId, direction, bufferId, placement);
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
                  if (closingPane.pinnedBufferIds?.includes(bufferId)) {
                    mergedTree = setPaneBufferPinned(mergedTree, fallbackPaneId, bufferId, true);
                  }
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
                state.bottomRoot = collapseEmptyPaneInTree(
                  state.bottomRoot,
                  paneId,
                  BOTTOM_PANE_ID,
                );
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
              const wasPinned = isBufferPinnedInState(state, bufferId);
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
              if (wasPinned) {
                updateTreeOfPane(state, toPaneId, (tree) =>
                  setPaneBufferPinned(tree, toPaneId, bufferId, true),
                );
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
            state.root = setPaneBufferPinnedEverywhere(state.root, bufferId, pinned);
            state.bottomRoot = setPaneBufferPinnedEverywhere(state.bottomRoot, bufferId, pinned);
            if (pinned) {
              state.root = clearPanePreviewBufferEverywhere(state.root, bufferId);
              state.bottomRoot = clearPanePreviewBufferEverywhere(state.bottomRoot, bufferId);
            }
          });
        },

        clearPreviewBufferEverywhere: (bufferId) => {
          set((state) => {
            state.root = clearPanePreviewBufferEverywhere(state.root, bufferId);
            state.bottomRoot = clearPanePreviewBufferEverywhere(state.bottomRoot, bufferId);
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
  );

export const usePaneStore = createSelectors(createWorkspaceScopedStore("pane", createPaneStore));
