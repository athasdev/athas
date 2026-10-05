// @vitest-environment jsdom
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../hooks/use-editor-view-settings", () => ({
  useEditorViewSettings: () => ({
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    tabSize: 4,
    wordWrap: false,
    lineNumbers: true,
    renderWhitespace: "none",
    renderIndentGuides: false,
    highlightOccurrences: false,
    editorFontLigatures: false,
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

const { NotebookCodeCellEditor } = await import("../notebook/notebook-code-cell-editor");

let container: HTMLDivElement;
let root: Root;

function view() {
  const element = container.querySelector(".cm-editor");
  if (!(element instanceof HTMLElement)) throw new Error("No CodeMirror editor rendered");
  const found = EditorView.findFromDOM(element);
  if (!found) throw new Error("No EditorView for the editor element");
  return found;
}

function pressShiftEnter(editor: EditorView) {
  const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true });
  return runScopeHandlers(editor, event, "editor");
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Notebook code cell editor", () => {
  it("reports typed edits but not value updates from the notebook", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <NotebookCodeCellEditor id="a" value="x = 1" language="python" onChange={onChange} />,
      ),
    );
    const editor = view();
    act(() => editor.dispatch({ changes: { from: 5, insert: "\nprint(x)" } }));
    expect(onChange).toHaveBeenLastCalledWith("x = 1\nprint(x)");

    onChange.mockClear();
    editor.dispatch({ selection: { anchor: 2 } });
    await act(async () =>
      root.render(
        <NotebookCodeCellEditor
          id="a"
          value={"x = 1\nprint(x)\ny = 2"}
          language="python"
          onChange={onChange}
        />,
      ),
    );
    expect(view()).toBe(editor);
    expect(editor.state.doc.toString()).toBe("x = 1\nprint(x)\ny = 2");
    expect(editor.state.selection.main.head).toBe(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("runs the cell with Shift+Enter and inserts a newline without a run handler", async () => {
    const onRun = vi.fn();
    await act(async () =>
      root.render(
        <NotebookCodeCellEditor
          id="a"
          value="x"
          language="python"
          onChange={vi.fn()}
          onRun={onRun}
        />,
      ),
    );
    expect(pressShiftEnter(view())).toBe(true);
    expect(onRun).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(<NotebookCodeCellEditor id="a" value="x" language="python" onChange={vi.fn()} />),
    );
    const editor = view();
    act(() => {
      editor.dispatch({ selection: { anchor: 1 } });
      pressShiftEnter(editor);
    });
    expect(editor.state.doc.toString()).toBe("x\n");
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
