import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface FileChangeEvent {
  path: string;
  event_type: "modified" | "deleted";
}

interface FileWatcherState {
  // State
  watchedPaths: Set<string>;
  pendingSaves: Map<string, number>; // path -> timestamp

  // Actions
  startWatching: (path: string) => Promise<void>;
  stopWatching: (path: string) => Promise<void>;
  markPendingSave: (path: string) => void;
  clearPendingSave: (path: string) => void;

  // Reset state
  reset: () => void;
}

// Store the unlisten function outside of the store to prevent re-renders
let unlistenFileChanged: UnlistenFn | null = null;

export const useFileWatcherStore = create<FileWatcherState>((set, get) => ({
  // Initial state
  watchedPaths: new Set(),
  pendingSaves: new Map(),

  // Start watching a path (file or directory)
  startWatching: async (path: string) => {
    const { watchedPaths } = get();
    if (watchedPaths.has(path)) {
      return;
    }

    try {
      await invoke("start_watching", { path });
      set(state => ({
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
      set(state => {
        const newSet = new Set(state.watchedPaths);
        newSet.delete(path);
        return { watchedPaths: newSet };
      });
    } catch (error) {
      console.error("❌ Failed to stop watching:", path, error);
    }
  },

  // Mark a file as having a pending save
  markPendingSave: (path: string) => {
    set(state => {
      const newPendingSaves = new Map(state.pendingSaves);
      newPendingSaves.set(path, Date.now());
      return { pendingSaves: newPendingSaves };
    });

    // Auto-clear after 800ms to prevent stuck states (longer than Rust's 300ms debounce)
    setTimeout(() => {
      const { pendingSaves } = get();
      const timestamp = pendingSaves.get(path);
      if (timestamp && Date.now() - timestamp >= 800) {
        get().clearPendingSave(path);
      }
    }, 800);
  },

  // Clear pending save status for a file
  clearPendingSave: (path: string) => {
    set(state => {
      const newPendingSaves = new Map(state.pendingSaves);
      newPendingSaves.delete(path);
      return { pendingSaves: newPendingSaves };
    });
  },

  // Reset state
  reset: () => {
    set({
      watchedPaths: new Set(),
      pendingSaves: new Map(),
    });
  },
}));

// Initialize event listener (called only once)
export async function initializeFileWatcherListener() {
  // Clean up existing listener first
  await cleanupFileWatcherListener();

  // Listen for file changes
  unlistenFileChanged = await listen<FileChangeEvent>("file-changed", event => {
    const { path, event_type } = event.payload;
    console.log(`📋 [FileWatcher] File change event: ${path}, type: ${event_type}`);

    // Check if this file has a pending save
    const { pendingSaves } = useFileWatcherStore.getState();
    if (pendingSaves.has(path)) {
      console.log(`📋 [FileWatcher] Ignoring change for ${path} - pending save`);
      // Don't clear here - let the auto-clear timeout handle it
      return;
    }

    // Emit a custom event that the App component can listen to
    window.dispatchEvent(
      new CustomEvent("file-external-change", {
        detail: { path, changeType: event_type },
      }),
    );
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
