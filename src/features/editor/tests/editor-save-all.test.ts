import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import type { useBufferStore as useBufferStoreHook } from "../stores/buffer.store";
import type { useEditorAppStore as useEditorAppStoreHook } from "../stores/editor-app.store";

const mocks = vi.hoisted(() => ({
  notifyDocumentSave: vi.fn(),
  recordLocalHistoryFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@/features/editor/lsp/lsp-client", () => ({
  LspClient: {
    getInstance: () => ({
      notifyDocumentSave: mocks.notifyDocumentSave,
    }),
  },
}));

vi.mock("@/features/file-system/controllers/platform", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/file-system/controllers/platform")>();
  return {
    ...original,
    writeFile: mocks.writeFile,
  };
});

vi.mock("@/features/local-history/api/local-history-api", () => ({
  recordLocalHistoryFile: mocks.recordLocalHistoryFile,
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

function makeEditorBuffer(
  id: string,
  path: string,
  content: string,
  isDirty: boolean,
): EditorContent {
  return {
    id,
    type: "editor",
    path,
    name: path.split("/").pop() ?? path,
    content,
    savedContent: isDirty ? "" : content,
    isDirty,
    isVirtual: false,
    isPinned: false,
    isPreview: false,
    isActive: false,
    language: "typescript",
    tokens: [],
  };
}

describe("editor save all", () => {
  let useBufferStore: typeof useBufferStoreHook;
  let useEditorAppStore: typeof useEditorAppStoreHook;

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
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.recordLocalHistoryFile.mockResolvedValue(undefined);
    mocks.notifyDocumentSave.mockResolvedValue(undefined);

    ({ useBufferStore } = await import("../stores/buffer.store"));
    ({ useEditorAppStore } = await import("../stores/editor-app.store"));

    useBufferStore.setState({
      activeBufferId: "a",
      buffers: [
        makeEditorBuffer("a", "/workspace/a.ts", "a next", true),
        makeEditorBuffer("b", "/workspace/b.ts", "b next", true),
        makeEditorBuffer("c", "/workspace/c.ts", "c clean", false),
      ],
      pendingClose: null,
      closedBuffersHistory: [],
    });
  });

  afterEach(() => {
    useBufferStore?.setState({
      activeBufferId: null,
      buffers: [],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("saves each dirty editor buffer without switching the active buffer", async () => {
    const savedCount = await useEditorAppStore.getState().actions.handleSaveAll();

    expect(savedCount).toBe(2);
    expect(useBufferStore.getState().activeBufferId).toBe("a");
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "a next");
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/b.ts", "b next");
    expect(mocks.writeFile).not.toHaveBeenCalledWith("/workspace/c.ts", "c clean");
    expect(
      useBufferStore
        .getState()
        .buffers.filter((buffer) => buffer.type === "editor" && buffer.isDirty),
    ).toHaveLength(0);
  });
});
