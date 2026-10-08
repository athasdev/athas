// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import type { EditorDocumentChangeBatch, Position, Range } from "../types/editor.types";
import type { LiveDocumentEdit } from "../services/live-document-registry";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve([]),
      transformCallback: () => 0,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

vi.mock("../stores/state.store", () => {
  const getState = () => ({
    cursorPosition: { line: 0, column: 0, offset: 0 },
    selection: undefined,
    pendingNavigation: null,
    pendingReveal: null,
    actions: {
      getCachedViewState: () => null,
      requestNavigation: vi.fn(),
      requestReveal: vi.fn(),
    },
  });
  const store = (selector: (value: unknown) => unknown) => selector(getState());
  return {
    useEditorStateStore: Object.assign(store, {
      getState,
      use: {
        actions: () => ({
          setCursorAndSelection: vi.fn(),
          setScrollForBuffer: vi.fn(),
          setViewportHeightForView: vi.fn(),
        }),
      },
    }),
  };
});
vi.mock("../services/editor-api", () => ({
  editorAPI: {
    setViewportRef: vi.fn(),
    getViewportRef: () => null,
    setActiveFindAdapter: vi.fn(),
    clearActiveFindAdapter: vi.fn(),
    setActiveEditorAdapter: vi.fn(),
    clearActiveEditorAdapter: vi.fn(),
    on: () => () => {},
  },
}));
vi.mock("@/features/settings/stores/settings.store", () => {
  const state = { settings: { vimMode: false, vimRelativeLineNumbers: false, autoSave: false } };
  return {
    useSettingsStore: Object.assign((selector: (value: unknown) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});
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
    highlightOccurrences: false,
    editorFontLigatures: true,
    editorItalicComments: false,
    editorBracketPairColorization: false,
    editorScrollBeyondLastLine: false,
    editorCursorStyle: "line",
    editorCursorBlinking: "blink",
  }),
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { CodeMirrorEditor } = await import("../components/codemirror-editor");
const { useBufferStore } = await import("../stores/buffer.store");
const { useEditorAppStore } = await import("../stores/editor-app.store");
const { getBufferText } = await import("../services/open-buffer-text");
const { flushLiveDocument, resetLiveDocumentRegistry } =
  await import("../services/live-document-registry");

let container: HTMLDivElement;
let root: Root;
let bufferId: string;

function views() {
  return [...container.querySelectorAll(".cm-editor")].map((element) => {
    const found = EditorView.findFromDOM(element as HTMLElement);
    if (!found) throw new Error("No EditorView for the editor element");
    return found;
  });
}

function buffer() {
  return useBufferStore.getState().buffers.find((item) => item.id === bufferId) as EditorContent;
}

function onDocumentChange(
  batch: EditorDocumentChangeBatch,
  cursor?: Position,
  selection?: Range,
  live?: LiveDocumentEdit,
) {
  return useEditorAppStore
    .getState()
    .actions.handleDocumentChange(bufferId, batch, cursor, selection, live);
}

function renderEditors(count: number) {
  return act(async () =>
    root.render(
      <>
        {Array.from({ length: count }, (_, index) => (
          <div key={index}>
            <CodeMirrorEditor
              bufferId={bufferId}
              viewStateKey={`pane-${index}:${bufferId}`}
              isActiveSurface={index === 0}
              onDocumentChange={onDocumentChange}
            />
          </div>
        ))}
      </>,
    ),
  );
}

describe("CodeMirror live documents", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    bufferId = useBufferStore.getState().actions.openContent({
      type: "editor",
      path: "/workspace/live.ts",
      name: "live.ts",
      content: "const a = 1;\n",
      isVirtual: true,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetLiveDocumentRegistry();
    useBufferStore.setState({ buffers: [] });
  });

  it("keeps typed text in the editor and writes it to the store when the editor closes", async () => {
    await renderEditors(1);
    const [editor] = views();
    act(() => editor.dispatch({ changes: { from: 0, insert: "// " } }));

    expect(buffer().content).toBe("const a = 1;\n");
    expect(getBufferText(bufferId)).toBe("// const a = 1;\n");

    act(() => root.unmount());
    root = createRoot(container);

    expect(buffer().content).toBe("// const a = 1;\n");
  });

  it("shows a reload from disk in an editor holding unflushed text", async () => {
    await renderEditors(1);
    const [editor] = views();
    act(() => editor.dispatch({ changes: { from: 0, insert: "draft " } }));

    act(() =>
      useBufferStore.getState().actions.updateBufferContent(bufferId, "from disk\n", false),
    );

    expect(editor.state.doc.toString()).toBe("from disk\n");
    expect(getBufferText(bufferId)).toBe("from disk\n");
    act(() => editor.dispatch({ changes: { from: 0, insert: "x" } }));
    expect(getBufferText(bufferId)).toBe("xfrom disk\n");
  });

  it("carries edits from one view of a buffer to the other", async () => {
    await renderEditors(2);
    const [left, right] = views();
    act(() => left.dispatch({ changes: { from: 0, insert: "// " } }));
    expect(right.state.doc.toString()).toBe("// const a = 1;\n");

    act(() => right.dispatch({ changes: { from: right.state.doc.length, insert: "end\n" } }));
    expect(left.state.doc.toString()).toBe("// const a = 1;\nend\n");
    expect(getBufferText(bufferId)).toBe("// const a = 1;\nend\n");
    expect(buffer().content).toBe("const a = 1;\n");
  });

  it("tracks the dirty flag exactly for a buffer that was already dirty when the editor opened", async () => {
    bufferId = useBufferStore.getState().actions.openContent({
      type: "editor",
      path: "/workspace/dirty.ts",
      name: "dirty.ts",
      content: "const a = 1;\n",
    });
    useBufferStore.getState().actions.updateBufferContent(bufferId, "const a = 2;\n", true);
    expect(buffer().isDirty).toBe(true);
    await renderEditors(1);
    const [editor] = views();

    act(() => editor.dispatch({ changes: { from: 10, to: 11, insert: "1" } }));
    expect(buffer().isDirty).toBe(false);
    act(() => editor.dispatch({ changes: { from: 10, to: 11, insert: "3" } }));
    expect(buffer().isDirty).toBe(true);
  });

  function openFile(path: string, content: string) {
    bufferId = useBufferStore.getState().actions.openContent({
      type: "editor",
      path,
      name: path.split("/").pop() ?? path,
      content,
    });
  }

  it("keeps typed text when the store changes the buffer before its first flush", async () => {
    await renderEditors(1);
    const [editor] = views();
    act(() => editor.dispatch({ changes: { from: 0, insert: "// " } }));
    act(() => editor.dispatch({ changes: { from: 0, insert: "x" } }));
    act(() => useBufferStore.getState().actions.handleTabPin(bufferId));

    expect(editor.state.doc.toString()).toBe("x// const a = 1;\n");
    expect(getBufferText(bufferId)).toBe("x// const a = 1;\n");
  });

  it("keeps typed text and a correct dirty flag when saved before the first flush", async () => {
    openFile("/workspace/saved.ts", "const a = 1;\n");
    await renderEditors(1);
    const [editor] = views();
    act(() => editor.dispatch({ changes: { from: 0, insert: "// " } }));
    expect(buffer().isDirty).toBe(true);

    act(() => useBufferStore.getState().actions.markBufferSaved(bufferId, "// const a = 1;\n"));

    expect(editor.state.doc.toString()).toBe("// const a = 1;\n");
    expect(buffer().isDirty).toBe(false);
    act(() => flushLiveDocument(bufferId));
    expect(buffer()).toMatchObject({
      content: "// const a = 1;\n",
      savedContent: "// const a = 1;\n",
      isDirty: false,
    });
    expect(editor.state.doc.toString()).toBe("// const a = 1;\n");
  });

  it("keeps the first edit in a split pane when the dirty flag flips", async () => {
    openFile("/workspace/split.ts", "const a = 1;\n");
    await renderEditors(2);
    const [left, right] = views();
    act(() => left.dispatch({ changes: { from: 0, insert: "// " } }));

    expect(buffer().isDirty).toBe(true);
    expect(right.state.doc.toString()).toBe("// const a = 1;\n");
    expect(left.state.doc.toString()).toBe("// const a = 1;\n");
  });

  it("marks a collaboration note dirty while it is typed into", async () => {
    bufferId = useBufferStore
      .getState()
      .actions.openBuffer(
        "athas-collaboration://channel/1/notes/notes.md",
        "notes.md",
        "hello\n",
        false,
        undefined,
        false,
        true,
      );
    await renderEditors(1);
    const [editor] = views();
    act(() => editor.dispatch({ changes: { from: 0, insert: "x" } }));
    expect(buffer().isDirty).toBe(true);
    act(() => editor.dispatch({ changes: { from: 0, to: 1 } }));
    expect(buffer().isDirty).toBe(false);
  });

  it("keeps a stray CR when another part of the file is edited", async () => {
    openFile("/workspace/cr.ts", 'const s = "a\rb";\nx\n');
    await renderEditors(1);
    const [editor] = views();
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "y" } }));

    expect(getBufferText(bufferId)).toBe('const s = "a\rb";\nx\ny');
    expect(buffer().isDirty).toBe(true);
    act(() =>
      editor.dispatch({
        changes: { from: editor.state.doc.length - 1, to: editor.state.doc.length },
      }),
    );
    expect(getBufferText(bufferId)).toBe('const s = "a\rb";\nx\n');
    expect(buffer().isDirty).toBe(false);
  });
});
