import { afterEach, describe, expect, it } from "vite-plus/test";
import { isEditorViewOfBuffer, useEditorStateStore } from "../stores/state.store";

describe("editor state store", () => {
  afterEach(() => {
    useEditorStateStore.setState({ activeEditorViewKey: null, selection: undefined });
  });

  it("keeps no copy of the active buffer's text or path", () => {
    const state = useEditorStateStore.getState();
    expect(state).not.toHaveProperty("value");
    expect(state).not.toHaveProperty("filePath");
    expect(state.actions).not.toHaveProperty("setContent");
    expect(state.actions).not.toHaveProperty("setFileInfo");
  });

  it("matches a view key to the buffer it shows", () => {
    expect(isEditorViewOfBuffer("buffer-1", "buffer-1")).toBe(true);
    expect(isEditorViewOfBuffer("pane-2:buffer-1", "buffer-1")).toBe(true);
    expect(isEditorViewOfBuffer("pane-2:buffer-10", "buffer-1")).toBe(false);
    expect(isEditorViewOfBuffer(null, "buffer-1")).toBe(false);
  });

  it("stores the change handler only when it changes", () => {
    const handler = () => {};
    let notifications = 0;
    const unsubscribe = useEditorStateStore.subscribe(() => notifications++);
    useEditorStateStore.getState().actions.setChangeHandler(handler);
    useEditorStateStore.getState().actions.setChangeHandler(handler);
    unsubscribe();

    expect(useEditorStateStore.getState().onChange).toBe(handler);
    expect(notifications).toBe(1);
  });
});
