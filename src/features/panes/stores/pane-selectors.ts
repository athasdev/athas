import type { PaneGroup, PaneNode } from "../types/pane.types";
import { findPaneGroup, isBufferPinnedInTree, isBufferPreviewInTree } from "../services/pane-tree";
import { usePaneStore } from "./pane.store";

/**
 * Selectors over the pane layout, the single source of truth for which buffers are shown where,
 * which is active, previewed or pinned. Buffers themselves carry none of these flags.
 */
export interface PaneLayoutState {
  root: PaneNode;
  bottomRoot: PaneNode;
  activePaneId: string;
  mostRecentActivePaneIds: string[];
}

export function selectActivePane(state: PaneLayoutState): PaneGroup | null {
  return (
    findPaneGroup(state.root, state.activePaneId) ??
    findPaneGroup(state.bottomRoot, state.activePaneId)
  );
}

/**
 * The workbench's active buffer: the focused pane's active tab. When the focused pane is empty it
 * falls back to the most recently focused pane that shows something, which is what the old stored
 * value kept pointing at.
 */
export function selectActiveBufferId(state: PaneLayoutState): string | null {
  const activePane = selectActivePane(state);
  if (activePane?.activeBufferId) return activePane.activeBufferId;

  for (const paneId of state.mostRecentActivePaneIds) {
    const pane = findPaneGroup(state.root, paneId) ?? findPaneGroup(state.bottomRoot, paneId);
    if (pane?.activeBufferId) return pane.activeBufferId;
  }
  return null;
}

/** Pins are kept per pane but toggled for every pane showing the buffer. */
export function selectIsBufferPinned(state: PaneLayoutState, bufferId: string): boolean {
  return (
    isBufferPinnedInTree(state.root, bufferId) || isBufferPinnedInTree(state.bottomRoot, bufferId)
  );
}

export function selectIsBufferPreview(state: PaneLayoutState, bufferId: string): boolean {
  return (
    isBufferPreviewInTree(state.root, bufferId) || isBufferPreviewInTree(state.bottomRoot, bufferId)
  );
}

export interface PaneBufferFlags {
  pinnedBufferIds: ReadonlySet<string>;
  previewBufferIds: ReadonlySet<string>;
}

const flagCache = new WeakMap<PaneNode, WeakMap<PaneNode, PaneBufferFlags>>();

function collectFlags(node: PaneNode, pinned: Set<string>, preview: Set<string>) {
  if (node.type === "group") {
    for (const bufferId of node.pinnedBufferIds ?? []) pinned.add(bufferId);
    if (node.previewBufferId) preview.add(node.previewBufferId);
    return;
  }
  collectFlags(node.children[0], pinned, preview);
  collectFlags(node.children[1], pinned, preview);
}

/** Pinned and preview buffer ids across all panes, cached per layout. */
export function selectPaneBufferFlags(state: Pick<PaneLayoutState, "root" | "bottomRoot">) {
  let byBottomRoot = flagCache.get(state.root);
  if (!byBottomRoot) {
    byBottomRoot = new WeakMap();
    flagCache.set(state.root, byBottomRoot);
  }
  const cached = byBottomRoot.get(state.bottomRoot);
  if (cached) return cached;

  const pinnedBufferIds = new Set<string>();
  const previewBufferIds = new Set<string>();
  collectFlags(state.root, pinnedBufferIds, previewBufferIds);
  collectFlags(state.bottomRoot, pinnedBufferIds, previewBufferIds);
  const flags: PaneBufferFlags = { pinnedBufferIds, previewBufferIds };
  byBottomRoot.set(state.bottomRoot, flags);
  return flags;
}

const getPaneState = (workspaceId?: string) =>
  workspaceId ? usePaneStore.getStore(workspaceId).getState() : usePaneStore.getState();

/** Non-React read of the active buffer id for a workspace (the active one by default). */
export function getActiveBufferId(workspaceId?: string): string | null {
  return selectActiveBufferId(getPaneState(workspaceId));
}

export function isBufferPinned(bufferId: string, workspaceId?: string): boolean {
  return selectIsBufferPinned(getPaneState(workspaceId), bufferId);
}

export function isBufferPreview(bufferId: string, workspaceId?: string): boolean {
  return selectIsBufferPreview(getPaneState(workspaceId), bufferId);
}
