import type { CompletionItem } from "vscode-languageserver-protocol";
import { create } from "zustand";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useSettingsStore } from "@/features/settings/store";
import type { FilteredCompletion } from "@/utils/fuzzy-matcher";
import { createSelectors } from "@/utils/zustand-selectors";

// Types
type HoverInfo = {
  content: string;
  position: { top: number; left: number };
  opensUpward?: boolean;
};

type CompletionPosition = {
  top: number;
  left: number;
};

type AutocompleteCompletion = {
  text: string;
  cursorOffset: number;
};

type SearchMatch = {
  start: number;
  end: number;
};

type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
};

type DefinitionLinkRange = {
  line: number;
  startColumn: number;
  endColumn: number;
};

function getActiveTextContent(): string {
  const { activeBufferId, buffers } = useBufferStore.getState();
  const activeBuffer = activeBufferId
    ? buffers.find((buffer) => buffer.id === activeBufferId)
    : null;
  return activeBuffer && hasTextContent(activeBuffer) ? activeBuffer.content : "";
}

function areSearchMatchesEqual(a: SearchMatch[], b: SearchMatch[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index++) {
    const left = a[index];
    const right = b[index];
    if (!left || !right || left.start !== right.start || left.end !== right.end) {
      return false;
    }
  }

  return true;
}

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
  autocompleteCompletion: AutocompleteCompletion | null;
  lastInputTimestamp: number;

  // Search state
  searchQuery: string;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;
  replaceQuery: string;
  isReplaceVisible: boolean;
  searchOptions: SearchOptions;

  // Definition link state (for Cmd+hover highlighting)
  definitionLinkRange: DefinitionLinkRange | null;

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
  setAutocompleteCompletion: (completion: AutocompleteCompletion | null) => void;
  setLastInputTimestamp: (timestamp: number) => void;
  clearTypingTransientState: () => void;

  // Search actions
  setSearchQuery: (query: string) => void;
  setSearchMatches: (matches: SearchMatch[]) => void;
  setSearchResults: (matches: SearchMatch[], preferredMatchIndex: number) => void;
  setCurrentMatchIndex: (index: number) => void;
  setReplaceQuery: (query: string) => void;
  setIsReplaceVisible: (visible: boolean) => void;
  setSearchOption: <K extends keyof SearchOptions>(option: K, value: SearchOptions[K]) => void;
  clearSearch: () => void;
  searchNext: () => void;
  searchPrevious: () => void;
  replaceNext: () => void;
  replaceAll: () => void;

  // Definition link actions
  setDefinitionLinkRange: (range: DefinitionLinkRange | null) => void;

  // Buffer switch reset
  resetOnBufferSwitch: () => void;
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
    autocompleteCompletion: null,
    lastInputTimestamp: 0,

    // Search state
    searchQuery: "",
    searchMatches: [],
    currentMatchIndex: -1,
    replaceQuery: "",
    isReplaceVisible: false,
    searchOptions: {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
    },

    // Definition link state
    definitionLinkRange: null,

    // Actions
    actions: {
      // Completion actions
      setLspCompletions: (completions) => {
        if (get().lspCompletions !== completions) {
          set({ lspCompletions: completions });
        }
      },
      setFilteredCompletions: (completions) => {
        if (get().filteredCompletions !== completions) {
          set({ filteredCompletions: completions });
        }
      },
      setCurrentPrefix: (prefix) => {
        if (get().currentPrefix !== prefix) {
          set({ currentPrefix: prefix });
        }
      },
      setSelectedLspIndex: (index) => {
        if (get().selectedLspIndex !== index) {
          set({ selectedLspIndex: index });
        }
      },
      setIsLspCompletionVisible: (visible) => {
        if (get().isLspCompletionVisible !== visible) {
          set({ isLspCompletionVisible: visible });
        }
      },
      setCompletionPosition: (position) => {
        const current = get().completionPosition;
        if (current.top !== position.top || current.left !== position.left) {
          set({ completionPosition: position });
        }
      },
      setHoverInfo: (info) => {
        if (get().hoverInfo !== info) {
          set({ hoverInfo: info });
        }
      },
      setIsHovering: (hovering) => {
        if (get().isHovering !== hovering) {
          set({ isHovering: hovering });
        }
      },
      setIsApplyingCompletion: (applying) => {
        if (get().isApplyingCompletion !== applying) {
          set({ isApplyingCompletion: applying });
        }
      },
      setAiCompletion: (enabled) => {
        if (get().aiCompletion !== enabled) {
          set({ aiCompletion: enabled });
        }
      },
      setAutocompleteCompletion: (completion) => {
        const current = get().autocompleteCompletion;
        if (
          current === completion ||
          (current &&
            completion &&
            current.text === completion.text &&
            current.cursorOffset === completion.cursorOffset)
        ) {
          return;
        }
        set({ autocompleteCompletion: completion });
      },
      setLastInputTimestamp: (timestamp) => {
        if (get().lastInputTimestamp !== timestamp) {
          set({ lastInputTimestamp: timestamp });
        }
      },
      clearTypingTransientState: () => {
        const state = get();
        if (
          state.hoverInfo === null &&
          !state.isHovering &&
          state.autocompleteCompletion === null
        ) {
          return;
        }

        set({
          hoverInfo: null,
          isHovering: false,
          autocompleteCompletion: null,
        });
      },

      // Search actions
      setSearchQuery: (query) => {
        if (get().searchQuery !== query) {
          set({ searchQuery: query });
        }
      },
      setSearchMatches: (matches) => {
        const current = get().searchMatches;
        if (areSearchMatchesEqual(current, matches)) {
          return;
        }
        set({ searchMatches: matches });
      },
      setSearchResults: (matches, preferredMatchIndex) => {
        const state = get();
        const matchesAreEqual = areSearchMatchesEqual(state.searchMatches, matches);
        const nextMatchIndex =
          matches.length === 0
            ? -1
            : matchesAreEqual &&
                state.currentMatchIndex >= 0 &&
                state.currentMatchIndex < matches.length
              ? state.currentMatchIndex
              : Math.max(0, Math.min(preferredMatchIndex, matches.length - 1));

        if (matchesAreEqual && state.currentMatchIndex === nextMatchIndex) {
          return;
        }

        set({
          searchMatches: matchesAreEqual ? state.searchMatches : matches,
          currentMatchIndex: nextMatchIndex,
        });
      },
      setCurrentMatchIndex: (index) => {
        if (get().currentMatchIndex === index) {
          return;
        }
        set({ currentMatchIndex: index });
      },
      setReplaceQuery: (query) => {
        if (get().replaceQuery !== query) {
          set({ replaceQuery: query });
        }
      },
      setIsReplaceVisible: (visible) => {
        if (get().isReplaceVisible !== visible) {
          set({ isReplaceVisible: visible });
        }
      },
      setSearchOption: (option, value) =>
        set((state) =>
          state.searchOptions[option] === value
            ? state
            : {
                searchOptions: { ...state.searchOptions, [option]: value },
              },
        ),
      clearSearch: () =>
        set({
          searchQuery: "",
          searchMatches: [],
          currentMatchIndex: -1,
          replaceQuery: "",
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
      replaceNext: () => {
        const { searchMatches, currentMatchIndex, replaceQuery } = get();
        if (searchMatches.length === 0 || currentMatchIndex < 0) return;

        const match = searchMatches[currentMatchIndex];
        if (!match) return;

        // Get current content from editor state
        const { onChange } = useEditorStateStore.getState();
        const value = getActiveTextContent();
        if (!value || !onChange) return;

        // Replace the current match
        const newContent =
          value.substring(0, match.start) + replaceQuery + value.substring(match.end);

        // Calculate offset adjustment
        const lengthDiff = replaceQuery.length - (match.end - match.start);

        // Update matches array, removing the replaced match and adjusting subsequent offsets
        const updatedMatches = searchMatches
          .filter((_, i) => i !== currentMatchIndex)
          .map((m) => {
            if (m.start > match.start) {
              return {
                start: m.start + lengthDiff,
                end: m.end + lengthDiff,
              };
            }
            return m;
          });

        // Update state and trigger content change
        onChange(newContent);
        set({
          searchMatches: updatedMatches,
          currentMatchIndex:
            updatedMatches.length > 0 ? Math.min(currentMatchIndex, updatedMatches.length - 1) : -1,
        });
      },
      replaceAll: () => {
        const { searchMatches, replaceQuery } = get();
        if (searchMatches.length === 0) return;

        // Get current content from editor state
        const { onChange } = useEditorStateStore.getState();
        const value = getActiveTextContent();
        if (!value || !onChange) return;

        // Replace all matches in reverse order to maintain offset validity
        let newContent = value;
        const sortedMatches = [...searchMatches].sort((a, b) => b.start - a.start);

        for (const match of sortedMatches) {
          newContent =
            newContent.substring(0, match.start) + replaceQuery + newContent.substring(match.end);
        }

        // Update state and trigger content change
        onChange(newContent);
        set({
          searchMatches: [],
          currentMatchIndex: -1,
        });
      },

      // Definition link actions
      setDefinitionLinkRange: (range) => set({ definitionLinkRange: range }),

      // Buffer switch reset
      resetOnBufferSwitch: () =>
        set({
          lspCompletions: [],
          filteredCompletions: [],
          currentPrefix: "",
          selectedLspIndex: 0,
          isLspCompletionVisible: false,
          completionPosition: { top: 0, left: 0 },
          hoverInfo: null,
          isHovering: false,
          isApplyingCompletion: false,
          autocompleteCompletion: null,
          searchMatches: [],
          currentMatchIndex: -1,
          definitionLinkRange: null,
        }),
    },
  })),
);

// Subscribe to settings store and sync AI completion setting
useSettingsStore.subscribe((state) => {
  const { aiCompletion } = state.settings;
  useEditorUIStore.getState().actions.setAiCompletion(aiCompletion);
});
