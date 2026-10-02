import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  cleanupBufferHistoryTracking,
  flushPendingBufferHistory,
  trackBufferHistoryChange,
  trackImmediateBufferHistoryChange,
} from "@/features/editor/stores/buffer-history-tracking";
import { useHistoryStore } from "@/features/editor/stores/history.store";

const BUFFER_ID = "buffer-history-tracking-test";

function currentEntry(content: string) {
  return {
    content,
    timestamp: Date.now(),
  };
}

describe("buffer history tracking", () => {
  beforeEach(() => {
    cleanupBufferHistoryTracking(BUFFER_ID);
    useHistoryStore.getState().actions.clearAllHistories();
  });

  it("keeps an atomic command undo step after pending typing", () => {
    trackBufferHistoryChange({
      bufferId: BUFFER_ID,
      currentContent: "one",
      nextContent: "one!",
    });

    expect(useHistoryStore.getState().actions.getHistoryState(BUFFER_ID)?.past ?? []).toHaveLength(
      0,
    );

    trackBufferHistoryChange({
      bufferId: BUFFER_ID,
      currentContent: "one!\none!",
      nextContent: "one!\none!",
      previousContent: "one!",
      skipUndoGrouping: true,
    });

    const undoCommand = useHistoryStore
      .getState()
      .actions.undo(BUFFER_ID, currentEntry("one!\none!"));
    expect(undoCommand?.content).toBe("one!");

    const undoTyping = useHistoryStore.getState().actions.undo(BUFFER_ID, currentEntry("one!"));
    expect(undoTyping?.content).toBe("one");
  });

  it("records direct command mutations as a single undo step", () => {
    trackImmediateBufferHistoryChange({
      bufferId: BUFFER_ID,
      currentContent: "alpha\nbeta",
      nextContent: "alpha\nbeta\nbeta",
    });

    const undoEntry = useHistoryStore
      .getState()
      .actions.undo(BUFFER_ID, currentEntry("alpha\nbeta\nbeta"));
    expect(undoEntry?.content).toBe("alpha\nbeta");

    const redoEntry = useHistoryStore
      .getState()
      .actions.redo(BUFFER_ID, currentEntry("alpha\nbeta"));
    expect(redoEntry?.content).toBe("alpha\nbeta\nbeta");
  });

  it("stores grouped typing as patches and preserves undo and redo", () => {
    trackBufferHistoryChange({
      bufferId: BUFFER_ID,
      currentContent: "one",
      nextContent: "one!",
      previousContent: "one",
      contentChanges: [
        {
          rangeOffset: 3,
          rangeLength: 0,
          text: "!",
          startLine: 0,
          startColumn: 3,
          endLine: 0,
          endColumn: 3,
        },
      ],
    });
    trackBufferHistoryChange({
      bufferId: BUFFER_ID,
      currentContent: "one!",
      nextContent: "one!!",
      previousContent: "one!",
      contentChanges: [
        {
          rangeOffset: 4,
          rangeLength: 0,
          text: "!",
          startLine: 0,
          startColumn: 4,
          endLine: 0,
          endColumn: 4,
        },
      ],
    });
    const pending = useHistoryStore.getState().actions.getHistoryState(BUFFER_ID)?.past ?? [];
    expect(pending).toHaveLength(0);

    flushPendingBufferHistory(BUFFER_ID, "one!!");
    const stored = useHistoryStore.getState().actions.getHistoryState(BUFFER_ID)?.past[0];
    expect(stored).toMatchObject({ kind: "patch", beforeLength: 3, afterLength: 5 });
    expect("content" in (stored ?? {})).toBe(false);

    const undoEntry = useHistoryStore.getState().actions.undo(BUFFER_ID, currentEntry("one!!"));
    expect(undoEntry?.content).toBe("one");
    const redoEntry = useHistoryStore.getState().actions.redo(BUFFER_ID, currentEntry("one"));
    expect(redoEntry?.content).toBe("one!!");
  });
});
