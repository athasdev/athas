import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useEditorStateStore } from "../stores/state.store";
import type { Position } from "../types/editor.types";

const state = () => useEditorStateStore.getState();
const actions = () => state().actions;
const at = (line: number, column: number, offset = line * 10 + column): Position => ({
  line,
  column,
  offset,
});

beforeEach(() => {
  actions().clearPositionCache();
  useEditorStateStore.setState({
    cursorPosition: at(0, 0),
    selection: undefined,
    multiCursorState: null,
    activeEditorViewKey: "pane:file",
    desiredColumn: undefined,
    cursorVisible: true,
  });
});

describe("multiple cursors", () => {
  it("starts from the current cursor and adds distinct cursors only", () => {
    useEditorStateStore.setState({ cursorPosition: at(1, 2) });
    actions().addCursor(at(3, 0));
    expect(state().multiCursorState).toBeNull();

    actions().enableMultiCursor();
    const primaryId = state().multiCursorState!.primaryCursorId;
    actions().enableMultiCursor();
    actions().addCursor(at(2, 4));
    actions().addCursor(at(2, 4));
    actions().addCursor(at(1, 2));

    expect(state().multiCursorState!.primaryCursorId).toBe(primaryId);
    expect(state().multiCursorState!.cursors.map((cursor) => cursor.position)).toEqual([
      at(1, 2),
      at(2, 4),
    ]);
  });

  it("moves, removes and collapses cursors back to the primary one", () => {
    useEditorStateStore.setState({ cursorPosition: at(0, 1) });
    actions().enableMultiCursor();
    actions().addCursor(at(1, 1));
    actions().addCursor(at(2, 1));
    const [primary, second, third] = state().multiCursorState!.cursors;
    const selection = { start: at(2, 0), end: at(2, 3) };

    actions().updateCursor(third.id, at(2, 3), selection);
    expect(state().multiCursorState!.cursors[2]).toMatchObject({ position: at(2, 3), selection });

    actions().removeCursor(second.id);
    expect(state().multiCursorState!.cursors.map((cursor) => cursor.id)).toEqual([
      primary.id,
      third.id,
    ]);

    actions().removeCursor(primary.id);
    expect(state().multiCursorState!.primaryCursorId).toBe(third.id);

    actions().clearSecondaryCursors();
    expect(state().cursorPosition).toEqual(at(2, 3));
    expect(state().selection).toEqual(selection);

    actions().removeCursor(third.id);
    expect(state().multiCursorState).toBeNull();
  });

  it("drops every cursor when the primary one is missing", () => {
    useEditorStateStore.setState({
      multiCursorState: { cursors: [{ id: "a", position: at(0, 0) }], primaryCursorId: "gone" },
    });
    actions().clearSecondaryCursors();
    expect(state().multiCursorState).toBeNull();
  });

  it("ignores cursor edits without multi-cursor mode and can be disabled", () => {
    actions().removeCursor("x");
    actions().updateCursor("x", at(1, 1));
    actions().clearSecondaryCursors();
    expect(state().multiCursorState).toBeNull();

    actions().enableMultiCursor();
    actions().disableMultiCursor();
    expect(state().multiCursorState).toBeNull();
  });

  it("resets selection, cursors and desired column on buffer switch", () => {
    actions().enableMultiCursor();
    actions().setSelection({ start: at(0, 0), end: at(0, 2) });
    actions().setDesiredColumn(8);

    actions().resetOnBufferSwitch();

    expect(state()).toMatchObject({
      multiCursorState: null,
      selection: undefined,
      desiredColumn: undefined,
    });
  });
});

describe("per-view state cache", () => {
  it("remembers the cursor and selection of the active view", () => {
    const selection = { start: at(4, 0), end: at(4, 6) };
    actions().setCursorAndSelection(at(4, 6), selection);
    actions().setCursorAndSelection(at(4, 6), selection);

    expect(actions().getCachedPosition("pane:file")).toEqual(at(4, 6));
    expect(actions().getCachedViewState("pane:file")).toEqual({
      cursor: at(4, 6),
      selection,
      scrollTop: 0,
      scrollLeft: 0,
    });
    expect(actions().getCachedPosition("unknown")).toBeNull();
    expect(actions().getCachedViewState("unknown")).toBeNull();
  });

  it("falls back between pane view keys and plain buffer ids", () => {
    actions().cacheViewStateForBuffer("file", {
      cursor: at(9, 1),
      scrollTop: 120,
      scrollLeft: 4,
    });
    expect(actions().getCachedViewState("other-pane:file")).toMatchObject({ scrollTop: 120 });

    actions().cacheViewStateForBuffer("pane-2:notes", {
      cursor: at(1, 1),
      selection: { start: at(1, 0), end: at(1, 1) },
      scrollTop: 30,
      scrollLeft: 0,
    });
    expect(actions().getCachedViewState("notes")).toMatchObject({
      cursor: at(1, 1),
      scrollTop: 30,
    });
  });

  it("stores scroll per view and reports the active view's scroll", () => {
    actions().setScroll(200, 10);
    expect(actions().getScroll()).toEqual({ scrollTop: 200, scrollLeft: 10 });

    actions().setScrollForBuffer("pane:other", 50, 0);
    actions().setScrollForBuffer(null as never, 1, 1);
    expect(actions().getCachedViewState("pane:other")).toMatchObject({ scrollTop: 50 });
    expect(actions().getScroll()).toEqual({ scrollTop: 200, scrollLeft: 10 });

    useEditorStateStore.setState({ activeEditorViewKey: null });
    expect(actions().getScroll()).toEqual({ scrollTop: 0, scrollLeft: 0 });
  });

  it("forgets one view or every view", () => {
    actions().cacheViewStateForBuffer("a", { cursor: at(1, 0), scrollTop: 0, scrollLeft: 0 });
    actions().cacheViewStateForBuffer("b", { cursor: at(2, 0), scrollTop: 0, scrollLeft: 0 });

    actions().clearPositionCache("a");
    expect(actions().getCachedPosition("a")).toBeNull();
    expect(actions().getCachedPosition("b")).toEqual(at(2, 0));

    actions().clearPositionCache();
    expect(actions().getCachedPosition("b")).toBeNull();
  });

  it("evicts the oldest view once the cache is full", () => {
    for (let index = 0; index < 51; index += 1) {
      actions().cacheViewStateForBuffer(`view-${index}`, {
        cursor: at(index, 0),
        scrollTop: 0,
        scrollLeft: 0,
      });
    }

    expect(actions().getCachedPosition("view-0")).toBeNull();
    expect(actions().getCachedPosition("view-1")).toEqual(at(1, 0));
    expect(actions().getCachedPosition("view-50")).toEqual(at(50, 0));
  });
});

describe("simple view flags", () => {
  it("updates desired column, cursor visibility, active view and pending requests", () => {
    actions().setDesiredColumn(5);
    actions().setCursorVisibility(false);
    actions().setActiveEditorViewKey("pane:two");
    actions().requestNavigation({ bufferId: "two", range: { start: at(1, 0), end: at(1, 0) } });
    actions().requestReveal({ bufferId: "two", line: 3 });

    expect(state()).toMatchObject({
      desiredColumn: 5,
      cursorVisible: false,
      activeEditorViewKey: "pane:two",
      pendingNavigation: { bufferId: "two" },
      pendingReveal: { bufferId: "two", line: 3 },
    });
  });
});
