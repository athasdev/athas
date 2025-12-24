import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import type { BufferHistory, HistoryEntry, HistoryState } from "@/features/editor/history/types";
import { createSelectors } from "@/utils/zustand-selectors";

interface HistoryStoreState {
  bufferHistories: BufferHistory;
  actions: HistoryActions;
}

interface HistoryActions {
  pushHistory: (bufferId: string, entry: HistoryEntry) => void;
  undo: (bufferId: string) => HistoryEntry | null;
  redo: (bufferId: string) => HistoryEntry | null;
  canUndo: (bufferId: string) => boolean;
  canRedo: (bufferId: string) => boolean;
  clearHistory: (bufferId: string) => void;
  clearAllHistories: () => void;
  getHistoryState: (bufferId: string) => HistoryState | null;
}

const DEFAULT_MAX_HISTORY_SIZE = 100;

const createDefaultHistoryState = (maxHistorySize = DEFAULT_MAX_HISTORY_SIZE): HistoryState => ({
  past: [],
  future: [],
  maxHistorySize,
});

export const useHistoryStore = createSelectors(
  createWithEqualityFn<HistoryStoreState>()(
    immer((set, get) => ({
      bufferHistories: {},

      actions: {
        pushHistory: (bufferId: string, entry: HistoryEntry) => {
          set((state) => {
            if (!state.bufferHistories[bufferId]) {
              state.bufferHistories[bufferId] = createDefaultHistoryState();
            }

            const history = state.bufferHistories[bufferId];

            // Add to past
            history.past.push(entry);

            // Clear future on new change
            history.future = [];

            // Enforce max size
            if (history.past.length > history.maxHistorySize) {
              history.past.shift();
            }
          });
        },

        undo: (bufferId: string) => {
          const history = get().bufferHistories[bufferId];
          if (!history || history.past.length === 0) {
            return null;
          }

          let entry: HistoryEntry | null = null;

          set((state) => {
            const hist = state.bufferHistories[bufferId];
            if (hist && hist.past.length > 0) {
              const lastEntry = hist.past.pop();
              if (lastEntry) {
                hist.future.push(lastEntry);
                entry = lastEntry;
              }
            }
          });

          return entry;
        },

        redo: (bufferId: string) => {
          const history = get().bufferHistories[bufferId];
          if (!history || history.future.length === 0) {
            return null;
          }

          let entry: HistoryEntry | null = null;

          set((state) => {
            const hist = state.bufferHistories[bufferId];
            if (hist && hist.future.length > 0) {
              const nextEntry = hist.future.pop();
              if (nextEntry) {
                hist.past.push(nextEntry);
                entry = nextEntry;
              }
            }
          });

          return entry;
        },

        canUndo: (bufferId: string) => {
          const history = get().bufferHistories[bufferId];
          return history ? history.past.length > 0 : false;
        },

        canRedo: (bufferId: string) => {
          const history = get().bufferHistories[bufferId];
          return history ? history.future.length > 0 : false;
        },

        clearHistory: (bufferId: string) => {
          set((state) => {
            if (state.bufferHistories[bufferId]) {
              state.bufferHistories[bufferId] = createDefaultHistoryState();
            }
          });
        },

        clearAllHistories: () => {
          set((state) => {
            state.bufferHistories = {};
          });
        },

        getHistoryState: (bufferId: string) => {
          return get().bufferHistories[bufferId] || null;
        },
      },
    })),
    isEqual,
  ),
);
