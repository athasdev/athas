// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    handler: null as null | ((action: { action: string; value?: string | null }) => void),
    showToast: vi.fn(),
  };
});

vi.mock("../lib/menu-actions", () => ({
  listenToMenuActions: async (handler: typeof io.handler) => {
    io.handler = handler;
    return () => {};
  },
}));
vi.mock("@/features/layout/contexts/toast-context", () => ({
  showToast: io.showToast,
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("@/features/settings/hooks/use-updater", () => ({
  useUpdater: () => ({ checkForUpdates: vi.fn() }),
}));

const { builtInCommands } = await import("@/features/keymaps/commands/command-registry");
const { keymapRegistry } = await import("@/features/keymaps/utils/registry");
const { useMenuEventsWrapper } = await import("../hooks/use-menu-events-wrapper");

const MENU_COMMANDS: Record<string, string> = {
  new_window: "workbench.newWindow",
  new_file: "file.new",
  save: "file.save",
  save_as: "file.saveAs",
  close_tab: "file.close",
  undo: "editor.undo",
  redo: "editor.redo",
  select_all: "editor.selectAll",
  find: "workbench.showFind",
  find_replace: "workbench.showFindReplace",
  toggle_comment: "editor.toggleComment",
  command_palette: "workbench.commandPalette",
  toggle_sidebar: "workbench.toggleSidebar",
  toggle_terminal: "workbench.toggleTerminal",
  split_editor: "workbench.splitEditorRight",
  toggle_vim: "settings.toggleVimMode",
  quick_open: "file.quickOpen",
  next_tab: "workbench.nextTab",
  prev_tab: "workbench.previousTab",
  whats_new: "help.showWhatsNew",
  open_settings: "workbench.openSettings",
  open_extensions: "view.showIntegrations",
  toggle_menu_bar: "window.toggleMenuBar",
};

function Harness() {
  useMenuEventsWrapper();
  return null;
}

let container: HTMLDivElement;
let root: Root;

describe("native menu events", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  it("runs the registered command its keyboard shortcut runs", async () => {
    const execute = vi.spyOn(keymapRegistry, "executeCommand").mockResolvedValue();
    await act(async () => root.render(<Harness />));

    for (const [action, commandId] of Object.entries(MENU_COMMANDS)) {
      execute.mockClear();
      act(() => io.handler?.({ action }));
      expect(execute, action).toHaveBeenCalledExactlyOnceWith(
        commandId,
        undefined,
        expect.objectContaining({ onError: expect.any(Function) }),
      );
    }
  });

  it("shows an error toast when the command fails", async () => {
    keymapRegistry.registerCommand({
      id: "test.menuFailure",
      title: "Menu Failure",
      execute: async () => {
        throw new Error("chunk failed");
      },
    });
    await act(async () => root.render(<Harness />));

    await act(async () => io.handler?.({ action: "execute_command", value: "test.menuFailure" }));

    expect(io.showToast).toHaveBeenCalledExactlyOnceWith({
      message: "Couldn't run Menu Failure",
      description: "chunk failed",
      type: "error",
    });
    keymapRegistry.unregisterCommand("test.menuFailure");
  });

  it("only routes to built-in commands", () => {
    const ids = new Set(builtInCommands.map((command) => command.id));
    const missing = Object.values(MENU_COMMANDS).filter((commandId) => !ids.has(commandId));

    expect(missing).toEqual([]);
  });
});
