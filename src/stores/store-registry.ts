/**
 * Store Registry - Central dependency injection container for all stores
 * Eliminates circular dependencies by providing controlled access to stores
 */

// Type imports removed to avoid circular dependencies
// Using 'any' types in StoreRegistry interface for now

// Store type definitions - using any for now to avoid circular type issues
export interface StoreRegistry {
  // Core stores
  appStore: any;
  bufferStore: any;
  fileWatcherStore: any;
  recentFilesStore: any;

  // Settings stores
  settingsStore: any;
  persistentSettingsStore: any;

  // Feature stores
  fileSystemStore: any;
  aiChatStore: any;
}

// Global registry instance
let registry: StoreRegistry | null = null;

/**
 * Async version of store registry initialization
 */
export async function initializeStoreRegistryAsync(): Promise<StoreRegistry> {
  if (registry) {
    return registry;
  }

  // Level 1: Independent stores (no dependencies)
  const { useSettingsStore } = await import("../settings/stores/settings-store");
  const { usePersistentSettingsStore } = await import(
    "../settings/stores/persistent-settings-store"
  );
  const { useRecentFilesStore } = await import("./recent-files-store");
  const { useFileSystemStore } = await import("./file-system/store");
  const { useAIChatStore } = await import("./ai-chat/store");

  // Level 2: Stores with Level 1 dependencies
  const { useBufferStore } = await import("./buffer-store");

  // Level 3: Stores with Level 2 dependencies
  const { useFileWatcherStore } = await import("./file-watcher-store");

  // Level 4: Coordination stores (depends on multiple stores)
  const { useAppStore } = await import("./app-store");

  // Create registry
  registry = {
    // Core stores
    appStore: useAppStore,
    bufferStore: useBufferStore,
    fileWatcherStore: useFileWatcherStore,
    recentFilesStore: useRecentFilesStore,

    // Settings stores
    settingsStore: useSettingsStore,
    persistentSettingsStore: usePersistentSettingsStore,

    // Feature stores
    fileSystemStore: useFileSystemStore,
    aiChatStore: useAIChatStore,
  };

  return registry;
}

/**
 * Get the store registry instance
 * Throws error if not initialized
 */
export function getStoreRegistry(): StoreRegistry {
  if (!registry) {
    throw new Error("Store registry not initialized. Call initializeStoreRegistryAsync() first.");
  }
  return registry;
}

/**
 * Type-safe store access helpers
 */
export const stores = {
  get app() {
    return getStoreRegistry().appStore;
  },
  get buffer() {
    return getStoreRegistry().bufferStore;
  },
  get fileWatcher() {
    return getStoreRegistry().fileWatcherStore;
  },
  get recentFiles() {
    return getStoreRegistry().recentFilesStore;
  },
  get settings() {
    return getStoreRegistry().settingsStore;
  },
  get persistentSettings() {
    return getStoreRegistry().persistentSettingsStore;
  },
  get fileSystem() {
    return getStoreRegistry().fileSystemStore;
  },
  get aiChat() {
    return getStoreRegistry().aiChatStore;
  },
};

/**
 * Reset the registry (useful for testing)
 */
export function resetStoreRegistry(): void {
  registry = null;
}
