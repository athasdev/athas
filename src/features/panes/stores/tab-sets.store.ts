import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { ROOT_PANE_ID } from "../constants/pane";
import { closePane, getAllPaneGroups, normalizePaneTree } from "../services/pane-tree";
import type { PaneGroup, PaneNode } from "../types/pane.types";
import { usePaneStore } from "./pane.store";

/**
 * Whose editor tabs the centre shows: the project's own (its classic view) or one agent session's.
 * Each owner keeps its own set of tabs and splits; switching owners swaps the set in the pane
 * store and keeps the others aside. Buffers stay shared by the workspace, so a file open in two
 * sets is one buffer, and closing its tab in one set leaves it open in the other.
 */
export type TabSetOwner = "project" | `session:${string}`;

export const PROJECT_TAB_SET: TabSetOwner = "project";

export function getSessionTabSet(chatId: string): TabSetOwner {
  return `session:${chatId}`;
}

/** The session a tab set belongs to, or null for the project's. */
export function getTabSetSessionId(owner: TabSetOwner): string | null {
  return owner.startsWith("session:") ? owner.slice("session:".length) : null;
}

/** A tab set kept aside while another is on screen. The bottom pane is shared and not part of it. */
export interface TabSetLayout {
  root: PaneNode;
  activePaneId: string;
  mostRecentActivePaneIds?: string[];
  fullscreenPaneId: string | null;
}

function createEmptyTabSet(): TabSetLayout {
  return {
    root: { id: ROOT_PANE_ID, type: "group", bufferIds: [], activeBufferId: null },
    activePaneId: ROOT_PANE_ID,
    mostRecentActivePaneIds: [ROOT_PANE_ID],
    fullscreenPaneId: null,
  };
}

function keepBuffers(node: PaneNode, keep: (bufferId: string) => boolean): PaneNode {
  if (node.type === "split") {
    return {
      ...node,
      children: [keepBuffers(node.children[0], keep), keepBuffers(node.children[1], keep)],
    };
  }
  const bufferIds = node.bufferIds.filter(keep);
  if (bufferIds.length === node.bufferIds.length) return node;
  const group: PaneGroup = {
    ...node,
    bufferIds,
    activeBufferId: node.activeBufferId && keep(node.activeBufferId) ? node.activeBufferId : null,
    mruBufferIds: node.mruBufferIds?.filter(keep),
    pinnedBufferIds: node.pinnedBufferIds?.filter(keep),
    previewBufferId:
      node.previewBufferId && keep(node.previewBufferId) ? node.previewBufferId : null,
  };
  return group;
}

/** The buffers a tab set shows. */
export function getTabSetBufferIds(layout: Pick<TabSetLayout, "root">): string[] {
  return getAllPaneGroups(layout.root).flatMap((group) => group.bufferIds);
}

/**
 * The tab set without the buffers `keep` turns down, such as ones closed since it was kept. Splits
 * that lost every tab close, as they do when their last tab closes on screen.
 */
export function pruneTabSet(
  layout: TabSetLayout,
  keep: (bufferId: string) => boolean,
): TabSetLayout {
  const kept = keepBuffers(layout.root, keep);
  if (kept === layout.root) return layout;
  let root = kept;
  for (const group of getAllPaneGroups(kept)) {
    if (group.bufferIds.length > 0 || root.type === "group") continue;
    root = closePane(root, group.id) ?? root;
  }
  return { ...layout, root: normalizePaneTree(root) };
}

interface SwitchOptions {
  /** The set to show when the owner has none yet; an empty one by default. */
  initial?: () => TabSetLayout;
  /** Buffers that still exist; a kept set drops any others before it shows. */
  isOpenBuffer?: (bufferId: string) => boolean;
}

interface TabSetsState {
  activeOwner: TabSetOwner;
  /** Every owner's set but the one on screen, which lives in the pane store. */
  stored: Record<string, TabSetLayout>;
  actions: {
    /** Puts the set on screen aside and shows `owner`'s. Returns whether the owner changed. */
    switchTo: (owner: TabSetOwner, options?: SwitchOptions) => boolean;
    /** Buffers that a set other than the one on screen shows. */
    getHeldBufferIds: () => Set<string>;
    /** Takes buffers out of the sets kept aside, as when they are closed for good. */
    removeBuffers: (bufferIds: readonly string[]) => void;
    /** Forgets a session's set, as when the session is deleted. */
    forget: (owner: TabSetOwner) => void;
    /** Restores the sets kept aside from a saved session, the project's showing. */
    restore: (stored: Record<string, TabSetLayout>) => void;
  };
}

const createTabSetsStore = (workspaceId: string) =>
  createStore<TabSetsState>()((set, get) => {
    const paneStore = () => usePaneStore.getStore(workspaceId);
    return {
      activeOwner: PROJECT_TAB_SET,
      stored: {},
      actions: {
        switchTo: (owner, options = {}) => {
          const { activeOwner, stored } = get();
          if (owner === activeOwner) return false;
          const panes = paneStore().getState();
          const current: TabSetLayout = {
            root: panes.root,
            activePaneId: panes.activePaneId,
            mostRecentActivePaneIds: panes.mostRecentActivePaneIds,
            fullscreenPaneId: panes.fullscreenPaneId,
          };
          const kept = stored[owner];
          const next = kept
            ? options.isOpenBuffer
              ? pruneTabSet(kept, options.isOpenBuffer)
              : kept
            : (options.initial?.() ?? createEmptyTabSet());
          const nextStored: Record<string, TabSetLayout> = { ...stored, [activeOwner]: current };
          delete nextStored[owner];
          set({ activeOwner: owner, stored: nextStored });
          panes.actions.restoreLayout({ ...next, bottomRoot: panes.bottomRoot });
          return true;
        },
        getHeldBufferIds: () =>
          new Set(
            Object.values(get().stored).flatMap((layout) =>
              layout ? getTabSetBufferIds(layout) : [],
            ),
          ),
        removeBuffers: (bufferIds) => {
          if (bufferIds.length === 0) return;
          const removed = new Set(bufferIds);
          const { stored } = get();
          let changed = false;
          const next: Record<string, TabSetLayout> = {};
          for (const [owner, layout] of Object.entries(stored) as [TabSetOwner, TabSetLayout][]) {
            const pruned = pruneTabSet(layout, (bufferId) => !removed.has(bufferId));
            if (pruned.root !== layout.root) changed = true;
            next[owner] = pruned;
          }
          if (changed) set({ stored: next });
        },
        forget: (owner) => {
          if (owner === PROJECT_TAB_SET) return;
          if (owner === get().activeOwner) get().actions.switchTo(PROJECT_TAB_SET);
          if (!(owner in get().stored)) return;
          const next = { ...get().stored };
          delete next[owner];
          set({ stored: next });
        },
        restore: (stored) => set({ activeOwner: PROJECT_TAB_SET, stored }),
      },
    };
  });

export const useTabSetsStore = createWorkspaceScopedStore("tab-sets", createTabSetsStore);
