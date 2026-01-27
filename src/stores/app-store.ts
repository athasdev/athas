import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { gitDiffCache } from "@/features/git/utils/diff-cache";
import { createSelectors } from "@/utils/zustand-selectors";
import { writeFile } from "../features/file-system/controllers/platform";

// History tracking state (module-level to avoid re-renders)
const HISTORY_DEBOUNCE_MS = 500;
const historyDebounceTimers = new Map<string, NodeJS.Timeout>();
const lastBufferContent = new Map<string, string>();

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
          const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
          const { useFileWatcherStore } = await import(
            "../features/file-system/controllers/file-watcher-store"
          );
          const { useSettingsStore } = await import("@/features/settings/store");
          const { useHistoryStore } = await import("@/features/editor/stores/history-store");

          // Get dependencies from other stores
          const { activeBufferId, buffers } = useBufferStore.getState();
          const { updateBufferContent, markBufferDirty } = useBufferStore.getState().actions;
          const { settings } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = buffers.find((b) => b.id === activeBufferId);
          if (!activeBuffer) return;

          // Track history for this buffer (debounced)
          if (activeBufferId) {
            const lastContent = lastBufferContent.get(activeBufferId);

            // Initialize lastContent if this is the first edit
            if (lastContent === undefined) {
              lastBufferContent.set(activeBufferId, activeBuffer.content);
            }

            // Only track if content actually changed
            if (content !== lastContent) {
              // Clear existing debounce timer
              const existingTimer = historyDebounceTimers.get(activeBufferId);
              if (existingTimer) {
                clearTimeout(existingTimer);
              }

              // Set new debounce timer to save history
              const timer = setTimeout(() => {
                const { pushHistory } = useHistoryStore.getState().actions;
                const oldContent = lastBufferContent.get(activeBufferId);

                // Save the OLD content to history (before this change)
                if (oldContent !== undefined) {
                  pushHistory(activeBufferId, {
                    content: oldContent,
                    timestamp: Date.now(),
                  });
                }

                // Update last content reference
                lastBufferContent.set(activeBufferId, content);
                historyDebounceTimers.delete(activeBufferId);
              }, HISTORY_DEBOUNCE_MS);

              historyDebounceTimers.set(activeBufferId, timer);
            }
          }

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

                  // Invalidate git diff cache for this file
                  const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
                  if (rootFolderPath) {
                    gitDiffCache.invalidate(rootFolderPath, activeBuffer.path);
                    // Small delay to ensure git operations are complete before updating gutter
                    // Note: This timeout is intentionally not stored as it's very short (50ms)
                    // and will complete before any cleanup is needed. If component unmounts
                    // during this time, the event will still fire but won't cause issues.
                    setTimeout(() => {
                      window.dispatchEvent(
                        new CustomEvent("git-status-updated", {
                          detail: { filePath: activeBuffer.path },
                        }),
                      );
                    }, 50);
                  }
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
          const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
          const { useSettingsStore } = await import("@/features/settings/store");
          const { useFileWatcherStore } = await import(
            "../features/file-system/controllers/file-watcher-store"
          );

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

              let contentToSave = activeBuffer.content;

              // Format on save if enabled
              const { settings } = useSettingsStore.getState();
              if (settings.formatOnSave) {
                const { formatContent } = await import(
                  "@/features/editor/formatter/formatter-service"
                );
                const languageId = extensionRegistry.getLanguageId(activeBuffer.path);

                const formatResult = await formatContent({
                  filePath: activeBuffer.path,
                  content: activeBuffer.content,
                  languageId: languageId || undefined,
                });

                if (formatResult.success && formatResult.formattedContent) {
                  contentToSave = formatResult.formattedContent;

                  // Update buffer with formatted content
                  const { updateBufferContent } = useBufferStore.getState().actions;
                  updateBufferContent(activeBufferId!, contentToSave, false);
                }
              }

              await writeFile(activeBuffer.path, contentToSave);
              markBufferDirty(activeBuffer.id, false);

              // Lint on save if enabled
              if (settings.lintOnSave) {
                const { lintContent } = await import("@/features/editor/linter/linter-service");
                const languageId = extensionRegistry.getLanguageId(activeBuffer.path);

                const lintResult = await lintContent({
                  filePath: activeBuffer.path,
                  content: contentToSave,
                  languageId: languageId || undefined,
                });

                if (lintResult.success && lintResult.diagnostics) {
                  // TODO: Store diagnostics and display in UI
                  // For now, just log them
                  console.log(
                    `Linting found ${lintResult.diagnostics.length} issues:`,
                    lintResult.diagnostics,
                  );
                }
              }

              // Invalidate git diff cache for this file
              const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
              if (rootFolderPath) {
                gitDiffCache.invalidate(rootFolderPath, activeBuffer.path);
                // Small delay to ensure git operations are complete before updating gutter
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("git-status-updated", {
                      detail: { filePath: activeBuffer.path },
                    }),
                  );
                }, 50);
              }
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
