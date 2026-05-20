import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane-store";
import { getAllPaneGroups } from "../utils/pane-tree";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import {
  closeActiveEditorGroup,
  closeOtherEditorGroups,
  moveActiveEditorToAdjacentGroup,
  resetEditorGroupSizes,
  splitActiveEditorGroup,
  toggleActiveEditorGroupLock,
} from "../utils/pane-command-actions";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn().mockReturnValue({ label: "main" }),
  getAllWebviewWindows: vi.fn().mockResolvedValue([{ label: "main" }]),
}));

describe("pane command actions", () => {
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
    vi.clearAllMocks();
  });

  it("splits the active editor group with an editor buffer", () => {
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
          isActive: true,
          content: "",
          savedContent: "",
          isDirty: false,
          isVirtual: false,
          tokens: [],
        },
      ],
      activeBufferId: "buffer-a",
    }));
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");

    expect(splitActiveEditorGroup("horizontal")).toBe(true);

    const groups = getAllPaneGroups(usePaneStore.getState().root);
    expect(groups).toHaveLength(2);
    expect(groups.every((pane) => pane.bufferIds.includes("buffer-a"))).toBe(true);
  });

  it("splits stateful buffers into an empty editor group", () => {
    const paneActions = usePaneStore.getState().actions;

    useBufferStore.setState((state) => ({
      ...state,
      buffers: [
        {
          id: "terminal-a",
          type: "terminal",
          path: "terminal://terminal-a",
          name: "Terminal",
          isPinned: false,
          isPreview: false,
          isActive: true,
          sessionId: "terminal-a",
        },
      ],
      activeBufferId: "terminal-a",
    }));
    paneActions.addBufferToPane(ROOT_PANE_ID, "terminal-a");

    expect(splitActiveEditorGroup("horizontal")).toBe(true);

    const groups = getAllPaneGroups(usePaneStore.getState().root);
    expect(groups).toHaveLength(2);
    expect(groups.find((pane) => pane.id === ROOT_PANE_ID)?.bufferIds).toEqual(["terminal-a"]);
    expect(groups.find((pane) => pane.id !== ROOT_PANE_ID)?.bufferIds).toEqual([]);
  });

  it("closes only when another editor group can receive the buffers", () => {
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    expect(closeActiveEditorGroup()).toBe(false);

    const splitPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(splitPaneId).not.toBeNull();
    if (!splitPaneId) return;

    paneActions.setActivePane(splitPaneId);
    expect(closeActiveEditorGroup()).toBe(true);
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(1);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a"]);
  });

  it("closes other editor groups into the active editor group", () => {
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const rightPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    paneActions.addBufferToPane(rightPaneId, "buffer-b");
    paneActions.setActivePane(ROOT_PANE_ID);

    expect(closeOtherEditorGroups()).toBe(true);
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(1);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a", "buffer-b"]);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("resets nested editor group sizes", () => {
    const paneActions = usePaneStore.getState().actions;

    const rightPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    const bottomRightPaneId = paneActions.splitPane(rightPaneId, "vertical");
    expect(bottomRightPaneId).not.toBeNull();
    if (!bottomRightPaneId) return;

    const root = usePaneStore.getState().root;
    expect(root.type).toBe("split");
    if (root.type !== "split") return;
    expect(root.children[1].type).toBe("split");
    if (root.children[1].type !== "split") return;

    paneActions.updatePaneSizes(root.id, [75, 25]);
    paneActions.updatePaneSizes(root.children[1].id, [30, 70]);

    expect(resetEditorGroupSizes()).toBe(true);

    const nextRoot = usePaneStore.getState().root;
    expect(nextRoot.type).toBe("split");
    if (nextRoot.type !== "split") return;
    expect(nextRoot.sizes).toEqual([50, 50]);
    expect(nextRoot.children[1].type).toBe("split");
    if (nextRoot.children[1].type !== "split") return;
    expect(nextRoot.children[1].sizes).toEqual([50, 50]);
  });

  it("moves the active editor into the next and previous editor group", () => {
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-b");
    const rightPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    paneActions.activatePaneBuffer(ROOT_PANE_ID, "buffer-a");
    expect(moveActiveEditorToAdjacentGroup("next")).toBe(true);

    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-b"]);
    expect(paneActions.getPaneById(rightPaneId)?.bufferIds).toEqual(["buffer-a"]);
    expect(usePaneStore.getState().activePaneId).toBe(rightPaneId);

    expect(moveActiveEditorToAdjacentGroup("previous")).toBe(true);

    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-b", "buffer-a"]);
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(1);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("does not run editor group commands against bottom pane splits", () => {
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(BOTTOM_PANE_ID, "terminal-a");
    const splitPaneId = paneActions.splitPane(BOTTOM_PANE_ID, "horizontal");
    expect(splitPaneId).not.toBeNull();
    if (!splitPaneId) return;

    paneActions.addBufferToPane(splitPaneId, "terminal-b");
    paneActions.setActivePane(splitPaneId);

    expect(splitActiveEditorGroup("horizontal")).toBe(false);
    expect(closeActiveEditorGroup()).toBe(false);
    expect(moveActiveEditorToAdjacentGroup("previous")).toBe(false);
    expect(toggleActiveEditorGroupLock()).toBe(false);
    expect(getAllPaneGroups(usePaneStore.getState().bottomRoot)).toHaveLength(2);
    expect(paneActions.getPaneById(splitPaneId)?.locked).toBeFalsy();
  });
});
