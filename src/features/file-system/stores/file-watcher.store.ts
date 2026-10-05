import { commands } from "@/bindings/commands";
import { combine } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

const initialState = {
  /** The workspace root this window's watcher subscription is for, "" when none. */
  projectRoot: "",
  pendingSaves: new Map<string, number>(), // path -> timestamp
};

const createFileWatcherStore = () =>
  createStore(
    combine(initialState, (set, get) => ({
      actions: {
        /**
         * Watches `path` for this window and releases the previous root, so switching or
         * closing a folder stops its watch. An empty path only releases.
         */
        setProjectRoot: async (path: string) => {
          const next = path.trim() ? path : "";
          const previous = get().projectRoot;
          if (next === previous) {
            return;
          }
          set({ projectRoot: next });

          if (previous) {
            await commands
              .stopWatching(previous)
              .catch((error) => console.error("Failed to stop watching:", previous, error));
          }
          if (next) {
            await commands
              .setProjectRoot(next)
              .catch((error) => console.error("Failed to set project root:", next, error));
          }
        },

        // Clear pending save status for a file
        clearPendingSave: (path: string) => {
          set((state) => {
            const newPendingSaves = new Map(state.pendingSaves);
            newPendingSaves.delete(path);
            return { pendingSaves: newPendingSaves };
          });
        },

        // Mark a file as having a pending save
        markPendingSave: (path: string) => {
          set((state) => {
            const newPendingSaves = new Map(state.pendingSaves);
            newPendingSaves.set(path, Date.now());
            return { pendingSaves: newPendingSaves };
          });

          // Auto-clear after 800ms to prevent stuck states (longer than the watcher's 500ms
          // longest batch window)
          setTimeout(() => {
            const { pendingSaves } = get();
            const timestamp = pendingSaves.get(path);
            if (timestamp && Date.now() - timestamp >= 800) {
              // Clear the pending save using set directly
              set((state) => {
                const newPendingSaves = new Map(state.pendingSaves);
                newPendingSaves.delete(path);
                return { pendingSaves: newPendingSaves };
              });
            }
          }, 800);
        },

        // Reset state
        reset: () => {
          set({
            projectRoot: "",
            pendingSaves: new Map(),
          });
        },
      },
    })),
  );

export const useFileWatcherStore = createWorkspaceScopedStore(
  "file-watcher",
  createFileWatcherStore,
);
