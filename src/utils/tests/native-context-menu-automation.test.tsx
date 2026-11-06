// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  menuNew: vi.fn(),
  getIdentifier: vi.fn(async () => "com.code.athas.e2e"),
}));

vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: mocks.menuNew } }));
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: mocks.getIdentifier }));

import { ContextMenuPopup } from "@/ui/context-menu";
import { showNativeContextMenu } from "@/ui/native-context-menu";

let root: Root;
let container: HTMLDivElement;

async function flush(ms = 0) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, isTauri: true });
  Element.prototype.getAnimations = () => [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Object.assign(globalThis, { isTauri: undefined });
});

// WebDriver only sees the page, so the e2e build must never hand a right-click menu to the OS:
// the file explorer specs right-click a folder and look for its "New File" item in the DOM.
describe("context menus under automation", () => {
  it("does not draw an OS menu in the e2e build", async () => {
    await expect(showNativeContextMenu({ entries: [], point: { x: 0, y: 0 } })).resolves.toBe(
      false,
    );
    expect(mocks.menuNew).not.toHaveBeenCalled();
  });

  it("renders the menu in the page so its items can be found and clicked", async () => {
    const onClick = vi.fn();
    await act(async () =>
      root.render(
        <ContextMenuPopup
          isOpen
          point={{ x: 10, y: 10 }}
          onClose={() => {}}
          groups={[{ id: "folder", items: [{ id: "new-file", label: "New File", onClick }] }]}
        />,
      ),
    );
    await flush(20);

    const item = document.querySelector<HTMLElement>('[role="menuitem"]');
    expect(item?.textContent).toContain("New File");
    expect(mocks.menuNew).not.toHaveBeenCalled();

    await act(async () => item?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
