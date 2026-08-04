import { invoke } from "@tauri-apps/api/core";
import { combine } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

const initialState = {
  watchedPaths: new Set<string>(),
  pendingSaves: new Map<string, number>(), // path -> timestamp
};

const createFileWatcherStore = () =>
  createStore(
    combine(initialState, (set, get) => ({
      actions: {
        // Set the project root and start watching it
        setProjectRoot: async (path: string) => {
          try {
            await invoke("set_project_root", { path });
          } catch (error) {
            console.error("Failed to set project root:", path, error);
          }
        },

        // Start watching a path (file or directory)
        startWatching: async (path: string) => {
          const { watchedPaths } = get();
          if (watchedPaths.has(path)) {
            return;
          }

          try {
            await invoke("start_watching", { path });
            set((state) => ({
              watchedPaths: new Set(state.watchedPaths).add(path),
            }));
          } catch (error) {
            console.error("Failed to start watching:", path, error);
          }
        },

        // Stop watching a path
        stopWatching: async (path: string) => {
          const { watchedPaths } = get();
          if (!watchedPaths.has(path)) {
            return;
          }

          try {
            await invoke("stop_watching", { path });
            set((state) => {
              const newSet = new Set(state.watchedPaths);
              newSet.delete(path);
              return { watchedPaths: newSet };
            });
          } catch (error) {
            console.error("Failed to stop watching:", path, error);
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

          // Auto-clear after 800ms to prevent stuck states (longer than Rust's 300ms debounce)
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
            watchedPaths: new Set(),
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
