// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FileNavigatorSidebar } from "../components/file-navigator-sidebar";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.getAnimations = () => [];
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
  vi.unstubAllGlobals();
});

const items = [
  { key: "a", path: "src/app/main.ts" },
  { key: "b", path: "src/lib/util.ts" },
  { key: "c", path: "README.md" },
];

const labels = () =>
  [...container.querySelectorAll('[role="treeitem"]')].map((item) => item.textContent?.trim());

describe("file navigator sidebar", () => {
  it("shows filter matches inside folders the user collapsed", async () => {
    await act(async () =>
      root.render(
        <FileNavigatorSidebar
          items={items}
          selectedKey="c"
          onSelect={() => {}}
          onViewModeChange={() => {}}
        />,
      ),
    );
    const folder = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (item) => item.getAttribute("aria-expanded") === "true",
    )!;
    await act(async () => folder.click());
    expect(labels()).not.toContain("main.ts");

    const input = within(container).getByRole("textbox", { name: "Filter files" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "main" } });
    });
    expect(labels()).toContain("main.ts");

    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    expect(labels()).not.toContain("main.ts");
  });

  it("scrolls the selected file into view in the tree view", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    await act(async () =>
      root.render(<FileNavigatorSidebar items={items} selectedKey="b" onSelect={() => {}} />),
    );
    const selected = container.querySelector<HTMLElement>('[data-file-navigator-key="b"]')!;
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.scrollIntoView).toHaveBeenCalled();
    raf.mockRestore();
  });
});
