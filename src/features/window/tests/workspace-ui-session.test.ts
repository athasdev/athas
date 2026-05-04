import { afterEach, describe, expect, it } from "vite-plus/test";
import { ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import type { PaneContent } from "@/features/panes/types/pane-content";
import {
  buildCurrentProjectPaneSession,
  buildPaneLayoutFromSession,
} from "../stores/workspace-pane-session";

const editorBuffer = (id: string, path: string) =>
  ({
    id,
    path,
    type: "editor",
    isVirtual: false,
  }) as PaneContent;

describe("workspace UI pane session helpers", () => {
  afterEach(() => {
    usePaneStore.getState().actions.reset();
  });

  it("serializes pane buffer ids as stable buffer paths", () => {
    const { actions } = usePaneStore.getState();
    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const splitPaneId = actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(splitPaneId).not.toBeNull();
    if (!splitPaneId) return;

    actions.addBufferToPane(splitPaneId, "buffer-b");
    actions.setActivePane(splitPaneId);

    const layout = usePaneStore.getState();
    const paneState = buildCurrentProjectPaneSession(layout, [
      editorBuffer("buffer-a", "/workspace/a.ts"),
      editorBuffer("buffer-b", "/workspace/b.ts"),
    ]);

    expect(paneState.activePaneId).toBe(splitPaneId);
    expect(paneState.root.type).toBe("split");
    if (paneState.root.type !== "split") return;
    expect(paneState.root.children[0]).toMatchObject({
      type: "group",
      bufferPaths: ["/workspace/a.ts"],
    });
    expect(paneState.root.children[1]).toMatchObject({
      type: "group",
      bufferPaths: ["/workspace/b.ts"],
      activeBufferPath: "/workspace/b.ts",
    });
  });

  it("hydrates saved pane paths into the current buffer ids", () => {
    const layout = buildPaneLayoutFromSession(
      {
        root: {
          id: ROOT_PANE_ID,
          type: "group",
          bufferPaths: ["/workspace/a.ts", "/workspace/missing.ts"],
          activeBufferPath: "/workspace/a.ts",
        },
        bottomRoot: {
          id: "bottom-pane",
          type: "group",
          bufferPaths: [],
          activeBufferPath: null,
        },
        activePaneId: ROOT_PANE_ID,
        fullscreenPaneId: null,
      },
      [editorBuffer("new-buffer-a", "/workspace/a.ts")],
    );

    expect(layout?.root).toEqual({
      id: ROOT_PANE_ID,
      type: "group",
      bufferIds: ["new-buffer-a"],
      activeBufferId: "new-buffer-a",
    });
  });
});
