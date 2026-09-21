// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { OutlineSidebar } from "../components/outline-sidebar";
import { normalizeOutlineSymbols } from "../utils/outline-symbols";

const state = vi.hoisted(() => ({
  symbols: [] as unknown[],
  activeBuffer: { path: "/workspace/widget.ts" },
  isSupported: true,
  isLoading: false,
}));
vi.mock("../hooks/use-document-outline", () => ({ useDocumentOutline: () => state }));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { use: { actions: () => ({ openBuffer: vi.fn() }) } },
}));
vi.mock("@/features/file-system/controllers/file-operations", () => ({ readFileContent: vi.fn() }));
vi.mock("@/features/file-system/controllers/platform", () => ({ openFile: vi.fn() }));
vi.mock("@/utils/clipboard", () => ({ writeClipboardText: vi.fn() }));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  state.isSupported = true;
  state.isLoading = false;
  state.symbols = normalizeOutlineSymbols(
    [
      {
        name: "Widget",
        kind: "class",
        detail: "class Widget",
        line: 0,
        character: 0,
        endLine: 10,
        endCharacter: 0,
      },
      {
        name: "render",
        kind: "method",
        detail: "(): Element",
        line: 2,
        character: 2,
        endLine: 5,
        endCharacter: 0,
      },
      {
        name: "createWidget",
        kind: "function",
        line: 15,
        character: 0,
        endLine: 20,
        endCharacter: 0,
      },
    ],
    "/workspace/widget.ts",
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const rows = () => [...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')];
const input = () =>
  container.querySelector<HTMLInputElement>('input[aria-label="Filter outline"]')!;
async function render() {
  await act(async () => root.render(<OutlineSidebar />));
  container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!.scrollTo = vi.fn();
}

describe("outline sidebar", () => {
  it("filters from the header and clears without hiding the input", async () => {
    await render();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input(),
        "missing",
      );
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain("No symbols found.");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Clear filter"]')!.click(),
    );
    expect(rows()).toHaveLength(3);
    expect(document.activeElement).toBe(input());
  });

  it("focuses inline filtering through the outline keyboard shortcut", async () => {
    await render();
    await act(async () =>
      rows()[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(input());
    await act(async () =>
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("collapses branches without navigating and opens the selected symbol", async () => {
    const navigate = vi.fn();
    window.addEventListener("menu-go-to-line", navigate);
    try {
      await render();
      expect(rows()[0]?.getAttribute("aria-expanded")).toBe("true");
      await act(async () =>
        rows()[0]!.querySelector<HTMLElement>("[data-sidebar-tree-disclosure]")!.click(),
      );
      expect(rows()).toHaveLength(2);
      expect(rows()[0]?.getAttribute("aria-expanded")).toBe("false");
      expect(navigate).not.toHaveBeenCalled();
      await act(async () => rows()[1]!.click());
      expect(navigate).toHaveBeenCalledOnce();
      expect((navigate.mock.calls[0]![0] as CustomEvent).detail).toEqual({
        path: "/workspace/widget.ts",
        line: 16,
        column: 1,
      });
    } finally {
      window.removeEventListener("menu-go-to-line", navigate);
    }
  });

  it("does not offer filters when the document has no symbols", async () => {
    state.symbols = [];
    await render();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector('[aria-label="Filter symbol kinds"]')).toBeNull();
    expect(container.textContent).toContain("Outline");
    expect(container.textContent).toContain("No symbols found.");
  });
});
