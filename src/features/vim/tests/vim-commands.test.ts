import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import type { useBufferStore as useBufferStoreHook } from "../../editor/stores/buffer.store";
import type { useEditorAppStore as useEditorAppStoreHook } from "../../editor/stores/editor-app.store";

const mocks = vi.hoisted(() => ({
  notifyDocumentSave: vi.fn(),
  recordLocalHistoryFile: vi.fn(),
  saveDialog: vi.fn(),
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

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mocks.saveDialog,
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

describe("vim ex commands", () => {
  let useBufferStore: typeof useBufferStoreHook;
  let useEditorAppStore: typeof useEditorAppStoreHook;
  let parseAndExecuteVimCommand: (input: string) => Promise<boolean>;
  let dispatchedEvents: CustomEvent[];

  const activeBuffer = () =>
    useBufferStore
      .getState()
      .buffers.find((b) => b.id === useBufferStore.getState().activeBufferId);

  beforeEach(async () => {
    vi.stubGlobal("localStorage", createMockStorage());
    dispatchedEvents = [];
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
      dispatchEvent: (event: CustomEvent) => {
        dispatchedEvents.push(event);
        return true;
      },
    });
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.recordLocalHistoryFile.mockResolvedValue(undefined);
    mocks.notifyDocumentSave.mockResolvedValue(undefined);
    mocks.saveDialog.mockResolvedValue(null);

    ({ useBufferStore } = await import("../../editor/stores/buffer.store"));
    ({ useEditorAppStore } = await import("../../editor/stores/editor-app.store"));
    ({ parseAndExecuteVimCommand } = await import("../stores/vim-commands"));

    useBufferStore.setState({
      activeBufferId: "a",
      buffers: [makeEditorBuffer("a", "/workspace/a.ts", "changed", true)],
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

  it(":w saves the active file", async () => {
    const handleSave = vi.spyOn(useEditorAppStore.getState().actions, "handleSave");

    const handled = await parseAndExecuteVimCommand("w");

    expect(handled).toBe(true);
    expect(handleSave).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "changed");
  });

  it(":wq saves and closes the buffer without a save prompt", async () => {
    const handleSave = vi.spyOn(useEditorAppStore.getState().actions, "handleSave");

    const handled = await parseAndExecuteVimCommand("wq");

    expect(handled).toBe(true);
    expect(handleSave).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "changed");
    expect(activeBuffer()).toBeUndefined();
    expect(useBufferStore.getState().pendingClose).toBeNull();
  });

  it(":x saves and closes like :wq", async () => {
    const handled = await parseAndExecuteVimCommand("x");

    expect(handled).toBe(true);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "changed");
    expect(activeBuffer()).toBeUndefined();
  });

  it(":wq keeps an untitled buffer open when saving is canceled", async () => {
    useBufferStore.setState({
      activeBufferId: "a",
      buffers: [makeEditorBuffer("a", "untitled:a.ts", "changed", true)],
    });

    const handled = await parseAndExecuteVimCommand("wq");

    expect(handled).toBe(true);
    expect(mocks.saveDialog).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(activeBuffer()).toBeDefined();
    expect(useBufferStore.getState().pendingClose).toBeNull();
  });

  it(":wq closes the saved buffer when the active buffer changes", async () => {
    const secondBuffer = makeEditorBuffer("b", "/workspace/b.ts", "unchanged", false);
    useBufferStore.setState({
      activeBufferId: "a",
      buffers: [makeEditorBuffer("a", "/workspace/a.ts", "changed", true), secondBuffer],
    });

    let finishSave: (saved: boolean) => void = () => {};
    const savePromise = new Promise<boolean>((resolve) => {
      finishSave = resolve;
    });
    const handleSave = vi
      .spyOn(useEditorAppStore.getState().actions, "handleSave")
      .mockReturnValueOnce(savePromise);

    const handledPromise = parseAndExecuteVimCommand("wq");
    expect(handleSave).toHaveBeenCalledTimes(1);
    useBufferStore.setState({ activeBufferId: "b" });
    useBufferStore.getState().actions.markBufferDirty("a", false);
    finishSave(true);

    expect(await handledPromise).toBe(true);
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.id === "a")).toBe(false);
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.id === "b")).toBe(true);
    expect(useBufferStore.getState().activeBufferId).toBe("b");
  });

  it(":q on a dirty buffer asks for confirmation instead of closing", async () => {
    const handled = await parseAndExecuteVimCommand("q");

    expect(handled).toBe(true);
    expect(useBufferStore.getState().pendingClose).toEqual({
      bufferId: "a",
      type: "single",
    });
    expect(activeBuffer()).toBeDefined();
  });

  it(":q! force closes a dirty buffer without saving", async () => {
    const handled = await parseAndExecuteVimCommand("q!");

    expect(handled).toBe(true);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(activeBuffer()).toBeUndefined();
    expect(useBufferStore.getState().pendingClose).toBeNull();
  });

  it(":{line} requests a cursor jump through the app go-to-line event", async () => {
    const handled = await parseAndExecuteVimCommand("42");

    expect(handled).toBe(true);
    const goToLineEvent = dispatchedEvents.find((event) => event.type === "menu-go-to-line");
    expect(goToLineEvent).toBeDefined();
    expect(goToLineEvent?.detail).toMatchObject({ line: 42 });
  });
});
