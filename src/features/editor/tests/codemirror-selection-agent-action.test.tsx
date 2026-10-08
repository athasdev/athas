// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";

const mocks = vi.hoisted(() => ({
  inlineEditVisible: false,
  addEditorSelectionsToAgentChat: vi.fn(),
  showInlineEdit: vi.fn(),
  anchorRects: [] as Array<{ x: number; y: number; width: number; height: number }>,
}));

vi.mock("../stores/inline-edit-toolbar.store", () => ({
  useInlineEditToolbarStore: {
    use: { isVisible: () => mocks.inlineEditVisible },
    getState: () => ({ actions: { show: mocks.showInlineEdit } }),
  },
}));
vi.mock("../stores/buffer.store", () => ({
  useBufferStore: (selector: (state: unknown) => unknown) =>
    selector({ buffers: [{ id: "buffer-1", type: "editor", path: "/repo/a.ts", name: "a.ts" }] }),
}));
vi.mock("../stores/buffer-index", () => ({
  getBufferById: (buffers: Array<{ id: string }>, id: string) =>
    buffers.find((buffer) => buffer.id === id),
}));
vi.mock("@/features/ai/services/add-selection-to-agent-chat", () => ({
  addEditorSelectionsToAgentChat: mocks.addEditorSelectionsToAgentChat,
}));
vi.mock("../components/selection/editor-selection-agent-action", () => ({
  EditorSelectionAgentAction: ({
    anchorRect,
    onEdit,
    onAddToChat,
  }: {
    anchorRect: { x: number; y: number; width: number; height: number };
    onEdit: () => void;
    onAddToChat: () => void;
  }) => {
    mocks.anchorRects.push(anchorRect);
    return (
      <>
        <button type="button" data-testid="agent-action" onClick={onAddToChat}>
          Add to chat
        </button>
        <button type="button" data-testid="inline-edit-action" onClick={onEdit}>
          Edit
        </button>
      </>
    );
  },
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { CodeMirrorSelectionAgentAction } =
  await import("../engines/codemirror/features/codemirror-selection-agent-action");

let view: EditorView;
let root: Root;
let shell: HTMLDivElement;

function mount(host: Partial<CodeMirrorHost> = {}) {
  shell = document.createElement("div");
  document.body.append(shell);
  const editorParent = document.createElement("div");
  shell.append(editorParent);
  view = new EditorView({
    parent: editorParent,
    state: EditorState.create({ doc: "const a = 1;\r\nconst b = 2;" }),
  });
  vi.spyOn(view, "coordsAtPos").mockImplementation((position: number) => ({
    left: 100 + position * 8,
    right: 108 + position * 8,
    top: 40 + view.state.doc.lineAt(position).number * 20,
    bottom: 56 + view.state.doc.lineAt(position).number * 20,
  }));
  const fullHost: CodeMirrorHost = {
    view,
    container: shell,
    bufferId: "buffer-1",
    filePath: "/repo/a.ts",
    languageId: "typescript",
    viewStateKey: null,
    isActiveSurface: true,
    isReadOnly: false,
    isVirtual: false,
    getSeparator: () => "\r\n",
    applyHistory: () => true,
    ...host,
  };
  const reactParent = document.createElement("div");
  shell.append(reactParent);
  root = createRoot(reactParent);
  act(() => root.render(<CodeMirrorSelectionAgentAction host={fullHost} />));
}

const action = () => document.querySelector<HTMLButtonElement>('[data-testid="agent-action"]');

describe("CodeMirror selection agent action", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.inlineEditVisible = false;
    mocks.anchorRects = [];
    mocks.addEditorSelectionsToAgentChat.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    view.destroy();
    shell.remove();
  });

  it("anchors above a single-line selection and sends it to the agent chat", () => {
    mount();
    expect(action()).toBeNull();

    act(() => view.dispatch({ selection: { anchor: 6, head: 7 } }));
    expect(mocks.anchorRects[mocks.anchorRects.length - 1]).toEqual({
      x: 148,
      y: 60,
      width: 8,
      height: 16,
    });

    act(() => action()!.click());
    expect(mocks.addEditorSelectionsToAgentChat).toHaveBeenCalledWith([
      expect.objectContaining({
        bufferId: "buffer-1",
        fileName: "a.ts",
        selectedText: "a",
        startLine: 1,
        startColumn: 7,
      }),
    ]);
    expect(action()).toBeNull();
  });

  it("opens inline edit on the selection from the Edit action", () => {
    mount({ viewStateKey: "pane-1:buffer-1" });
    act(() => view.dispatch({ selection: { anchor: 6, head: 7 } }));

    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="inline-edit-action"]')!.click(),
    );
    expect(mocks.showInlineEdit).toHaveBeenCalledWith("pane-1:buffer-1");
    expect(mocks.addEditorSelectionsToAgentChat).not.toHaveBeenCalled();
    expect(action()).toBeNull();
  });

  it("keeps CRLF line breaks in a multi-line selection and anchors at its start", () => {
    mount();
    act(() => view.dispatch({ selection: { anchor: 6, head: 18 } }));

    expect(mocks.anchorRects[mocks.anchorRects.length - 1]).toEqual({
      x: 148,
      y: 60,
      width: 1,
      height: 16,
    });
    act(() => action()!.click());
    expect(mocks.addEditorSelectionsToAgentChat).toHaveBeenCalledWith([
      expect.objectContaining({ selectedText: "a = 1;\r\nconst", endLine: 2, endColumn: 6 }),
    ]);
  });

  it("waits for the pointer to let go before showing", () => {
    mount();
    act(() => {
      view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    act(() => view.dispatch({ selection: { anchor: 0, head: 5 } }));
    expect(action()).toBeNull();

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(action()).not.toBeNull();
  });

  it("stays hidden in read-only editors and while inline edit is open", () => {
    mount({ isReadOnly: true });
    act(() => view.dispatch({ selection: { anchor: 0, head: 5 } }));
    expect(action()).toBeNull();
    act(() => root.unmount());
    view.destroy();
    shell.remove();

    mocks.inlineEditVisible = true;
    mount();
    act(() => view.dispatch({ selection: { anchor: 0, head: 5 } }));
    expect(action()).toBeNull();
  });
});
