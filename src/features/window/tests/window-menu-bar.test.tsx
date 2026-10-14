// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/dom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { themeRegistry } from "@/extensions/themes/theme-registry";

const native = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
    alwaysOnTop: false,
    failDevtools: false,
  };
  Object.assign(window, {
    __TAURI_OS_PLUGIN_INTERNALS__: { platform: "windows" },
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        state.calls.push({ cmd, args });
        if (cmd === "plugin:window|is_always_on_top") return Promise.resolve(state.alwaysOnTop);
        if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
        if (cmd === "reopen_current_webview_devtools" && state.failDevtools) {
          return Promise.reject(new Error("Inspector unavailable"));
        }
        return Promise.resolve(null);
      },
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return state;
});

const { default: WindowMenuBar, WindowMenuDropdown } =
  await import("../components/window-menu-bar");

let root: Root;
let container: HTMLDivElement;
let openMenu: (menu: string | null) => void;
let activeMenu: string | null;

function Harness({ initial }: { initial: string | null }) {
  const [menu, setMenu] = useState<string | null>(initial);
  openMenu = setMenu;
  activeMenu = menu;
  return <WindowMenuBar activeMenu={menu} setActiveMenu={setMenu} />;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function eventually(assertion: () => void) {
  await act(async () => {
    await waitFor(assertion, { timeout: 5000 });
  });
}

async function waitForMenuItems() {
  await eventually(() => expect(menuItems().length).toBeGreaterThan(0));
}

async function render(initial: string | null = null) {
  await act(async () => root.render(<Harness initial={initial} />));
  await flush();
  if (initial) await waitForMenuItems();
}

async function open(menu: string) {
  await act(async () => openMenu(menu));
  await flush();
  await waitForMenuItems();
}

const menuItems = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="menubar-item"]')].filter(
    (item) => !item.closest('[data-slot="menubar-sub-content"]'),
  );
const itemLabel = (item: HTMLElement) => item.querySelector("span")?.textContent?.trim() ?? "";

async function click(menu: string, label: string) {
  await open(menu);
  const item = menuItems().find((candidate) => itemLabel(candidate) === label);
  if (!item) throw new Error(`No ${label} in ${menu}`);
  await act(async () => item.click());
  await flush();
}

const emitted = () =>
  native.calls
    .filter((call) => call.cmd === "plugin:event|emit_to")
    .map((call) => call.args.payload as { action: string; value: string | null });
