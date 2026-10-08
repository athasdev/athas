import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { AUTO_SAVE_DELAY_MS } from "../services/editor-save-service";
import { useBufferStore } from "../stores/buffer.store";
import { useEditorAppStore } from "../stores/editor-app.store";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";

const mocks = vi.hoisted(() => ({
  notifyDocumentSave: vi.fn(),
  recordLocalHistoryFile: vi.fn(),
  writeFile: vi.fn(),
  formatContent: vi.fn(),
  showToast: vi.fn(),
  saveDialog: vi.fn(),
}));

vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ writeText: mocks.writeFile }),
}));
vi.mock("@/features/editor/formatter/formatter-service", () => ({
  formatContent: mocks.formatContent,
}));
vi.mock("@/utils/toast", () => ({ showToast: mocks.showToast }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.saveDialog }));

vi.mock("@/features/editor/lsp/lsp-client", () => ({
  LspClient: {
    getInstance: () => ({
      notifyDocumentSave: mocks.notifyDocumentSave,
    }),
  },
}));

vi.mock("@/features/file-system/api/file-system-api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/file-system/api/file-system-api")>();
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
    language: "typescript",
  };
}

describe("editor saves", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
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
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, autoSave: false, formatOnSave: false, lintOnSave: false },
    }));
    mocks.writeFile.mockReset().mockResolvedValue(undefined);
    mocks.formatContent.mockReset();
    mocks.saveDialog.mockReset().mockResolvedValue(null);
    mocks.recordLocalHistoryFile.mockResolvedValue(undefined);
    mocks.notifyDocumentSave.mockResolvedValue(undefined);

    useBufferStore.setState({
      buffers: [
        makeEditorBuffer("a", "/workspace/a.ts", "a next", true),
        makeEditorBuffer("b", "/workspace/b.ts", "b next", true),
        makeEditorBuffer("c", "/workspace/c.ts", "c clean", false),
      ],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    seedActiveBuffer("a");
  });

  afterEach(() => {
    useEditorAppStore.getState().actions.cleanup();
    vi.useRealTimers();
    useBufferStore.setState({
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
    expect(getActiveBufferId()).toBe("a");
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "a next", "");
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/b.ts", "b next", "");
    expect(mocks.writeFile).not.toHaveBeenCalledWith("/workspace/c.ts", "c clean");
    expect(
      useBufferStore
        .getState()
        .buffers.filter((buffer) => buffer.type === "editor" && buffer.isDirty),
    ).toHaveLength(0);
  });

  it("preserves text typed during a write and advances only the saved baseline", async () => {
    let finishWrite: () => void = () => {};
    mocks.writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("a", "newer draft", true);
    finishWrite();
    await expect(save).resolves.toBe(true);
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      content: "newer draft",
      savedContent: "a next",
      isDirty: true,
    });
    await useEditorAppStore.getState().actions.handleSave();
    expect(mocks.writeFile).toHaveBeenLastCalledWith("/workspace/a.ts", "newer draft", "a next");
  });

  it("refuses a formatter result after a newer draft arrives", async () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, formatOnSave: true } }));
    let finishFormat: (result: { success: boolean; formattedContent: string }) => void = () => {};
    mocks.formatContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFormat = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.formatContent).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("a", "newer draft", true);
    finishFormat({ success: true, formattedContent: "stale formatted text" });
    await expect(save).resolves.toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      content: "newer draft",
      savedContent: "",
      isDirty: true,
    });
  });

  it("saves an empty formatter result and acknowledges it after the write", async () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, formatOnSave: true } }));
    mocks.formatContent.mockResolvedValue({ success: true, formattedContent: "" });
    await expect(useEditorAppStore.getState().actions.handleSave()).resolves.toBe(true);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "", "");
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      content: "",
      savedContent: "",
      isDirty: false,
    });
  });

  it("keeps the draft and clears watcher suppression after a checked-write conflict", async () => {
    const { useFileWatcherStore } =
      await import("@/features/file-system/stores/file-watcher.store");
    mocks.writeFile.mockRejectedValueOnce(
      new Error("The file changed while preparing the update."),
    );
    await expect(useEditorAppStore.getState().actions.handleSave()).resolves.toBe(false);
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      content: "a next",
      savedContent: "",
      isDirty: true,
    });
    expect(useFileWatcherStore.getState().pendingSaves.has("/workspace/a.ts")).toBe(false);
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: expect.stringContaining("changed") }),
    );
  });

  it("serializes saves and uses the previous completed write as the next baseline", async () => {
    let finishWrite: () => void = () => {};
    mocks.writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const first = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("a", "second draft", true);
    const second = useEditorAppStore.getState().actions.handleSave();
    await Promise.resolve();
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    finishWrite();
    await Promise.all([first, second]);
    expect(mocks.writeFile).toHaveBeenLastCalledWith("/workspace/a.ts", "second draft", "a next");
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      savedContent: "second draft",
      isDirty: false,
    });
  });

  it("does not regress a newer externally synchronized disk baseline", async () => {
    let finishWrite: () => void = () => {};
    mocks.writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("a", "newer agent write", false);
    finishWrite();
    await save;
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      content: "newer agent write",
      savedContent: "newer agent write",
      isDirty: false,
    });
  });

  it("keeps a successful disk save acknowledged when language-server notification fails", async () => {
    mocks.notifyDocumentSave.mockRejectedValueOnce(new Error("Disconnected"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(useEditorAppStore.getState().actions.handleSave()).resolves.toBe(true);
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      savedContent: "a next",
      isDirty: false,
    });
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("marks remote edits dirty without replacing their saved baseline", async () => {
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "remote://connection/repo/a.ts", "before", false)],
    });
    seedActiveBuffer("a");
    await useEditorAppStore.getState().actions.handleContentChange("remote draft");
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      content: "remote draft",
      savedContent: "before",
      isDirty: true,
    });
    await useEditorAppStore.getState().actions.handleSaveAll();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "remote://connection/repo/a.ts",
      "remote draft",
      "before",
    );
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      savedContent: "remote draft",
      isDirty: false,
    });
  });

  it("autosaves each edited tab independently", async () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, autoSave: true } }));
    vi.useFakeTimers();
    await useEditorAppStore.getState().actions.handleContentChange("a autosave");
    seedActiveBuffer("b");
    await useEditorAppStore.getState().actions.handleContentChange("b autosave");
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 50);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "a autosave", "");
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/b.ts", "b autosave", "");
  });

  it("does not save after autosave is disabled while its timer is pending", async () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, autoSave: true } }));
    vi.useFakeTimers();
    await useEditorAppStore.getState().actions.handleContentChange("pending draft");
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, autoSave: false } }));
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 50);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      content: "pending draft",
      isDirty: true,
    });
  });

  it.each(["/workspace/saved-as.ts", "C:\\workspace\\saved-as.ts"])(
    "saves as %s and moves the saved document to its destination",
    async (destination) => {
      mocks.saveDialog.mockResolvedValue(destination);
      await expect(useEditorAppStore.getState().actions.handleSaveAs()).resolves.toBe(true);
      expect(mocks.writeFile).toHaveBeenCalledWith(destination, "a next");
      expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
        path: destination,
        name: "saved-as.ts",
        savedContent: "a next",
        isDirty: false,
      });
    },
  );

  it("saves the latest text when the user edits while the save dialog is open", async () => {
    let choosePath: (path: string) => void = () => {};
    mocks.saveDialog.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          choosePath = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSaveAs();
    await vi.waitFor(() => expect(mocks.saveDialog).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("a", "typed in dialog", true);
    choosePath("/workspace/copy.ts");
    await expect(save).resolves.toBe(true);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/copy.ts", "typed in dialog");
  });

  it("preserves newer text typed during an untitled document's first write", async () => {
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "untitled:new.ts", "first save", true)],
    });
    seedActiveBuffer("a");
    mocks.saveDialog.mockResolvedValue("/workspace/new.ts");
    let finishWrite: () => void = () => {};
    mocks.writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("a", "newer draft", true);
    finishWrite();
    await expect(save).resolves.toBe(true);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      path: "/workspace/new.ts",
      content: "newer draft",
      savedContent: "first save",
      isDirty: true,
    });
  });

  it("keeps the original document after Save As is canceled or fails", async () => {
    await expect(useEditorAppStore.getState().actions.handleSaveAs()).resolves.toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    mocks.saveDialog.mockResolvedValue("/workspace/copy.ts");
    mocks.writeFile.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(useEditorAppStore.getState().actions.handleSaveAs()).resolves.toBe(false);
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
      path: "/workspace/a.ts",
      content: "a next",
      savedContent: "",
      isDirty: true,
    });
  });

  it("refuses a Save As destination owned by another open editor", async () => {
    mocks.saveDialog.mockResolvedValue("/workspace/b.ts");
    await expect(useEditorAppStore.getState().actions.handleSaveAs()).resolves.toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "b")).toMatchObject({
      content: "b next",
      isDirty: true,
    });
  });

  it("checks the saved baseline when Save As selects the current path", async () => {
    mocks.saveDialog.mockResolvedValue("/workspace/a.ts");
    await expect(useEditorAppStore.getState().actions.handleSaveAs()).resolves.toBe(true);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "a next", "");
  });

  it("does not save a document closed while the Save As dialog was open", async () => {
    let choosePath: (path: string) => void = () => {};
    mocks.saveDialog.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          choosePath = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSaveAs();
    await vi.waitFor(() => expect(mocks.saveDialog).toHaveBeenCalledOnce());
    useBufferStore.setState({ buffers: [] });
    choosePath("/workspace/copy.ts");
    await expect(save).resolves.toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("keeps a queued save in its original workspace before it starts", async () => {
    const original = useBufferStore.getStore(workspaceRuntimeRegistry.getActiveWorkspaceId());
    const save = useEditorAppStore.getState().actions.handleSave();
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "/other/a.ts", "other draft", true)],
    });
    await expect(save).resolves.toBe(true);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "a next", "");
    expect(original.getState().buffers[0]).toMatchObject({
      savedContent: "a next",
      isDirty: false,
    });
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      content: "other draft",
      isDirty: true,
    });
  });

  it("acknowledges the owner after switching workspaces during a write", async () => {
    const original = useBufferStore.getStore(workspaceRuntimeRegistry.getActiveWorkspaceId());
    let finish: () => void = () => {};
    mocks.writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledOnce());
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "/workspace/a.ts", "a next", true)],
    });
    original.getState().actions.updateBufferContent("a", "owner newer draft", true);
    finish();
    await expect(save).resolves.toBe(true);
    expect(original.getState().buffers[0]).toMatchObject({
      content: "owner newer draft",
      savedContent: "a next",
      isDirty: true,
    });
    expect(useBufferStore.getState().buffers[0]).toMatchObject({ savedContent: "", isDirty: true });
  });

  it("lets different workspaces save the same restored buffer ID independently", async () => {
    let finish: () => void = () => {};
    mocks.writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledOnce());
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "/other/a.ts", "other draft", true)],
    });
    seedActiveBuffer("a");
    const second = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledTimes(2));
    await expect(second).resolves.toBe(true);
    finish();
    await expect(first).resolves.toBe(true);
  });

  it("keeps Save All completion counts attached to its owner", async () => {
    const original = useBufferStore.getStore(workspaceRuntimeRegistry.getActiveWorkspaceId());
    const save = useEditorAppStore.getState().actions.handleSaveAll();
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "/other/a.ts", "other draft", true)],
    });
    await expect(save).resolves.toBe(2);
    expect(original.getState().buffers.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a", savedContent: "a next", isDirty: false }),
        expect.objectContaining({ id: "b", savedContent: "b next", isDirty: false }),
      ]),
    );
    expect(useBufferStore.getState().buffers[0]).toMatchObject({ isDirty: true });
  });

  it("keeps autosave timers separate for identical IDs in different workspaces", async () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, autoSave: true } }));
    vi.useFakeTimers();
    await useEditorAppStore.getState().actions.handleContentChange("original autosave");
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "/other/a.ts", "other draft", true)],
    });
    seedActiveBuffer("a");
    await useEditorAppStore.getState().actions.handleContentChange("other autosave");
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 50);
    expect(mocks.writeFile).toHaveBeenCalledWith("/workspace/a.ts", "original autosave", "");
    expect(mocks.writeFile).toHaveBeenCalledWith("/other/a.ts", "other autosave", "");
  });

  it("refuses a removed and reopened owner while history recording is pending", async () => {
    workspaceRuntimeRegistry.activateWorkspace({ id: "original", name: "Original" });
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "/workspace/a.ts", "original draft", true)],
    });
    seedActiveBuffer("a");
    let finish: () => void = () => {};
    mocks.recordLocalHistoryFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSave();
    await vi.waitFor(() => expect(mocks.recordLocalHistoryFile).toHaveBeenCalled());
    workspaceRuntimeRegistry.removeWorkspace("original");
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "/workspace/a.ts", "original draft", true)],
    });
    seedActiveBuffer("a");
    finish();
    await expect(save).resolves.toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(useBufferStore.getState().buffers[0]).toMatchObject({ savedContent: "", isDirty: true });
  });

  it("saves the original workspace when switching while Save As is open", async () => {
    const original = useBufferStore.getStore(workspaceRuntimeRegistry.getActiveWorkspaceId());
    let choose: (path: string) => void = () => {};
    mocks.saveDialog.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          choose = resolve;
        }),
    );
    const save = useEditorAppStore.getState().actions.handleSaveAs();
    await vi.waitFor(() => expect(mocks.saveDialog).toHaveBeenCalledOnce());
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({
      buffers: [makeEditorBuffer("a", "/workspace/a.ts", "other draft", true)],
    });
    choose("/workspace/copy.ts");
    await expect(save).resolves.toBe(true);
    expect(original.getState().buffers[0]).toMatchObject({
      path: "/workspace/copy.ts",
      savedContent: "a next",
      isDirty: false,
    });
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      path: "/workspace/a.ts",
      content: "other draft",
      isDirty: true,
    });
  });

  it("refuses a destination opened while Save As records history", async () => {
    let finish: () => void = () => {};
    mocks.recordLocalHistoryFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.saveDialog.mockResolvedValue("/workspace/copy.ts");
    const save = useEditorAppStore.getState().actions.handleSaveAs();
    await vi.waitFor(() => expect(mocks.recordLocalHistoryFile).toHaveBeenCalled());
    useBufferStore.setState((state) => ({
      buffers: [
        ...state.buffers,
        makeEditorBuffer("copy", "/workspace/copy.ts", "copy draft", true),
      ],
    }));
    finish();
    await expect(save).resolves.toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves a destination opened during Save As (dirty=%s)",
    async (isDirty) => {
      let finish: () => void = () => {};
      mocks.writeFile.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      mocks.saveDialog.mockResolvedValue("/workspace/copy.ts");
      const save = useEditorAppStore.getState().actions.handleSaveAs();
      await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledOnce());
      useBufferStore.setState((state) => ({
        buffers: [
          ...state.buffers,
          makeEditorBuffer("copy", "/workspace/copy.ts", "copy draft", isDirty),
        ],
      }));
      finish();
      await expect(save).resolves.toBe(false);
      expect(
        useBufferStore.getState().buffers.filter((buffer) => buffer.path === "/workspace/copy.ts"),
      ).toHaveLength(1);
      expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "a")).toMatchObject({
        path: "/workspace/a.ts",
        content: "a next",
        savedContent: "",
        isDirty: true,
      });
      expect(
        useBufferStore.getState().buffers.find((buffer) => buffer.id === "copy"),
      ).toMatchObject({
        content: isDirty ? "copy draft" : "a next",
        savedContent: "a next",
        isDirty,
      });
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("original remains unsaved") }),
      );
    },
  );
});
