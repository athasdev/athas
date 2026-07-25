import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { dirname } from "@tauri-apps/api/path";
import { combine } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/utils/buffer-index";
import { emitGitChanged } from "@/features/git/events/git-events";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { useFileSystemStore } from "../stores/file-system.store";

interface FileChangeEvent {
  path: string;
  event_type: "opened" | "reloaded" | "deleted";
}

// Store the unlisten function outside of the store to prevent re-renders
let unlistenFileChanged: UnlistenFn | null = null;

const initialState = {
  watchedPaths: new Set<string>(),
  pendingSaves: new Map<string, number>(), // path -> timestamp
};

const createFileWatcherStore = () =>
  createStore(
    combine(initialState, (set, get) => ({
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
    })),
  );

export const useFileWatcherStore = createWorkspaceScopedStore(
  "file-watcher",
  createFileWatcherStore,
);

// Debounce map for directory refreshes
const pendingRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
const REFRESH_DEBOUNCE_MS = 300;

function scheduleDirectoryRefresh(workspaceId: string, dirPath: string) {
  const refreshKey = `${workspaceId}:${dirPath}`;
  const existing = pendingRefreshes.get(refreshKey);
  if (existing) clearTimeout(existing);

  pendingRefreshes.set(
    refreshKey,
    setTimeout(async () => {
      pendingRefreshes.delete(refreshKey);
      await useFileSystemStore.getStore(workspaceId).getState().refreshDirectory(dirPath);
    }, REFRESH_DEBOUNCE_MS),
  );
}

// Initialize event listener (called only once)
export async function initializeFileWatcherListener() {
  // Clean up existing listener first
  await cleanupFileWatcherListener();

  // Listen for file changes
  unlistenFileChanged = await listen<FileChangeEvent>("file-changed", async (event) => {
    const { path, event_type } = event.payload;
    const workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId();
    const parentDir = await dirname(path);

    window.dispatchEvent(
      new CustomEvent("file-external-change", {
        detail: { path, event_type },
      }),
    );

    // Handle deleted files - refresh parent directory
    if (event_type === "deleted") {
      scheduleDirectoryRefresh(workspaceId, parentDir);
      return;
    }

    // Handle new files created externally - refresh parent directory
    if (event_type === "opened") {
      scheduleDirectoryRefresh(workspaceId, parentDir);
      return;
    }

    // Handle reloaded files (content changed externally)
    // Check if this file has a pending save
    const fileWatcherState = useFileWatcherStore.getStore(workspaceId).getState();
    const { pendingSaves } = fileWatcherState;
    if (pendingSaves.has(path)) {
      // Don't clear here - let the auto-clear timeout handle it
      return;
    }

    // Handle the file change directly
    const bufferState = useBufferStore.getStore(workspaceId).getState();
    const { buffers } = bufferState;
    const { reloadBufferFromDisk } = bufferState.actions;
    const buffer = getBufferByPath(buffers, path);

    if (buffer) {
      // Reload buffer content from disk
      await reloadBufferFromDisk(buffer.id);

      // Dispatch custom event for file reload notification
      window.dispatchEvent(new CustomEvent("file-reloaded", { detail: { path } }));

      // Also trigger git gutter update for external file changes
      emitGitChanged({
        filePath: path,
        scopes: ["working-tree"],
        source: "external-file-change",
      });
    }
  });
}

// Cleanup event listener
export async function cleanupFileWatcherListener() {
  if (unlistenFileChanged) {
    try {
      unlistenFileChanged();
    } catch (error) {
      console.error("Error cleaning up file change listener:", error);
    }
    unlistenFileChanged = null;
  }
}
