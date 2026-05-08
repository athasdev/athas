import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { enableMapSet } from "immer";

enableMapSet();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(),
    onDragDropEvent: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(),
  }),
}));

import { useHistoryStore } from "@/features/editor/stores/history-store";

describe("history-store", () => {
  const BUFFER_ID = "test-buffer";

  beforeEach(() => {
    useHistoryStore.getState().actions.clearHistory(BUFFER_ID);
  });

  const makeEntry = (content: string, overrides?: Record<string, unknown>) => ({
    content,
    timestamp: Date.now(),
    ...overrides,
  });

  it("starts with empty history", () => {
    const { canUndo, canRedo } = useHistoryStore.getState().actions;
    expect(canUndo(BUFFER_ID)).toBe(false);
    expect(canRedo(BUFFER_ID)).toBe(false);
  });

  it("pushHistory adds an entry and enables undo", () => {
    const { pushHistory, canUndo, canRedo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("content-v1"));
    expect(canUndo(BUFFER_ID)).toBe(true);
    expect(canRedo(BUFFER_ID)).toBe(false);
  });

  it("undo returns the last pushed entry", () => {
    const { pushHistory, undo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("content-v1"));
    const entry = undo(BUFFER_ID);
    expect(entry?.content).toBe("content-v1");
  });

  it("after undo, canRedo is true", () => {
    const { pushHistory, undo, canRedo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("content-v1"));
    undo(BUFFER_ID);
    expect(canRedo(BUFFER_ID)).toBe(true);
  });

  it("redo returns the undone entry", () => {
    const { pushHistory, undo, redo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("content-v1"));
    undo(BUFFER_ID);
    const entry = redo(BUFFER_ID);
    expect(entry?.content).toBe("content-v1");
  });

  it("after redo, canRedo is false again", () => {
    const { pushHistory, undo, redo, canRedo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("content-v1"));
    undo(BUFFER_ID);
    redo(BUFFER_ID);
    expect(canRedo(BUFFER_ID)).toBe(false);
  });

  it("multiple undo/redo cycles work correctly", () => {
    const { pushHistory, undo, redo, canUndo, canRedo } = useHistoryStore.getState().actions;

    pushHistory(BUFFER_ID, makeEntry("v1"));
    pushHistory(BUFFER_ID, makeEntry("v2"));
    pushHistory(BUFFER_ID, makeEntry("v3"));

    expect(canUndo(BUFFER_ID)).toBe(true);

    expect(undo(BUFFER_ID)?.content).toBe("v3");
    expect(undo(BUFFER_ID)?.content).toBe("v2");
    expect(undo(BUFFER_ID)?.content).toBe("v1");
    expect(canUndo(BUFFER_ID)).toBe(false);
    expect(canRedo(BUFFER_ID)).toBe(true);

    expect(redo(BUFFER_ID)?.content).toBe("v1");
    expect(redo(BUFFER_ID)?.content).toBe("v2");
    expect(redo(BUFFER_ID)?.content).toBe("v3");
    expect(canUndo(BUFFER_ID)).toBe(true);
    expect(canRedo(BUFFER_ID)).toBe(false);
  });

  it("pushHistory after undo clears the future stack", () => {
    const { pushHistory, undo, canRedo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("v1"));
    pushHistory(BUFFER_ID, makeEntry("v2"));
    undo(BUFFER_ID); // back to v1
    pushHistory(BUFFER_ID, makeEntry("v3"));
    // Future should be cleared
    expect(canRedo(BUFFER_ID)).toBe(false);
  });

  it("pushHistory deduplicates identical consecutive content", () => {
    const { pushHistory, undo, canUndo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("same-content"));
    pushHistory(BUFFER_ID, makeEntry("same-content"));
    // Second push should be skipped because content matches top of past
    undo(BUFFER_ID);
    expect(canUndo(BUFFER_ID)).toBe(false);
  });

  it("pushHistory preserves cursor position in entry", () => {
    const { pushHistory, undo } = useHistoryStore.getState().actions;
    pushHistory(
      BUFFER_ID,
      makeEntry("content", {
        cursorPosition: { line: 5, column: 10, offset: 42 },
      }),
    );
    const entry = undo(BUFFER_ID);
    expect(entry?.cursorPosition).toEqual({ line: 5, column: 10, offset: 42 });
  });

  it("pushHistory enforces max history size", () => {
    const { pushHistory, undo } = useHistoryStore.getState().actions;
    // Default max is 100; push 101 entries
    for (let i = 1; i <= 101; i++) {
      pushHistory(BUFFER_ID, makeEntry(`v${i}`));
    }
    // The oldest entry (v1) should have been evicted
    let oldest = null;
    for (let i = 0; i < 101; i++) {
      oldest = undo(BUFFER_ID);
    }
    // After 100 undos, canUndo should be false (v1 was evicted)
    const { canUndo } = useHistoryStore.getState().actions;
    expect(canUndo(BUFFER_ID)).toBe(false);
  });

  it("clearHistory resets history for a buffer", () => {
    const { pushHistory, clearHistory, canUndo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("v1"));
    clearHistory(BUFFER_ID);
    expect(canUndo(BUFFER_ID)).toBe(false);
  });

  it("clearAllHistories resets all buffer histories", () => {
    const { pushHistory, clearAllHistories, canUndo } = useHistoryStore.getState().actions;
    pushHistory(BUFFER_ID, makeEntry("v1"));
    pushHistory("another-buffer", makeEntry("v2"));
    clearAllHistories();
    expect(canUndo(BUFFER_ID)).toBe(false);
    expect(canUndo("another-buffer")).toBe(false);
  });

  it("undo when already at start returns null", () => {
    const { undo } = useHistoryStore.getState().actions;
    expect(undo(BUFFER_ID)).toBeNull();
  });

  it("redo when already at end returns null", () => {
    const { redo } = useHistoryStore.getState().actions;
    expect(redo(BUFFER_ID)).toBeNull();
  });
});
