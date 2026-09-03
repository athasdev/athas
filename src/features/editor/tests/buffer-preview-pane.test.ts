import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane.store";

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
    const { useBufferStore } = await import("../stores/buffer.store");
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
  });

  it("replaces preview buffers only within the target pane", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
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
    const { useBufferStore } = await import("../stores/buffer.store");
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
    const { useBufferStore } = await import("../stores/buffer.store");
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

  it("opens independent new tabs and only consumes the active one", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const bufferActions = useBufferStore.getState().actions;
    const paneActions = usePaneStore.getState().actions;

    const editorId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/a.ts",
      name: "a.ts",
      content: "",
    });
    const newTabId = bufferActions.openContent({ type: "newTab" });
    const secondNewTabId = bufferActions.openContent({ type: "newTab" });

    const newTabBuffer = useBufferStore.getState().buffers.find((buffer) => buffer.id === newTabId);
    expect(newTabBuffer?.type).toBe("newTab");
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual([
      editorId,
      newTabId,
      secondNewTabId,
    ]);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.activeBufferId).toBe(secondNewTabId);

    const replacementId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/b.ts",
      name: "b.ts",
      content: "",
    });

    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual([
      editorId,
      newTabId,
      replacementId,
    ]);
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.id === newTabId)).toBe(true);
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.id === secondNewTabId)).toBe(
      false,
    );
  });

  it("opens tool buffers as singletons", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const bufferActions = useBufferStore.getState().actions;

    const firstSearchId = bufferActions.openGlobalSearchBuffer();
    const secondSearchId = bufferActions.openGlobalSearchBuffer();
    const firstReferencesId = bufferActions.openReferencesBuffer();
    const secondReferencesId = bufferActions.openReferencesBuffer();
    const diagnosticsId = bufferActions.openDiagnosticsBuffer();
    const firstSettingsId = bufferActions.openSettingsBuffer();
    const secondSettingsId = bufferActions.openSettingsBuffer();
    const firstExtensionsId = bufferActions.openExtensionsBuffer();
    const secondExtensionsId = bufferActions.openExtensionsBuffer();
    const firstContinuousAgentsId = bufferActions.openContinuousAgentsBuffer();
    const secondContinuousAgentsId = bufferActions.openContinuousAgentsBuffer();

    expect(secondSearchId).toBe(firstSearchId);
    expect(secondReferencesId).toBe(firstReferencesId);
    expect(secondSettingsId).toBe(firstSettingsId);
    expect(secondExtensionsId).toBe(firstExtensionsId);
    expect(secondContinuousAgentsId).toBe(firstContinuousAgentsId);
    expect(useBufferStore.getState().buffers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstSearchId,
          type: "globalSearch",
          path: "search://global",
          name: "Search",
        }),
        expect.objectContaining({
          id: firstReferencesId,
          type: "references",
          path: "references://results",
          name: "References",
        }),
        expect.objectContaining({
          id: diagnosticsId,
          type: "diagnostics",
          path: "diagnostics://problems",
          name: "Diagnostics",
        }),
        expect.objectContaining({
          id: firstSettingsId,
          type: "settings",
          path: "settings://preferences",
          name: "Settings",
        }),
        expect.objectContaining({
          id: firstExtensionsId,
          type: "extensions",
          path: "extensions://marketplace",
          name: "Extensions",
        }),
        expect.objectContaining({
          id: firstContinuousAgentsId,
          type: "continuousAgents",
          path: "continuous-agents://workspace",
          name: "Continuous Agents",
        }),
      ]),
    );
  });

  it("opens singular extension pages as reusable tabs", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const bufferActions = useBufferStore.getState().actions;

    const typescriptId = bufferActions.openExtensionBuffer("athas.typescript", "TypeScript");
    const rustId = bufferActions.openExtensionBuffer("athas.rust", "Rust");
    const reopenedTypescriptId = bufferActions.openExtensionBuffer(
      "athas.typescript",
      "TypeScript Language Support",
    );

    expect(reopenedTypescriptId).toBe(typescriptId);
    expect(rustId).not.toBe(typescriptId);
    expect(useBufferStore.getState().activeBufferId).toBe(typescriptId);
    expect(useBufferStore.getState().buffers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: typescriptId,
          type: "extension",
          extensionId: "athas.typescript",
          name: "TypeScript Language Support",
          path: "extension://athas.typescript",
        }),
        expect.objectContaining({
          id: rustId,
          type: "extension",
          extensionId: "athas.rust",
          name: "Rust",
          path: "extension://athas.rust",
        }),
      ]),
    );
  });
});
