// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { commands, type Shell } from "@/bindings/commands";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles.store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { TerminalSettings } from "../components/tabs/terminal-settings";
import { getDefaultSetting, getDefaultSettingsSnapshot } from "../config/default-settings";
import { useFontStore } from "../stores/font.store";
import { useSettingsStore } from "../stores/settings.store";
import type { Settings } from "../types/settings.types";

enableMapSet();

let root: Root;
let container: HTMLDivElement;

const body = () => within(document.body);
const settings = () => useSettingsStore.getState().settings;
const profiles = () => useTerminalProfilesStore.getState().profiles;
const row = (label: string) =>
  document.querySelector(`[data-setting-row-label="${label}"]`) as HTMLElement;

function shell(id: string, name: string): Shell {
  return { id, name, exec_win: null, exec_unix: `/bin/${id}`, kind: null, wsl_distribution: null };
}

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
  await act(async () => root.render(<TerminalSettings />));
  await flush();
}

const options = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((item) => item.textContent);

async function openOptions(control: HTMLElement, query = "") {
  if (control instanceof HTMLInputElement) {
    await click(control.parentElement!.querySelector("button")!);
    await act(async () => {
      fireEvent.change(control, { target: { value: query } });
    });
    await flush();
    return;
  }
  await click(control);
}

async function chooseIn(control: HTMLElement, option: string) {
  await openOptions(control, option);
  const match = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === option,
  );
  if (!match) throw new Error(`No option ${option} in ${options().join(", ")}`);
  await click(match);
}

const choose = (label: string, option: string) =>
  chooseIn(within(row(label)).getAllByRole("combobox")[0], option);

async function typeNumber(label: string, value: string) {
  const input = within(row(label)).getByRole("textbox");
  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  });
  await flush();
}

