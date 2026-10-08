import { captureBufferStoreOwner } from "@/features/editor/services/buffer-store-owner";
import { savePaneContent } from "@/features/panes/services/pane-content-save-service";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { parseCollaborationNoteBufferPath } from "@/features/collaboration/lib/collaboration-sidebar-model";
import { isDirtyContent, isEditorContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { cleanupEditorAutoSave, scheduleEditorAutoSave } from "../services/editor-save-service";
import { createSelectors } from "@/utils/zustand-selectors";
import type {
  EditorContentChangeOptions,
  EditorDocumentChangeBatch,
  EditorDocumentChangeResult,
  Position,
  Range,
} from "../types/editor.types";
import { readBufferText } from "../services/buffer-text";
import type { LiveDocumentEdit } from "../services/live-document-registry";
import { getBufferById } from "./buffer-index";
import { trackBufferHistoryChange } from "./buffer-history-tracking";
import { useBufferStore } from "./buffer.store";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";

interface AppState {
  actions: AppActions;
}

interface AppActions {
  handleDocumentChange: (
    bufferId: string,
    batch: EditorDocumentChangeBatch,
    previousCursorPosition?: Position,
    previousSelection?: Range,
    liveEdit?: LiveDocumentEdit,
  ) => EditorDocumentChangeResult;
  handleContentChange: (
    content: string,
    previousContent?: string,
    previousCursorPosition?: Position,
    previousSelection?: Range,
    options?: EditorContentChangeOptions,
  ) => Promise<void>;
  handleSave: () => Promise<boolean>;
  handleSaveAs: () => Promise<boolean>;
  handleSaveAll: () => Promise<number>;
  cleanup: () => void;
}

export const useEditorAppStore = createSelectors(
  create<AppState>()(
    immer(() => ({
      actions: {
        handleDocumentChange: (
          bufferId,
          batch,
          previousCursorPosition,
          previousSelection,
          liveEdit,
        ) => {
          const { buffers } = useBufferStore.getState();
          const { applyBufferContentChanges, applyLiveDocumentChange, markBufferDirty } =
            useBufferStore.getState().actions;
          const activeBuffer = getBufferById(buffers, bufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer)) {
            return { accepted: false, synchronized: false, contentRevision: 0 };
          }

          const collaborationNoteTarget = parseCollaborationNoteBufferPath(activeBuffer.path);
          const isRemoteFile = activeBuffer.path.startsWith("remote://");
          const isLive =
            liveEdit !== undefined &&
            !batch.isFlush &&
            !batch.isEolChange &&
            batch.fullContent === undefined;

          let result: EditorDocumentChangeResult;
          if (isLive) {
            // The view keeps the text: history and the dirty flag work from the change itself, so
            // a keystroke never copies the document.
            result = applyLiveDocumentChange(
              bufferId,
              batch,
              liveEdit,
              collaborationNoteTarget !== null,
            );
            if (!result.accepted) return result;
            trackBufferHistoryChange({
              bufferId,
              currentContent: liveEdit.previousText,
              nextContent: liveEdit.nextText,
              previousContent: liveEdit.previousText,
              previousCursorPosition,
              previousSelection,
              contentChanges: batch.changes,
            });
          } else {
            const previousContent = readBufferText(activeBuffer);
            result = applyBufferContentChanges(bufferId, batch, true);
            if (!result.accepted) return result;

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
          }

          const { settings } = useSettingsStore.getState();
          if (
            !isRemoteFile &&
            !collaborationNoteTarget &&
            !activeBuffer.isVirtual &&
            settings.autoSave
          ) {
            scheduleEditorAutoSave(bufferId);
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
          const { buffers } = useBufferStore.getState();
          const activeBufferId = getActiveBufferId();
          const { updateBufferContent, markBufferDirty } = useBufferStore.getState().actions;
          const { settings } = useSettingsStore.getState();
          const contentAlreadyApplied = options?.contentAlreadyApplied === true;

          const activeBuffer = getBufferById(buffers, activeBufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer)) return;
          const collaborationNoteTarget = parseCollaborationNoteBufferPath(activeBuffer.path);

          if (activeBufferId) {
            trackBufferHistoryChange({
              bufferId: activeBufferId,
              currentContent: readBufferText(activeBuffer),
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
              updateBufferContent(activeBuffer.id, content, true);
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
              scheduleEditorAutoSave(activeBuffer.id);
            }
          }
        },

        handleSave: async () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          if (
            !activeBuffer ||
            (activeBuffer.type !== "image" &&
              (!isEditorContent(activeBuffer) || activeBuffer.readOnly))
          )
            return false;

          return savePaneContent(captureBufferStoreOwner(), activeBuffer.id);
        },

        handleSaveAs: async () => {
          const activeBufferId = getActiveBufferId();
          if (!activeBufferId) return false;
          return savePaneContent(captureBufferStoreOwner(), activeBufferId, true);
        },

        handleSaveAll: async () => {
          const owner = captureBufferStoreOwner();
          const dirtyBufferIds = owner.store
            .getState()
            .buffers.filter(
              (buffer) => isDirtyContent(buffer) && (buffer.type !== "editor" || !buffer.readOnly),
            )
            .map((buffer) => buffer.id);
          const saveResults = await Promise.all(
            dirtyBufferIds.map(async (bufferId) => {
              const saved = await savePaneContent(owner, bufferId);
              const nextBuffer = getBufferById(owner.store.getState().buffers, bufferId);
              return saved && (!nextBuffer || !isDirtyContent(nextBuffer));
            }),
          );

          return saveResults.filter(Boolean).length;
        },

        cleanup: () => {
          cleanupEditorAutoSave();
        },
      },
    })),
  ),
);
