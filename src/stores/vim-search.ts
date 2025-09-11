import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { calculateOffsetFromPosition } from "@/utils/editor-position";
import { createSelectors } from "@/utils/zustand-selectors";
import { useEditorCursorStore } from "./editor-cursor-store";
import { useEditorViewStore } from "./editor-view-store";

interface SearchMatch {
  line: number;
  column: number;
  offset: number;
  length: number;
}

interface VimSearchState {
  searchTerm: string;
  isSearchMode: boolean;
  matches: SearchMatch[];
  currentMatchIndex: number;
  lastSearchTerm: string; // For 'n' and 'N' commands
}

const defaultSearchState: VimSearchState = {
  searchTerm: "",
  isSearchMode: false,
  matches: [],
  currentMatchIndex: -1,
  lastSearchTerm: "",
};

const useVimSearchStoreBase = create(
  immer(
    combine(defaultSearchState, (set, get) => ({
      actions: {
        startSearch: () => {
          set((state) => {
            state.isSearchMode = true;
            state.searchTerm = "";
            state.matches = [];
            state.currentMatchIndex = -1;
          });
        },

        exitSearch: () => {
          set((state) => {
            state.isSearchMode = false;
            state.searchTerm = "";
          });
        },

        updateSearchTerm: (term: string) => {
          set((state) => {
            state.searchTerm = term;
          });

          // Perform search as user types
          if (term) {
            // Access the performSearch function directly from the store
            useVimSearchStoreBase.getState().actions.performSearch(term);
          } else {
            set((state) => {
              state.matches = [];
              state.currentMatchIndex = -1;
            });
          }
        },

        performSearch: (term: string) => {
          const lines = useEditorViewStore.getState().lines;
          const matches: SearchMatch[] = [];

          // Search through all lines
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];

            // Use global regex to find all matches in the line
            const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
            let match: RegExpExecArray | null = regex.exec(line);

            while (match !== null) {
              const column = match.index;
              const offset = calculateOffsetFromPosition(lineIndex, column, lines);

              matches.push({
                line: lineIndex,
                column,
                offset,
                length: match[0].length,
              });

              // Prevent infinite loop with zero-length matches
              if (match.index === regex.lastIndex) {
                regex.lastIndex++;
              }

              match = regex.exec(line);
            }
          }

          set((state) => {
            state.matches = matches;
            state.currentMatchIndex = matches.length > 0 ? 0 : -1;
            state.lastSearchTerm = term;
          });

          // Move cursor to first match if found
          if (matches.length > 0) {
            useVimSearchStoreBase.getState().actions.goToMatch(0);
          }
        },

        executeSearch: () => {
          const state = get();
          if (state.searchTerm) {
            set((draft) => {
              draft.lastSearchTerm = draft.searchTerm;
              draft.isSearchMode = false;
              draft.searchTerm = "";
            });
          }
        },

        goToMatch: (matchIndex: number) => {
          const state = get();
          if (matchIndex >= 0 && matchIndex < state.matches.length) {
            const match = state.matches[matchIndex];

            set((draft) => {
              draft.currentMatchIndex = matchIndex;
            });

            // Update cursor position
            const { setCursorPosition } = useEditorCursorStore.getState().actions;
            const newPosition = {
              line: match.line,
              column: match.column,
              offset: match.offset,
            };
            setCursorPosition(newPosition);

            // Update textarea cursor
            const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
            if (textarea) {
              textarea.selectionStart = match.offset;
              textarea.selectionEnd = match.offset + match.length;
              textarea.dispatchEvent(new Event("select"));
            }
          }
        },

        findNext: () => {
          const state = get();
          if (state.lastSearchTerm && state.matches.length === 0) {
            // Re-perform search if no current matches
            useVimSearchStoreBase.getState().actions.performSearch(state.lastSearchTerm);
            return;
          }

          if (state.matches.length > 0) {
            const nextIndex = (state.currentMatchIndex + 1) % state.matches.length;
            useVimSearchStoreBase.getState().actions.goToMatch(nextIndex);
          }
        },

        findPrevious: () => {
          const state = get();
          if (state.lastSearchTerm && state.matches.length === 0) {
            // Re-perform search if no current matches
            useVimSearchStoreBase.getState().actions.performSearch(state.lastSearchTerm);
            return;
          }

          if (state.matches.length > 0) {
            const prevIndex =
              state.currentMatchIndex <= 0 ? state.matches.length - 1 : state.currentMatchIndex - 1;
            useVimSearchStoreBase.getState().actions.goToMatch(prevIndex);
          }
        },

        clearSearch: () => {
          set((state) => {
            state.matches = [];
            state.currentMatchIndex = -1;
          });
        },
      },
    })),
  ),
);

export const useVimSearchStore = createSelectors(useVimSearchStoreBase);
