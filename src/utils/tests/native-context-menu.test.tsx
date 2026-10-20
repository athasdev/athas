// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type MenuOptions = { items: Record<string, unknown>[] };

const mocks = vi.hoisted(() => ({
  created: [] as {
    options: MenuOptions;
    popup: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
  failNew: false,
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: vi.fn(async (options: MenuOptions) => {
      if (mocks.failNew) throw new Error("menu permission denied");
      const menu = { options, popup: vi.fn(async () => {}), close: vi.fn(async () => {}) };
      mocks.created.push(menu);
      return menu;
    }),
  },
}));

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
  contextMenuGroupsToNativeEntries,
  type ContextMenuGroupData,
} from "@/ui/context-menu";
import { shortcutToAccelerator, toNativeMenuItems } from "@/ui/native-context-menu";

let root: Root;
let container: HTMLDivElement;

const lastMenu = () => mocks.created[mocks.created.length - 1]!;
const nativeItem = (index: number) => lastMenu().options.items[index] as Record<string, unknown>;
const pick = (index: number) => (nativeItem(index).action as () => void)();

async function flush(ms = 0) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, isTauri: true });
  Element.prototype.getAnimations = () => [];
  mocks.created.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Object.assign(globalThis, { isTauri: undefined });
});

describe("native menu mapping", () => {
  it("turns app keybindings into display-only accelerators", () => {
    expect(shortcutToAccelerator("cmd+shift+p")).toBe("CmdOrCtrl+Shift+P");
    expect(shortcutToAccelerator("alt+up")).toBe("Alt+ArrowUp");
    expect(shortcutToAccelerator("f5")).toBe("F5");
    expect(shortcutToAccelerator("ctrl+space")).toBe("Ctrl+Space");
    expect(shortcutToAccelerator("cmd+k cmd+t")).toBeUndefined();
  });

  it("maps labels, state, separators and submenus to menu options", () => {
    const onSelect = vi.fn();
    const items = toNativeMenuItems(
      [
        { type: "separator" },
        { type: "item", label: "Save & Close", shortcut: "cmd+s", onSelect },
        { type: "separator" },
        { type: "separator" },
        { type: "item", label: "Word Wrap", checked: true, onSelect },
        { type: "item", label: "Paste", disabled: true, onSelect },
        {
          type: "submenu",
          label: "Copy As",
          items: [{ type: "item", label: "Markdown", onSelect }],
        },
        { type: "submenu", label: "Empty", items: [] },
        { type: "separator" },
      ],
      onSelect,
    );

    expect(items).toMatchObject([
      { text: "Save && Close", enabled: true, accelerator: "CmdOrCtrl+S" },
      { item: "Separator" },
      { text: "Word Wrap", enabled: true, checked: true },
      { text: "Paste", enabled: false },
      { text: "Copy As", enabled: true, items: [{ text: "Markdown", enabled: true }] },
      { text: "Empty", enabled: false },
    ]);
    expect(items[0]).not.toHaveProperty("checked");
    expect(items[5]).not.toHaveProperty("items");
  });

  it("flattens context menu groups, keeping destructive actions last", () => {
    const groups: ContextMenuGroupData[] = [
      {
        id: "a",
        items: [
          { id: "delete", label: "Delete", tone: "destructive", onClick: () => {} },
          { id: "open", label: "Open", icon: <svg />, onClick: () => {} },
          { id: "current", label: "Current", selected: true, onClick: () => {} },
        ],
      },
      { id: "b", items: [{ id: "info", label: "Info" }] },
    ];

    expect(contextMenuGroupsToNativeEntries(groups)).toMatchObject([
      { type: "item", label: "Open", disabled: false, checked: undefined },
      { type: "item", label: "Current", checked: true },
      { type: "separator" },
      { type: "item", label: "Info", disabled: true },
      { type: "separator" },
      { type: "item", label: "Delete", disabled: false },
    ]);
  });
});

function PopupHarness({
  native,
  onAction,
  onClose,
}: {
  native?: boolean;
  onAction: () => void;
  onClose: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="open" onClick={() => setIsOpen(true)}>
        open
      </button>
      <ContextMenuPopup
        native={native}
        isOpen={isOpen}
        point={{ x: 24, y: 48 }}
        onClose={() => {
          onClose();
          setIsOpen(false);
        }}
        groups={[{ id: "g", items: [{ id: "rename", label: "Rename", onClick: onAction }] }]}
      />
    </>
  );
}

async function openPopup(props: Parameters<typeof PopupHarness>[0]) {
  await act(async () => root.render(<PopupHarness {...props} />));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click());
  await flush();
}

describe("ContextMenuPopup", () => {
  it("shows an OS menu at the point in the desktop app, without page markup", async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    await openPopup({ onAction, onClose });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(mocks.created).toHaveLength(1);
    expect(lastMenu().popup).toHaveBeenCalledWith(expect.objectContaining({ x: 24, y: 48 }));

    await act(async () => pick(0));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAction.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    await flush(10);
    expect(lastMenu().close).toHaveBeenCalled();
  });

  it("closes without an action when the OS menu is dismissed", async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    await openPopup({ onAction, onClose });
    await flush(200);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("keeps the in-page menu when native is turned off", async () => {
    await openPopup({ native: false, onAction: vi.fn(), onClose: vi.fn() });

    expect(mocks.created).toHaveLength(0);
    expect(document.querySelector('[role="menuitem"]')?.textContent).toContain("Rename");
  });

  it("keeps the in-page menu outside the desktop app", async () => {
    Object.assign(globalThis, { isTauri: undefined });
    await openPopup({ onAction: vi.fn(), onClose: vi.fn() });

    expect(mocks.created).toHaveLength(0);
    expect(document.querySelector('[role="menuitem"]')?.textContent).toContain("Rename");
  });
});

describe("ContextMenu composed from items", () => {
  it("reads its items into an OS menu on right click", async () => {
    const onRename = vi.fn();
    await act(async () =>
      root.render(
        <ContextMenu>
          <ContextMenuTrigger data-testid="row">row</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={onRename}>
              <svg />
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled>Archive</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      ),
    );
    const row = document.querySelector<HTMLElement>('[data-testid="row"]')!;
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }),
      );
    });
    await flush();

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[data-slot="context-menu-native-source"]')).toBeNull();
    expect(lastMenu().options.items).toMatchObject([
      { text: "Rename", enabled: true },
      { item: "Separator" },
      { text: "Archive", enabled: false },
    ]);
    expect(lastMenu().popup).toHaveBeenCalledWith(expect.objectContaining({ x: 5, y: 6 }));

    await act(async () => pick(0));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("falls back to the in-page menu when the OS menu can't be created", async () => {
    mocks.failNew = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await openPopup({ onAction: vi.fn(), onClose: vi.fn() });
    await flush();

    expect(document.querySelector('[role="menuitem"]')?.textContent).toContain("Rename");
    warn.mockRestore();
  });
});
