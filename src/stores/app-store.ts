import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { writeFile } from "../utils/platform";

interface AppState {
  // Autosave state
  autoSaveTimeoutId: NodeJS.Timeout | null;

  // Quick edit state
  quickEditState: {
    isOpen: boolean;
    selectedText: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  };
}

export const useAppStore = create(
  immer(
    combine(
      {
        autoSaveTimeoutId: null,
        quickEditState: {
          isOpen: false,
          selectedText: "",
          cursorPosition: { x: 0, y: 0 },
          selectionRange: { start: 0, end: 0 },
        },
      } as AppState,
      (set, get) => ({
        // Content change handler - no more recreation on every render!
        handleContentChange: async (content: string) => {
          // Import stores dynamically to avoid circular dependencies
          const { useBufferStore } = await import("./buffer-store");
          const { useFileWatcherStore } = await import("./file-watcher-store");
          const { useSettingsStore } = await import("./settings-store");

          // Get dependencies from other stores
          const { activeBufferId, updateBufferContent, markBufferDirty } =
            useBufferStore.getState();
          const { settings } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = useBufferStore.getState().buffers.find(b => b.id === activeBufferId);
          if (!activeBuffer) return;

          const isRemoteFile = activeBuffer.path.startsWith("remote://");

          if (isRemoteFile) {
            updateBufferContent(activeBuffer.id, content, false);
          } else {
            updateBufferContent(activeBuffer.id, content, true);

            // Handle autosave
            if (!activeBuffer.isVirtual && settings.autoSave) {
              // Clear existing timeout
              const { autoSaveTimeoutId } = get();
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

              set(state => {
                state.autoSaveTimeoutId = newTimeoutId;
              });
            }
          }
        },

        // Save handler
        handleSave: async () => {
          // Import stores dynamically to avoid circular dependencies
          const { useBufferStore } = await import("./buffer-store");
          const { useSettingsStore } = await import("./settings-store");
          const { useFileWatcherStore } = await import("./file-watcher-store");

          const { activeBufferId, markBufferDirty } = useBufferStore.getState();
          const { updateSettingsFromJSON } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = useBufferStore.getState().buffers.find(b => b.id === activeBufferId);
          if (!activeBuffer) return;

          if (activeBuffer.isVirtual) {
            if (activeBuffer.path === "settings://user-settings.json") {
              const success = updateSettingsFromJSON(activeBuffer.content);
              markBufferDirty(activeBuffer.id, !success);
            } else {
              markBufferDirty(activeBuffer.id, false);
            }
          } else if (activeBuffer.path.startsWith("remote://")) {
            // Handle remote save
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
            // Handle local save
            try {
              markPendingSave(activeBuffer.path);
              await writeFile(activeBuffer.path, activeBuffer.content);
              markBufferDirty(activeBuffer.id, false);
            } catch (error) {
              console.error("Error saving local file:", error);
              markBufferDirty(activeBuffer.id, true);
            }
          }
        },

        // Quick edit handlers
        openQuickEdit: (params: {
          text: string;
          cursorPosition: { x: number; y: number };
          selectionRange: { start: number; end: number };
        }) => {
          set(state => {
            state.quickEditState = {
              isOpen: true,
              selectedText: params.text,
              cursorPosition: params.cursorPosition,
              selectionRange: params.selectionRange,
            };
          });
        },

        closeQuickEdit: () => {
          set(state => {
            state.quickEditState.isOpen = false;
          });
        },

        // Apply quick edit
        applyQuickEdit: async (editedText: string) => {
          const { useBufferStore } = await import("./buffer-store");
          const { activeBufferId, updateBufferContent } = useBufferStore.getState();
          const activeBuffer = useBufferStore.getState().buffers.find(b => b.id === activeBufferId);

          if (!activeBuffer) return;

          const { selectionRange } = get().quickEditState;
          const { start, end } = selectionRange;

          const newContent =
            activeBuffer.content.substring(0, start) +
            editedText +
            activeBuffer.content.substring(end);

          updateBufferContent(activeBuffer.id, newContent);
          set(state => {
            state.quickEditState.isOpen = false;
          });
        },

        // Cleanup
        cleanup: () => {
          const { autoSaveTimeoutId } = get();
          if (autoSaveTimeoutId) {
            clearTimeout(autoSaveTimeoutId);
          }
        },
      }),
    ),
  ),
);
