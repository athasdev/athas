import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorAppStore } from "../stores/editor-app-store";

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
  beforeEach(() => {
    localStorage.clear();
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.recordLocalHistoryFile.mockResolvedValue(undefined);
    mocks.notifyDocumentSave.mockResolvedValue(undefined);

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
    useBufferStore.setState({
      activeBufferId: null,
      buffers: [],
      pendingClose: null,
      closedBuffersHistory: [],
    });
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
