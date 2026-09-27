// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SidebarTree, SidebarTreeRow } from "../components/sidebar-tree";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.parentElement;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function press(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("Sidebar tree keyboard navigation", () => {
  it("keeps focus in an expanded branch with no visible children", async () => {
    await act(async () =>
      root.render(
        <SidebarTree label="Changed files">
          <SidebarTreeRow label="Empty folder" expanded />
          <SidebarTreeRow label="Another folder" expanded />
          <SidebarTreeRow label="Other folder child" depth={1} />
        </SidebarTree>,
      ),
    );
    const items = container.querySelectorAll<HTMLElement>("[role=treeitem]");
    items[0]!.focus();
    press(items[0]!, "ArrowRight");
    expect(document.activeElement).toBe(items[0]);
    press(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    press(items[1]!, "ArrowRight");
    expect(document.activeElement).toBe(items[2]);
    press(items[2]!, "ArrowLeft");
    expect(document.activeElement).toBe(items[1]);
  });

  it("opens a collapsed branch before moving to its visible child", async () => {
    const onToggle = vi.fn();
    await act(async () =>
      root.render(
        <SidebarTree label="Changed files">
          <SidebarTreeRow label="Closed folder" expanded={false} onToggle={onToggle} />
          <SidebarTreeRow label="Another folder" expanded />
          <SidebarTreeRow label="Other folder child" depth={1} />
        </SidebarTree>,
      ),
    );
    const first = container.querySelector<HTMLElement>("[role=treeitem]")!;
    first.focus();
    press(first, "ArrowRight");
    expect(onToggle).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(first);
  });

  it("skips disabled children without selecting a deeper descendant", async () => {
    await act(async () =>
      root.render(
        <SidebarTree label="Changed files">
          <SidebarTreeRow label="Folder" expanded />
          <SidebarTreeRow label="Unavailable child" depth={1} expanded disabled />
          <SidebarTreeRow label="Grandchild" depth={2} />
          <SidebarTreeRow label="Available child" depth={1} />
        </SidebarTree>,
      ),
    );
    const items = container.querySelectorAll<HTMLElement>("[role=treeitem]");
    items[0]!.focus();
    press(items[0]!, "ArrowRight");
    expect(document.activeElement).toBe(items[3]);
  });
});
