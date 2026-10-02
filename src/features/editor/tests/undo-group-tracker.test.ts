import { describe, expect, it } from "vite-plus/test";
import { EditorUndoGroupTracker } from "@/features/editor/history/undo-group-tracker";
import type { StoredHistoryEntry } from "@/features/editor/types/history.types";

function snapshotContent(entry: StoredHistoryEntry | null): string | undefined {
  return entry && "content" in entry ? entry.content : undefined;
}

describe("editor undo group tracker", () => {
  it("flushes a typing group after only the cursor moved", () => {
    const tracker = new EditorUndoGroupTracker();

    const closedEntries = tracker.track("buffer-1", "", "asd", {
      previousCursorPosition: { line: 0, column: 0, offset: 0 },
    });

    expect(closedEntries).toEqual([]);

    const flushedEntry = tracker.flush("buffer-1", "asd");

    expect(snapshotContent(flushedEntry)).toBe("");
    expect(flushedEntry?.cursorPosition).toEqual({ line: 0, column: 0, offset: 0 });
  });

  it("keeps enter and the following typing in the same undo group", () => {
    const tracker = new EditorUndoGroupTracker();

    expect(tracker.track("buffer-1", "", "a")).toEqual([]);
    expect(tracker.track("buffer-1", "a", "as")).toEqual([]);
    expect(tracker.track("buffer-1", "as", "asd")).toEqual([]);
    expect(tracker.track("buffer-1", "asd", "asd\n")).toEqual([
      expect.objectContaining({ content: "" }),
    ]);
    expect(tracker.track("buffer-1", "asd\n", "asd\na")).toEqual([]);
    expect(tracker.track("buffer-1", "asd\na", "asd\nas")).toEqual([]);
    expect(tracker.track("buffer-1", "asd\nas", "asd\nasd")).toEqual([]);

    expect(snapshotContent(tracker.flush("buffer-1", "asd\nasd"))).toBe("asd");
  });

  it("starts a new group when typing resumes at a different offset", () => {
    const tracker = new EditorUndoGroupTracker();

    expect(tracker.track("buffer-1", "", "a")).toEqual([]);
    expect(tracker.track("buffer-1", "a", "as")).toEqual([]);
    expect(tracker.track("buffer-1", "as", "asd")).toEqual([]);

    expect(tracker.track("buffer-1", "asd", "xasd")).toEqual([
      expect.objectContaining({ content: "" }),
    ]);
    expect(snapshotContent(tracker.flush("buffer-1", "xasd"))).toBe("asd");
  });

  it("groups incremental Monaco changes without scanning for their offsets", () => {
    const tracker = new EditorUndoGroupTracker();

    expect(
      tracker.track("buffer-1", "", "a", {
        contentChange: { rangeOffset: 0, rangeLength: 0, text: "a" },
      }),
    ).toEqual([]);
    expect(
      tracker.track("buffer-1", "a", "ab", {
        contentChange: { rangeOffset: 1, rangeLength: 0, text: "b" },
      }),
    ).toEqual([]);
    expect(snapshotContent(tracker.flush("buffer-1", "ab"))).toBe("");
  });
});
