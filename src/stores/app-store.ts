import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import * as coordinationService from "../services/editor-coordination-service";

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
    immer((_set, _get) => ({
      autoSaveTimeoutId: null,
      quickEditState: {
        isOpen: false,
        selectedText: "",
        cursorPosition: { x: 0, y: 0 },
        selectionRange: { start: 0, end: 0 },
      },
      actions: {
        handleContentChange: async (content: string) => {
          await coordinationService.handleContentChange(content);
        },

        handleSave: async () => {
          await coordinationService.handleSave();
        },

        openQuickEdit: (params: {
          text: string;
          cursorPosition: { x: number; y: number };
          selectionRange: { start: number; end: number };
        }) => {
          coordinationService.openQuickEdit(params);
        },

        closeQuickEdit: () => {
          coordinationService.closeQuickEdit();
        },

        cleanup: () => {
          coordinationService.cleanup();
        },
      },
    })),
  ),
);
