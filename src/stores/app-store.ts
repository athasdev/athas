import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
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

  actions: AppActions;
}

interface AppActions {
  handleContentChange: (content: string) => Promise<void>;
  handleSave: () => Promise<void>;
  openQuickEdit: (params: {
    text: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  }) => void;
  cleanup: () => void;
}

export const useAppStore = createSelectors(
  create<AppState>()(
    immer((set, get) => ({
      autoSaveTimeoutId: null,
      quickEditState: {
        isOpen: false,
        selectedText: "",
        cursorPosition: { x: 0, y: 0 },
        selectionRange: { start: 0, end: 0 },
      },
      actions: {
        handleContentChange: async (content: string) => {
          // Import stores dynamically to avoid circular dependencies
          const { useBufferStore } = await import("./buffer-store");
          const { useFileWatcherStore } = await import("./file-watcher-store");
          const { useSettingsStore } = await import("@/settings/stores/settings-store.ts");

          // Get dependencies from other stores
          const { activeBufferId, buffers } = useBufferStore.getState();
          const { updateBufferContent, markBufferDirty } = useBufferStore.getState().actions;
          const { settings } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = buffers.find((b) => b.id === activeBufferId);
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

              set((state) => {
                state.autoSaveTimeoutId = newTimeoutId;
              });
            }
          }
        },

        handleSave: async () => {
          // Import stores dynamically to avoid circular dependencies
          const { useBufferStore } = await import("./buffer-store");
          const { useSettingsStore } = await import("@/settings/stores/settings-store.ts");
          const { useFileWatcherStore } = await import("./file-watcher-store");

          const { activeBufferId, buffers } = useBufferStore.getState();
          const { markBufferDirty } = useBufferStore.getState().actions;
          const { updateSettingsFromJSON } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = buffers.find((b) => b.id === activeBufferId);
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

        openQuickEdit: (params: {
          text: string;
          cursorPosition: { x: number; y: number };
          selectionRange: { start: number; end: number };
        }) => {
          set((state) => {
            state.quickEditState = {
              isOpen: true,
              selectedText: params.text,
              cursorPosition: params.cursorPosition,
              selectionRange: params.selectionRange,
            };
          });
        },

        cleanup: () => {
          const { autoSaveTimeoutId } = get();
          if (autoSaveTimeoutId) {
            clearTimeout(autoSaveTimeoutId);
          }
        },
      },
    })),
  ),
);
