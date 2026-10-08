// @vitest-environment jsdom
import {
  autocompletion,
  type Completion,
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CompletionItem } from "vscode-languageserver-protocol";

const mocks = vi.hoisted(() => ({
  lspSupported: true,
  getCompletions: vi.fn(),
  resolveCompletionItem: vi.fn(),
  executeCommand: vi.fn(async () => null),
}));

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => mocks.lspSupported },
}));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: { getInstance: () => mocks },
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { autoCompletion: true } }),
}));
vi.mock("@/features/editor/markdown/services/code-highlight", () => ({
  highlightMarkdownCodeBlocks: async (html: string) => html,
}));

const { createLspCompletionSource } = await import("../engines/codemirror/features/lsp-completion");
const { getLspCompletionEntry } = await import("../engines/codemirror/lsp/lsp-completion-items");

let view: EditorView | null = null;

function createView(doc: string, cursor = doc.length) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [autocompletion({ override: [] })],
    }),
    parent: document.body,
  });
  return view;
}

async function complete(editor: EditorView, explicit = false) {
  const source = createLspCompletionSource("/repo/a.ts", mocks as never);
  const context = new CompletionContext(editor.state, editor.state.selection.main.head, explicit);
  return (await source(context)) as CompletionResult | null;
}

function pick(editor: EditorView, result: CompletionResult, completion: Completion) {
  const apply = completion.apply as (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number,
  ) => void;
  apply(editor, completion, result.from, editor.state.selection.main.head);
}

beforeEach(() => {
  mocks.lspSupported = true;
  mocks.getCompletions.mockReset();
  mocks.resolveCompletionItem.mockReset();
  mocks.resolveCompletionItem.mockImplementation(
    async (_path: string, item: CompletionItem) => item,
  );
  mocks.executeCommand.mockClear();
});

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("LSP completion source", () => {
  it("requests completions for the typed word and maps kinds, details and filter text", async () => {
    mocks.getCompletions.mockResolvedValue([
      {
        label: "log(message)",
        filterText: "log",
        kind: 2,
        sortText: "1",
        labelDetails: { detail: "(message: string)", description: "console" },
      },
      { label: "length", kind: 10, deprecated: true },
    ] satisfies CompletionItem[]);
    const editor = createView("console.lo");

    const result = await complete(editor);

    expect(mocks.getCompletions).toHaveBeenCalledWith("/repo/a.ts", 0, 10, 1, undefined);
    expect(result?.from).toBe(8);
    expect(
      result?.options.map((option) => [option.label, option.displayLabel, option.type]),
    ).toEqual([
      ["log", "log(message)", "method"],
      ["length", undefined, "property"],
    ]);
    expect(result?.options[0].detail).toBe("(message: string)");
    expect(result?.validFor instanceof RegExp && result.validFor.test("abc")).toBe(true);
  });

  it("sends trigger characters and stays quiet without a word or trigger", async () => {
    mocks.getCompletions.mockResolvedValue([{ label: "x" }]);
    await complete(createView("foo."));
    expect(mocks.getCompletions).toHaveBeenLastCalledWith("/repo/a.ts", 0, 4, 2, ".");
    view?.destroy();

    mocks.getCompletions.mockClear();
    expect(await complete(createView("foo("))).toBeNull();
    expect(mocks.getCompletions).not.toHaveBeenCalled();
  });

  it("falls back to document words without a language server", async () => {
    mocks.lspSupported = false;
    const result = await complete(createView("alpha beta\nal"));
    expect(mocks.getCompletions).not.toHaveBeenCalled();
    expect(result?.options.map((option) => option.label).sort()).toEqual(["alpha", "beta"]);
  });

  it("falls back to document words when the server has nothing", async () => {
    mocks.getCompletions.mockResolvedValue([]);
    const result = await complete(createView("gamma\nga"));
    expect(result?.options.map((option) => option.label)).toEqual(["gamma"]);
  });

  it("applies the text edit and additional edits", async () => {
    mocks.getCompletions.mockResolvedValue([
      {
        label: "readFile",
        textEdit: {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
          newText: "readFile",
        },
        additionalTextEdits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: 'import { readFile } from "fs";\n',
          },
        ],
      },
    ] satisfies CompletionItem[]);
    const editor = createView("// file\nread");
    const result = await complete(editor);
    pick(editor, result!, result!.options[0]);

    expect(editor.state.doc.toString()).toBe('import { readFile } from "fs";\n// file\nreadFile');
    expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
  });

  it("extends the edit over text typed after the request", async () => {
    mocks.getCompletions.mockResolvedValue([
      {
        label: "value",
        textEdit: {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          newText: "value",
        },
      },
    ] satisfies CompletionItem[]);
    const editor = createView("v");
    const result = await complete(editor);
    editor.dispatch({ changes: { from: 1, insert: "al" }, selection: { anchor: 3 } });
    pick(editor, result!, result!.options[0]);
    expect(editor.state.doc.toString()).toBe("value");
  });

  it("inserts snippets as CodeMirror snippets", async () => {
    mocks.getCompletions.mockResolvedValue([
      { label: "fn", insertText: "fn ${1:name}() {\n\t$0\n}", insertTextFormat: 2 },
    ] satisfies CompletionItem[]);
    const editor = createView("fn");
    const result = await complete(editor);
    pick(editor, result!, result!.options[0]);

    expect(editor.state.doc.toString()).toBe("fn name() {\n  \n}");
    expect(
      editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to),
    ).toBe("name");
  });

  it("resolves documentation for the details panel and runs completion commands", async () => {
    const item: CompletionItem = {
      label: "map",
      command: { title: "run", command: "server.command", arguments: [1] },
    };
    mocks.getCompletions.mockResolvedValue([item]);
    mocks.resolveCompletionItem.mockResolvedValue({
      ...item,
      detail: "map<T>(fn): T[]",
      documentation: { kind: "markdown", value: "Maps **items**." },
    });
    const editor = createView("ma");
    const result = await complete(editor);
    const option = result!.options[0];
    const info = (await (option.info as (completion: Completion) => Promise<Node | null>)(
      option,
    )) as HTMLElement;

    expect(info.querySelector(".cm-athas-completionInfoDetail")?.textContent).toBe(
      "map<T>(fn): T[]",
    );
    expect(info.querySelector("strong")?.textContent).toBe("items");
    expect(getLspCompletionEntry(option)?.resolved?.detail).toBe("map<T>(fn): T[]");

    pick(editor, result!, option);
    expect(mocks.executeCommand).toHaveBeenCalledWith("/repo/a.ts", "server.command", [1]);
  });
});
