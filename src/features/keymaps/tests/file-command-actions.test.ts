import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent, PaneContent } from "@/features/panes/types/pane-content.types";
import type { useBufferStore as useBufferStoreHook } from "@/features/editor/stores/buffer.store";

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

function makeTab(id: string, isPinned = false): PaneContent {
  return {
    id,
    type: "newTab",
    path: `newtab://${id}`,
    name: id,
    isPinned,
    isPreview: false,
    isActive: id === "b",
  };
}

function makeEditorTab(
  id: string,
  options: { isDirty?: boolean; isPinned?: boolean } = {},
): EditorContent {
  const content = options.isDirty ? "dirty" : "saved";

  return {
    id,
    type: "editor",
    path: `/tmp/${id}.txt`,
    name: `${id}.txt`,
    isPinned: options.isPinned ?? false,
    isPreview: false,
    isActive: id === "b",
    content,
    savedContent: options.isDirty ? "saved" : content,
    isDirty: options.isDirty ?? false,
    isVirtual: false,
    language: "text",
    tokens: [],
  };
}

describe("file command actions", () => {
  let useBufferStore: typeof useBufferStoreHook;
  let closeAllTabs: () => void;
  let closeOtherTabs: () => void;
  let closeSavedTabs: () => void;
  let closeTabsToLeft: () => void;
  let closeTabsToRight: () => void;

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
    ({ closeAllTabs, closeOtherTabs, closeSavedTabs, closeTabsToLeft, closeTabsToRight } =
      await import("../commands/file-command-actions"));
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

  it("closes every unpinned tab except the active tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b"), makeTab("c"), makeTab("pinned", true)],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeOtherTabs();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["b", "pinned"]);
  });

  it("routes close all through the dirty close guard", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeEditorTab("a"), makeEditorTab("b", { isDirty: true }), makeEditorTab("c")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeAllTabs();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["a", "b", "c"]);
    expect(useBufferStore.getState().pendingClose).toMatchObject({
      bufferId: "b",
      type: "all",
    });
  });

  it("closes saved unpinned tabs while keeping dirty and pinned tabs", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [
        makeEditorTab("a"),
        makeEditorTab("b", { isDirty: true }),
        makeEditorTab("c", { isPinned: true }),
        makeEditorTab("d"),
      ],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeSavedTabs();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["b", "c"]);
  });

  it("closes unpinned tabs to the left of the active tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("pinned", true), makeTab("b"), makeTab("c")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeTabsToLeft();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([
      "pinned",
      "b",
      "c",
    ]);
  });

  it("keeps the close-left anchor while prompting for a dirty tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeEditorTab("a", { isDirty: true }), makeTab("b"), makeTab("c")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeTabsToLeft();

    expect(useBufferStore.getState().pendingClose).toMatchObject({
      bufferId: "a",
      anchorBufferId: "b",
      type: "to-left",
    });

    useBufferStore.getState().actions.confirmCloseWithoutSaving();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["b", "c"]);
  });

  it("closes unpinned tabs to the right of the active tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b"), makeTab("c"), makeTab("pinned", true), makeTab("d")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeTabsToRight();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([
      "a",
      "b",
      "pinned",
    ]);
  });

  it("keeps the close-right anchor while prompting for a dirty tab", () => {
    useBufferStore.setState({
      activeBufferId: "b",
      buffers: [makeTab("a"), makeTab("b"), makeEditorTab("c", { isDirty: true }), makeTab("d")],
      pendingClose: null,
      closedBuffersHistory: [],
    });

    closeTabsToRight();

    expect(useBufferStore.getState().pendingClose).toMatchObject({
      bufferId: "c",
      anchorBufferId: "b",
      type: "to-right",
    });

    useBufferStore.getState().actions.confirmCloseWithoutSaving();

    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["a", "b"]);
  });
});
