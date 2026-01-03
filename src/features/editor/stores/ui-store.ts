import type { CompletionItem } from "vscode-languageserver-protocol";
import { create } from "zustand";
import { useSettingsStore } from "@/features/settings/store";
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

type SearchMatch = {
  start: number;
  end: number;
};

interface EditorUIState {
  // Completion state
  lspCompletions: CompletionItem[];
  filteredCompletions: FilteredCompletion[];
  currentPrefix: string;
  selectedLspIndex: number;
  isLspCompletionVisible: boolean;
  completionPosition: CompletionPosition;
  hoverInfo: HoverInfo | null;
  isHovering: boolean;
  isApplyingCompletion: boolean;
  aiCompletion: boolean;
  lastInputTimestamp: number;

  // Search state
  searchQuery: string;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;

  // Actions
  actions: EditorUIActions;
}

interface EditorUIActions {
  // Completion actions
  setLspCompletions: (completions: CompletionItem[]) => void;
  setFilteredCompletions: (completions: FilteredCompletion[]) => void;
  setCurrentPrefix: (prefix: string) => void;
  setSelectedLspIndex: (index: number) => void;
  setIsLspCompletionVisible: (visible: boolean) => void;
  setCompletionPosition: (position: CompletionPosition) => void;
  setHoverInfo: (info: HoverInfo | null) => void;
  setIsHovering: (hovering: boolean) => void;
  setIsApplyingCompletion: (applying: boolean) => void;
  setAiCompletion: (enabled: boolean) => void;
  setLastInputTimestamp: (timestamp: number) => void;

  // Search actions
  setSearchQuery: (query: string) => void;
  setSearchMatches: (matches: SearchMatch[]) => void;
  setCurrentMatchIndex: (index: number) => void;
  clearSearch: () => void;
  searchNext: () => void;
  searchPrevious: () => void;
}

export const useEditorUIStore = createSelectors(
  create<EditorUIState>()((set, get) => ({
    // Completion state
    lspCompletions: [],
    filteredCompletions: [],
    currentPrefix: "",
    selectedLspIndex: 0,
    isLspCompletionVisible: false,
    completionPosition: { top: 0, left: 0 },
    hoverInfo: null,
    isHovering: false,
    isApplyingCompletion: false,
    aiCompletion: false,
    lastInputTimestamp: 0,

    // Search state
    searchQuery: "",
    searchMatches: [],
    currentMatchIndex: -1,

    // Actions
    actions: {
      // Completion actions
      setLspCompletions: (completions) => set({ lspCompletions: completions }),
      setFilteredCompletions: (completions) => set({ filteredCompletions: completions }),
      setCurrentPrefix: (prefix) => set({ currentPrefix: prefix }),
      setSelectedLspIndex: (index) => set({ selectedLspIndex: index }),
      setIsLspCompletionVisible: (visible) => set({ isLspCompletionVisible: visible }),
      setCompletionPosition: (position) => set({ completionPosition: position }),
      setHoverInfo: (info) => set({ hoverInfo: info }),
      setIsHovering: (hovering) => set({ isHovering: hovering }),
      setIsApplyingCompletion: (applying) => set({ isApplyingCompletion: applying }),
      setAiCompletion: (enabled) => set({ aiCompletion: enabled }),
      setLastInputTimestamp: (timestamp) => set({ lastInputTimestamp: timestamp }),

      // Search actions
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSearchMatches: (matches) => set({ searchMatches: matches }),
      setCurrentMatchIndex: (index) => set({ currentMatchIndex: index }),
      clearSearch: () =>
        set({
          searchQuery: "",
          searchMatches: [],
          currentMatchIndex: -1,
        }),
      searchNext: () => {
        const { searchMatches, currentMatchIndex } = get();
        if (searchMatches.length > 0) {
          const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
          set({ currentMatchIndex: nextIndex });
        }
      },
      searchPrevious: () => {
        const { searchMatches, currentMatchIndex } = get();
        if (searchMatches.length > 0) {
          const prevIndex =
            currentMatchIndex <= 0 ? searchMatches.length - 1 : currentMatchIndex - 1;
          set({ currentMatchIndex: prevIndex });
        }
      },
    },
  })),
);

// Subscribe to settings store and sync AI completion setting
useSettingsStore.subscribe((state) => {
  const { aiCompletion } = state.settings;
  useEditorUIStore.getState().actions.setAiCompletion(aiCompletion);
});
