import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { useBufferStore as useBufferStoreHook } from "@/features/editor/stores/buffer.store";
import { usePaneStore } from "@/features/panes/stores/pane.store";

const mocks = vi.hoisted(() => ({
  handleFileSelect: vi.fn(),
  stopForFile: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: {
    getState: () => ({
      handleFileSelect: mocks.handleFileSelect,
    }),
  },
}));

vi.mock("@/features/editor/lsp/lsp-client", () => ({
  LspClient: {
    getInstance: () => ({
      stopForFile: mocks.stopForFile,
    }),
  },
}));

vi.mock("@/ui/toast", () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

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

const makeFileBuffer = (
  type: "editor" | "image" | "pdf" | "binary",
  id: string,
  path: string,
  isPinned = false,
): PaneContent => {
  const base = {
    id,
    type,
    path,
    name: path.split("/").pop() ?? path,
    isPinned,
    isPreview: false,
    isActive: false,
  };

  if (type === "editor") {
    return {
      ...base,
      type,
      content: "content",
      savedContent: "content",
      isDirty: false,
      isVirtual: false,
      tokens: [],
    };
  }

  return { ...base, type };
};

const makePreviewBuffer = (
  type: "markdownPreview" | "htmlPreview" | "csvPreview",
  isPinned = true,
): Extract<PaneContent, { type: "markdownPreview" | "htmlPreview" | "csvPreview" }> => ({
  id: `${type}-buffer`,
  type,
  path: `/workspace/file.${type}:preview`,
  name: `${type} preview`,
  isPinned,
  isPreview: false,
  isActive: true,
  content: `${type} content`,
  sourceFilePath: `/workspace/file.${type}`,
});

const makeUnrelatedBuffer = (): PaneContent => ({
  id: "unrelated",
  type: "newTab",
  path: "newtab://unrelated",
  name: "New Tab",
  isPinned: false,
  isPreview: false,
  isActive: true,
});

describe("reopen closed tab", () => {
  let useBufferStore: typeof useBufferStoreHook;

  beforeEach(async () => {
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

    ({ useBufferStore } = await import("@/features/editor/stores/buffer.store"));
    mocks.handleFileSelect.mockReset();
    mocks.stopForFile.mockClear();
    mocks.toastError.mockClear();
    mocks.toastInfo.mockClear();
  });

  afterEach(() => {
    useBufferStore.setState({
      activeBufferId: null,
      buffers: [],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    usePaneStore.getState().actions.reset();
    vi.unstubAllGlobals();
  });

  it.each([
    ["editor", "/workspace/file.ts"],
    ["image", "/workspace/image.png"],
    ["pdf", "/workspace/document.pdf"],
    ["binary", "/workspace/archive.bin"],
  ] as const)("reopens and pins a closed %s buffer by path", async (type, path) => {
    const closedBuffer = makeFileBuffer(type, "closed", path, true);
    closedBuffer.isActive = true;
    useBufferStore.setState({
      activeBufferId: closedBuffer.id,
      buffers: [closedBuffer],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    useBufferStore.getState().actions.closeBufferForce(closedBuffer.id);
    useBufferStore.setState({
      activeBufferId: "unrelated",
      buffers: [makeUnrelatedBuffer()],
    });

    mocks.handleFileSelect.mockImplementationOnce(async () => {
      useBufferStore.setState((state) => ({
        buffers: [...state.buffers, makeFileBuffer(type, "reopened", path)],
      }));
    });

    await useBufferStore.getState().actions.reopenClosedTab();

    const state = useBufferStore.getState();
    expect(mocks.handleFileSelect).toHaveBeenCalledWith(path, false);
    expect(state.buffers.find((buffer) => buffer.id === "reopened")?.isPinned).toBe(true);
    expect(state.buffers.find((buffer) => buffer.id === "unrelated")?.isPinned).toBe(false);
    expect(state.closedBuffersHistory).toEqual([]);
  });

  it.each(["markdownPreview", "htmlPreview", "csvPreview"] as const)(
    "restores a closed %s buffer from its preview state",
    async (type) => {
      const closedBuffer = makePreviewBuffer(type);
      useBufferStore.setState({
        activeBufferId: closedBuffer.id,
        buffers: [closedBuffer],
        pendingClose: null,
        closedBuffersHistory: [],
      });

      useBufferStore.getState().actions.closeBufferForce(closedBuffer.id);
      await useBufferStore.getState().actions.reopenClosedTab();

      const reopenedBuffer = useBufferStore
        .getState()
        .buffers.find((buffer) => buffer.path === closedBuffer.path);
      expect(reopenedBuffer).toMatchObject({
        type,
        content: closedBuffer.content,
        sourceFilePath: closedBuffer.sourceFilePath,
        isPinned: true,
      });
      expect(mocks.handleFileSelect).not.toHaveBeenCalled();
    },
  );

  it("restores a closed diff buffer from its saved diff state", async () => {
    const closedBuffer: PaneContent = {
      id: "diff-buffer",
      type: "diff",
      path: "diff://staged/file.ts",
      name: "file.ts (staged)",
      isPinned: true,
      isPreview: false,
      isActive: true,
      content: "diff content",
      savedContent: "diff content",
    };
    useBufferStore.setState({
      activeBufferId: closedBuffer.id,
      buffers: [closedBuffer],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    useBufferStore.getState().actions.closeBufferForce(closedBuffer.id);
    await useBufferStore.getState().actions.reopenClosedTab();

    expect(
      useBufferStore.getState().buffers.find((buffer) => buffer.path === closedBuffer.path),
    ).toMatchObject({
      type: "diff",
      content: "diff content",
      isPinned: true,
    });
    expect(mocks.handleFileSelect).not.toHaveBeenCalled();
  });

  it("does not add virtual editors to file-backed closed-tab history", () => {
    const closedBuffer = {
      ...makeFileBuffer("editor", "virtual", "untitled-1"),
      isActive: true,
      isVirtual: true,
    };
    useBufferStore.setState({
      activeBufferId: closedBuffer.id,
      buffers: [closedBuffer],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    useBufferStore.getState().actions.closeBufferForce(closedBuffer.id);

    expect(useBufferStore.getState().closedBuffersHistory).toEqual([]);
  });

  it("keeps only the newest history entry for the same tab type and path", () => {
    const path = "/workspace/image.png";
    const firstBuffer = makeFileBuffer("image", "first", path);
    useBufferStore.setState({
      activeBufferId: firstBuffer.id,
      buffers: [firstBuffer],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    useBufferStore.getState().actions.closeBufferForce(firstBuffer.id);

    const secondBuffer = makeFileBuffer("image", "second", path);
    useBufferStore.setState({
      activeBufferId: secondBuffer.id,
      buffers: [secondBuffer],
    });
    useBufferStore.getState().actions.closeBufferForce(secondBuffer.id);

    expect(useBufferStore.getState().closedBuffersHistory).toHaveLength(1);
  });
});
