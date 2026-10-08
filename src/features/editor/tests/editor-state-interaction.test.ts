import { beforeEach, describe, expect, test } from "vite-plus/test";
import { subscribeToEditorScroll } from "../services/editor-scroll-events";
import { useEditorStateStore } from "../stores/state.store";
import type { Position, Range } from "../types/editor.types";

const INITIAL_POSITION: Position = { line: 0, column: 0, offset: 0 };

describe("editor interaction state", () => {
  beforeEach(() => {
    useEditorStateStore.setState({
      cursorPosition: INITIAL_POSITION,
      selection: undefined,
    });
  });

  test("publishes a cursor and selection change in one store update", () => {
    const position: Position = { line: 4, column: 7, offset: 42 };
    const selection: Range = {
      start: { line: 4, column: 3, offset: 38 },
      end: position,
    };
    let updateCount = 0;
    const unsubscribe = useEditorStateStore.subscribe(() => {
      updateCount += 1;
    });

    useEditorStateStore.getState().actions.setCursorAndSelection(position, selection);
    unsubscribe();

    expect(updateCount).toBe(1);
    expect(useEditorStateStore.getState()).toMatchObject({
      cursorPosition: position,
      selection,
    });
  });

  test("does not publish an unchanged cursor and selection", () => {
    const position: Position = { line: 2, column: 5, offset: 21 };
    const selection: Range = { start: position, end: position };
    useEditorStateStore.getState().actions.setCursorAndSelection(position, selection);

    let updateCount = 0;
    const unsubscribe = useEditorStateStore.subscribe(() => {
      updateCount += 1;
    });
    useEditorStateStore.getState().actions.setCursorAndSelection(position, selection);
    unsubscribe();

    expect(updateCount).toBe(0);
  });

  test("keeps scroll out of store updates and reports it to scroll listeners", () => {
    useEditorStateStore.setState({ activeEditorViewKey: "pane-1:scroll-buffer" });
    let storeUpdates = 0;
    let scrollEvents = 0;
    const unsubscribeStore = useEditorStateStore.subscribe(() => {
      storeUpdates += 1;
    });
    const unsubscribeScroll = subscribeToEditorScroll(() => {
      scrollEvents += 1;
    });
    const { actions } = useEditorStateStore.getState();

    actions.setScrollForBuffer("pane-1:scroll-buffer", 120, 4);
    actions.setScrollForBuffer("pane-1:scroll-buffer", 120, 4);
    actions.setScrollForBuffer("pane-2:other-buffer", 40, 0);
    unsubscribeStore();
    unsubscribeScroll();

    expect(storeUpdates).toBe(0);
    expect(scrollEvents).toBe(1);
    expect(actions.getScroll()).toEqual({ scrollTop: 120, scrollLeft: 4 });
    expect(actions.getCachedViewState("pane-1:scroll-buffer")).toMatchObject({
      scrollTop: 120,
      scrollLeft: 4,
    });
    expect(actions.getCachedViewState("pane-2:other-buffer")).toMatchObject({ scrollTop: 40 });
  });
});
