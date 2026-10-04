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
import { getBufferById } from "../utils/buffer-index";
import { trackBufferHistoryChange } from "./buffer-history-tracking";
import { useBufferStore } from "./buffer.store";
import { discardEditorViewContentChange, queueEditorViewContentChange } from "./view.store";

interface AppState {
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
  handleSaveAs: () => Promise<boolean>;
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
    immer((set) => ({
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
          const result = applyBufferContentChanges(bufferId, batch, true);
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
          const { activeBufferId, buffers } = useBufferStore.getState();
          const { updateBufferContent, markBufferDirty } = useBufferStore.getState().actions;
          const { settings } = useSettingsStore.getState();
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
          const { activeBufferId, buffers } = useBufferStore.getState();
          const activeBuffer = getBufferById(buffers, activeBufferId);
          if (
            !activeBuffer ||
            (activeBuffer.type !== "image" &&
              (!isEditorContent(activeBuffer) || activeBuffer.readOnly))
          )
            return false;

          return savePaneContent(captureBufferStoreOwner(), activeBuffer.id);
        },

        handleSaveAs: async () => {
          const { activeBufferId } = useBufferStore.getState();
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
          cleanupEditorAutoSave();
        },
      },
    })),
  ),
);
