import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { activateBufferInPaneAndSync } from "../utils/pane-activation";

describe("pane activation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    usePaneStore.getState().actions.reset();
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
  });

  it("activates pane and buffer stores together", () => {
    const paneActions = usePaneStore.getState().actions;

    useBufferStore.setState((state) => ({
      ...state,
      buffers: [
        {
          id: "buffer-a",
          type: "editor",
          path: "/workspace/a.ts",
          name: "a.ts",
          isPinned: false,
          isPreview: false,
          isActive: false,
          content: "",
          savedContent: "",
          isDirty: false,
          isVirtual: false,
          tokens: [],
        },
      ],
      activeBufferId: null,
    }));
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a", false);

    activateBufferInPaneAndSync(ROOT_PANE_ID, "buffer-a");

    expect(paneActions.getPaneById(ROOT_PANE_ID)?.activeBufferId).toBe("buffer-a");
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
    expect(useBufferStore.getState().activeBufferId).toBe("buffer-a");
  });
});
