import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import type {
  BufferHistory,
  HistoryEntry,
  HistoryState,
  PatchHistoryEntry,
  StoredHistoryEntry,
} from "@/features/editor/types/history.types";
import { createSelectors } from "@/utils/zustand-selectors";
import { applyHistoryPatchBatches } from "../history/history-patches";

interface HistoryStoreState {
  bufferHistories: BufferHistory;
  actions: HistoryActions;
}

interface HistoryActions {
  pushHistory: (bufferId: string, entry: StoredHistoryEntry) => void;
  undo: (bufferId: string, currentEntry?: HistoryEntry) => HistoryEntry | null;
  redo: (bufferId: string, currentEntry?: HistoryEntry) => HistoryEntry | null;
  canUndo: (bufferId: string) => boolean;
  canRedo: (bufferId: string) => boolean;
  clearHistory: (bufferId: string) => void;
  clearAllHistories: () => void;
  getHistoryState: (bufferId: string) => HistoryState | null;
}

const DEFAULT_MAX_HISTORY_SIZE = 100;
export const MAX_HISTORY_BYTES_PER_BUFFER = 8 * 1024 * 1024;

const createDefaultHistoryState = (maxHistorySize = DEFAULT_MAX_HISTORY_SIZE): HistoryState => ({
  past: [],
  future: [],
  maxHistorySize,
});

function isPatchHistoryEntry(entry: StoredHistoryEntry): entry is PatchHistoryEntry {
  return "kind" in entry && entry.kind === "patch";
}

function cloneStoredHistoryEntry(entry: StoredHistoryEntry): StoredHistoryEntry {
  if (isPatchHistoryEntry(entry)) {
    return {
      ...entry,
      patches: entry.patches.map((batch) => ({
        ...batch,
        changes: batch.changes.map((change) => ({ ...change })),
      })),
      cursorPosition: entry.cursorPosition ? { ...entry.cursorPosition } : undefined,
      selection: entry.selection
        ? {
            start: { ...entry.selection.start },
            end: { ...entry.selection.end },
          }
        : undefined,
    };
  }

  return {
    ...entry,
    cursorPosition: entry.cursorPosition ? { ...entry.cursorPosition } : undefined,
    selection: entry.selection
      ? {
          start: { ...entry.selection.start },
          end: { ...entry.selection.end },
        }
      : undefined,
  };
}

function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return cloneStoredHistoryEntry(entry) as HistoryEntry;
}

function getHistoryEntryBytes(entry: StoredHistoryEntry): number {
  if (!isPatchHistoryEntry(entry)) return entry.content.length * 2;
  return entry.patches.reduce(
    (total, batch) =>
      total +
      batch.changes.reduce(
        (batchTotal, change) =>
          batchTotal + (change.beforeText.length + change.afterText.length) * 2 + 16,
        0,
      ),
    0,
  );
}

function resolvePatchEntry(
  entry: PatchHistoryEntry,
  currentEntry: HistoryEntry,
  direction: "forward" | "reverse",
): HistoryEntry | null {
  const content = applyHistoryPatchBatches(currentEntry.content, entry.patches, direction);
  if (content === null) return null;
  return {
    content,
    cursorPosition: entry.cursorPosition ? { ...entry.cursorPosition } : undefined,
    selection: entry.selection
      ? {
          start: { ...entry.selection.start },
          end: { ...entry.selection.end },
        }
      : undefined,
    timestamp: entry.timestamp,
  };
}

function trimHistoryToByteBudget(history: HistoryState): void {
  let retainedBytes = [...history.past, ...history.future].reduce(
    (total, entry) => total + getHistoryEntryBytes(entry),
    0,
  );

  while (retainedBytes > MAX_HISTORY_BYTES_PER_BUFFER) {
    const removablePastEntry = history.past.length > 1 ? history.past.shift() : undefined;
    if (removablePastEntry) {
      retainedBytes -= getHistoryEntryBytes(removablePastEntry);
      continue;
    }

    const removableFutureEntry = history.future.length > 1 ? history.future.shift() : undefined;
    if (!removableFutureEntry) break;
    retainedBytes -= getHistoryEntryBytes(removableFutureEntry);
  }
}

export const useHistoryStore = createSelectors(
  createWithEqualityFn<HistoryStoreState>()(
    immer((set, get) => ({
      bufferHistories: {},

      actions: {
        pushHistory: (bufferId: string, entry: StoredHistoryEntry) => {
          set((state) => {
            if (!state.bufferHistories[bufferId]) {
              state.bufferHistories[bufferId] = createDefaultHistoryState();
            }

            const history = state.bufferHistories[bufferId];
            const lastEntry = history.past[history.past.length - 1];

            if (
              lastEntry &&
              !isPatchHistoryEntry(lastEntry) &&
              !isPatchHistoryEntry(entry) &&
              lastEntry.content === entry.content
            ) {
              return;
            }

            // Add to past
            history.past.push(entry);

            // Clear future on new change
            history.future = [];

            // Enforce max size
            if (history.past.length > history.maxHistorySize) {
              history.past.shift();
            }
            trimHistoryToByteBudget(history);
          });
        },

        undo: (bufferId: string, currentEntry?: HistoryEntry) => {
          const history = get().bufferHistories[bufferId];
          if (!history || history.past.length === 0) {
            return null;
          }

          let entry: HistoryEntry | null = null;

          set((state) => {
            const hist = state.bufferHistories[bufferId];
            if (hist && hist.past.length > 0) {
              const lastEntry = hist.past[hist.past.length - 1];
              if (lastEntry) {
                if (isPatchHistoryEntry(lastEntry)) {
                  if (!currentEntry) return;
                  const resolved = resolvePatchEntry(lastEntry, currentEntry, "reverse");
                  if (!resolved) return;
                  hist.past.pop();
                  hist.future.push({
                    ...cloneStoredHistoryEntry(lastEntry),
                    cursorPosition: currentEntry.cursorPosition,
                    selection: currentEntry.selection,
                  });
                  entry = resolved;
                } else {
                  hist.past.pop();
                  if (currentEntry) {
                    hist.future.push(cloneHistoryEntry(currentEntry));
                  }
                  entry = cloneHistoryEntry(lastEntry);
                }
                trimHistoryToByteBudget(hist);
              }
            }
          });

          return entry;
        },

        redo: (bufferId: string, currentEntry?: HistoryEntry) => {
          const history = get().bufferHistories[bufferId];
          if (!history || history.future.length === 0) {
            return null;
          }

          let entry: HistoryEntry | null = null;

          set((state) => {
            const hist = state.bufferHistories[bufferId];
            if (hist && hist.future.length > 0) {
              const nextEntry = hist.future[hist.future.length - 1];
              if (nextEntry) {
                if (isPatchHistoryEntry(nextEntry)) {
                  if (!currentEntry) return;
                  const resolved = resolvePatchEntry(nextEntry, currentEntry, "forward");
                  if (!resolved) return;
                  hist.future.pop();
                  hist.past.push({
                    ...cloneStoredHistoryEntry(nextEntry),
                    cursorPosition: currentEntry.cursorPosition,
                    selection: currentEntry.selection,
                  });
                  entry = resolved;
                } else {
                  hist.future.pop();
                  if (currentEntry) {
                    hist.past.push(cloneHistoryEntry(currentEntry));
                  }
                  entry = cloneHistoryEntry(nextEntry);
                }
                trimHistoryToByteBudget(hist);
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
