import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { HistoryEntry } from "@/features/editor/types/history.types";
import {
  MAX_HISTORY_BYTES_PER_BUFFER,
  useHistoryStore,
} from "@/features/editor/stores/history.store";

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

  it("ignores duplicate adjacent snapshots", () => {
    const { pushHistory, getHistoryState } = useHistoryStore.getState().actions;

    pushHistory("buffer-1", entry("same content"));
    pushHistory("buffer-1", entry("same content"));

    expect(getHistoryState("buffer-1")?.past).toHaveLength(1);
  });

  it("evicts old snapshots when a buffer exceeds its byte budget", () => {
    const { pushHistory, getHistoryState } = useHistoryStore.getState().actions;
    const snapshot = "a".repeat(Math.ceil(MAX_HISTORY_BYTES_PER_BUFFER / 6));

    pushHistory("buffer-1", entry(`${snapshot}1`));
    pushHistory("buffer-1", entry(`${snapshot}2`));
    pushHistory("buffer-1", entry(`${snapshot}3`));

    expect(
      getHistoryState("buffer-1")?.past.map(({ content }) => content[content.length - 1]),
    ).toEqual(["2", "3"]);
  });
});
