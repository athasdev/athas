import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { LspClient } from "../lib/lsp/lsp-client";
import { useBufferStore } from "./buffer-store";

interface FileChangeEvent {
  path: string;
  event_type: "created" | "modified" | "deleted";
}

// Store the unlisten function outside of the store to prevent re-renders
let unlistenFileChanged: UnlistenFn | null = null;

const initialState = {
  watchedPaths: new Set<string>(),
  pendingSaves: new Map<string, number>(), // path -> timestamp
};

export const useFileWatcherStore = create(
  combine(initialState, (set, get) => ({
    // Set the project root and start watching it
    setProjectRoot: async (path: string) => {
      console.log(`📁 setProjectRoot called with path: ${path}`);
      try {
        await invoke("set_project_root", { path });
        console.log(`✅ Started watching project root: ${path}`);

        // Start LSP for the project
        try {
          console.log(`🚀 Attempting to start LSP for project: ${path}`);
          const lspClient = LspClient.getInstance();
          await lspClient.start(path);
          console.log(`✅ Started LSP for project: ${path}`);
        } catch (error) {
          console.error("❌ Failed to start LSP:", error);
        }
      } catch (error) {
        console.error("❌ Failed to set project root:", path, error);
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
        console.error("❌ Failed to start watching:", path, error);
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
        console.error("❌ Failed to stop watching:", path, error);
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

// Initialize event listener (called only once)
export async function initializeFileWatcherListener() {
  // Clean up existing listener first
  await cleanupFileWatcherListener();

  // Listen for file changes
  unlistenFileChanged = await listen<FileChangeEvent>("file-changed", async (event) => {
    const { path, event_type } = event.payload;
    console.log(`📋 [FileWatcher] File change event: ${path}, type: ${event_type}`);

    // Skip if file was deleted
    if (event_type === "deleted") {
      return;
    }

    // Check if this file has a pending save
    const { pendingSaves } = useFileWatcherStore.getState();
    if (pendingSaves.has(path)) {
      console.log(`📋 [FileWatcher] Ignoring change for ${path} - pending save`);
      // Don't clear here - let the auto-clear timeout handle it
      return;
    }

    // Handle the file change directly
    const { buffers } = useBufferStore.getState();
    const { reloadBufferFromDisk } = useBufferStore.getState().actions;
    const buffer = buffers.find((b) => b.path === path);

    if (buffer) {
      // Reload buffer content from disk
      await reloadBufferFromDisk(buffer.id);

      // Dispatch custom event for file reload notification
      window.dispatchEvent(new CustomEvent("file-reloaded", { detail: { path } }));
    }
  });
}

// Cleanup event listener
export async function cleanupFileWatcherListener() {
  if (unlistenFileChanged) {
    try {
      unlistenFileChanged();
    } catch (error) {
      console.error("❌ Error cleaning up file change listener:", error);
    }
    unlistenFileChanged = null;
  }
}
