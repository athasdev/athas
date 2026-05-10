import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane-store";

const createMockStorage = () => {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
};

describe("buffer preview pane integration", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn().mockResolvedValue([]),
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(async () => {
    usePaneStore.getState().actions.reset();
    const { useBufferStore } = await import("../stores/buffer-store");
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
  });

  it("replaces preview buffers only within the target pane", async () => {
    const { useBufferStore } = await import("../stores/buffer-store");
    const bufferActions = useBufferStore.getState().actions;
    const paneActions = usePaneStore.getState().actions;

    const firstPreviewId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/a.ts",
      name: "a.ts",
      content: "a",
      isPreview: true,
    });
    const rightPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    const secondPreviewId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/b.ts",
      name: "b.ts",
      content: "b",
      isPreview: true,
    });

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([
      firstPreviewId,
      secondPreviewId,
    ]);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.previewBufferId).toBe(firstPreviewId);
    expect(paneActions.getPaneById(rightPaneId)?.previewBufferId).toBe(secondPreviewId);

    const thirdPreviewId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/c.ts",
      name: "c.ts",
      content: "c",
      isPreview: true,
    });

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([
      firstPreviewId,
      thirdPreviewId,
    ]);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.previewBufferId).toBe(firstPreviewId);
    expect(paneActions.getPaneById(rightPaneId)?.previewBufferId).toBe(thirdPreviewId);
  });

  it("clears pane preview metadata when a preview becomes definite", async () => {
    const { useBufferStore } = await import("../stores/buffer-store");
    const bufferActions = useBufferStore.getState().actions;
    const paneActions = usePaneStore.getState().actions;

    const previewId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/preview.ts",
      name: "preview.ts",
      content: "preview",
      isPreview: true,
    });

    expect(paneActions.getPaneById(ROOT_PANE_ID)?.previewBufferId).toBe(previewId);

    bufferActions.convertPreviewToDefinite(previewId);

    expect(
      useBufferStore.getState().buffers.find((buffer) => buffer.id === previewId)?.isPreview,
    ).toBe(false);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.previewBufferId).toBeNull();
  });

  it("pins preview buffers as definite pane metadata", async () => {
    const { useBufferStore } = await import("../stores/buffer-store");
    const bufferActions = useBufferStore.getState().actions;
    const paneActions = usePaneStore.getState().actions;

    const previewId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/pinned.ts",
      name: "pinned.ts",
      content: "pinned",
      isPreview: true,
    });

    bufferActions.handleTabPin(previewId);

    const buffer = useBufferStore.getState().buffers.find((item) => item.id === previewId);
    const pane = paneActions.getPaneById(ROOT_PANE_ID);
    expect(buffer?.isPreview).toBe(false);
    expect(buffer?.isPinned).toBe(true);
    expect(pane?.previewBufferId).toBeNull();
    expect(pane?.pinnedBufferIds).toEqual([previewId]);
  });
});
