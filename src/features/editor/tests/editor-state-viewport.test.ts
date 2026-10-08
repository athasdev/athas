import { beforeEach, describe, expect, test } from "vite-plus/test";
import { EDITOR_CONSTANTS } from "../config/constants";
import { useEditorStateStore } from "../stores/state.store";

describe("editor viewport height", () => {
  beforeEach(() => {
    useEditorStateStore.setState({
      activeEditorViewKey: "pane-a",
      viewportHeight: EDITOR_CONSTANTS.DEFAULT_VIEWPORT_HEIGHT,
    });
  });

  test("records the height of the active editor view", () => {
    useEditorStateStore.getState().actions.setViewportHeightForView("pane-a", 412);

    expect(useEditorStateStore.getState().viewportHeight).toBe(412);
  });

  test("ignores other views and unmeasured heights", () => {
    const { setViewportHeightForView } = useEditorStateStore.getState().actions;

    setViewportHeightForView("pane-b", 300);
    setViewportHeightForView(null, 300);
    setViewportHeightForView("pane-a", 0);

    expect(useEditorStateStore.getState().viewportHeight).toBe(
      EDITOR_CONSTANTS.DEFAULT_VIEWPORT_HEIGHT,
    );
  });

  test("does not publish an unchanged height", () => {
    const { setViewportHeightForView } = useEditorStateStore.getState().actions;
    setViewportHeightForView("pane-a", 500);
    let updateCount = 0;
    const unsubscribe = useEditorStateStore.subscribe(() => {
      updateCount += 1;
    });

    setViewportHeightForView("pane-a", 500);
    unsubscribe();

    expect(updateCount).toBe(0);
  });
});
