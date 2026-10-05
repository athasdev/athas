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
    contentRevision: 1,
  } as Record<string, unknown>,
  setCursorAndSelection: vi.fn(),
  applyBufferHistory: vi.fn(),
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
  const store = {
    getState: () => ({ cursorPosition: { line: 0, column: 0, offset: 0 }, selection: undefined }),
  };
  return {
    useEditorStateStore: Object.assign(store, {
      use: {
        actions: () => ({
          setCursorAndSelection: state.setCursorAndSelection,
          setScrollForBuffer: vi.fn(),
        }),
      },
    }),
  };
});
vi.mock("../hooks/use-editor-view-settings", () => ({
  useEditorViewSettings: () => ({
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    tabSize: 2,
    wordWrap: false,
    lineNumbers: true,
    renderWhitespace: "none",
    editorItalicComments: false,
  }),
}));
vi.mock("../services/buffer-history-service", () => ({
  applyBufferHistory: state.applyBufferHistory,
}));
vi.mock("../services/buffer-store-owner", () => ({ captureBufferStoreOwner: () => ({}) }));

const { CodeMirrorEditor } = await import("../components/codemirror-editor");

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
      contentRevision: 1,
    };
    state.setCursorAndSelection.mockClear();
    state.applyBufferHistory.mockReset();
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
    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" onDocumentChange={onDocumentChange} />),
    );

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
    await act(async () =>
      root.render(<CodeMirrorEditor bufferId="buffer-1" onDocumentChange={onDocumentChange} />),
    );

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
});
