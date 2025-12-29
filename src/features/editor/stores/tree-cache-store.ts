/**
 * Tree Cache Store
 * Stores Tree-sitter parse trees per buffer for incremental parsing
 */

import type { Tree } from "web-tree-sitter";
import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export interface TreeCacheEntry {
  tree: Tree;
  contentLength: number; // Simple hash for staleness detection
  languageId: string;
  lastUpdated: number;
}

interface TreeCacheState {
  trees: Map<string, TreeCacheEntry>;

  actions: {
    setTree: (bufferId: string, tree: Tree, contentLength: number, languageId: string) => void;
    getTree: (bufferId: string) => TreeCacheEntry | undefined;
    clearTree: (bufferId: string) => void;
    clearAllTrees: () => void;
  };
}

export const useTreeCacheStore = createSelectors(
  create<TreeCacheState>()((set, get) => ({
    trees: new Map(),

    actions: {
      setTree: (bufferId, tree, contentLength, languageId) => {
        set((state) => {
          const newMap = new Map(state.trees);
          // Delete old tree to free memory
          const oldEntry = newMap.get(bufferId);
          if (oldEntry?.tree) {
            try {
              oldEntry.tree.delete();
            } catch {
              // Tree may already be deleted
            }
          }
          newMap.set(bufferId, {
            tree,
            contentLength,
            languageId,
            lastUpdated: Date.now(),
          });
          return { trees: newMap };
        });
      },

      getTree: (bufferId) => {
        return get().trees.get(bufferId);
      },

      clearTree: (bufferId) => {
        set((state) => {
          const newMap = new Map(state.trees);
          const entry = newMap.get(bufferId);
          if (entry?.tree) {
            try {
              entry.tree.delete();
            } catch {
              // Tree may already be deleted
            }
          }
          newMap.delete(bufferId);
          return { trees: newMap };
        });
      },

      clearAllTrees: () => {
        const { trees } = get();
        for (const entry of trees.values()) {
          if (entry?.tree) {
            try {
              entry.tree.delete();
            } catch {
              // Tree may already be deleted
            }
          }
        }
        set({ trees: new Map() });
      },
    },
  })),
);

// Subscribe to buffer store to clean up trees when buffers are closed
// This is done lazily to avoid circular dependency issues
let subscribed = false;

export function initTreeCacheSubscription() {
  if (subscribed) return;
  subscribed = true;

  // Dynamically import to avoid circular dependency
  import("./buffer-store").then(({ useBufferStore }) => {
    useBufferStore.subscribe((state, prevState) => {
      const currentBufferIds = new Set(state.buffers.map((b) => b.id));
      const previousBufferIds = new Set(prevState.buffers.map((b) => b.id));

      // Find closed buffers
      for (const bufferId of previousBufferIds) {
        if (!currentBufferIds.has(bufferId)) {
          // Buffer was closed, clean up its tree
          useTreeCacheStore.getState().actions.clearTree(bufferId);
        }
      }
    });
  });
}
