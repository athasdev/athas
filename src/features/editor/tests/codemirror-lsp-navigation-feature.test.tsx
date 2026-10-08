// @vitest-environment jsdom
import { foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";

const lsp = vi.hoisted(() => ({
  getDefinition: vi.fn(),
  getFoldingRanges: vi.fn(),
  getInlayHints: vi.fn(),
  getCodeLens: vi.fn(),
  getCodeActions: vi.fn(),
  getReferences: vi.fn(),
  getSelectionRanges: vi.fn(),
  applyCodeAction: vi.fn(),
  getOnTypeFormattingTriggerCharacters: vi.fn(),
  formatOnType: vi.fn(),
  isDocumentOpen: () => true,
  getActiveServerEntryForFile: () => ({}),
}));
const navigateToLspLocation = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const editorAPI = vi.hoisted(() => ({ expandSelection: vi.fn(), shrinkSelection: vi.fn() }));
const settings = vi.hoisted(() => ({
  inlayHints: true,
  codeLens: true,
  editorItalicComments: false,
  formatOnType: true,
}));

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => true, getLanguageId: () => null },
}));
vi.mock("../lsp/lsp-client", () => ({ LspClient: { getInstance: () => lsp } }));
vi.mock("../lsp/location-navigation", () => ({ navigateToLspLocation }));
vi.mock("../lsp/stores/lsp.store", () => {
  const state = {
    lspStatus: { status: "connected", activeWorkspaces: ["/repo"], documentRevision: 1 },
  };
  return { useLspStore: (selector: (value: unknown) => unknown) => selector(state) };
});
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (value: unknown) => unknown) => selector({ settings }),
}));
vi.mock("@/features/diagnostics/stores/diagnostics.store", () => {
  const state = { diagnosticsByFile: new Map() };
  return { useDiagnosticsStore: (selector: (value: unknown) => unknown) => selector(state) };
});
vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: "/repo" }) },
}));
vi.mock("@/features/file-system/controllers/file-operations", () => ({
  readFileContent: vi.fn(() => Promise.resolve("export const other = value;\n")),
}));
vi.mock("../stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: [{ type: "editor", path: "/repo/a.ts", content: "const value = compute(1);\n" }],
    }),
  },
}));
vi.mock("../extensions/api", () => ({ editorAPI }));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/utils/platform", () => ({ isMac: () => true, IS_MAC: true, IS_WINDOWS: false }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { CodeMirrorLspNavigation } = await import("../engines/codemirror/features/lsp-navigation");
const { getActiveCodeMirrorNavigation } =
  await import("../engines/codemirror/navigation/active-navigation");

const DOC = "const value = compute(1);\nfunction compute(n) {\n  return n;\n}\n";
const location = (line: number, character: number, uri = "file:///repo/a.ts") => ({
  uri,
  range: { start: { line, character }, end: { line, character: character + 5 } },
});

let root: Root;
let container: HTMLDivElement;
let view: EditorView;

function rect(): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 10,
    bottom: 18,
    width: 10,
    height: 18,
    toJSON() {},
  } as DOMRect;
}

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  view = new EditorView({ parent: container, state: EditorState.create({ doc: DOC }) });
  const host: CodeMirrorHost = {
    view,
    container,
    bufferId: "buffer-1",
    filePath: "/repo/a.ts",
    languageId: "typescript",
    viewStateKey: null,
    isActiveSurface: true,
    isReadOnly: false,
    isVirtual: false,
    getSeparator: () => "\n",
    applyHistory: () => false,
  };
  root = createRoot(container.appendChild(document.createElement("div")));
  await act(async () => root.render(<CodeMirrorLspNavigation host={host} />));
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Range.prototype.getClientRects = () => [rect()] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = rect;
  lsp.getDefinition.mockResolvedValue([location(1, 9), location(5, 0)]);
  lsp.getFoldingRanges.mockResolvedValue([{ startLine: 1, endLine: 2 }]);
  lsp.getInlayHints.mockResolvedValue([
    { line: 0, character: 22, label: "n:", paddingLeft: false, paddingRight: true },
  ]);
  lsp.getCodeLens.mockResolvedValue([
    {
      line: 1,
      title: "2 references",
      command: "editor.action.showReferences",
      arguments: [
        "file:///repo/a.ts",
        { line: 1, character: 9 },
        [location(0, 14), location(3, 2, "file:///repo/b.ts")],
      ],
    },
  ]);
  lsp.getCodeActions.mockResolvedValue([
    {
      id: "fix",
      title: "Add missing import",
      kind: "quickfix",
      isPreferred: true,
      hasCommand: false,
      hasEdit: true,
      payload: { title: "fix" },
    },
  ]);
  lsp.getReferences.mockResolvedValue([location(0, 14)]);
  lsp.getSelectionRanges.mockResolvedValue([
    {
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
      parent: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 25 } } },
    },
  ]);
  lsp.getOnTypeFormattingTriggerCharacters.mockResolvedValue([";"]);
  lsp.formatOnType.mockResolvedValue([
    {
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 2 } },
      newText: "    ",
    },
  ]);
  lsp.applyCodeAction.mockResolvedValue({ applied: true });
});

