// @vitest-environment jsdom
import { foldable } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { act, startTransition, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../hooks/use-editor-view-settings", () => ({
  useEditorViewSettings: () => ({
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 20,
    editorItalicComments: false,
  }),
}));
vi.mock("../services/editor-api", () => ({
  editorAPI: { setActiveFindAdapter: vi.fn(), clearActiveFindAdapter: vi.fn() },
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({ handleFileSelect: vi.fn() }) },
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { CodeMirrorReadonlyView } = await import("../components/codemirror-readonly-view");
const { updateWorkflowLog, workflowLogExtension } =
  await import("@/features/github/lib/github-workflow-log-codemirror");
const { buildWorkflowLogModel } = await import("@/features/github/utils/github-workflow-log-model");
const { parseWorkflowLog } = await import("@/features/github/utils/github-workflow-logs");

let root: Root;
let container: HTMLDivElement;
const suspended = new Promise(() => {});
function Pending(): never {
  throw suspended;
}
function View({
  pending = false,
  content,
  formatter,
}: {
  pending?: boolean;
  content: string;
  formatter: (line: number) => string;
}) {
  return (
    <>
      <CodeMirrorReadonlyView content={content} lineNumberFormatter={formatter} />
      {pending && <Pending />}
    </>
  );
}

function view() {
  const element = container.querySelector(".cm-editor");
  if (!(element instanceof HTMLElement)) throw new Error("No CodeMirror editor rendered");
  const found = EditorView.findFromDOM(element);
  if (!found) throw new Error("No EditorView for the editor element");
  return found;
}

function firstLineNumber() {
  const numbers = [...container.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
    .map((element) => element.textContent)
    .filter((text) => text && text.length > 0);
  // The first element is the width spacer; the rest belong to lines.
  return numbers[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Read-only log view lifecycle", () => {
  it("appends live output as an insertion and reports full replacements", async () => {
    const applied = vi.fn();
    await act(async () =>
      root.render(<CodeMirrorReadonlyView content="first" onContentApplied={applied} />),
    );
    const editor = view();
    editor.dispatch({ selection: { anchor: 2 } });
    await act(async () =>
      root.render(<CodeMirrorReadonlyView content={"first\nsecond"} onContentApplied={applied} />),
    );
    expect(editor.state.doc.toString()).toBe("first\nsecond");
    expect(editor.state.selection.main.head).toBe(2);
    expect(applied).toHaveBeenLastCalledWith(editor, true);

    await act(async () =>
      root.render(<CodeMirrorReadonlyView content="different job" onContentApplied={applied} />),
    );
    expect(view()).toBe(editor);
    expect(editor.state.doc.toString()).toBe("different job");
    expect(applied).toHaveBeenLastCalledWith(editor, false);
    expect(editor.state.readOnly).toBe(true);
  });

  it("keeps visible line numbers and text tied to committed output", async () => {
    await act(async () =>
      root.render(
        <Suspense>
          <View content="first" formatter={() => "10"} />
        </Suspense>,
      ),
    );
    await act(async () =>
      startTransition(() =>
        root.render(
          <Suspense>
            <View content="pending" formatter={() => "99"} pending />
          </Suspense>,
        ),
      ),
    );
    expect(view().state.doc.toString()).toBe("first");
    expect(firstLineNumber()).toBe("10");
    await act(async () =>
      root.render(
        <Suspense>
          <View content="latest" formatter={() => "20"} />
        </Suspense>,
      ),
    );
    expect(view().state.doc.toString()).toBe("latest");
    expect(firstLineNumber()).toBe("20");
  });

  it("updates line numbers when filtering produces identical text", async () => {
    const applied = vi.fn();
    await act(async () =>
      root.render(
        <CodeMirrorReadonlyView
          content="repeated log"
          lineNumberFormatter={() => "8"}
          onContentApplied={applied}
        />,
      ),
    );
    await act(async () =>
      root.render(
        <CodeMirrorReadonlyView
          content="repeated log"
          lineNumberFormatter={() => "42"}
          onContentApplied={applied}
        />,
      ),
    );
    expect(firstLineNumber()).toBe("42");
    expect(applied).not.toHaveBeenCalled();
  });

  it("keeps the editor across language changes and cleans up before destroying it", async () => {
    const cleanup = vi.fn();
    const first = vi.fn(() => cleanup);
    const latest = vi.fn();
    await act(async () => root.render(<CodeMirrorReadonlyView content="first" onReady={first} />));
    const editor = view();
    const destroy = vi.spyOn(editor, "destroy");
    await act(async () =>
      root.render(<CodeMirrorReadonlyView content="latest" onReady={latest} languageId="json" />),
    );
    expect(view()).toBe(editor);
    expect(first).toHaveBeenCalledWith(editor);
    expect(latest).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe("latest");

    await act(async () => root.render(<></>));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0]);
  });

  it("folds workflow log groups and decorates problem lines", async () => {
    const lines = parseWorkflowLog(
      ["##[group]Install", "step one", "step two", "##[endgroup]", "##[error]Broke"].join("\n"),
    );
    const model = buildWorkflowLogModel(lines, { showTimestamps: false });
    await act(async () =>
      root.render(
        <CodeMirrorReadonlyView content={model.text} extensions={workflowLogExtension} folding />,
      ),
    );
    const editor = view();
    act(() =>
      updateWorkflowLog(editor, {
        model,
        showTimestamps: false,
        highlightLine: null,
        repoPath: "/repo",
      }),
    );

    const group = editor.state.doc.line(1);
    expect(foldable(editor.state, group.from, group.to)).toEqual({
      from: group.to,
      to: editor.state.doc.line(3).to,
    });
    expect(container.querySelector(".cm-line.gha-log-line-error")?.textContent).toContain("Broke");
  });
});
