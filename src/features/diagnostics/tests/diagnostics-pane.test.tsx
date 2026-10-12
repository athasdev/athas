// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { LspClient } from "@/features/editor/lsp/services/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import DiagnosticsPane from "../components/diagnostics-pane";
import type { Diagnostic, DiagnosticCodeAction } from "../types/diagnostics.types";

const native = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return { clipboard: [] as string[], toasts: [] as Array<{ message: string; type: string }> };
});

vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: async (text: string) => {
    native.clipboard.push(text);
  },
}));
vi.mock("@/utils/toast", () => ({
  useToast: () => ({
    showToast: (toast: { message: string; type: string }) => {
      native.toasts.push(toast);
      return "toast";
    },
  }),
}));

enableMapSet();

const diagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  severity: "error",
  filePath: "/repo/src/app.ts",
  line: 4,
  column: 2,
  endLine: 4,
  endColumn: 8,
  message: "Cannot find name 'foo'.",
  source: "ts",
  code: "2304",
  ...overrides,
});

const diagnostics = [
  diagnostic({}),
  diagnostic({
    severity: "warning",
    line: 10,
    message: "'bar' is declared but never used.\nRemove the unused declaration.",
    code: "6133",
  }),
  diagnostic({
    severity: "info",
    filePath: "/repo/src/util.ts",
    line: 0,
    column: 0,
    message: "Prefer const",
    source: "eslint",
    code: "prefer-const",
  }),
];

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
const onDiagnosticClick = vi.fn();

async function render(items: Diagnostic[] = diagnostics) {
  await act(async () =>
    root.render(<DiagnosticsPane diagnostics={items} onDiagnosticClick={onDiagnosticClick} />),
  );
}

const view = () => within(container);
const position = (row: HTMLElement) => row.lastElementChild?.textContent;
const problemRows = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    /^\d+:\d+$/.test(position(button) ?? ""),
  );

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferCodeActions() {
  let resolveActions: (value: DiagnosticCodeAction[]) => void = () => {};
  const spy = vi
    .spyOn(LspClient.getInstance(), "getCodeActions")
    .mockImplementation(() => new Promise((resolve) => (resolveActions = resolve)));
  return {
    spy,
    resolve: (value: DiagnosticCodeAction[]) =>
      act(async () => {
        resolveActions(value);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }),
  };
}

async function openContextMenu(row: HTMLElement) {
  await act(async () => {
    fireEvent.contextMenu(row, { clientX: 5, clientY: 5 });
  });
  await flush();
}
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === label,
  )!;

async function openFilters() {
  await act(async () => view().getByRole("button", { name: "Filter problems" }).click());
  await flush();
}

