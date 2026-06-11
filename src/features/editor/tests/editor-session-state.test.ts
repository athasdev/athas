import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";

const createEditorBuffer = (overrides: Partial<EditorContent> = {}): EditorContent => ({
  id: "editor-1",
  type: "editor",
  path: "/workspace/src/app.ts",
  name: "app.ts",
  isPinned: false,
  isPreview: false,
  isActive: true,
  content: "const value = 1;\nconsole.log(value);\n",
  savedContent: "const value = 1;\nconsole.log(value);\n",
  isDirty: false,
  isVirtual: false,
  tokens: [],
  ...overrides,
});

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

describe("editor session state", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a persisted editor view snapshot from cached view and fold state", async () => {
    const { buildPersistedEditorViewState } = await import("../stores/editor-session-state");
    const { useFoldStore } = await import("../stores/fold.store");
    const { useEditorStateStore } = await import("../stores/state.store");
    const buffer = createEditorBuffer({ id: "editor-build", path: "/workspace/src/build.ts" });

    useEditorStateStore.getState().actions.cacheViewStateForBuffer(buffer.id, {
      cursor: { line: 1, column: 4, offset: 20 },
      selection: {
        start: { line: 1, column: 0, offset: 16 },
        end: { line: 1, column: 4, offset: 20 },
      },
      scrollTop: 120,
      scrollLeft: 8,
    });
    useFoldStore.getState().actions.setCollapsedLines(buffer.path, [2, 4]);

    expect(buildPersistedEditorViewState(buffer)).toEqual({
      cursor: { line: 1, column: 4, offset: 20 },
      selection: {
        start: { line: 1, column: 0, offset: 16 },
        end: { line: 1, column: 4, offset: 20 },
      },
      scrollTop: 120,
      scrollLeft: 8,
      collapsedFoldLines: [2, 4],
    });
  });

  it("restores persisted view state for the new buffer id used after session restore", async () => {
    const { restorePersistedEditorViewState } = await import("../stores/editor-session-state");
    const { useFoldStore } = await import("../stores/fold.store");
    const { useEditorStateStore } = await import("../stores/state.store");
    const buffer = createEditorBuffer({ id: "editor-restore", path: "/workspace/src/restore.ts" });

    restorePersistedEditorViewState(buffer, {
      cursor: { line: 3, column: 2, offset: 42 },
      scrollTop: 300,
      scrollLeft: 12,
      collapsedFoldLines: [1],
    });

    expect(
      useEditorStateStore.getState().actions.getCachedViewState("pane-a:editor-restore"),
    ).toEqual({
      cursor: { line: 3, column: 2, offset: 42 },
      selection: undefined,
      scrollTop: 300,
      scrollLeft: 12,
    });
    expect(useFoldStore.getState().actions.getCollapsedLines(buffer.path)).toEqual([1]);
  });
});
