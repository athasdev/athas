// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  activePath: "/repo/src/app.ts" as string | undefined,
  lspSupported: true,
  getDocumentSymbols: vi.fn(),
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      activeBufferId: "active",
      buffers: mocks.activePath ? [{ id: "active", path: mocks.activePath }] : [],
    }),
  },
}));
vi.mock("@/features/editor/utils/buffer-index", () => ({
  getBufferById: (buffers: Array<{ id: string }>, id: string) =>
    buffers.find((buffer) => buffer.id === id),
}));
vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => mocks.lspSupported },
}));
vi.mock("@/features/editor/lsp/lsp-client", () => ({
  LspClient: { getInstance: () => ({ getDocumentSymbols: mocks.getDocumentSymbols }) },
}));

const { useSymbolSearch } = await import("../hooks/use-symbol-search");

type SymbolSearch = ReturnType<typeof useSymbolSearch>;

let container: HTMLDivElement;
let root: Root;
let search: SymbolSearch;

function Harness({ query, isActive }: { query: string; isActive: boolean }) {
  search = useSymbolSearch(query, isActive);
  return null;
}

async function render(query: string, isActive = true) {
  await act(async () => root.render(<Harness query={query} isActive={isActive} />));
  return search.symbols.map((symbol) => symbol.name);
}

const documentSymbols = [
  { name: "handleSave", kind: "function", line: 40, character: 0 },
  { name: "AppState", kind: "interface", line: 3, character: 0 },
  { name: "MAX_TABS", kind: "constant", line: 1, character: 0 },
  { name: "App", kind: "class", line: 10, character: 0 },
  { name: "render", kind: "method", line: 20, character: 2 },
  { name: "handleOpen", kind: "function", line: 30, character: 0 },
];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.activePath = "/repo/src/app.ts";
  mocks.lspSupported = true;
  mocks.getDocumentSymbols.mockReset().mockResolvedValue(documentSymbols);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("quick open symbol search", () => {
  it("lists symbols by kind and then by line when the query is just @", async () => {
    expect(await render("@")).toEqual([
      "App",
      "AppState",
      "handleOpen",
      "handleSave",
      "render",
      "MAX_TABS",
    ]);
    expect(mocks.getDocumentSymbols).toHaveBeenCalledWith("/repo/src/app.ts");
    expect(search.symbols[0]?.filePath).toBe("/repo/src/app.ts");
  });

  it("filters and ranks symbols by the text after @", async () => {
    await render("@");

    expect(await render("@ app")).toEqual(["App", "AppState"]);
    expect(await render("@handle")).toEqual(["handleSave", "handleOpen"]);
  });

  it("returns nothing for files without language server support", async () => {
    mocks.lspSupported = false;

    expect(await render("@")).toEqual([]);
    expect(mocks.getDocumentSymbols).not.toHaveBeenCalled();
  });

  it("returns nothing when the language server fails", async () => {
    mocks.getDocumentSymbols.mockRejectedValue(new Error("server crashed"));

    expect(await render("@")).toEqual([]);
    expect(search.isLoading).toBe(false);
  });

  it("drops symbols when symbol mode is left", async () => {
    await render("@");

    expect(await render("@", false)).toEqual([]);
  });
});
