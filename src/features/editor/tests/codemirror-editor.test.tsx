// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorDocumentChangeBatch } from "../types/editor.types";

const state = vi.hoisted(() => ({
  buffer: {
    id: "buffer-1",
    type: "editor",
    path: "/repo/a.ts",
    content: "const a = 1;\n",
    savedContent: "const a = 1;\n",
    contentRevision: 1,
  } as Record<string, unknown>,
  setCursorAndSelection: vi.fn(),
  setViewportHeightForView: vi.fn(),
  applyBufferHistory: vi.fn(),
  requestNavigation: vi.fn(),
  requestReveal: vi.fn(),
  pendingNavigation: null as unknown,
  pendingReveal: null as unknown,
  cachedViewStates: {} as Record<string, unknown>,
}));

vi.mock("../stores/buffer.store", () => {
  const store = (selector: (value: unknown) => unknown) =>
    selector({ activeBufferId: "buffer-1", buffers: [state.buffer] });
  return { useBufferStore: store };
});
vi.mock("../utils/buffer-index", () => ({
  getBufferById: (buffers: Array<{ id: string }>, id: string) =>
    buffers.find((buffer) => buffer.id === id),
}));
vi.mock("@/features/workspace/stores/create-workspace-scoped-store", () => ({
  useActiveWorkspaceId: () => "ws",
  useWorkspaceStoreScopeId: () => null,
}));
vi.mock("../stores/state.store", () => {
  const getState = () => ({
    cursorPosition: { line: 0, column: 0, offset: 0 },
    selection: undefined,
    pendingNavigation: state.pendingNavigation,
    pendingReveal: state.pendingReveal,
    actions: {
      getCachedViewState: (key: string) => state.cachedViewStates[key] ?? null,
      requestNavigation: state.requestNavigation,
      requestReveal: state.requestReveal,
    },
  });
  const store = (selector: (value: unknown) => unknown) => selector(getState());
  return {
    useEditorStateStore: Object.assign(store, {
      getState,
      use: {
        actions: () => ({
          setCursorAndSelection: state.setCursorAndSelection,
          setScrollForBuffer: vi.fn(),
          setViewportHeightForView: state.setViewportHeightForView,
        }),
      },
    }),
  };
});
vi.mock("../extensions/api", () => {
  type Adapter = { ownerId: string } & Record<string, (...args: unknown[]) => void>;
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  let editorAdapter: Adapter | null = null;
  return {
    editorAPI: {
      setViewportRef: vi.fn(),
      getViewportRef: () => null,
      setActiveFindAdapter: vi.fn(),
      clearActiveFindAdapter: vi.fn(),
      setActiveEditorAdapter: (adapter: Adapter) => {
        editorAdapter = adapter;
      },
      clearActiveEditorAdapter: (ownerId: string) => {
        if (editorAdapter?.ownerId === ownerId) editorAdapter = null;
      },
      insertText: (...args: unknown[]) => editorAdapter?.insertText(...args),
      selectAll: () => editorAdapter?.selectAll(),
      on: (event: string, handler: (payload: unknown) => void) => {
        const set = handlers.get(event) ?? new Set();
        handlers.set(event, set);
        set.add(handler);
        return () => set.delete(handler);
      },
      setCursorPosition: (position: unknown) => {
        for (const handler of handlers.get("cursorChange") ?? []) handler(position);
      },
    },
  };
});
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (value: unknown) => unknown) =>
    selector({ settings: { vimMode: false, vimRelativeLineNumbers: false } }),
}));
vi.mock("../engines/codemirror/features/codemirror-features", () => ({
  CodeMirrorFeatures: () => null,
}));
vi.mock("../hooks/use-editor-view-settings", () => ({
  useEditorViewSettings: () => ({
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    tabSize: 2,
    wordWrap: false,
    lineNumbers: true,
    renderWhitespace: "none",
    renderIndentGuides: true,
    highlightOccurrences: true,
    editorFontLigatures: true,
    editorItalicComments: false,
    editorBracketPairColorization: true,
    editorScrollBeyondLastLine: false,
    editorCursorStyle: "line",
    editorCursorBlinking: "blink",
  }),
}));
vi.mock("../services/buffer-history-service", () => ({
  applyBufferHistory: state.applyBufferHistory,
}));
const bufferListeners = new Set<(value: { buffers: unknown[] }) => void>();
function notifyBufferChange() {
  for (const listener of bufferListeners) listener({ buffers: [state.buffer] });
}
vi.mock("../services/buffer-store-owner", () => ({
  captureBufferStoreOwner: () => ({
    store: {
      getState: () => ({ buffers: [state.buffer] }),
      subscribe: (listener: (value: { buffers: unknown[] }) => void) => {
        bufferListeners.add(listener);
        return () => bufferListeners.delete(listener);
      },
    },
  }),
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { CodeMirrorEditor } = await import("../components/codemirror-editor");
const { editorAPI } = await import("../extensions/api");

let container: HTMLDivElement;
let root: Root;

function view() {
  const element = container.querySelector(".cm-editor");
  if (!(element instanceof HTMLElement)) throw new Error("No CodeMirror editor rendered");
  const found = EditorView.findFromDOM(element);
  if (!found) throw new Error("No EditorView for the editor element");
  return found;
}

describe("CodeMirror editor", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    state.buffer = {
      id: "buffer-1",
      type: "editor",
      path: "/repo/a.ts",
      content: "const a = 1;\n",
      savedContent: "const a = 1;\n",
      contentRevision: 1,
    };
    state.setCursorAndSelection.mockClear();
    state.applyBufferHistory.mockReset();
    state.requestNavigation.mockClear();
    state.requestReveal.mockClear();
    state.pendingNavigation = null;
    state.pendingReveal = null;
    state.cachedViewStates = {};
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("sends typed edits to the buffer as a delta batch", async () => {
    const batches: EditorDocumentChangeBatch[] = [];
    const onDocumentChange = vi.fn((batch: EditorDocumentChangeBatch) => {
      batches.push(batch);
      return { accepted: true, synchronized: true, contentRevision: 2 };
    });
    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" onDocumentChange={onDocumentChange} />),
    );

    act(() => view().dispatch({ changes: { from: 10, to: 11, insert: "42" } }));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      isFlush: false,
      eol: "\n",
      changes: [{ rangeOffset: 10, rangeLength: 1, text: "42", startLine: 0, startColumn: 10 }],
      expectedContentLength: "const a = 42;\n".length,
    });
    expect(state.setCursorAndSelection).toHaveBeenCalled();
  });

  it("applies a newer buffer revision without sending it back", async () => {
    const onDocumentChange = vi.fn(() => ({
      accepted: true,
      synchronized: true,
      contentRevision: 1,
    }));
    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" onDocumentChange={onDocumentChange} />),
    );

    state.buffer = { ...state.buffer, content: "const b = 2;\n", contentRevision: 2 };
    act(() => notifyBufferChange());

    expect(view().state.doc.toString()).toBe("const b = 2;\n");
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("ignores a buffer revision the editor already produced", async () => {
    const onDocumentChange = vi.fn(() => ({
      accepted: true,
      synchronized: true,
      contentRevision: 2,
    }));
    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" onDocumentChange={onDocumentChange} />),
    );
    act(() => view().dispatch({ changes: { from: 0, insert: "// x\n" } }));

    state.buffer = { ...state.buffer, content: "// stale echo\n", contentRevision: 2 };
    act(() => notifyBufferChange());

    expect(view().state.doc.toString()).toBe("// x\nconst a = 1;\n");
  });

  it("undoes through the buffer history instead of the editor's own", async () => {
    state.applyBufferHistory.mockReturnValue({
      content: "const a = 0;\n",
      cursorPosition: { line: 0, column: 10, offset: 10 },
    });
    await act(async () => root.render(<CodeMirrorEditor bufferId="buffer-1" />));

    const editorView = view();
    act(() => {
      editorView.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
      );
    });

    expect(state.applyBufferHistory).toHaveBeenCalledWith(
      expect.anything(),
      "buffer-1",
      "undo",
      expect.anything(),
    );
    expect(editorView.state.doc.toString()).toBe("const a = 0;\n");
    expect(editorView.state.selection.main.head).toBe(10);
  });

  it("restores the cached cursor for its view before paint", async () => {
    state.cachedViewStates["view-1"] = {
      cursor: { line: 0, column: 6, offset: 6 },
      scrollTop: 0,
      scrollLeft: 0,
    };
    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" viewStateKey="view-1" />),
    );

    expect(view().state.selection.main.head).toBe(6);
  });

  it("selects a pending navigation target and clears the request", async () => {
    state.pendingNavigation = {
      bufferId: "buffer-1",
      range: {
        start: { line: 0, column: 6, offset: 6 },
        end: { line: 0, column: 7, offset: 7 },
      },
    };
    await act(async () => root.render(<CodeMirrorEditor bufferId="buffer-1" />));

    const { main } = view().state.selection;
    expect([main.from, main.to]).toEqual([6, 7]);
    expect(state.requestNavigation).toHaveBeenCalledWith(null);
  });

  it("clears a reveal request once it has scrolled", async () => {
    state.pendingReveal = { bufferId: "buffer-1", line: 1 };
    await act(async () => root.render(<CodeMirrorEditor bufferId="buffer-1" />));

    expect(state.requestReveal).toHaveBeenCalledWith(null);
  });

  it("edits through the shared editor API while it is the active surface", async () => {
    const onDocumentChange = vi.fn(() => ({
      accepted: true,
      synchronized: true,
      contentRevision: 2,
    }));
    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" onDocumentChange={onDocumentChange} />),
    );

    act(() => editorAPI.insertText("// ", { line: 0, column: 0, offset: 0 }));
    expect(view().state.doc.toString()).toBe("// const a = 1;\n");
    expect(onDocumentChange).toHaveBeenCalledTimes(1);

    act(() => editorAPI.selectAll());
    const { main } = view().state.selection;
    expect([main.from, main.to]).toEqual([0, view().state.doc.length]);

    act(() => editorAPI.setCursorPosition({ line: 0, column: 3, offset: 3 }));
    expect(view().state.selection.main.head).toBe(3);
  });

  it("does not take edits from the shared editor API when read-only", async () => {
    await act(async () => root.render(<CodeMirrorEditor bufferId="buffer-1" readOnly />));

    act(() => editorAPI.insertText("x", { line: 0, column: 0, offset: 0 }));
    expect(view().state.doc.toString()).toBe("const a = 1;\n");
  });

  it("highlights outside search matches and moves the current one", async () => {
    await act(async () =>
      root.render(
        <CodeMirrorEditor
          bufferId="buffer-1"
          highlightMatches={[
            { start: 0, end: 5 },
            { start: 6, end: 7 },
          ]}
          currentHighlightIndex={1}
        />,
      ),
    );

    const marks = [...container.querySelectorAll(".cm-athas-match")].map((node) => [
      node.textContent,
      node.classList.contains("cm-athas-match-current"),
    ]);
    expect(marks).toEqual([
      ["const", false],
      ["a", true],
    ]);
  });

  it("numbers lines from a mapped start", async () => {
    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" lineNumberStart={41} />),
    );

    const numbers = [...container.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
      .map((node) => node.textContent)
      .filter(Boolean);
    expect(numbers).toContain("41");
  });

  it("reports read-only clicks as editor positions", async () => {
    const onReadonlySurfaceClick = vi.fn();
    await act(async () =>
      root.render(
        <CodeMirrorEditor
          bufferId="buffer-1"
          readOnly
          onReadonlySurfaceClick={onReadonlySurfaceClick}
        />,
      ),
    );
    vi.spyOn(view(), "posAtCoords").mockReturnValue(6);

    act(() => {
      container.firstElementChild?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onReadonlySurfaceClick).toHaveBeenCalledWith({ line: 0, column: 6 });
  });

  it("reports its viewport height when it becomes the active view", async () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await act(async () =>
      root.render(
        <CodeMirrorEditor bufferId="buffer-1" viewStateKey="bottom" isActiveSurface={false} />,
      ),
    );
    await act(nextFrame);
    state.setViewportHeightForView.mockClear();

    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" viewStateKey="bottom" isActiveSurface />),
    );
    await act(nextFrame);

    expect(state.setViewportHeightForView).toHaveBeenCalledWith("bottom", expect.any(Number));
  });
});
