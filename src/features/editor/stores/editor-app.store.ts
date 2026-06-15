import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useFileWatcherStore } from "@/features/file-system/stores/file-watcher.store";
import { gitDiffCache } from "@/features/git/utils/git-diff-cache";
import { recordLocalHistoryFile } from "@/features/local-history/api/local-history-api";
import {
  isEditorContent,
  type EditorContent,
  type PaneContent,
} from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { createSelectors } from "@/utils/zustand-selectors";
import { writeFile } from "@/features/file-system/controllers/platform";
import type { Position, Range } from "../types/editor.types";
import { trackBufferHistoryChange } from "./buffer-history-tracking";
import { useBufferStore } from "./buffer.store";

async function recordLocalHistoryBeforeWrite(
  path: string,
  reason: "save" | "auto-save" | "restore",
): Promise<void> {
  try {
    await recordLocalHistoryFile(path, reason);
  } catch (error) {
    console.warn("Failed to record local history:", error);
  }
}

async function saveEditorBufferById(bufferId: string): Promise<boolean> {
  const { buffers } = useBufferStore.getState();
  const { markBufferDirty, updateBufferContent, updateBufferPath } =
    useBufferStore.getState().actions;
  const { updateSettingsFromJSON } = useSettingsStore.getState();
  const { markPendingSave } = useFileWatcherStore.getState();
  const activeBuffer = buffers.find((buffer) => buffer.id === bufferId);
  if (!activeBuffer || !isEditorContent(activeBuffer)) return false;

  const { parseCollaborationNoteBufferPath } =
    await import("@/features/collaboration/lib/collaboration-sidebar-model");
  const collaborationNoteTarget = parseCollaborationNoteBufferPath(activeBuffer.path);

  if (activeBuffer.path.startsWith("untitled:")) {
    const { save: saveDialog } = await import("@tauri-apps/plugin-dialog");
    const result = await saveDialog({
      title: "Save",
      defaultPath: activeBuffer.name,
      filters: [{ name: "All Files", extensions: ["*"] }],
    });
    if (!result) return false;

    await writeFile(result, activeBuffer.content);
    updateBufferPath(activeBuffer.id, result);
    markBufferDirty(activeBuffer.id, false);
    return true;
  }

  if (collaborationNoteTarget) {
    const { updateCollaborationChannelNote } = await import("@/features/window/services/auth-api");
    const { useAuthStore } = await import("@/features/window/stores/auth.store");
    const { updateCollaborationNoteFile } =
      await import("@/features/collaboration/lib/collaboration-sidebar-model");
    const { subscription, setCollaborationSnapshot } = useAuthStore.getState();
    const collaboration = subscription?.collaboration;
    const channelNote = collaboration?.channelNotes.find(
      (note) => note.channelId === collaborationNoteTarget.channelId,
    );

    if (!channelNote) {
      markBufferDirty(activeBuffer.id, true);
      return false;
    }

    const nextCollaboration = await updateCollaborationChannelNote({
      channelId: collaborationNoteTarget.channelId,
      contentMarkdown: updateCollaborationNoteFile({
        contentMarkdown: channelNote.contentMarkdown,
        path: collaborationNoteTarget.notePath,
        fileContent: activeBuffer.content,
      }),
    });
    setCollaborationSnapshot(nextCollaboration);
    markBufferDirty(activeBuffer.id, false);
    return true;
  }

  if (activeBuffer.isVirtual) {
    if (activeBuffer.path === "settings://user-settings.json") {
      const success = updateSettingsFromJSON(activeBuffer.content);
      markBufferDirty(activeBuffer.id, !success);
      return success;
    }

    markBufferDirty(activeBuffer.id, false);
    return true;
  }

  if (activeBuffer.path.startsWith("remote://")) {
    markBufferDirty(activeBuffer.id, true);
    const pathParts = activeBuffer.path.replace("remote://", "").split("/");
    const connectionId = pathParts.shift();
    const remotePath = `/${pathParts.join("/")}`;

    if (!connectionId) return false;

    try {
      await invoke("ssh_write_file", {
        connectionId,
        filePath: remotePath,
        content: activeBuffer.content,
      });
      markBufferDirty(activeBuffer.id, false);
      return true;
    } catch (error) {
      console.error("Error saving remote file:", error);
      markBufferDirty(activeBuffer.id, true);
      return false;
    }
  }

  try {
    markPendingSave(activeBuffer.path);

    let contentToSave = activeBuffer.content;
    const { settings } = useSettingsStore.getState();

    if (settings.formatOnSave) {
      const { formatContent } = await import("@/features/editor/formatter/formatter-service");
      const languageId = extensionRegistry.getLanguageId(activeBuffer.path);

      const formatResult = await formatContent({
        filePath: activeBuffer.path,
        content: activeBuffer.content,
        languageId: languageId || undefined,
      });

      if (formatResult.success && formatResult.formattedContent) {
        contentToSave = formatResult.formattedContent;
        updateBufferContent(activeBuffer.id, contentToSave, false);
      }
    }

    await recordLocalHistoryBeforeWrite(activeBuffer.path, "save");
    await writeFile(activeBuffer.path, contentToSave);
    const { LspClient } = await import("@/features/editor/lsp/lsp-client");
    await LspClient.getInstance().notifyDocumentSave(activeBuffer.path, contentToSave);
    markBufferDirty(activeBuffer.id, false);

    if (settings.lintOnSave) {
      const { lintContent } = await import("@/features/editor/linter/linter-service");
      const { convertLintDiagnostic, useDiagnosticsStore } =
        await import("@/features/diagnostics/stores/diagnostics.store");
      const languageId = extensionRegistry.getLanguageId(activeBuffer.path);

      const lintResult = await lintContent({
        filePath: activeBuffer.path,
        content: contentToSave,
        languageId: languageId || undefined,
      });

      if (lintResult.success && lintResult.diagnostics) {
        useDiagnosticsStore.getState().actions.setDiagnostics(
          activeBuffer.path,
          lintResult.diagnostics.map((diagnostic) =>
            convertLintDiagnostic(activeBuffer.path, diagnostic),
          ),
          "linter",
        );
      }
    }

    const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
    if (rootFolderPath) {
      gitDiffCache.invalidate(rootFolderPath, activeBuffer.path);
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("git-status-updated", {
            detail: { filePath: activeBuffer.path },
          }),
        );
      }, 50);
    }
    return true;
  } catch (error) {
    console.error("Error saving local file:", error);
    markBufferDirty(activeBuffer.id, true);
    return false;
  }
}

