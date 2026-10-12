// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  searchFilesContent,
  SearchFilesResponse,
} from "@/features/file-search/api/file-search-api";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useGlobalSearchSessionStore } from "../stores/global-search-session.store";

const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  mode: "search" as "search" | "indexing" | "fail" | "paged",
  requests: [] as Array<{ query: string; offset: number }>,
  observers: [] as Array<{
    callback: (entries: Array<{ isIntersecting: boolean }>) => void;
    connected: boolean;
  }>,
}));

vi.mock("@/features/file-search/api/file-search-api", () => ({
  searchFilesContent: async (request: Parameters<typeof searchFilesContent>[0]) => {
    io.requests.push({ query: request.query, offset: request.file_offset ?? 0 });
    if (io.mode === "fail") throw new Error("disk unavailable");
    const all = [...io.files.entries()].flatMap(([filePath, content]) => {
      const matches = content.split("\n").flatMap((line, index) => {
        const haystack = request.case_sensitive ? line : line.toLowerCase();
        const needle = request.case_sensitive ? request.query : request.query.toLowerCase();
        const ranges = [];
        for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
          ranges.push({ start: at, end: at + needle.length });
        }
        return ranges.length === 0
          ? []
          : [
              {
                line_number: index + 1,
                line_content: line,
                column_start: ranges[0].start,
                column_end: ranges[0].end,
                match_ranges: ranges,
              },
            ];
      });
      return matches.length
        ? [{ file_path: filePath, matches, total_matches: matches.length }]
        : [];
    });
    const offset = request.file_offset ?? 0;
    const results = io.mode === "paged" ? all.slice(offset, offset + 1) : all;
    const hasMore = io.mode === "paged" && offset + 1 < all.length;
    return {
      results,
      total_files: io.files.size,
      searched_files: io.files.size,
      searchable_files: io.files.size,
      files_with_matches: results.length,
      next_file_offset: hasMore ? offset + 1 : 0,
      has_more: hasMore,
      is_indexing: io.mode === "indexing",
      indexed_files: io.mode === "indexing" ? 12 : io.files.size,
      regex_fallback_error: null,
    } satisfies SearchFilesResponse;
  },
  fffScanStatus: vi.fn(),
  fffListFiles: vi.fn(),
}));
vi.mock("../services/search-worker-client", async () => {
  const { executeSearchTask } = await import("../workers/search-worker-execution");
  return {
    createSearchWorkerSession: () => ({
      run: async (task: Parameters<typeof executeSearchTask>[0]) => executeSearchTask(task),
      dispose: () => {},
    }),
  };
});
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({
    readText: async (path: string) => io.files.get(path) ?? "",
    writeText: async (path: string, content: string) => {
      io.files.set(path, content);
    },
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", emitTo: async () => {} }),
  getAllWebviewWindows: async () => [],
}));

const { default: GlobalSearchBuffer } = await import("../components/global-search-buffer");

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
let opened: Array<[string, number | undefined, number | undefined]>;

