import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { HistoryEntry } from "@/features/editor/history/types";
import { useHistoryStore } from "@/features/editor/stores/history-store";

function entry(content: string): HistoryEntry {
  return {
    content,
    timestamp: Date.now(),
  };
}

describe("history store", () => {
  beforeEach(() => {
    useHistoryStore.getState().actions.clearAllHistories();
  });

  it("moves the current snapshot to future when undoing", () => {
    const { pushHistory, undo, redo, canRedo } = useHistoryStore.getState().actions;

    pushHistory("buffer-1", entry("before edit"));

    const undoEntry = undo("buffer-1", entry("after edit"));

    expect(undoEntry?.content).toBe("before edit");
    expect(canRedo("buffer-1")).toBe(true);

    const redoEntry = redo("buffer-1", entry("before edit"));

    expect(redoEntry?.content).toBe("after edit");
  });

  it("clears redo snapshots after a new history entry", () => {
    const { pushHistory, undo, canRedo } = useHistoryStore.getState().actions;

    pushHistory("buffer-1", entry("before edit"));
    undo("buffer-1", entry("after edit"));

    expect(canRedo("buffer-1")).toBe(true);

    pushHistory("buffer-1", entry("new branch"));

    expect(canRedo("buffer-1")).toBe(false);
  });
});
