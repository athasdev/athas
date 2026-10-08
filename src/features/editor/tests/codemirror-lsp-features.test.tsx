// @vitest-environment jsdom
import { completionStatus, currentCompletions } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";
import { emitAppEvent } from "@/utils/app-events";

const mocks = vi.hoisted(() => ({
  settings: {
    autoCompletion: true,
    parameterHints: true,
    semanticTokens: true,
    highlightOccurrences: true,
    aiCompletion: true,
  },
  client: {
    getCompletions: vi.fn(async () => [{ label: "console", kind: 6 }]),
    resolveCompletionItem: vi.fn(async (_path: string, item: unknown) => item),
    getHover: vi.fn(async () => ({ contents: "hover text" })),
    getSignatureHelp: vi.fn(async () => null),
    getSignatureTriggerCharacters: vi.fn(async () => []),
    getSemanticTokens: vi.fn(async () => null),
    getDocumentHighlights: vi.fn(async () => []),
    getActiveServerEntryForFile: () => ({}),
    isDocumentOpen: () => true,
    executeCommand: vi.fn(),
  },
}));

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => true },
}));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: { getInstance: () => mocks.client },
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ settings: mocks.settings }),
    { getState: () => ({ settings: mocks.settings }), subscribe: () => () => {} },
  ),
}));
vi.mock("@/features/diagnostics/stores/diagnostics.store", () => {
  const diagnosticsByFile = new Map([
    [
      "/repo/a.ts",
      [
        {
          severity: "error",
          filePath: "/repo/a.ts",
          line: 0,
          column: 0,
          endLine: 0,
          endColumn: 3,
          message: "Bad",
        },
      ],
    ],
  ]);
  return {
    useDiagnosticsStore: Object.assign(
      (selector: (state: unknown) => unknown) => selector({ diagnosticsByFile }),
      { getState: () => ({ diagnosticsByFile }) },
    ),
  };
});
vi.mock("@/features/editor/lsp/stores/lsp.store", () => ({
  useLspStore: { subscribe: () => () => {} },
}));
vi.mock("@/features/ai/intelligence/services/intelligence-completion-service", () => ({
  canRequestIntelligenceCompletion: () => false,
  registerIntelligenceCompletionResume: vi.fn(),
  requestIntelligenceCompletion: vi.fn(async () => null),
  INTELLIGENCE_COMPLETION_DEBOUNCE_MS: 350,
  INTELLIGENCE_COMPLETION_PREFIX_CHARS: 12000,
  INTELLIGENCE_COMPLETION_SUFFIX_CHARS: 4000,
}));
vi.mock("@/features/editor/markdown/services/code-highlight", () => ({
  highlightMarkdownCodeBlocks: async (html: string) => html,
}));

const { CodeMirrorLspFeatures } = await import("../engines/codemirror/features/lsp-features");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let view: EditorView | null = null;

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  view?.destroy();
  view = null;
});

function mount(isReadOnly = false) {
  view = new EditorView({
    state: EditorState.create({ doc: "con", selection: { anchor: 3 } }),
    parent: document.body,
  });
  const host: CodeMirrorHost = {
    view,
    container: document.body,
    bufferId: "buffer-1",
    filePath: "/repo/a.ts",
    languageId: "typescript",
    viewStateKey: null,
    isActiveSurface: true,
    isReadOnly,
    isVirtual: false,
    getSeparator: () => "\n",
    applyHistory: () => false,
  };
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<CodeMirrorLspFeatures host={host} />));
  return view;
}

describe("CodeMirror LSP features", () => {
  it("mounts every feature and shows the file's diagnostics", () => {
    const editor = mount();
    expect(editor.dom.querySelector(".cm-lintRange-error")?.textContent).toBe("con");
  });

  it("opens the completion popup from the trigger suggest command", async () => {
    const editor = mount();
    act(() => emitAppEvent("editor:trigger-suggest"));
    await vi.waitFor(() => expect(completionStatus(editor.state)).toBe("active"));
    expect(currentCompletions(editor.state).map((completion) => completion.label)).toEqual([
      "console",
    ]);
    expect(editor.dom.querySelector(".cm-tooltip-autocomplete.cm-athas-completion")).not.toBeNull();
  });

  it("shows the hover at the cursor from the show hover command", async () => {
    const editor = mount();
    act(() => emitAppEvent("editor:show-hover"));
    await vi.waitFor(() =>
      expect(editor.dom.querySelector(".cm-athas-hover")?.textContent).toBe("hover text"),
    );
  });

  it("leaves completion off in read-only editors", async () => {
    const editor = mount(true);
    act(() => emitAppEvent("editor:trigger-suggest"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(completionStatus(editor.state)).toBeNull();
  });
});