async function wait(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(query = "") {
  useGlobalSearchSessionStore.getState().actions.setQuery(query);
  await act(async () => root.render(<GlobalSearchBuffer />));
  await wait(10);
}

const view = () => within(container);
const input = () => view().getByRole("textbox", { name: "Search in files" });
const status = () =>
  view()
    .queryAllByRole("status")
    .map((element) => element.textContent?.trim())
    .filter(Boolean);
const sections = () =>
  [...container.querySelectorAll<HTMLElement>("[data-multibuffer-section]")].map(
    (section) => section.dataset.multibufferSection,
  );

function scrollToEnd() {
  for (const observer of io.observers) {
    if (observer.connected) observer.callback([{ isIntersecting: true }]);
  }
}

async function type(value: string, label = "Search in files") {
  await act(async () => {
    fireEvent.change(view().getByRole("textbox", { name: label }), { target: { value } });
  });
  await wait(260);
}

async function key(value: string) {
  await act(async () => {
    fireEvent.keyDown(input(), { key: value });
  });
  await wait();
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await wait(20);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  io.files = new Map([
    ["/w/src/app.ts", "const value = 1;\nexport const total = value + value;\n"],
    ["/w/src/util.ts", "// helpers\nexport function double(value: number) {}\n"],
    ["/w/README.md", "Nothing here\n"],
  ]);
  io.mode = "search";
  io.requests = [];
  io.observers = [];
  opened = [];
  useProjectStore.setState({ rootFolderPath: "/w", workspaceFolders: [] });
  useFileSystemStore.setState({
    handleFileSelect: async (path: string, _isDir: boolean, line?: number, column?: number) => {
      opened.push([path, line, column]);
    },
  } as never);
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    if (typeof options === "object") this.scrollTop = options.top ?? 0;
  } as Element["scrollTo"];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const index = Number((this as HTMLElement).dataset?.multibufferIndex ?? -1);
    const scroller = this.closest("[data-multibuffer-scroll-container]");
    const top = index >= 0 ? index * 100 - (scroller?.scrollTop ?? 0) : 0;
    return {
      x: 0,
      y: top,
      left: 0,
      top,
      width: 100,
      height: 100,
      right: 100,
      bottom: top + 100,
      toJSON() {},
    } as DOMRect;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      entry: (typeof io.observers)[number];
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        this.entry = { callback, connected: true };
        io.observers.push(this.entry);
      }
      observe() {}
      disconnect() {
        this.entry.connected = false;
      }
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("global search buffer", () => {
  it("asks for a query and focuses the search field", async () => {
    await render();
    expect(view().getByText("Enter a query to search files and lines.")).toBeTruthy();
    expect(document.activeElement).toBe(input());
    expect(io.requests).toEqual([]);
  });

  it("searches as the user types and groups matches by file", async () => {
    await render();
    await type("value");
    expect(last(io.requests)).toEqual({ query: "value", offset: 0 });
    expect(sections()).toHaveLength(2);
    expect(container.textContent).toContain("app.ts");
    expect(container.textContent).toContain("2 matches");
    expect(container.textContent).toContain("1 match");
    expect(status()).toContain("3 results");

    await type("nothing here");
    expect(status()).toContain("1 result");

    await type("missing");
    expect(container.textContent).toContain('No results for "missing"');
  });

  it("opens the selected match from the keyboard and clears with Escape", async () => {
    await render("value");
    await key("Enter");
    expect(last(opened)).toEqual(["/w/src/app.ts", 1, 7]);

    await key("ArrowDown");
    await key("Enter");
    expect(last(opened)).toEqual(["/w/src/app.ts", 2, 22]);

    await key("ArrowDown");
    await key("Enter");
    expect(last(opened)?.[0]).toBe("/w/src/util.ts");

    await key("ArrowUp");
    await key("Escape");
    expect(input()).toHaveProperty("value", "");
    await wait(260);
    expect(sections()).toHaveLength(0);

    await key("Escape");
    expect(document.activeElement).not.toBe(input());
  });

  it("opens a file from its section header", async () => {
    await render("double");
    const header = container.querySelector<HTMLElement>(
      '[data-multibuffer-section="/w/src/util.ts"] [aria-label^="Open"]',
    );
    await click(header!);
    expect(last(opened)).toEqual(["/w/src/util.ts", 2, 17]);
  });

  it("replaces the selected match and then all remaining matches", async () => {
    await render("value");
    await click(view().getByRole("button", { name: "Show details" }));
    await act(async () => {
      fireEvent.change(view().getByPlaceholderText("Replace with..."), {
        target: { value: "amount" },
      });
    });
    await wait();
    await click(view().getByRole("button", { name: "Replace" }));
    await wait(260);
    expect(io.files.get("/w/src/app.ts")).toBe(
      "const amount = 1;\nexport const total = value + value;\n",
    );

    await click(view().getByRole("button", { name: "All" }));
    await wait(260);
    expect(io.files.get("/w/src/app.ts")).toBe(
      "const amount = 1;\nexport const total = amount + amount;\n",
    );
    expect(io.files.get("/w/src/util.ts")).toBe(
      "// helpers\nexport function double(amount: number) {}\n",
    );
  });

  it("narrows the search with match case and file filters", async () => {
    io.files.set("/w/src/case.ts", "VALUE\n");
    await render("VALUE");
    expect(sections()).toHaveLength(3);

    await click(view().getByRole("button", { name: "Match case" }));
    await wait(260);
    expect(sections()).toEqual(["/w/src/case.ts"]);

    await click(view().getByRole("button", { name: "Match case" }));
    await click(view().getByRole("button", { name: "Show details" }));
    await type("src/util.ts", "Files to include");
    expect(sections()).toEqual(["/w/src/util.ts"]);
    await type("", "Files to include");
    await type("src/util.ts", "Files to exclude");
    expect(sections()).not.toContain("/w/src/util.ts");
  });

  it("expands and collapses the context around a file's matches", async () => {
    io.files.set(
      "/w/src/long.ts",
      ["a", "b", "c", "d", "e", "target", "f", "g", "h", "i"].join("\n"),
    );
    await render("target");
    await click(view().getByRole("button", { name: "Expand context" }));
    await wait(20);
    expect(view().getByRole("button", { name: "Collapse context" })).toBeTruthy();
    await click(view().getByRole("button", { name: "Collapse context" }));
    expect(view().getByRole("button", { name: "Expand context" })).toBeTruthy();
  });

  it("jumps to a file picked in the result navigator and hides the navigator", async () => {
    await render("value");
    const navigator = view().getByRole("complementary", { name: "Search result files" });
    const row = (path: string) =>
      navigator.querySelector<HTMLElement>(`[data-file-navigator-key="${path}"]`)!;
    expect(row("/w/src/app.ts").getAttribute("aria-current")).toBe("true");
    await click(row("/w/src/util.ts"));
    expect(row("/w/src/util.ts").getAttribute("aria-current")).toBe("true");
    expect(row("/w/src/app.ts").getAttribute("aria-current")).toBeNull();

    const toggle = container.querySelector<HTMLElement>("[data-multibuffer-navigator-toggle]")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await click(toggle);
    expect(view().queryByRole("complementary", { name: "Search result files" })).toBeNull();
  });

  it("shows indexing progress and search failures with a retry", async () => {
    io.mode = "indexing";
    await render("value");
    expect(status()).toContain("Indexing 12 files");

    io.mode = "fail";
    await type("valu");
    expect(container.textContent).toContain("Search failed: disk unavailable");
    io.mode = "search";
    await click(view().getByRole("button", { name: "Try again" }));
    await wait(20);
    expect(sections()).toHaveLength(2);
  });

  it("renders more matches and loads further pages as the user scrolls", async () => {
    io.files = new Map([
      ["/w/big.ts", Array.from({ length: 60 }, (_, index) => `hit ${index}`).join("\n")],
      ["/w/next.ts", "hit next\n"],
    ]);
    io.mode = "paged";
    await render("hit");
    expect(status()).toContain("40 of 60+ results");

    await act(async () => {
      scrollToEnd();
    });
    await wait(20);
    expect(status()).toContain("60 of 60+ results");

    await act(async () => {
      scrollToEnd();
    });
    await wait(20);
    expect(io.requests.map((request) => request.offset)).toContain(1);
    expect(status()).toContain("60 of 61 results");

    await act(async () => {
      scrollToEnd();
    });
    await wait(20);
    expect(sections()).toContain("/w/next.ts");
    expect(status()).toContain("61 results");
  });
});
