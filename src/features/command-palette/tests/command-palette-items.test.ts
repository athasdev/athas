import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("@/utils/toast", () => toast);

import { registerCommands } from "@/features/keymaps/commands/command-registry";
import { defaultKeymaps } from "@/features/keymaps/defaults/default-keymaps";
import type { Command, CommandContext } from "@/features/keymaps/types/keymaps.types";
import { getEffectiveShortcutsByCommand } from "@/features/keymaps/utils/effective-keymaps";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { commandPaletteOrder } from "../constants/command-palette-order";
import { legacyPaletteIds, migrateLegacyPaletteId } from "../constants/legacy-palette-ids";
import type { CommandPaletteItem } from "../types/command-palette-item.types";
import {
  buildCommandPaletteItems,
  type CommandPaletteProviders,
  runCommandFromPalette,
} from "../utils/command-palette-items";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    settings: defaultSettings,
    ui: { isSidebarVisible: true, isBottomPaneVisible: false, bottomPaneActiveTab: "terminal" },
    activeBuffer: null,
    lspStatus: { status: "running", activeWorkspaces: ["/repo"] },
    agent: { cli: null, logOutAgentId: null, browseSessionsAgentId: null },
    ...overrides,
  };
}

const activeEditorBuffer: CommandContext["activeBuffer"] = {
  id: "buffer-1",
  type: "editor",
  path: "/repo/a.ts",
  isVirtual: false,
  isMarkdownPreview: false,
};

function providerItem(id: string): CommandPaletteItem {
  return { id, label: id, description: "", icon: null, category: "Settings", run: () => {} };
}

const emptyProviders: CommandPaletteProviders = {
  "settings-search": () => [],
  "extension-commands": () => [],
  "vim-commands": () => [],
};

function buildItems(context = createContext(), providers = emptyProviders) {
  return buildCommandPaletteItems({
    commands: keymapRegistry.getAllCommands(),
    context,
    order: commandPaletteOrder,
    providers,
  });
}

function labels(context?: CommandContext) {
  return buildItems(context).map((item) => item.label);
}

