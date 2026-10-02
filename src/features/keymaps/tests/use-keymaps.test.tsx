// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  settings: { vimMode: false, nativeMenuBar: false, keybindingPreset: "none" },
  hasOpenModal: vi.fn(() => false),
  closeTopModal: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  arch: () => "aarch64",
  platform: () => "macos",
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: mocks.settings }) },
}));
vi.mock("@/features/window/stores/ui-state.store", () => ({
  useUIState: {
    getState: () => ({ hasOpenModal: mocks.hasOpenModal, closeTopModal: mocks.closeTopModal }),
  },
}));

const { useKeymaps } = await import("../hooks/use-keymaps");
const { useKeymapStore } = await import("../stores/keymaps.store");
const { keymapRegistry } = await import("../utils/registry");

const executed: Array<{ command: string; args: unknown }> = [];
let container: HTMLDivElement;
let root: Root;

function Harness() {
  useKeymaps();
  return null;
}

function register(command: string) {
  keymapRegistry.registerCommand({
    id: command,
    title: command,
    execute: (args) => {
      executed.push({ command, args });
    },
  });
}

function press(init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.settings = { vimMode: false, nativeMenuBar: false, keybindingPreset: "none" };
  for (const command of [
    "file.save",
    "file.close",
    "file.quickOpen",
    "terminal.close",
    "workbench.toggleSidebar",
    "editor.format",
  ]) {
    register(command);
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  keymapRegistry.clear();
  useKeymapStore.getState().actions.resetToDefaults();
  useKeymapStore.getState().actions.setContexts({ editorFocus: false, terminalFocus: false });
  executed.length = 0;
  mocks.hasOpenModal.mockReset().mockReturnValue(false);
  mocks.closeTopModal.mockReset();
  vi.useRealTimers();
});

describe("keyboard shortcut dispatch", () => {
  it("runs the bound command and stops the event", () => {
    keymapRegistry.registerKeybinding({ key: "cmd+s", command: "file.save", source: "default" });

    const event = press({ key: "s", code: "KeyS", metaKey: true });

    expect(executed).toEqual([{ command: "file.save", args: undefined }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("prefers a user keybinding over the default for the same command", () => {
    keymapRegistry.registerKeybinding({ key: "cmd+s", command: "file.save", source: "default" });
    useKeymapStore.getState().actions.addKeybinding({
      key: "cmd+alt+s",
      command: "file.save",
      source: "user",
      args: { force: true },
    });

    press({ key: "s", code: "KeyS", metaKey: true });
    expect(executed).toEqual([]);

    press({ key: "s", code: "KeyS", metaKey: true, altKey: true });
    expect(executed).toEqual([{ command: "file.save", args: { force: true } }]);
  });

  it("skips keybindings whose when clause does not hold", () => {
    keymapRegistry.registerKeybinding({
      key: "cmd+shift+i",
      command: "editor.format",
      when: "editorFocus",
      source: "default",
    });

    press({ key: "i", code: "KeyI", metaKey: true, shiftKey: true });
    expect(executed).toEqual([]);

    useKeymapStore.getState().actions.setContext("editorFocus", true);
    press({ key: "i", code: "KeyI", metaKey: true, shiftKey: true });
    expect(executed.map((entry) => entry.command)).toEqual(["editor.format"]);
  });

  it("treats a keydown inside the Monaco editor as editor focus", () => {
    keymapRegistry.registerKeybinding({
      key: "cmd+shift+i",
      command: "editor.format",
      when: "editorFocus",
      source: "default",
    });
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    document.body.append(editor);

    press({ key: "i", code: "KeyI", metaKey: true, shiftKey: true }, editor);

    expect(executed.map((entry) => entry.command)).toEqual(["editor.format"]);
  });

  it("completes a chord within the timeout", () => {
    keymapRegistry.registerKeybinding({
      key: "cmd+k cmd+b",
      command: "workbench.toggleSidebar",
      source: "default",
    });

    const first = press({ key: "k", code: "KeyK", metaKey: true });
    expect(first.defaultPrevented).toBe(true);
    expect(executed).toEqual([]);

    press({ key: "b", code: "KeyB", metaKey: true });
    expect(executed.map((entry) => entry.command)).toEqual(["workbench.toggleSidebar"]);
  });

  it("abandons a pending chord after one second", () => {
    keymapRegistry.registerKeybinding({
      key: "cmd+k cmd+b",
      command: "workbench.toggleSidebar",
      source: "default",
    });

    press({ key: "k", code: "KeyK", metaKey: true });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    press({ key: "b", code: "KeyB", metaKey: true });

    expect(executed).toEqual([]);
  });

  it("does not run single-key bindings that collide with a pending chord's second key", () => {
    keymapRegistry.registerKeybinding({
      key: "cmd+k cmd+b",
      command: "workbench.toggleSidebar",
      source: "default",
    });
    keymapRegistry.registerKeybinding({ key: "cmd+s", command: "file.save", source: "default" });

    press({ key: "k", code: "KeyK", metaKey: true });
    press({ key: "s", code: "KeyS", metaKey: true });
    expect(executed).toEqual([]);

    press({ key: "s", code: "KeyS", metaKey: true });
    expect(executed.map((entry) => entry.command)).toEqual(["file.save"]);
  });

  it("only allows quick open and the command palette from text inputs", () => {
    keymapRegistry.registerKeybinding({ key: "cmd+s", command: "file.save", source: "default" });
    keymapRegistry.registerKeybinding({
      key: "cmd+p",
      command: "file.quickOpen",
      source: "default",
    });
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    press({ key: "s", code: "KeyS", metaKey: true }, input);
    press({ key: "p", code: "KeyP", metaKey: true }, input);

    expect(executed.map((entry) => entry.command)).toEqual(["file.quickOpen"]);
  });

  it("ignores disabled keybindings", () => {
    keymapRegistry.registerKeybinding({
      key: "cmd+s",
      command: "file.save",
      source: "default",
      enabled: false,
    });

    press({ key: "s", code: "KeyS", metaKey: true });

    expect(executed).toEqual([]);
  });

  it("ignores auto-repeated modifier shortcuts", () => {
    keymapRegistry.registerKeybinding({ key: "cmd+s", command: "file.save", source: "default" });

    press({ key: "s", code: "KeyS", metaKey: true, repeat: true });

    expect(executed).toEqual([]);
  });

  it("does nothing while a keybinding is being recorded", () => {
    keymapRegistry.registerKeybinding({ key: "cmd+s", command: "file.save", source: "default" });
    useKeymapStore.getState().actions.startRecording("file.save");

    press({ key: "s", code: "KeyS", metaKey: true });
    useKeymapStore.getState().actions.stopRecording();

    expect(executed).toEqual([]);
  });

  it("routes cmd+w to the terminal when the terminal has focus", () => {
    press({ key: "w", code: "KeyW", metaKey: true });
    useKeymapStore.getState().actions.setContext("terminalFocus", true);
    press({ key: "w", code: "KeyW", metaKey: true });

    expect(executed.map((entry) => entry.command)).toEqual(["file.close", "terminal.close"]);
  });

  it("closes the top modal on Escape", () => {
    mocks.hasOpenModal.mockReturnValue(true);

    const event = press({ key: "Escape", code: "Escape" });

    expect(mocks.closeTopModal).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves unmodified keys to Vim when Vim mode is on", () => {
    mocks.settings = { ...mocks.settings, vimMode: true };
    keymapRegistry.registerKeybinding({ key: "j", command: "file.save", source: "default" });

    press({ key: "j", code: "KeyJ" });

    expect(executed).toEqual([]);
  });
});
