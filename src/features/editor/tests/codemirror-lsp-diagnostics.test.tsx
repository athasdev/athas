// @vitest-environment jsdom
import { diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import type { CodeMirrorHost } from "../engines/codemirror/host";

const mocks = vi.hoisted(() => ({
  diagnostics: new Map<string, unknown[]>(),
  listeners: new Set<() => void>(),
}));

vi.mock("@/features/diagnostics/stores/diagnostics.store", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  };
  return {
    useDiagnosticsStore: (selector: (state: unknown) => unknown) =>
      useSyncExternalStore(subscribe, () => selector({ diagnosticsByFile: mocks.diagnostics })),
  };
});

const { LspDiagnostics, toLintDiagnostics } =
  await import("../engines/codemirror/features/lsp-diagnostics");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function diagnostic(overrides: Partial<Diagnostic>): Diagnostic {
  return {
    severity: "error",
    filePath: "/repo/a.ts",
    line: 0,
    column: 0,
    endLine: 0,
    endColumn: 0,
    message: "Problem",
    ...overrides,
  };
}

function setDiagnostics(list: Diagnostic[]) {
  mocks.diagnostics = new Map([["/repo/a.ts", list]]);
  for (const listener of mocks.listeners) listener();
}

let root: Root | null = null;
let view: EditorView | null = null;

beforeEach(() => {
  mocks.diagnostics = new Map();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  view?.destroy();
  view = null;
});

describe("CodeMirror diagnostics", () => {
  it("maps store diagnostics to lint ranges covering at least one character", () => {
    const doc = Text.of(["const a = 1;", "b"]);
    const [first, second, third] = toLintDiagnostics(doc, [
      diagnostic({ line: 0, column: 6, endLine: 0, endColumn: 7, severity: "warning" }),
      diagnostic({ line: 0, column: 2, endLine: 0, endColumn: 2 }),
      diagnostic({ line: 9, column: 0, endLine: 9, endColumn: 4, severity: "info" }),
    ]);
    expect([first.from, first.to, first.severity]).toEqual([6, 7, "warning"]);
    expect([second.from, second.to]).toEqual([2, 3]);
    expect([third.from, third.to, third.severity]).toEqual([doc.length, doc.length, "info"]);
  });

  it("renders the source and code after the message", () => {
    const [lint] = toLintDiagnostics(Text.of(["x"]), [
      diagnostic({ message: "Cannot find name 'x'.", source: "ts", code: "2304" }),
    ]);
    const element = lint.renderMessage?.(null as never) as HTMLElement;
    expect(element.textContent).toBe("Cannot find name 'x'. ts(2304)");
  });

  it("shows the file's diagnostics, follows updates, and clears them on unmount", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "const a = 1;\nconst b = 2;" }),
      parent: document.body,
    });
    const host = { view, filePath: "/repo/a.ts" } as CodeMirrorHost;
    mocks.diagnostics = new Map([
      ["/repo/a.ts", [diagnostic({ line: 1, column: 6, endLine: 1, endColumn: 7 })]],
    ]);
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => root!.render(<LspDiagnostics host={host} />));

    const ranges: Array<[number, number]> = [];
    forEachDiagnostic(view.state, (_d, from, to) => ranges.push([from, to]));
    expect(ranges).toEqual([[19, 20]]);
    expect(view.dom.querySelector(".cm-lintRange-error")?.textContent).toBe("b");

    act(() => setDiagnostics([]));
    expect(diagnosticCount(view.state)).toBe(0);

    act(() => setDiagnostics([diagnostic({ column: 0, endColumn: 5 })]));
    expect(diagnosticCount(view.state)).toBe(1);

    act(() => root!.unmount());
    root = null;
    expect(diagnosticCount(view.state)).toBe(0);
  });
});