const commandsRun = (cmd: string) => native.calls.filter((call) => call.cmd === cmd);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  native.calls.length = 0;
  native.alwaysOnTop = false;
  native.failDevtools = false;
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
  themeRegistry.registerTheme({
    id: "ocean",
    name: "Ocean",
    description: "",
    category: "Dark",
    cssVariables: {},
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  themeRegistry.unregisterTheme("ocean");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("window menu bar", () => {
  it("lists every top-level menu and opens the one picked by the user", async () => {
    await render();
    const triggers = [...container.querySelectorAll('[data-slot="menubar-trigger"]')].map(
      (trigger) => trigger.textContent,
    );
    expect(triggers).toEqual([
      "File",
      "Edit",
      "View",
      "Go",
      "Terminal",
      "Run",
      "Agent",
      "Tools",
      "Window",
      "Help",
    ]);
    expect(menuItems()).toHaveLength(0);

    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="menubar-trigger"]')!);
    });
    await flush();
    expect(activeMenu).toBe("File");
    expect(menuItems().map(itemLabel)).toContain("Reopen Closed Tab");
  });

  // Clicks all ~100 menu items one by one; under CI coverage that outlasts the default timeout.
  it("sends every menu command to the window and closes the menu after each one", async () => {
    await render();
    const menus = ["File", "Edit", "View", "Go", "Terminal", "Run", "Agent", "Tools", "Help"];
    let clicked = 0;
    for (const menu of menus) {
      await open(menu);
      const count = menuItems().length;
      for (let index = 0; index < count; index++) {
        await open(menu);
        await act(async () => menuItems()[index].click());
        await flush();
        expect(activeMenu).toBeNull();
        clicked++;
      }
    }

    const actions = emitted();
    expect(actions).toContainEqual({ action: "execute_command", value: "workbench.newTab" });
    expect(actions).toContainEqual({ action: "open_folder", value: null });
    expect(actions).toContainEqual({ action: "execute_command", value: "file.reopenClosed" });
    expect(actions).toContainEqual({ action: "find_replace", value: null });
    expect(actions).toContainEqual({ action: "execute_command", value: "editor.formatSelection" });
    expect(actions).toContainEqual({ action: "execute_command", value: "workbench.zoomReset" });
    expect(actions).toContainEqual({ action: "execute_command", value: "editor.renameSymbol" });
    expect(actions).toContainEqual({ action: "execute_command", value: "terminal.splitDown" });
    expect(actions).toContainEqual({ action: "execute_command", value: "debug.toggleBreakpoint" });
    expect(actions).toContainEqual({ action: "execute_command", value: "editor.inlineEdit" });
    expect(actions).toContainEqual({ action: "open_extensions", value: null });
    expect(actions).toContainEqual({ action: "check_updates", value: null });
    expect(actions.every((action) => typeof action.action === "string")).toBe(true);
    expect(actions.length).toBe(clicked - 3);
    expect(commandsRun("create_app_window")).toHaveLength(1);
    expect(commandsRun("plugin:process|exit")).toHaveLength(1);
    expect(commandsRun("reopen_current_webview_devtools")).toHaveLength(1);
  }, 60_000);

  it("controls the native window from the Window menu", async () => {
    await render();
    await click("Window", "Minimize");
    await click("Window", "Maximize");
    await click("Window", "Toggle Fullscreen");
    await click("Window", "Toggle Menu Bar");

    expect(commandsRun("plugin:window|minimize")).toHaveLength(1);
    expect(commandsRun("plugin:window|maximize")).toHaveLength(1);
    expect(commandsRun("plugin:window|set_fullscreen")[0]?.args).toMatchObject({ value: true });
    expect(emitted()).toContainEqual({ action: "toggle_menu_bar", value: null });
    expect(activeMenu).toBeNull();
  });

  it("applies a registered theme from the View menu", async () => {
    await render("View");
    const themeTrigger = () =>
      document.querySelector<HTMLElement>('[data-slot="menubar-sub-trigger"]');
    await eventually(() => expect(themeTrigger()?.textContent).toContain("Theme"));
    await act(async () => {
      fireEvent.click(themeTrigger()!);
    });
    const ocean = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-slot="menubar-sub-content"] [data-slot="menubar-item"]',
        ),
      ].find((item) => item.textContent?.includes("Ocean"));
    await eventually(() => expect(ocean()).toBeTruthy());
    await act(async () => ocean()!.click());
    await eventually(() =>
      expect(emitted()).toContainEqual({ action: "theme_change", value: "ocean" }),
    );
  });

  it("reports a Web Inspector that cannot open", async () => {
    native.failDevtools = true;
    const error = vi.spyOn(toast, "error").mockImplementation(() => 1);
    await render();
    await click("Tools", "Web Inspector");
    await eventually(() => expect(error).toHaveBeenCalledWith("Inspector unavailable"));
  });

  it("keeps the window above others while a menu is open and restores it afterwards", async () => {
    await render("File");
    const alwaysOnTop = () =>
      commandsRun("plugin:window|set_always_on_top").map((call) => call.args.value);
    await eventually(() => expect(alwaysOnTop()).toEqual([true]));

    await act(async () => openMenu(null));
    await eventually(() => expect(alwaysOnTop()).toEqual([true, false]));
  });

  it("leaves a window that is already always on top unchanged", async () => {
    native.alwaysOnTop = true;
    await render("Edit");
    const alwaysOnTop = () =>
      commandsRun("plugin:window|set_always_on_top").map((call) => call.args.value);
    await act(async () => openMenu(null));
    await eventually(() => expect(alwaysOnTop()).toEqual([true]));
  });

  describe("as the title bar dropdown", () => {
    function renderDropdown() {
      return act(async () =>
        root.render(
          <WindowMenuDropdown trigger={<button type="button" aria-label="Menu" />}>
            Athas
          </WindowMenuDropdown>,
        ),
      );
    }

    const menuButton = () => document.querySelector<HTMLElement>('[aria-label="Menu"]')!;
    const rows = () => [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ];

    async function openDropdown() {
      await renderDropdown();
      await act(async () => menuButton().click());
      await flush();
      await eventually(() => expect(rows().length).toBeGreaterThan(0));
    }

    it("lists every menu as a row of an opaque dropdown", async () => {
      await openDropdown();

      const dropdown = document.querySelector('[data-slot="dropdown-menu-content"]')!;
      expect(dropdown.className).toContain("bg-overlay");
      expect(rows().map((row) => row.textContent?.trim())).toEqual([
        "File",
        "Edit",
        "View",
        "Go",
        "Terminal",
        "Run",
        "Agent",
        "Tools",
        "Window",
        "Help",
      ]);
      expect(document.querySelector('[data-slot="menubar"]')).toBeNull();
    });

    it("opens a menu's items beside its row and closes after one runs", async () => {
      await openDropdown();
      const view = rows().find((row) => row.textContent?.trim() === "View")!;
      await act(async () => view.click());
      await waitForMenuItems();

      const item = menuItems().find((candidate) => itemLabel(candidate) === "Toggle Sidebar");
      expect(item).toBeDefined();
      await act(async () => item!.click());
      await flush();

      expect(emitted()).toContainEqual({ action: "toggle_sidebar", value: null });
      await eventually(() =>
        expect(document.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull(),
      );
    });

    it("keeps the window above others while it is open", async () => {
      await openDropdown();
      const alwaysOnTop = () =>
        commandsRun("plugin:window|set_always_on_top").map((call) => call.args.value);
      await eventually(() => expect(alwaysOnTop()).toEqual([true]));

      await act(async () => {
        fireEvent.keyDown(document.querySelector('[data-slot="dropdown-menu-content"]')!, {
          key: "Escape",
        });
      });
      await eventually(() => expect(alwaysOnTop()).toEqual([true, false]));
    });
  });
});
