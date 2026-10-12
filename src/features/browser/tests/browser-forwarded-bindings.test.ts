import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  registry: [] as Array<{ key: string; command: string; when?: string; enabled?: boolean }>,
  user: [] as Array<{ key: string; command: string; enabled?: boolean; replaceDefaults?: boolean }>,
}));

vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: { keybindingPreset: "default" } }) },
}));
vi.mock("@/features/keymaps/stores/keymaps.store", () => ({
  useKeymapStore: { getState: () => ({ keybindings: harness.user }) },
}));
vi.mock("@/features/keymaps/services/keymap-registry", () => ({
  keymapRegistry: { getAllKeybindings: () => harness.registry },
}));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  normalizeKey: (key: string) => key,
}));

import { getBrowserKeyBindings, isPageCommand } from "../utils/browser-key-bindings";

beforeEach(() => {
  harness.registry = [];
  harness.user = [];
});

describe("getBrowserKeyBindings", () => {
  it("forwards only enabled workbench navigation shortcuts that apply in a page", () => {
    harness.registry = [
      { key: "cmd+p", command: "file.quickOpen" },
      { key: "cmd+shift+p", command: "workbench.commandPalette", when: "browserFocus" },
      { key: "cmd+b", command: "workbench.toggleSidebar", when: "!browserFocus" },
      { key: "cmd+s", command: "file.save" },
      { key: "cmd+k cmd+t", command: "workbench.nextTab" },
      { key: "cmd+1", command: "workbench.switchToTab1" },
    ];
    harness.user = [{ key: "ctrl+alt+r", command: "browser.reload" }];

    const bindings = getBrowserKeyBindings();

    expect(bindings).toEqual([
      {
        command: "browser.reload",
        key: "r",
        code: null,
        meta: false,
        ctrl: true,
        alt: true,
        shift: false,
      },
      expect.objectContaining({ command: "file.quickOpen", key: "p", meta: true }),
      expect.objectContaining({ command: "workbench.commandPalette", shift: true }),
      expect.objectContaining({ command: "workbench.switchToTab1", code: "Digit1" }),
    ]);
  });

  it("drops shortcuts the user disabled", () => {
    harness.registry = [{ key: "cmd+p", command: "file.quickOpen" }];
    harness.user = [{ key: "cmd+p", command: "file.quickOpen", enabled: false }];

    expect(getBrowserKeyBindings()).toEqual([]);
  });
});

describe("isPageCommand", () => {
  it("keeps focus in the page for browser and zoom commands", () => {
    expect(isPageCommand("browser.reload")).toBe(true);
    expect(isPageCommand("workbench.zoomIn")).toBe(true);
    expect(isPageCommand("workbench.zoomOut")).toBe(true);
    expect(isPageCommand("workbench.zoomReset")).toBe(true);
    expect(isPageCommand("workbench.toggleSidebar")).toBe(false);
  });
});