async function typeInto(element: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useSettingsStore.setState({ settings: getDefaultSettingsSnapshot() });
  useTerminalProfilesStore.setState({ profiles: [] });
  useTerminalShellsStore.setState({ shells: [], isLoading: false, hasLoaded: false });
  useFontStore.setState({ monospaceFonts: [] });
  vi.spyOn(commands, "listShells").mockResolvedValue([shell("zsh", "Zsh"), shell("fish", "Fish")]);
  vi.spyOn(commands, "getMonospaceFonts").mockResolvedValue([
    { family: "JetBrainsMono Nerd Font", is_monospace: true },
    { family: "Menlo", is_monospace: true },
  ] as never);
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("terminal settings", () => {
  it.each([
    ["Shell Integration", "terminalShellIntegration"],
    ["Alt Click Moves Cursor", "terminalAltClickMovesCursor"],
    ["Option as Meta", "terminalMacOptionIsMeta"],
    ["Right Click Selects Word", "terminalRightClickSelectsWord"],
    ["Blinking Cursor", "terminalCursorBlink"],
  ] as [string, keyof Settings][])("toggles %s and resets it", async (label, key) => {
    await render();
    const initial = getDefaultSetting(key);

    await click(body().getByRole("switch", { name: label }));
    expect(settings()[key]).toBe(!initial);

    await click(body().getByRole("button", { name: `Reset ${label}` }));
    expect(settings()[key]).toBe(initial);
  });

  it("chooses the default shell from the installed shells", async () => {
    await render();

    await choose("Default Shell", "Fish");
    expect(settings().terminalDefaultShellId).toBe("fish");

    await click(body().getByRole("button", { name: "Reset Default Shell" }));
    expect(settings().terminalDefaultShellId).toBe("");
  });

  it("keeps the saved default shell and profile while shells are still loading", async () => {
    let finishLoading!: (shells: Shell[]) => void;
    vi.mocked(commands.listShells).mockReturnValueOnce(
      new Promise((resolve) => {
        finishLoading = resolve;
      }) as never,
    );
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        terminalDefaultShellId: "fish",
        terminalDefaultProfileId: "custom-1",
      },
    }));
    useTerminalProfilesStore.setState({
      profiles: [{ id: "custom-1", name: "Server", startupCommands: [] }],
    });
    await render();

    expect(settings().terminalDefaultShellId).toBe("fish");
    expect(settings().terminalDefaultProfileId).toBe("custom-1");

    await act(async () => finishLoading([shell("zsh", "Zsh"), shell("fish", "Fish")]));
    await flush();

    expect(settings().terminalDefaultShellId).toBe("fish");
    expect(settings().terminalDefaultProfileId).toBe("custom-1");
    expect(
      (within(row("Default Shell")).getAllByRole("combobox")[0] as HTMLInputElement).placeholder,
    ).toBe("Fish");
  });

  it("forgets a default shell that is no longer installed", async () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        terminalDefaultShellId: "bash",
        terminalDefaultProfileId: "gone",
      },
    }));
    await render();

    expect(settings().terminalDefaultShellId).toBe("");
    expect(settings().terminalDefaultProfileId).toBe("");
  });

  it("adds, edits and deletes a custom profile", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, terminalDefaultShellId: "zsh" },
    }));
    await render();
    expect(body().getByText("No custom profiles")).toBeTruthy();

    await click(button("Add Profile"));
    const [profile] = profiles();
    expect(profile).toMatchObject({ name: "Custom Profile 1", shell: "zsh", startupCommands: [] });

    await typeInto(document.getElementById(`terminal-profile-name-${profile.id}`)!, "Server");
    await typeInto(
      document.getElementById(`terminal-profile-directory-${profile.id}`)!,
      "/srv/app",
    );
    await typeInto(
      document.getElementById(`terminal-profile-commands-${profile.id}`)!,
      " source .env \n\nnpm run dev",
    );
    await chooseIn(document.getElementById(`terminal-profile-shell-${profile.id}`)!, "Fish");

    expect(profiles()[0]).toMatchObject({
      name: "Server",
      shell: "fish",
      startupDirectory: "/srv/app",
      startupCommands: ["source .env", "npm run dev"],
    });

    await choose("Default Profile", "Server");
    expect(settings().terminalDefaultProfileId).toBe(profile.id);

    await typeInto(document.getElementById(`terminal-profile-directory-${profile.id}`)!, "");
    expect(profiles()[0].startupDirectory).toBeUndefined();

    await click(body().getByRole("button", { name: "Delete Server" }));
    expect(profiles()).toEqual([]);
    expect(settings().terminalDefaultProfileId).toBe("");
  });

  it("offers installed Nerd Fonts first and keeps a custom font choice", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, terminalFontFamily: "Comic Mono" },
    }));
    await render();

    await openOptions(within(row("Font Family")).getAllByRole("combobox")[0]);
    expect(options()).toEqual([
      "Comic Mono (Custom)",
      "JetBrainsMono Nerd Font (Nerd Font)",
      "Menlo",
    ]);
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (item) => item.textContent === "Menlo",
      )!,
    );
    expect(settings().terminalFontFamily).toBe("Menlo");
  });

  it("applies typed typography and cursor values", async () => {
    await render();

    await typeNumber("Font Size", "15");
    await typeNumber("Line Height", "1.4");
    await typeNumber("Letter Spacing", "1");
    await typeNumber("Scrollback", "5000");
    await typeNumber("Minimum Contrast", "7");
    await typeNumber("Cursor Width", "3");
    await choose("Cursor Style", "Underline");
    await choose("Inactive Cursor Style", "Hidden");

    expect(settings()).toMatchObject({
      terminalFontSize: 15,
      terminalLineHeight: 1.4,
      terminalLetterSpacing: 1,
      terminalScrollback: 5000,
      terminalMinimumContrastRatio: 7,
      terminalCursorWidth: 3,
      terminalCursorStyle: "underline",
      terminalCursorInactiveStyle: "none",
    });

    for (const label of [
      "Font Size",
      "Line Height",
      "Letter Spacing",
      "Scrollback",
      "Minimum Contrast",
      "Cursor Width",
      "Cursor Style",
      "Inactive Cursor Style",
    ]) {
      await click(body().getByRole("button", { name: `Reset ${label}` }));
    }
    expect(settings()).toMatchObject({
      terminalFontSize: getDefaultSetting("terminalFontSize"),
      terminalScrollback: getDefaultSetting("terminalScrollback"),
      terminalCursorStyle: getDefaultSetting("terminalCursorStyle"),
      terminalCursorInactiveStyle: getDefaultSetting("terminalCursorInactiveStyle"),
    });
  });
});
