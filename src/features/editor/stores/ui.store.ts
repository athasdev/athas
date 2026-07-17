import { create } from "zustand";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { createSelectors } from "@/utils/zustand-selectors";
import { replaceAllSearchMatches, replaceSearchMatch } from "../utils/search-replace";
import { getBufferById } from "../utils/buffer-index";

type SearchMatch = {
  start: number;
  end: number;
};

type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  preserveCase: boolean;
};

function getActiveTextContent(): string {
  const { activeBufferId, buffers } = useBufferStore.getState();
  const activeBuffer = getBufferById(buffers, activeBufferId);
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
  // Search state
  searchQuery: string;
  searchMatches: SearchMatch[];
  searchResultsLimited: boolean;
  currentMatchIndex: number;
  searchNavigationRevision: number;
  replaceQuery: string;
  isReplaceVisible: boolean;
  searchOptions: SearchOptions;

  // Actions
  actions: EditorUIActions;
}

interface EditorUIActions {
  // Search actions
  setSearchQuery: (query: string) => void;
  setSearchMatches: (matches: SearchMatch[]) => void;
  setSearchResults: (
    matches: SearchMatch[],
    preferredMatchIndex: number,
    limited?: boolean,
    revealCurrentMatch?: boolean,
  ) => void;
  setCurrentMatchIndex: (index: number) => void;
  setReplaceQuery: (query: string) => void;
  setIsReplaceVisible: (visible: boolean) => void;
  setSearchOption: <K extends keyof SearchOptions>(option: K, value: SearchOptions[K]) => void;
  clearSearch: () => void;
  searchNext: () => void;
  searchPrevious: () => void;
  replaceNext: () => void;
  replaceAll: () => void;

  // Buffer switch reset
  resetOnBufferSwitch: () => void;
}

export const useEditorUIStore = createSelectors(
  create<EditorUIState>()((set, get) => ({
    // Search state
    searchQuery: "",
    searchMatches: [],
    searchResultsLimited: false,
    currentMatchIndex: -1,
    searchNavigationRevision: 0,
    replaceQuery: "",
    isReplaceVisible: false,
    searchOptions: {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      preserveCase: false,
    },

    // Actions
    actions: {
      // Search actions
      setSearchQuery: (query) => {
        if (get().searchQuery !== query) {
          set({ searchQuery: query });
        }
      },
      setSearchMatches: (matches) => {
        const current = get().searchMatches;
        if (areSearchMatchesEqual(current, matches) && !get().searchResultsLimited) {
          return;
        }
        set({ searchMatches: matches, searchResultsLimited: false });
      },
      setSearchResults: (
        matches,
        preferredMatchIndex,
        limited = false,
        revealCurrentMatch = false,
      ) => {
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

        if (
          matchesAreEqual &&
          state.currentMatchIndex === nextMatchIndex &&
          state.searchResultsLimited === limited &&
          !revealCurrentMatch
        ) {
          return;
        }

        set({
          searchMatches: matchesAreEqual ? state.searchMatches : matches,
          searchResultsLimited: limited,
          currentMatchIndex: nextMatchIndex,
          searchNavigationRevision:
            revealCurrentMatch && nextMatchIndex >= 0
              ? state.searchNavigationRevision + 1
              : state.searchNavigationRevision,
        });
      },
      setCurrentMatchIndex: (index) => {
        if (get().currentMatchIndex === index) {
          return;
        }
        set((state) => ({
          currentMatchIndex: index,
          searchNavigationRevision:
            index >= 0 ? state.searchNavigationRevision + 1 : state.searchNavigationRevision,
        }));
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
          searchResultsLimited: false,
          currentMatchIndex: -1,
          replaceQuery: "",
        }),
      searchNext: () => {
        const { searchMatches, currentMatchIndex } = get();
        if (searchMatches.length > 0) {
          const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
          set((state) => ({
            currentMatchIndex: nextIndex,
            searchNavigationRevision: state.searchNavigationRevision + 1,
          }));
        }
      },
      searchPrevious: () => {
        const { searchMatches, currentMatchIndex } = get();
        if (searchMatches.length > 0) {
          const prevIndex =
            currentMatchIndex <= 0 ? searchMatches.length - 1 : currentMatchIndex - 1;
          set((state) => ({
            currentMatchIndex: prevIndex,
            searchNavigationRevision: state.searchNavigationRevision + 1,
          }));
        }
      },
      replaceNext: () => {
        const { searchMatches, currentMatchIndex, replaceQuery } = get();
        if (searchMatches.length === 0 || currentMatchIndex < 0) return;

        const { cursorPosition, selection, onChange } = useEditorStateStore.getState();
        const value = getActiveTextContent();
        if (!value || !onChange) return;

        const result = replaceSearchMatch(value, searchMatches, currentMatchIndex, replaceQuery, {
          preserveCase: get().searchOptions.preserveCase,
        });
        if (!result) return;

        onChange(result.content, value, cursorPosition, selection);
        const state = get();
        set({
          searchMatches: result.matches,
          currentMatchIndex: result.currentMatchIndex,
          searchNavigationRevision:
            result.currentMatchIndex >= 0
              ? state.searchNavigationRevision + 1
              : state.searchNavigationRevision,
        });
      },
      replaceAll: () => {
        const { searchMatches, searchResultsLimited, replaceQuery } = get();
        if (searchMatches.length === 0) return;
        if (searchResultsLimited) return;

        // Get current content from editor state
        const { cursorPosition, selection, onChange } = useEditorStateStore.getState();
        const value = getActiveTextContent();
        if (!value || !onChange) return;

        const newContent = replaceAllSearchMatches(value, searchMatches, replaceQuery, {
          preserveCase: get().searchOptions.preserveCase,
        });

        onChange(newContent, value, cursorPosition, selection);
        set({
          searchMatches: [],
          searchResultsLimited: false,
          currentMatchIndex: -1,
        });
      },

      // Buffer switch reset
      resetOnBufferSwitch: () =>
        set({
          searchMatches: [],
          searchResultsLimited: false,
          currentMatchIndex: -1,
        }),
    },
  })),
);
