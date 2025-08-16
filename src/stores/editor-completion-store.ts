import type { CompletionItem } from "vscode-languageserver-protocol";
import { create } from "zustand";
import { useSettingsStore } from "@/settings/store";
import type { FilteredCompletion } from "@/utils/fuzzy-matcher";
import { createSelectors } from "@/utils/zustand-selectors";

// Types
type HoverInfo = {
  content: string;
  position: { top: number; left: number };
};

type CompletionPosition = {
  top: number;
  left: number;
};

interface EditorCompletionState {
  // LSP State
  lspCompletions: CompletionItem[];
  filteredCompletions: FilteredCompletion[];
  currentPrefix: string;
  selectedLspIndex: number;
  isLspCompletionVisible: boolean;
  completionPosition: CompletionPosition;
  hoverInfo: HoverInfo | null;
  isHovering: boolean;

  // AI Completion State
  aiCompletion: boolean;

  // Actions
  actions: EditorCompletionActions;
}

interface EditorCompletionActions {
  setLspCompletions: (completions: CompletionItem[]) => void;
  setFilteredCompletions: (completions: FilteredCompletion[]) => void;
  setCurrentPrefix: (prefix: string) => void;
  setSelectedLspIndex: (index: number) => void;
  setIsLspCompletionVisible: (visible: boolean) => void;
  setCompletionPosition: (position: CompletionPosition) => void;
  setHoverInfo: (info: HoverInfo | null) => void;
  setIsHovering: (hovering: boolean) => void;
  setAiCompletion: (enabled: boolean) => void;
}

export const useEditorCompletionStore = createSelectors(
  create<EditorCompletionState>()((set) => ({
    // LSP State
    lspCompletions: [],
    filteredCompletions: [],
    currentPrefix: "",
    selectedLspIndex: 0,
    isLspCompletionVisible: false,
    completionPosition: { top: 0, left: 0 },
    hoverInfo: null,
    isHovering: false,

    // AI Completion State
    aiCompletion: false,
    actions: {
      setLspCompletions: (completions: CompletionItem[]) => set({ lspCompletions: completions }),
      setFilteredCompletions: (completions: FilteredCompletion[]) =>
        set({ filteredCompletions: completions }),
      setCurrentPrefix: (prefix: string) => set({ currentPrefix: prefix }),
      setSelectedLspIndex: (index: number) => set({ selectedLspIndex: index }),
      setIsLspCompletionVisible: (visible: boolean) => set({ isLspCompletionVisible: visible }),
      setCompletionPosition: (position: CompletionPosition) =>
        set({ completionPosition: position }),
      setHoverInfo: (info: HoverInfo | null) => set({ hoverInfo: info }),
      setIsHovering: (hovering: boolean) => set({ isHovering: hovering }),
      setAiCompletion: (enabled: boolean) => set({ aiCompletion: enabled }),
    },
  })),
);

// Subscribe to settings store and sync AI completion setting
useSettingsStore.subscribe((state) => {
  const { aiCompletion } = state.settings;
  useEditorCompletionStore.getState().actions.setAiCompletion(aiCompletion);
});
