// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const mocks = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    toasts: [] as { type: string; message: string; description?: string }[],
    save: vi.fn(),
    writeTextFile: vi.fn(async (_path: string, _contents: string) => {}),
  };
});

vi.mock("sonner", () => {
  const record = (type: string) => (message: string, options?: { description?: string }) =>
    mocks.toasts.push({ type, message, description: options?.description });
  return {
    toast: Object.assign(record("info"), {
      error: record("error"),
      success: record("success"),
      info: record("info"),
      warning: record("warning"),
    }),
  };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save, open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: mocks.writeTextFile }));

import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import type { Keybinding } from "@/features/keymaps/types/keymaps.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { KeyboardSettings } from "../components/tabs/keyboard-settings";
import { getDefaultSettingsSnapshot } from "../config/default-settings";
import { useSettingsStore } from "../stores/settings.store";

enableMapSet();

const last = <T,>(items: T[]) => items[items.length - 1];

const testCommands = [
  { id: "workbench.commandPalette", title: "Show Command Palette", category: "View" },
  { id: "file.quickOpen", title: "Quick Open File", category: "File" },
  { id: "workbench.toggleSidebar", title: "Toggle Sidebar", category: "View" },
];

let root: Root;
let container: HTMLDivElement;

const body = () => within(document.body);
const settings = () => useSettingsStore.getState().settings;
const userBindings = () => useKeymapStore.getState().keybindings;

function button(text: string) {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!match) throw new Error(`No button labelled ${text}`);
  return match;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

async function render() {
  await act(async () => root.render(<KeyboardSettings />));
  await flush();
}

async function openEditor() {
  await render();
  await click(button("Edit"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await flush();
}

const commandRows = () =>
  [...document.querySelectorAll("tbody tr")]
    .map((row) => row.querySelector("td")?.firstElementChild?.textContent)
    .filter(Boolean);

function userBinding(command: string, key: string): Keybinding {
  return { command, key, source: "user", enabled: true };
}

async function importFile(contents: string) {
  const pickers: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    pickers.push(this);
  });
  await click(button("Import"));
  const file = new File([contents], "keybindings.json", { type: "application/json" });
  Object.defineProperty(pickers[0], "files", { value: [file] });
  await act(async () => {
    await (pickers[0].onchange as (event: Event) => Promise<void>)({ target: pickers[0] } as never);
  });
  await flush();
}

beforeAll(() => {
  for (const command of testCommands) {
    keymapRegistry.registerCommand({ ...command, execute: () => {} } as never);
  }
  keymapRegistry.registerKeybinding({
    key: "cmd+shift+p",
    command: "workbench.commandPalette",
    source: "default",
  });
  keymapRegistry.registerKeybinding({ key: "cmd+p", command: "file.quickOpen", source: "default" });
});