describe("command palette items", () => {
  beforeEach(() => {
    keymapRegistry.clear();
    registerCommands();
  });

  afterEach(() => {
    keymapRegistry.clear();
  });

  it("orders every palette command exactly once", () => {
    const paletteCommandIds = keymapRegistry
      .getAllCommands()
      .filter((command) => command.palette)
      .map((command) => command.id)
      .sort();
    const orderedIds = commandPaletteOrder.filter((slot) => typeof slot === "string");

    expect(new Set(orderedIds).size).toBe(orderedIds.length);
    expect([...orderedIds].sort()).toEqual(paletteCommandIds);
  });

  it("keeps the labels other surfaces and tests run from the palette", () => {
    expect(labels()).toEqual(
      expect.arrayContaining([
        "View: Hide Sidebar",
        "View: Show Terminal",
        "View: Show Git",
        "View: Split Editor Right",
        "View: Close Editor Group",
        "Preferences: Open Settings",
        "Preferences: Color Theme",
        "Search: Global Search",
        "File: New Document",
        "Tab: Reopen Closed Tab",
        "Git: Stage All Changes",
        "GitHub: New Pull Request",
        "Language Server: Restart All Servers",
      ]),
    );
  });

  it("labels stateful toggles from the command context", () => {
    const hidden = createContext({
      ui: { isSidebarVisible: false, isBottomPaneVisible: true, bottomPaneActiveTab: "terminal" },
      settings: { ...defaultSettings, wordWrap: true, showMinimap: false },
    });

    expect(labels(hidden)).toEqual(
      expect.arrayContaining([
        "View: Show Sidebar",
        "View: Hide Bottom Pane",
        "View: Hide Terminal",
        "Editor: Disable Word Wrap",
        "Editor: Show Minimap",
      ]),
    );
    expect(buildItems().find((item) => item.id === "lsp.showStatus")?.description).toBe(
      "Status: running (1 workspaces)",
    );
  });

  it("offers contextual commands only when their predicate holds", () => {
    const markdownEditor = createContext({
      activeBuffer: {
        id: "readme",
        type: "editor",
        path: "/repo/README.md",
        isVirtual: false,
        isMarkdownPreview: true,
      },
      agent: {
        cli: { name: "Claude CLI", command: "claude" },
        logOutAgentId: "claude-acp",
        browseSessionsAgentId: "claude-acp",
      },
      settings: { ...defaultSettings, vimMode: true },
    });

    expect(labels()).not.toContain("Markdown: Show Source");
    expect(labels()).not.toContain("View: Show Outline");
    expect(labels()).not.toContain("AI: Log Out of Agent");
    expect(labels()).not.toContain("Vim: Enter Normal Mode");
    expect(labels(markdownEditor)).toEqual(
      expect.arrayContaining([
        "Markdown: Show Source",
        "View: Show Outline",
        "AI: Open Claude CLI in Terminal",
        "AI: Import Agent Session",
        "AI: Log Out of Agent",
        "Vim: Enter Normal Mode",
      ]),
    );
    expect(
      labels(
        createContext({
          settings: {
            ...defaultSettings,
            coreFeatures: { ...defaultSettings.coreFeatures, terminal: false },
          },
        }),
      ),
    ).not.toContain("Window: New Terminal Window");
  });

  it("splices provider rows into their slots", () => {
    const items = buildItems(createContext(), {
      "settings-search": () => [providerItem("open-setting-font")],
      "extension-commands": () => [providerItem("extension-command:demo.run")],
      "vim-commands": () => [],
    });
    const ids = items.map((item) => item.id);
    const indexOf = (id: string) => ids.indexOf(id);

    expect(indexOf("open-setting-font")).toBeGreaterThan(
      indexOf("preferences.openSettingsTab.file-explorer"),
    );
    expect(indexOf("open-setting-font")).toBeLessThan(indexOf("view.showFiles"));
    expect(indexOf("extension-command:demo.run")).toBeGreaterThan(indexOf("file.reopenClosed"));
    expect(indexOf("extension-command:demo.run")).toBeLessThan(indexOf("window.newTerminalWindow"));
  });

  it("shows the keybinding the default keymap assigns to each row", () => {
    const shortcuts = getEffectiveShortcutsByCommand({
      preset: "none",
      registryKeybindings: defaultKeymaps,
      userKeybindings: [],
    });
    const firstDefaultKey = (commandId: string) =>
      defaultKeymaps.find((binding) => binding.command === commandId && binding.enabled !== false)
        ?.key;

    for (const item of buildItems()) {
      const commandId = item.keybindingCommandId ?? item.id;
      expect(keymapRegistry.getCommand(commandId), item.id).toBeDefined();
      expect(shortcuts.get(commandId), item.id).toBe(firstDefaultKey(commandId));
    }

    const byLabel = new Map(
      buildItems(createContext({ activeBuffer: activeEditorBuffer })).map((item) => [
        item.label,
        item,
      ]),
    );
    expect(shortcuts.get(byLabel.get("File: Save")?.keybindingCommandId ?? "")).toBe("cmd+s");
    expect(shortcuts.get(byLabel.get("Tab: Close Tab")?.keybindingCommandId ?? "")).toBe("cmd+w");
    expect(shortcuts.get(byLabel.get("View: Show Terminal")?.keybindingCommandId ?? "")).toBe(
      "cmd+`",
    );
  });

  it("offers Close Tab only while a tab is open, so the palette never closes the window", () => {
    expect(labels()).not.toContain("Tab: Close Tab");
    expect(labels(createContext({ activeBuffer: activeEditorBuffer }))).toContain("Tab: Close Tab");
  });

  it("maps every legacy palette id onto a palette command", () => {
    const missing = Object.entries(legacyPaletteIds)
      .filter(([, commandId]) => !keymapRegistry.getCommand(commandId)?.palette)
      .map(([legacyId]) => legacyId);

    expect(missing).toEqual([]);
    expect(migrateLegacyPaletteId("git-push")).toBe("git.push");
    expect(migrateLegacyPaletteId("open-settings-tab-keyboard")).toBe(
      "preferences.openSettingsTab.keyboard",
    );
    expect(migrateLegacyPaletteId("extension-command:demo.run")).toBe("extension-command:demo.run");
  });
});

describe("running a command from the palette", () => {
  afterEach(() => {
    keymapRegistry.clear();
  });

  async function runWith(closeMode: "before" | "settled" | "never") {
    const events: string[] = [];
    let finish: () => void = () => {};
    const command: Command = {
      id: "test.run",
      title: "Run",
      execute: async () => {
        events.push("start");
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        events.push("end");
      },
    };
    keymapRegistry.clear();
    keymapRegistry.registerCommand(command);

    const run = runCommandFromPalette("test.run", closeMode, () => events.push("close"));
    await vi.waitFor(() => expect(events).toContain("start"));
    finish();
    await run;
    return events;
  }

  it("shows an error toast when a command fails to run", async () => {
    toast.showToast.mockClear();
    keymapRegistry.registerCommand({
      id: "test.lazy",
      title: "Lazy Command",
      execute: async () => {
        throw new Error("Failed to fetch dynamically imported module");
      },
    });
    const closePalette = vi.fn();

    await runCommandFromPalette("test.lazy", "before", closePalette);

    expect(closePalette).toHaveBeenCalledOnce();
    expect(toast.showToast).toHaveBeenCalledExactlyOnceWith({
      message: "Couldn't run Lazy Command",
      description: "Failed to fetch dynamically imported module",
      type: "error",
    });
  });

  it("does not toast when a command succeeds", async () => {
    toast.showToast.mockClear();
    keymapRegistry.registerCommand({ id: "test.ok", title: "Ok", execute: () => {} });

    await runCommandFromPalette("test.ok", "before", vi.fn());

    expect(toast.showToast).not.toHaveBeenCalled();
  });

  it.each([
    ["before", ["close", "start", "end"]],
    ["settled", ["start", "end", "close"]],
    ["never", ["start", "end"]],
  ] as const)("closes the palette %s", async (closeMode, expected) => {
    expect(await runWith(closeMode)).toEqual(expected);
  });
});
