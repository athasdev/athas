// @vitest-environment jsdom
import { act, startTransition, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MonacoReadonlyView } from "../components/monaco-readonly-view";

const monaco = vi.hoisted(() => ({ createModel: vi.fn(), create: vi.fn(), setTheme: vi.fn() }));
vi.mock("monaco-editor", () => ({
  editor: monaco,
  Uri: { parse: (value: string) => ({ toString: () => value }) },
}));
vi.mock("../engines/monaco/monaco-environment", () => ({}));
vi.mock("../engines/monaco/theme", () => ({ defineMonacoTheme: () => "test" }));
vi.mock("../engines/monaco/use-monaco-editor-settings", () => ({
  useMonacoEditorSettings: () => ({
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 20,
    themeId: "test",
    editorItalicComments: false,
  }),
}));
vi.mock("../extensions/api", () => ({
  editorAPI: { setActiveFindAdapter: vi.fn(), clearActiveFindAdapter: vi.fn() },
}));
let text = "";
let numbers: string | ((line: number) => string);
const model = {
  getValue: () => text,
  getLineCount: () => text.split("\n").length,
  getLineMaxColumn: () => text.split("\n").slice(-1)[0]!.length + 1,
  isDisposed: () => false,
  applyEdits: vi.fn((edits: Array<{ text: string }>) => {
    text += edits[0].text;
  }),
  setValue: vi.fn((value: string) => {
    text = value;
  }),
  dispose: vi.fn(),
};
const editor = {
  onDidFocusEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
  onDidBlurEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
  updateOptions: vi.fn((options: { lineNumbers?: typeof numbers }) => {
    if (options.lineNumbers) numbers = options.lineNumbers;
  }),
  dispose: vi.fn(),
};
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
      <MonacoReadonlyView content={content} lineNumberFormatter={formatter} />
      {pending && <Pending />}
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  monaco.createModel.mockImplementation((value: string) => {
    text = value;
    return model;
  });
  monaco.create.mockImplementation(
    (container: HTMLElement, options: { lineNumbers: typeof numbers }) => {
      numbers = options.lineNumbers;
      return editor;
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Read-only log view lifecycle", () => {
  it("appends live output without replacing the model and reports full replacements", async () => {
    const applied = vi.fn();
    await act(async () =>
      root.render(<MonacoReadonlyView content="first" onContentApplied={applied} />),
    );
    await act(async () =>
      root.render(<MonacoReadonlyView content={"first\nsecond"} onContentApplied={applied} />),
    );
    expect(text).toBe("first\nsecond");
    expect(model.applyEdits).toHaveBeenCalledTimes(1);
    expect(model.setValue).not.toHaveBeenCalled();
    expect(applied).toHaveBeenLastCalledWith(editor, true);
    await act(async () =>
      root.render(<MonacoReadonlyView content="different job" onContentApplied={applied} />),
    );
    expect(model.setValue).toHaveBeenCalledWith("different job");
    expect(applied).toHaveBeenLastCalledWith(editor, false);
    expect(monaco.create).toHaveBeenCalledTimes(1);
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
    expect(text).toBe("first");
    expect(typeof numbers === "function" && numbers(1)).toBe("10");
    await act(async () =>
      root.render(
        <Suspense>
          <View content="latest" formatter={() => "20"} />
        </Suspense>,
      ),
    );
    expect(text).toBe("latest");
    expect(typeof numbers === "function" && numbers(1)).toBe("20");
  });

  it("updates line numbers when filtering produces identical text", async () => {
    await act(async () =>
      root.render(<MonacoReadonlyView content="repeated log" lineNumberFormatter={() => "8"} />),
    );
    await act(async () =>
      root.render(<MonacoReadonlyView content="repeated log" lineNumberFormatter={() => "42"} />),
    );
    expect(typeof numbers === "function" && numbers(1)).toBe("42");
    expect(model.setValue).not.toHaveBeenCalled();
  });

  it("uses current setup callbacks when a language change recreates the editor", async () => {
    const cleanup = vi.fn();
    const first = vi.fn(() => cleanup);
    const latest = vi.fn();
    await act(async () => root.render(<MonacoReadonlyView content="first" onReady={first} />));
    await act(async () =>
      root.render(<MonacoReadonlyView content="latest" onReady={latest} languageId="typescript" />),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      editor.dispose.mock.invocationCallOrder[0],
    );
    expect(latest).toHaveBeenCalledWith(editor);
    expect(text).toBe("latest");
    expect(model.dispose).toHaveBeenCalledTimes(1);
  });
});
