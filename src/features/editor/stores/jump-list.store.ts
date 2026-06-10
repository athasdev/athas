import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import { createSelectors } from "@/utils/zustand-selectors";

export interface JumpListEntry {
  bufferId: string;
  filePath: string;
  line: number;
  column: number;
  offset: number;
  scrollTop: number;
  scrollLeft: number;
  timestamp: number;
}

interface JumpListActions {
  pushEntry: (entry: Omit<JumpListEntry, "timestamp">) => void;
  goBack: (currentPosition?: Omit<JumpListEntry, "timestamp">) => JumpListEntry | null;
  goForward: () => JumpListEntry | null;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  clear: () => void;
}

interface JumpListState {
  entries: JumpListEntry[];
  currentIndex: number;
  maxEntries: number;
  actions: JumpListActions;
}

const DEFAULT_MAX_ENTRIES = 100;
const DUPLICATE_LINE_THRESHOLD = 5;

export const useJumpListStore = createSelectors(
  createWithEqualityFn<JumpListState>()(
    immer((set, get) => ({
      entries: [],
      currentIndex: -1,
      maxEntries: DEFAULT_MAX_ENTRIES,

      actions: {
        pushEntry: (entry) => {
          set((state) => {
            const newEntry: JumpListEntry = {
              ...entry,
              timestamp: Date.now(),
            };

            // If we're in the middle of history, truncate future entries
            if (state.currentIndex >= 0 && state.currentIndex < state.entries.length - 1) {
              state.entries = state.entries.slice(0, state.currentIndex + 1);
            }

            // Check for duplicate (same file and within line threshold)
            const lastEntry = state.entries[state.entries.length - 1];
            if (lastEntry) {
              const isSameFile = lastEntry.filePath === newEntry.filePath;
              const isNearbyLine =
                Math.abs(lastEntry.line - newEntry.line) <= DUPLICATE_LINE_THRESHOLD;

              if (isSameFile && isNearbyLine) {
                // Update the existing entry instead of adding a duplicate
                state.entries[state.entries.length - 1] = newEntry;
                state.currentIndex = -1;
                return;
              }
            }

            // Add the new entry
            state.entries.push(newEntry);

            // Enforce max size
            if (state.entries.length > state.maxEntries) {
              state.entries.shift();
            }

            // Reset to present (not navigating history)
            state.currentIndex = -1;
          });
        },

        goBack: (currentPosition) => {
          const state = get();

          if (state.entries.length === 0) {
            return null;
          }

          let newIndex: number;
          if (state.currentIndex === -1) {
            // Currently at present - save current position so we can go forward to it
            if (currentPosition) {
              set((s) => {
                s.entries.push({
                  ...currentPosition,
                  timestamp: Date.now(),
                });
                // Enforce max size
                if (s.entries.length > s.maxEntries) {
                  s.entries.shift();
                }
              });
            }
            // Go to second-to-last entry (last entry is now where we just were)
            newIndex = get().entries.length - 2;
          } else if (state.currentIndex > 0) {
            // Go to previous entry
            newIndex = state.currentIndex - 1;
          } else {
            // Already at the beginning
            return null;
          }

          if (newIndex < 0) return null;

          const entry = get().entries[newIndex];
          if (!entry) return null;

          set((s) => {
            s.currentIndex = newIndex;
          });

          return entry;
        },

        goForward: () => {
          const state = get();

          if (state.currentIndex === -1 || state.currentIndex >= state.entries.length - 1) {
            return null;
          }

          const newIndex = state.currentIndex + 1;
          const entry = state.entries[newIndex];
          if (!entry) return null;

          set((s) => {
            s.currentIndex = newIndex;
          });

          return entry;
        },

        canGoBack: () => {
          const state = get();
          if (state.entries.length === 0) return false;
          if (state.currentIndex === -1) return true;
          return state.currentIndex > 0;
        },

        canGoForward: () => {
          const state = get();
          if (state.currentIndex === -1) return false;
          return state.currentIndex < state.entries.length - 1;
        },

        clear: () => {
          set((state) => {
            state.entries = [];
            state.currentIndex = -1;
          });
        },
      },
    })),
    isEqual,
  ),
);
