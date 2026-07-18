import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  cleanupBufferHistoryTracking,
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
});
