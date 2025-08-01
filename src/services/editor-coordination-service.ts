/**
 * Editor Coordination Service
 * Handles coordination between multiple stores for editor operations
 * Eliminates the need for circular dependencies between stores
 */

import { invoke } from "@tauri-apps/api/core";
import { stores } from "../stores/store-registry";
import { writeFile } from "../utils/platform";

/**
 * Handle content changes in the editor
 * Coordinates between buffer, settings, and file watcher stores
 */
export async function handleContentChange(content: string): Promise<void> {
  // Get current state from stores
  const { activeBufferId, buffers } = stores.buffer.getState();
  const { updateBufferContent, markBufferDirty } = stores.buffer.getState().actions;
  const { settings } = stores.settings.getState();
  const { markPendingSave } = stores.fileWatcher.getState();

  const activeBuffer = buffers.find((b: any) => b.id === activeBufferId);
  if (!activeBuffer) return;

  const isRemoteFile = activeBuffer.path.startsWith("remote://");

  if (isRemoteFile) {
    updateBufferContent(activeBuffer.id, content, false);
  } else {
    updateBufferContent(activeBuffer.id, content, true);

    // Handle autosave
    if (!activeBuffer.isVirtual && settings.autoSave) {
      // Clear existing timeout
      const { autoSaveTimeoutId } = stores.app.getState();
      if (autoSaveTimeoutId) {
        clearTimeout(autoSaveTimeoutId);
      }

      // Set new timeout
      const newTimeoutId = setTimeout(async () => {
        try {
          markPendingSave(activeBuffer.path);
          await writeFile(activeBuffer.path, content);
          markBufferDirty(activeBuffer.id, false);
        } catch (error) {
          console.error("Error saving file:", error);
          markBufferDirty(activeBuffer.id, true);
        }
      }, 150);

      stores.app.setState((state: any) => {
        state.autoSaveTimeoutId = newTimeoutId;
      });
    }
  }
}

/**
 * Handle save operations
 * Coordinates between buffer, settings, and file watcher stores
 */
export async function handleSave(): Promise<void> {
  const { activeBufferId, buffers } = stores.buffer.getState();
  const { markBufferDirty } = stores.buffer.getState().actions;
  const { updateSettingsFromJSON } = stores.settings.getState();
  const { markPendingSave } = stores.fileWatcher.getState();

  const activeBuffer = buffers.find((b: any) => b.id === activeBufferId);
  if (!activeBuffer) return;

  if (activeBuffer.isVirtual) {
    // Handle virtual files (like settings)
    if (activeBuffer.path === "settings://user-settings.json") {
      const success = updateSettingsFromJSON(activeBuffer.content);
      markBufferDirty(activeBuffer.id, !success);
    } else {
      markBufferDirty(activeBuffer.id, false);
    }
  } else if (activeBuffer.path.startsWith("remote://")) {
    // Handle remote file save
    markBufferDirty(activeBuffer.id, true);
    const pathParts = activeBuffer.path.replace("remote://", "").split("/");
    const connectionId = pathParts.shift();
    const remotePath = `/${pathParts.join("/")}`;

    if (connectionId) {
      try {
        await invoke("ssh_write_file", {
          connectionId,
          filePath: remotePath,
          content: activeBuffer.content,
        });
        markBufferDirty(activeBuffer.id, false);
      } catch (error) {
        console.error("Error saving remote file:", error);
        markBufferDirty(activeBuffer.id, true);
      }
    }
  } else {
    // Handle local file save
    try {
      markPendingSave(activeBuffer.path);
      await writeFile(activeBuffer.path, activeBuffer.content);
      markBufferDirty(activeBuffer.id, false);
    } catch (error) {
      console.error("Error saving local file:", error);
      markBufferDirty(activeBuffer.id, true);
    }
  }
}

/**
 * Handle quick edit operations
 * Manages the quick edit modal state
 */
export function openQuickEdit(params: {
  text: string;
  cursorPosition: { x: number; y: number };
  selectionRange: { start: number; end: number };
}): void {
  stores.app.setState((state: any) => {
    state.quickEditState = {
      isOpen: true,
      selectedText: params.text,
      cursorPosition: params.cursorPosition,
      selectionRange: params.selectionRange,
    };
  });
}

/**
 * Close quick edit modal
 */
export function closeQuickEdit(): void {
  stores.app.setState((state: any) => {
    state.quickEditState = {
      isOpen: false,
      selectedText: "",
      cursorPosition: { x: 0, y: 0 },
      selectionRange: { start: 0, end: 0 },
    };
  });
}

/**
 * Cleanup coordination service resources
 */
export function cleanup(): void {
  const { autoSaveTimeoutId } = stores.app.getState();
  if (autoSaveTimeoutId) {
    clearTimeout(autoSaveTimeoutId);
    stores.app.setState((state: any) => {
      state.autoSaveTimeoutId = null;
    });
  }
}

/**
 * Initialize coordination service
 * Sets up any necessary subscriptions or listeners
 */
export function initializeCoordinationService(): void {
  // Any initialization logic can go here
  console.log("📋 Editor coordination service initialized");
}