function getDirtyEditorBuffers(buffers: PaneContent[]): EditorContent[] {
  return buffers.filter(
    (buffer): buffer is EditorContent => isEditorContent(buffer) && buffer.isDirty,
  );
}

interface AppState {
  autoSaveTimeoutId: NodeJS.Timeout | null;
  quickEditState: {
    isOpen: boolean;
    selectedText: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  };
  actions: AppActions;
}

interface AppActions {
  handleContentChange: (
    content: string,
    previousContent?: string,
    previousCursorPosition?: Position,
    previousSelection?: Range,
    options?: { contentAlreadyApplied?: boolean; skipUndoGrouping?: boolean },
  ) => Promise<void>;
  handleSave: () => Promise<void>;
  handleSaveAll: () => Promise<number>;
  openQuickEdit: (params: {
    text: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  }) => void;
  cleanup: () => void;
}

export const useEditorAppStore = createSelectors(
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
        handleContentChange: async (
          content: string,
          previousContent?: string,
          previousCursorPosition?: Position,
          previousSelection?: Range,
          options?: { contentAlreadyApplied?: boolean; skipUndoGrouping?: boolean },
        ) => {
          const { activeBufferId, buffers } = useBufferStore.getState();
          const { updateBufferContent, markBufferDirty } = useBufferStore.getState().actions;
          const { settings } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();
          const contentAlreadyApplied = options?.contentAlreadyApplied === true;

          const activeBuffer = buffers.find((b) => b.id === activeBufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer)) return;
          const { parseCollaborationNoteBufferPath } =
            await import("@/features/collaboration/lib/collaboration-sidebar-model");
          const collaborationNoteTarget = parseCollaborationNoteBufferPath(activeBuffer.path);

          if (activeBufferId) {
            trackBufferHistoryChange({
              bufferId: activeBufferId,
              currentContent: activeBuffer.content,
              nextContent: content,
              previousContent,
              previousCursorPosition,
              previousSelection,
              skipUndoGrouping: options?.skipUndoGrouping,
            });
          }

          const isRemoteFile = activeBuffer.path.startsWith("remote://");

          if (isRemoteFile) {
            if (!contentAlreadyApplied) {
              updateBufferContent(activeBuffer.id, content, false);
            }
          } else if (collaborationNoteTarget) {
            if (!contentAlreadyApplied) {
              updateBufferContent(activeBuffer.id, content, true);
            }
            markBufferDirty(activeBuffer.id, content !== activeBuffer.savedContent);
          } else {
            if (!contentAlreadyApplied) {
              updateBufferContent(activeBuffer.id, content, true);
            }

            if (!activeBuffer.isVirtual && settings.autoSave) {
              const { autoSaveTimeoutId } = get();
              if (autoSaveTimeoutId) {
                clearTimeout(autoSaveTimeoutId);
              }

              const newTimeoutId = setTimeout(async () => {
                try {
                  markPendingSave(activeBuffer.path);
                  await recordLocalHistoryBeforeWrite(activeBuffer.path, "auto-save");
                  await writeFile(activeBuffer.path, content);
                  markBufferDirty(activeBuffer.id, false);

                  const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
                  if (rootFolderPath) {
                    gitDiffCache.invalidate(rootFolderPath, activeBuffer.path);
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
          const { activeBufferId, buffers } = useBufferStore.getState();
          const activeBuffer = buffers.find((b) => b.id === activeBufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer)) return;

          await saveEditorBufferById(activeBuffer.id);
        },

        handleSaveAll: async () => {
          const dirtyBufferIds = getDirtyEditorBuffers(useBufferStore.getState().buffers).map(
            (buffer) => buffer.id,
          );
          const saveResults = await Promise.all(
            dirtyBufferIds.map(async (bufferId) => {
              const saved = await saveEditorBufferById(bufferId);
              const nextBuffer = useBufferStore
                .getState()
                .buffers.find((buffer) => buffer.id === bufferId);
              return saved && (!nextBuffer || !isEditorContent(nextBuffer) || !nextBuffer.isDirty);
            }),
          );

          return saveResults.filter(Boolean).length;
        },

        openQuickEdit: (params) => {
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
