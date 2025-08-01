/**
 * App Initialization
 * Handles proper initialization order for stores and services
 * Eliminates circular dependency issues
 */

import { initializeCoordinationService } from "../services/editor-coordination-service";
import { initializeFileWatcherCoordination } from "../services/file-watcher-coordination-service";
import { initializeStoreRegistryAsync } from "../stores/store-registry";

/**
 * Initialize the entire application
 * Must be called before any components try to use stores
 */
export async function initializeApp(): Promise<void> {
  console.log("🚀 Initializing application...");

  try {
    // Step 1: Initialize store registry (handles dependency order)
    console.log("📦 Initializing store registry...");
    await initializeStoreRegistryAsync();

    // Step 2: Initialize coordination services
    console.log("🔧 Initializing coordination services...");
    initializeCoordinationService();
    initializeFileWatcherCoordination();

    console.log("✅ Application initialization complete!");
  } catch (error) {
    console.error("❌ Application initialization failed:", error);
    throw error;
  }
}

/**
 * Check if the app is properly initialized
 */
export function isAppInitialized(): boolean {
  try {
    // Try to access the store registry
    const { getStoreRegistry } = require("../stores/store-registry");
    getStoreRegistry();
    return true;
  } catch {
    return false;
  }
}
