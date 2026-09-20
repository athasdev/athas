import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { parseCollaborationNoteBufferPath } from "@/features/collaboration/lib/collaboration-sidebar-model";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useFileWatcherStore } from "@/features/file-system/stores/file-watcher.store";
import { emitGitChanged } from "@/features/git/events/git-events";
import { recordLocalHistoryFile } from "@/features/local-history/api/local-history-api";
import { isEditorContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { createSelectors } from "@/utils/zustand-selectors";
import { writeFile } from "@/features/file-system/controllers/platform";
import type {
  EditorContentChangeOptions,
  EditorDocumentChangeBatch,
  EditorDocumentChangeResult,
  Position,
  Range,
} from "../types/editor.types";
import { getBufferById } from "../utils/buffer-index";
import { getDirtyWritableEditorBuffers } from "../utils/editor-buffer-selectors";
import { trackBufferHistoryChange } from "./buffer-history-tracking";
import { useBufferStore } from "./buffer.store";
import { discardEditorViewContentChange, queueEditorViewContentChange } from "./view.store";

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
  const { updateSettingsFromJSON } = useSettingsStore.getState().actions;
  const { markPendingSave } = useFileWatcherStore.getState().actions;
  const activeBuffer = getBufferById(buffers, bufferId);
  if (!activeBuffer || !isEditorContent(activeBuffer)) return false;
  if (activeBuffer.readOnly) return false;

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
    const [{ updateCollaborationChannelNote }, { useAuthStore }, { updateCollaborationNoteFile }] =
      await Promise.all([
        import("@/features/window/services/auth-api"),
        import("@/features/window/stores/auth.store"),
        import("@/features/collaboration/lib/collaboration-sidebar-model"),
      ]);
    const { subscription, actions } = useAuthStore.getState();
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
    actions.setCollaborationSnapshot(nextCollaboration);
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
      emitGitChanged({
        repoPath: rootFolderPath,
        filePath: activeBuffer.path,
        scopes: ["working-tree"],
        source: "save",
      });
    }
    return true;
  } catch (error) {
    console.error("Error saving local file:", error);
    markBufferDirty(activeBuffer.id, true);
    return false;
  }
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
  handleDocumentChange: (
    bufferId: string,
    batch: EditorDocumentChangeBatch,
    previousCursorPosition?: Position,
    previousSelection?: Range,
  ) => EditorDocumentChangeResult;
  handleContentChange: (
    content: string,
    previousContent?: string,
    previousCursorPosition?: Position,
    previousSelection?: Range,
    options?: EditorContentChangeOptions,
  ) => Promise<void>;
  handleSave: () => Promise<boolean>;
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
        handleDocumentChange: (bufferId, batch, previousCursorPosition, previousSelection) => {
          const { buffers } = useBufferStore.getState();
          const { applyBufferContentChanges, markBufferDirty } = useBufferStore.getState().actions;
          const activeBuffer = getBufferById(buffers, bufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer)) {
            return { accepted: false, synchronized: false, contentRevision: 0 };
          }

          const previousContent = activeBuffer.content;
          const previousContentRevision = activeBuffer.contentRevision ?? 0;
          queueEditorViewContentChange(bufferId, previousContentRevision, batch);
          const collaborationNoteTarget = parseCollaborationNoteBufferPath(activeBuffer.path);
          const isRemoteFile = activeBuffer.path.startsWith("remote://");
          const result = applyBufferContentChanges(bufferId, batch, isRemoteFile ? false : true);
          if (!result.accepted) {
            discardEditorViewContentChange(bufferId);
            return result;
          }

          const updatedBuffer = getBufferById(useBufferStore.getState().buffers, bufferId);
          if (!updatedBuffer || !isEditorContent(updatedBuffer)) return result;

          trackBufferHistoryChange({
            bufferId,
            currentContent: previousContent,
            nextContent: updatedBuffer.content,
            previousContent,
            previousCursorPosition,
            previousSelection,
            contentChanges: batch.changes,
          });

          if (collaborationNoteTarget) {
            markBufferDirty(bufferId, updatedBuffer.content !== updatedBuffer.savedContent);
          }

          const { settings } = useSettingsStore.getState();
          if (
            !isRemoteFile &&
            !collaborationNoteTarget &&
            !activeBuffer.isVirtual &&
            settings.autoSave
          ) {
            const { autoSaveTimeoutId } = get();
            if (autoSaveTimeoutId) clearTimeout(autoSaveTimeoutId);

            const newTimeoutId = setTimeout(async () => {
              const latestBuffer = getBufferById(useBufferStore.getState().buffers, bufferId);
              if (!latestBuffer || !isEditorContent(latestBuffer)) return;
              const savingRevision = latestBuffer.contentRevision ?? 0;
              try {
                useFileWatcherStore.getState().actions.markPendingSave(latestBuffer.path);
                await recordLocalHistoryBeforeWrite(latestBuffer.path, "auto-save");
                await writeFile(latestBuffer.path, latestBuffer.content);
                const currentBuffer = getBufferById(useBufferStore.getState().buffers, bufferId);
                if (
                  currentBuffer &&
                  isEditorContent(currentBuffer) &&
                  (currentBuffer.contentRevision ?? 0) === savingRevision
                ) {
                  markBufferDirty(bufferId, false);
                }

                const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
                if (rootFolderPath) {
                  emitGitChanged({
                    repoPath: rootFolderPath,
                    filePath: latestBuffer.path,
                    scopes: ["working-tree"],
                    source: "auto-save",
                  });
                }
              } catch (error) {
                console.error("Error saving file:", error);
                markBufferDirty(bufferId, true);
              }
            }, 150);
            set((state) => {
              state.autoSaveTimeoutId = newTimeoutId;
            });
          }

          return result;
        },

        handleContentChange: async (
          content: string,
          previousContent?: string,
          previousCursorPosition?: Position,
          previousSelection?: Range,
          options?: EditorContentChangeOptions,
        ) => {
          const { activeBufferId, buffers } = useBufferStore.getState();
          const { updateBufferContent, markBufferDirty } = useBufferStore.getState().actions;
          const { settings } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState().actions;
          const contentAlreadyApplied = options?.contentAlreadyApplied === true;

          const activeBuffer = getBufferById(buffers, activeBufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer)) return;
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
              contentChange: options?.contentChange,
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
                const latestBuffer = getBufferById(
                  useBufferStore.getState().buffers,
                  activeBuffer.id,
                );
                if (!latestBuffer || !isEditorContent(latestBuffer)) return;
                const savingRevision = latestBuffer.contentRevision ?? 0;
                try {
                  markPendingSave(latestBuffer.path);
                  await recordLocalHistoryBeforeWrite(latestBuffer.path, "auto-save");
                  await writeFile(latestBuffer.path, latestBuffer.content);
                  const currentBuffer = getBufferById(
                    useBufferStore.getState().buffers,
                    activeBuffer.id,
                  );
                  if (
                    currentBuffer &&
                    isEditorContent(currentBuffer) &&
                    (currentBuffer.contentRevision ?? 0) === savingRevision
                  ) {
                    markBufferDirty(activeBuffer.id, false);
                  }

                  const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
                  if (rootFolderPath) {
                    emitGitChanged({
                      repoPath: rootFolderPath,
                      filePath: latestBuffer.path,
                      scopes: ["working-tree"],
                      source: "auto-save",
                    });
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
          const activeBuffer = getBufferById(buffers, activeBufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer) || activeBuffer.readOnly)
            return false;

          return saveEditorBufferById(activeBuffer.id);
        },

        handleSaveAll: async () => {
          const dirtyBufferIds = getDirtyWritableEditorBuffers(
            useBufferStore.getState().buffers,
          ).map((buffer) => buffer.id);
          const saveResults = await Promise.all(
            dirtyBufferIds.map(async (bufferId) => {
              const saved = await saveEditorBufferById(bufferId);
              const nextBuffer = getBufferById(useBufferStore.getState().buffers, bufferId);
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