afterAll(() => {
  for (const command of testCommands) {
    keymapRegistry.unregisterKeybinding(command.id);
    keymapRegistry.unregisterCommand(command.id);
  }
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useKeymapStore.setState({ keybindings: [], recordingCommandId: null });
  useSettingsStore.setState({ settings: getDefaultSettingsSnapshot() });
  mocks.toasts.length = 0;
  mocks.save.mockReset();
  mocks.writeTextFile.mockClear();
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("keyboard settings", () => {
  it("toggles vim mode and resets it", async () => {
    await render();
    const vimSwitch = body().getByRole("switch", { name: "Vim Mode" });

    await click(vimSwitch);
    expect(settings().vimMode).toBe(true);

    await click(body().getByRole("button", { name: "Reset Vim Mode" }));
    expect(settings().vimMode).toBe(false);
  });

  it("switches the keybinding preset and shows the bindings it changes", async () => {
    await render();
    await click(body().getByRole("combobox", { name: "Keybinding preset" }));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === "Zed",
    )!;
    await click(option);

    expect(settings().keybindingPreset).toBe("zed");
    expect(body().queryByText(/not covered/)).toBeNull();

    await click(button("Edit"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(body().queryByText("Not assigned")).toBeNull();
    await click(button("Preset"));
    expect(commandRows()).toContain("Toggle Sidebar");
  });

  it("counts custom shortcuts on the summary", async () => {
    useKeymapStore.setState({
      keybindings: [userBinding("file.quickOpen", "alt+ctrl+o")],
    });
    await render();

    expect(body().getByText("1 custom shortcut")).toBeTruthy();
  });

  it("lists commands with their effective binding and filters them", async () => {
    useKeymapStore.setState({
      keybindings: [userBinding("file.quickOpen", "alt+ctrl+o")],
    });
    await openEditor();

    expect(commandRows()).toEqual(["Show Command Palette", "Quick Open File", "Toggle Sidebar"]);

    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Search keybindings..."), {
        target: { value: "sidebar" },
      });
    });
    expect(commandRows()).toEqual(["Toggle Sidebar"]);
    expect(body().getByText("Not assigned")).toBeTruthy();

    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Search keybindings..."), {
        target: { value: "no such command" },
      });
    });
    expect(body().getByText("No keybindings found")).toBeTruthy();

    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Search keybindings..."), {
        target: { value: "" },
      });
    });
    await click(button("User"));
    expect(commandRows()).toEqual(["Quick Open File"]);

    await click(button("Default"));
    expect(commandRows()).toEqual(["Show Command Palette", "Toggle Sidebar"]);
  });

  it("records a new shortcut as a user override and flags conflicts", async () => {
    useKeymapStore.setState({
      keybindings: [userBinding("file.quickOpen", "alt+ctrl+k")],
    });
    await openEditor();

    await click(body().getByRole("button", { name: "Edit keybinding for Toggle Sidebar" }));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, altKey: true }),
      );
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    await flush();

    expect(userBindings()).toContainEqual(
      expect.objectContaining({
        command: "workbench.toggleSidebar",
        key: "alt+ctrl+k",
        source: "user",
      }),
    );
    expect(body().getAllByText("Conflicts with: Quick Open File").length).toBeGreaterThan(0);
  });

  it("resets every override after typing yes", async () => {
    useKeymapStore.setState({
      keybindings: [userBinding("file.quickOpen", "alt+ctrl+o")],
    });
    await openEditor();

    await click(button("Reset to Defaults"));
    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Type 'yes'"), { target: { value: "yes" } });
    });
    await click(button("Reset to Defaults"));

    expect(userBindings()).toEqual([]);
    expect(mocks.toasts).toContainEqual(
      expect.objectContaining({ type: "success", message: "Keybindings reset to defaults" }),
    );
  });

  it("exports user overrides with the active preset", async () => {
    useKeymapStore.setState({
      keybindings: [userBinding("file.quickOpen", "alt+ctrl+o")],
    });
    mocks.save.mockResolvedValue("/home/dev/keybindings.json");
    await openEditor();

    await click(button("Export"));

    const [path, contents] = mocks.writeTextFile.mock.calls[0];
    expect(path).toBe("/home/dev/keybindings.json");
    const payload = JSON.parse(contents);
    expect(payload.keybindingPreset).toBe(settings().keybindingPreset);
    expect(payload.keybindings).toEqual([
      expect.objectContaining({ command: "file.quickOpen", key: "alt+ctrl+o" }),
    ]);
    expect(mocks.toasts).toContainEqual(
      expect.objectContaining({ type: "success", message: "Keybindings exported" }),
    );
  });

  it("stays quiet when export is cancelled and reports write failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.save.mockResolvedValueOnce(null);
    await openEditor();

    await click(button("Export"));
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
    expect(mocks.toasts).toEqual([]);

    mocks.save.mockResolvedValueOnce("/locked/keybindings.json");
    mocks.writeTextFile.mockRejectedValueOnce("read-only volume");
    await click(button("Export"));
    expect(mocks.toasts).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: "Failed to export keybindings: read-only volume",
      }),
    );
  });

  it("imports an Athas keybindings file and applies its preset", async () => {
    await openEditor();

    await importFile(
      JSON.stringify({
        format: "athas.keybindings",
        version: 1,
        keybindingPreset: "zed",
        keybindings: [
          { key: "alt+ctrl+q", command: "file.quickOpen" },
          { key: 42, command: "" },
        ],
      }),
    );

    expect(settings().keybindingPreset).toBe("zed");
    expect(userBindings()).toContainEqual(
      expect.objectContaining({ command: "file.quickOpen", key: "alt+ctrl+q", source: "user" }),
    );
    expect(mocks.toasts).toContainEqual({
      type: "warning",
      message: "Imported 1 keybinding and preset",
      description: "Skipped 1 invalid entries.",
    });
  });

  it("rejects files that are not keybindings", async () => {
    await openEditor();

    await importFile(JSON.stringify({ theme: "dark" }));
    expect(mocks.toasts).toContainEqual(
      expect.objectContaining({ type: "error", message: "Invalid keybindings file format" }),
    );

    await importFile("{ not json");
    expect(last(mocks.toasts)).toMatchObject({
      type: "error",
      message: expect.stringMatching(/^Failed to import keybindings: /),
    });
    expect(userBindings()).toEqual([]);
  });

  it("returns to the summary from the editor", async () => {
    await openEditor();

    await click(button("Back"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(body().getByRole("switch", { name: "Vim Mode" })).toBeTruthy();
  });
});