afterEach(() => {
  act(() => root.unmount());
  view.destroy();
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CodeMirror LSP navigation", () => {
  it("goes to the first definition on Cmd+click", async () => {
    await render();
    const position = DOC.indexOf("compute");
    vi.spyOn(view, "posAtCoords").mockReturnValue(position + 2);
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    view.contentDOM.dispatchEvent(event);
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(lsp.getDefinition).toHaveBeenCalledWith("/repo/a.ts", 0, position + 2);
    expect(navigateToLspLocation).toHaveBeenCalledWith(
      location(1, 9),
      expect.objectContaining({ bufferId: "buffer-1", filePath: "/repo/a.ts", line: 0 }),
    );
  });

  it("underlines the symbol under the pointer while Cmd is held", async () => {
    await render();
    vi.spyOn(view, "posAtCoords").mockReturnValue(DOC.indexOf("compute") + 1);
    view.contentDOM.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, metaKey: true }));
    await settle();
    expect(view.contentDOM.querySelector(".cm-athas-definition-link")?.textContent).toBe("compute");

    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", metaKey: false }));
    expect(view.contentDOM.querySelector(".cm-athas-definition-link")).toBeNull();
  });

  it("shows inlay hints, code lenses and LSP folds once the server answers", async () => {
    await render();
    await settle();

    expect(view.contentDOM.querySelector(".cm-athas-inlay-hint")?.textContent).toBe("n:");
    expect(view.contentDOM.querySelector(".cm-athas-code-lens")?.textContent).toBe("2 references");
    const line = view.state.doc.line(2);
    expect(foldable(view.state, line.from, line.to)).toEqual({
      from: line.to,
      to: view.state.doc.line(3).to,
    });
  });

  it("asks for inlay hints, code lenses and LSP folds again once edits pause", async () => {
    await render();
    await settle();
    const requests = () => [
      lsp.getInlayHints.mock.calls.length,
      lsp.getCodeLens.mock.calls.length,
      lsp.getFoldingRanges.mock.calls.length,
    ];
    expect(requests()).toEqual([1, 1, 1]);

    lsp.getInlayHints.mockResolvedValue([
      { line: 1, character: 22, label: "edited:", paddingLeft: false, paddingRight: true },
    ]);
    act(() => view.dispatch({ changes: { from: 0, insert: "// note\n" } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    act(() => view.dispatch({ changes: { from: 0, insert: "/" } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(requests()).toEqual([1, 1, 1]);

    await settle();
    expect(requests()).toEqual([2, 2, 2]);
    expect(view.contentDOM.querySelector(".cm-athas-inlay-hint")?.textContent).toBe("edited:");
  });

  it("opens the references peek from a lens and opens the chosen reference", async () => {
    await render();
    await settle();

    const lens = view.contentDOM.querySelector<HTMLButtonElement>(".cm-athas-code-lens-item")!;
    await act(async () => lens.click());
    await settle();

    const peek = view.dom.querySelector(".cm-athas-references-peek")!;
    expect(peek).not.toBeNull();
    const options = peek.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]!.textContent).toContain("const value = compute(1);");

    const list = peek.querySelector<HTMLElement>('[role="listbox"]')!;
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    expect(navigateToLspLocation).toHaveBeenCalledWith(
      location(3, 2, "file:///repo/b.ts"),
      expect.objectContaining({ bufferId: "buffer-1" }),
    );
    expect(view.dom.querySelector(".cm-athas-references-peek")).toBeNull();
  });

  it("peeks references at the cursor through the active navigation", async () => {
    await render();
    view.dispatch({ selection: { anchor: 15 } });
    await act(async () => {
      expect(getActiveCodeMirrorNavigation()?.peekReferences()).toBe(true);
    });
    await settle();
    expect(lsp.getReferences).toHaveBeenCalledWith("/repo/a.ts", 0, 15);
    expect(view.dom.querySelector(".cm-athas-references-peek")).not.toBeNull();
  });

  it("expands and shrinks the selection with LSP selection ranges", async () => {
    await render();
    view.dispatch({ selection: { anchor: 8 } });
    await act(async () => {
      getActiveCodeMirrorNavigation()?.expandSelection();
    });
    await settle();
    expect(view.state.selection.main).toMatchObject({ from: 6, to: 11 });

    await act(async () => {
      getActiveCodeMirrorNavigation()?.expandSelection();
    });
    await settle();
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 25 });

    getActiveCodeMirrorNavigation()?.shrinkSelection();
    expect(view.state.selection.main).toMatchObject({ from: 6, to: 11 });
    expect(editorAPI.expandSelection).not.toHaveBeenCalled();
  });

  it("shows the lightbulb when the server has code actions at the cursor", async () => {
    await render();
    vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({
      ...rect(),
      bottom: 400,
      height: 400,
    });
    view.dispatch({ selection: { anchor: 3 } });
    await settle();
    await settle();
    expect(lsp.getCodeActions).toHaveBeenCalledWith(
      "/repo/a.ts",
      { startLine: 0, startColumn: 3, endLine: 0, endColumn: 3 },
      [],
    );
    expect(container.querySelector('[aria-label="Show code actions"]')).not.toBeNull();
  });

  it("applies on-type formatting edits as one change", async () => {
    await render();
    const end = view.state.doc.line(3).to;
    view.dispatch({ changes: { from: end, insert: ";" }, userEvent: "input.type" });
    await settle();
    expect(lsp.formatOnType).toHaveBeenCalledWith("/repo/a.ts", 2, 12, ";", 4, true);
    expect(view.state.doc.line(3).text).toBe("    return n;;");
  });
});
