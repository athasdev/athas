// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import ReferencesPane from "../components/references-pane";
import { useReferencesStore } from "../stores/references.store";

const openFile = vi.hoisted(() => vi.fn());
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { use: { handleFileSelect: () => openFile } },
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  openFile.mockClear();
  useReferencesStore.getState().actions.setReferences(
    { symbol: "hello", filePath: "/src/a.ts", line: 0, column: 0 },
    ["a", "b"].map((name) => ({
      filePath: `/src/${name}.ts`,
      line: 4,
      column: 2,
      endLine: 4,
      endColumn: 7,
      lineContent: `hello(${name});`,
    })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useReferencesStore.getState().actions.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Reference navigation", () => {
  it("exposes independent group disclosure and opens the reference location", async () => {
    await act(async () => root.render(<ReferencesPane />));
    const groups = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((button) => button.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
    const panelId = groups[0].getAttribute("aria-controls")!;
    expect(document.getElementById(panelId)?.textContent).toContain("hello(a)");

    await act(async () => groups[0].click());
    expect(groups[0].getAttribute("aria-expanded")).toBe("false");
    expect(groups[1].getAttribute("aria-expanded")).toBe("true");
    await act(async () => groups[0].click());
    expect(groups[0].getAttribute("aria-expanded")).toBe("true");

    const reference = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("hello(a)"),
    )!;
    await act(async () => reference.click());
    expect(openFile).toHaveBeenCalledWith("/src/a.ts", false, 5, 3, undefined, false);
  });
});
