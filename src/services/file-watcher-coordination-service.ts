/**
 * File Watcher Coordination Service
 * Handles coordination between file watcher and buffer stores
 * Eliminates circular dependencies
 */

import { stores } from "../stores/store-registry";

/**
 * Handle file change events from the file watcher
 * Coordinates with buffer store to reload changed files
 */
export async function handleFileChange(path: string): Promise<void> {
  // Handle the file change directly
  const { buffers } = stores.buffer.getState();
  const { reloadBufferFromDisk } = stores.buffer.getState().actions;
  const buffer = buffers.find((b: any) => b.path === path);

  if (buffer) {
    // Reload buffer content from disk
    await reloadBufferFromDisk(buffer.id);
    console.log(`🔄 Reloaded buffer from disk: ${path}`);
  }
}

/**
 * Initialize file watcher coordination service
 */
export function initializeFileWatcherCoordination(): void {
  console.log("👁️ File watcher coordination service initialized");
}
