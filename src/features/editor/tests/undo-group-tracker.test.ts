import { describe, expect, it } from "vite-plus/test";
import { EditorUndoGroupTracker } from "@/features/editor/history/undo-group-tracker";

describe("editor undo group tracker", () => {
  it("flushes a typing group after only the cursor moved", () => {
    const tracker = new EditorUndoGroupTracker();

    const closedEntries = tracker.track("buffer-1", "", "asd", {
      previousCursorPosition: { line: 0, column: 0, offset: 0 },
    });

    expect(closedEntries).toEqual([]);

    const flushedEntry = tracker.flush("buffer-1", "asd");

    expect(flushedEntry?.content).toBe("");
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

    expect(tracker.flush("buffer-1", "asd\nasd")?.content).toBe("asd");
  });

  it("starts a new group when typing resumes at a different offset", () => {
    const tracker = new EditorUndoGroupTracker();

    expect(tracker.track("buffer-1", "", "a")).toEqual([]);
    expect(tracker.track("buffer-1", "a", "as")).toEqual([]);
    expect(tracker.track("buffer-1", "as", "asd")).toEqual([]);

    expect(tracker.track("buffer-1", "asd", "xasd")).toEqual([
      expect.objectContaining({ content: "" }),
    ]);
    expect(tracker.flush("buffer-1", "xasd")?.content).toBe("asd");
  });
});