async function choose(label: string) {
  await act(async () => menuItem(label).click());
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  window.localStorage.clear();
  native.clipboard.length = 0;
  native.toasts.length = 0;
  onDiagnosticClick.mockReset();
  useProjectStore.setState({ rootFolderPath: "/repo" });
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("diagnostics pane", () => {
  it("says when there are no problems", async () => {
    await render([]);
    expect(view().getByText("No problems detected")).toBeTruthy();
  });

  it("groups problems by file with counts and opens a problem on click", async () => {
    await render();
    expect(view().getByText("3 problems")).toBeTruthy();
    expect(view().getByRole("status").getAttribute("title")).toBe("1 errors · 1 warnings · 1 info");
    expect(view().getByText("2 problems")).toBeTruthy();
    expect(view().getByText("1 problem")).toBeTruthy();
    expect(view().getByText("Remove the unused declaration.")).toBeTruthy();

    const rows = problemRows();
    expect(rows.map(position)).toEqual(["5:3", "11:3", "1:1"]);
    await act(async () => rows[1].click());
    expect(onDiagnosticClick).toHaveBeenCalledWith(diagnostics[1]);
  });

  it("narrows problems by search text and clears the search", async () => {
    await render();
    const search = view().getByRole("textbox", { name: "Search problems" });
    await act(async () => {
      fireEvent.change(search, { target: { value: "prefer" } });
    });
    expect(view().getByText("1 of 3 problems")).toBeTruthy();
    expect(problemRows()).toHaveLength(1);

    await act(async () => {
      fireEvent.change(search, { target: { value: "nothing like this" } });
    });
    expect(view().getByText("No problems match the current filters")).toBeTruthy();
    await act(async () => view().getByRole("button", { name: "Reset filters" }).click());
    expect(problemRows()).toHaveLength(3);
  });

  it("regroups, resorts and hides severities from the filter menu", async () => {
    await render();
    await openFilters();
    await choose("Group by: Severity");
    expect(view().getByText("Errors")).toBeTruthy();
    expect(view().getByText("Warnings")).toBeTruthy();
    expect(view().getByText("Info")).toBeTruthy();

    await openFilters();
    await choose("Warnings (1/1)");
    expect(view().queryByText("Warnings")).toBeNull();
    expect(view().getByText("2 of 3 problems")).toBeTruthy();

    await openFilters();
    await choose("Group by: None");
    await openFilters();
    await choose("Sort by: Position");
    expect(problemRows().map(position)).toEqual(["1:1", "5:3"]);
    expect(JSON.parse(window.localStorage.getItem("diagnostics-pane-prefs")!)).toMatchObject({
      groupBy: "none",
      sortBy: "position",
    });

    await openFilters();
    await choose("Reset All Filters");
    expect(view().getByText("3 problems")).toBeTruthy();
  });

  it("collapses a severity group", async () => {
    window.localStorage.setItem("diagnostics-pane-prefs", JSON.stringify({ groupBy: "severity" }));
    await render();
    expect(problemRows()).toHaveLength(3);
    await act(async () => view().getByText("Errors").closest("button")!.click());
    expect(problemRows()).toHaveLength(2);
  });

  it("shows only the current file's problems when asked", async () => {
    const bufferId = useBufferStore
      .getState()
      .actions.openBuffer("/repo/src/util.ts", "util.ts", "let x = 1;");
    useBufferStore.getState().actions.setActiveBuffer(bufferId);
    await render();
    await openFilters();
    await choose("Only Current File");
    expect(problemRows()).toHaveLength(1);
    expect(problemRows()[0].textContent).toContain("Prefer const");
  });

  it("copies problem details and filters by source from the context menu", async () => {
    const actions = deferCodeActions();
    await render();
    const row = problemRows()[2];
    await openContextMenu(row);
    expect(menuItem("Loading quick fixes...")).toBeTruthy();
    await actions.resolve([]);
    expect(menuItem("No quick fixes available")).toBeTruthy();

    await choose("Copy Message");
    expect(last(native.clipboard)).toBe("Prefer const");
    expect(last(native.toasts)?.message).toBe("Diagnostic message copied");

    await openContextMenu(row);
    await choose("Copy Location");
    expect(last(native.clipboard)).toBe("/repo/src/util.ts:1:1");

    await openContextMenu(row);
    await choose("Copy Full Details");
    expect(last(native.clipboard)).toBe(
      "/repo/src/util.ts:1:1 | INFO | Prefer const | source: eslint | code: prefer-const",
    );

    await openContextMenu(row);
    await choose("Go to Problem");
    expect(onDiagnosticClick).toHaveBeenCalledWith(diagnostics[2]);

    await openContextMenu(problemRows()[2]);
    await choose("Filter by Source: eslint");
    expect(problemRows()).toHaveLength(1);

    await openFilters();
    await choose("Clear Source Filter (eslint)");
    expect(problemRows()).toHaveLength(3);

    await openContextMenu(problemRows()[0]);
    await choose("Disable Message Wrap");
    expect(JSON.parse(window.localStorage.getItem("diagnostics-pane-prefs")!).wrapMessages).toBe(
      false,
    );
  });

  it("finishes loading quick fixes that arrive after the menu was closed", async () => {
    const actions = deferCodeActions();
    await render();

    await openContextMenu(problemRows()[0]);
    expect(menuItem("Loading quick fixes...")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    await flush();
    await actions.resolve([]);

    await openContextMenu(problemRows()[0]);
    expect(menuItem("Loading quick fixes...")).toBeUndefined();
    expect(menuItem("No quick fixes available")).toBeTruthy();
    expect(actions.spy).toHaveBeenCalledTimes(1);
  });

  it("stops loading quick fixes when the language server fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(LspClient.getInstance(), "getCodeActions").mockRejectedValue(new Error("LSP down"));
    await render();

    await openContextMenu(problemRows()[0]);
    await flush();

    expect(menuItem("Loading quick fixes...")).toBeUndefined();
    expect(menuItem("No quick fixes available")).toBeTruthy();
  });

  it("offers and applies quick fixes from the language server", async () => {
    const lsp = LspClient.getInstance();
    const actions = deferCodeActions();
    const quickFixes: DiagnosticCodeAction[] = [
      {
        id: "import",
        title: "Add import from './foo'",
        isPreferred: true,
        hasCommand: true,
        hasEdit: true,
        payload: { id: "import" },
      },
      {
        id: "edit-only",
        title: "Rewrite file",
        isPreferred: false,
        hasCommand: false,
        hasEdit: true,
        payload: {},
      },
    ];
    const apply = vi
      .spyOn(lsp, "applyCodeAction")
      .mockResolvedValueOnce({ applied: true })
      .mockResolvedValueOnce({ applied: false, reason: "Server rejected the edit" });
    await render();

    await openContextMenu(problemRows()[0]);
    await actions.resolve(quickFixes);
    expect(menuItem("Rewrite file").getAttribute("aria-disabled")).toBe("true");
    await choose("Add import from './foo'");
    expect(apply).toHaveBeenCalledWith("/repo/src/app.ts", { id: "import" });
    expect(last(native.toasts)).toEqual({
      message: "Applied: Add import from './foo'",
      type: "success",
    });

    await openContextMenu(problemRows()[0]);
    await choose("Add import from './foo'");
    expect(last(native.toasts)).toEqual({ message: "Server rejected the edit", type: "warning" });
    expect(actions.spy).toHaveBeenCalledTimes(1);
  });

  it("opens a file's first problem from the file navigator and section header", async () => {
    await render();
    await act(async () =>
      view()
        .getByRole("button", { name: /^util\.ts\s*1$/ })
        .click(),
    );
    expect(onDiagnosticClick).toHaveBeenLastCalledWith(diagnostics[2]);

    await act(async () => view().getByRole("button", { name: "Open src/app.ts" }).click());
    expect(onDiagnosticClick).toHaveBeenLastCalledWith(diagnostics[0]);

    await act(async () => view().getByRole("button", { name: "Collapse util.ts" }).click());
    expect(problemRows()).toHaveLength(2);
  });
});
