// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
    storage: new Map<string, unknown>(),
    failStoreWrites: false,
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
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (key: string) => mocks.storage.get(key),
    set: async (key: string, value: unknown) => {
      if (mocks.failStoreWrites) throw new Error("store is read-only");
      mocks.storage.set(key, structuredClone(value));
    },
    save: async () => {},
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save, open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: mocks.writeTextFile }));

import { commands } from "@/bindings/commands";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { AppearanceSettings } from "../components/tabs/appearance-settings";
import { getDefaultSettingsSnapshot } from "../config/default-settings";
import { useSettingsStore } from "../stores/settings.store";

enableMapSet();

const colors = {
  "--background": "#101010",
  "--surface": "#181818",
  "--foreground": "#eeeeee",
  "--muted-foreground": "#aaaaaa",
  "--subtle-foreground": "#888888",
  "--border": "#333333",
  "--accent": "#222222",
  "--selected": "#2a2a2a",
  "--primary": "#3b82f6",
};

function theme(id: string, name: string, isDark: boolean): ThemeDefinition {
  return {
    id,
    name,
    description: name,
    category: isDark ? "Dark" : "Light",
    cssVariables: colors,
    isDark,
  };
}

const bundledThemes = [
  theme("athas-dark", "Athas Dark", true),
  theme("athas-light", "Athas Light", false),
  theme("nord", "Nord", true),
  theme("paper", "Paper", false),
];

let root: Root;
let container: HTMLDivElement;

const body = () => within(document.body);
const settings = () => useSettingsStore.getState().settings;

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
  await act(async () => root.render(<AppearanceSettings />));
  await flush();
}

function rowControl(label: string, role: string) {
  const row = document.querySelector(`[data-setting-row-label="${label}"]`) as HTMLElement;
  return within(row).getAllByRole(role)[0];
}

const options = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((item) => item.textContent);

async function openOptions(label: string, query: string) {
  const control = rowControl(label, "combobox");
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

async function choose(label: string, option: string) {
  await openOptions(label, option);
  const match = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === option,
  );
  if (!match) throw new Error(`No option ${option} in ${options().join(", ")}`);
  await click(match);
}

async function registerCustomTheme(id: string, name: string, isDark = true) {
  themeRegistry.registerTheme(theme(id, name, isDark), {
    extensionId: `custom-theme.${id}`,
    kind: "custom",
  });
  mocks.storage.set("themes", JSON.parse(themeFileJson(id, name)).themes);
}

function themeFileJson(id: string, name: string) {
  return JSON.stringify({
    name,
    themes: [
      {
        id,
        name,
        appearance: "dark",
        colors: Object.fromEntries(
          Object.entries(colors).map(([key, value]) => [key.slice(2), value]),
        ),
      },
    ],
  });
}

async function pickThemeFile(file: File) {
  const pickers: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    pickers.push(this);
  });
  await click(button("Import"));
  Object.defineProperty(pickers[0], "files", { value: [file] });
  await act(async () => {
    (pickers[0].onchange as () => void)();
  });
  await flush();
}

beforeAll(() => {
  for (const definition of bundledThemes) {
    themeRegistry.registerTheme(definition, { extensionId: "bundled", isBundled: true });
  }
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useSettingsStore.setState({
    settings: { ...getDefaultSettingsSnapshot(), syncSystemTheme: false },
  });
  mocks.toasts.length = 0;
  mocks.storage.clear();
  mocks.failStoreWrites = false;
  mocks.save.mockReset();
  mocks.writeTextFile.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(commands, "getSystemFonts").mockResolvedValue([]);
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
  for (const definition of themeRegistry.getAllThemes()) {
    if (themeRegistry.getThemeSource(definition.id)?.kind === "custom") {
      themeRegistry.unregisterTheme(definition.id);
    }
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("appearance settings", () => {
  it("toggles window transparency and resets it", async () => {
    await render();

    await click(body().getByRole("switch", { name: "Window Transparency" }));
    expect(settings().windowTransparency).toBe(false);

    await click(body().getByRole("button", { name: "Reset Window Transparency" }));
    expect(settings().windowTransparency).toBe(true);
  });

  it("only offers window transparency under Interface", async () => {
    await render();

    for (const label of [
      "Reduce Motion",
      "UI Density",
      "Show Tab Icons",
      "Tab Close Buttons",
      "Open Projects In New Window",
    ]) {
      expect(document.querySelector(`[data-setting-row-label="${label}"]`)).toBeNull();
    }
  });

  it("picks a color theme from the registered themes", async () => {
    await render();

    await choose("Color Theme", "Nord");
    expect(settings().theme).toBe("nord");

    await click(body().getByRole("button", { name: "Reset Color Theme" }));
    expect(settings().theme).toBe("athas-dark");
  });

  it("splits light and dark choices when syncing with the OS", async () => {
    await render();

    await click(body().getByRole("switch", { name: "Sync With OS" }));
    expect(settings().syncSystemTheme).toBe(true);
    expect(document.querySelector('[data-setting-row-label="Color Theme"]')).toBeNull();

    await openOptions("Preferred Light Theme", "a");
    expect(options()).toEqual(["Athas Light", "Paper"]);
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (item) => item.textContent === "Paper",
      )!,
    );
    expect(settings().autoThemeLight).toBe("paper");

    await choose("Preferred Dark Theme", "Nord");
    expect(settings().autoThemeDark).toBe("nord");
  });

  it("applies a typed UI font size", async () => {
    await render();
    const input = body().getByRole("textbox", { name: /^UI font size: / });

    await act(async () => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "15" } });
      fireEvent.blur(input);
    });
    await flush();

    expect(settings().uiFontSize).toBe(15);
    expect(input.getAttribute("aria-label")).toBe("UI font size: 15.00 pixels");
  });

  it("lists imported themes and removes one, falling back from it", async () => {
    await registerCustomTheme("sunset", "Sunset");
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, theme: "sunset", autoThemeDark: "sunset" },
    }));
    await render();

    expect(document.querySelector('[data-setting-row-label="Sunset"]')).not.toBeNull();
    await click(body().getByRole("button", { name: "Remove Sunset" }));

    expect(settings().theme).toBe("athas-dark");
    expect(settings().autoThemeDark).toBe("athas-dark");
    expect(themeRegistry.getTheme("sunset")).toBeUndefined();
    expect(mocks.toasts).toContainEqual(
      expect.objectContaining({ type: "success", message: "Custom theme removed" }),
    );
    expect(document.querySelector('[data-setting-row-label="Sunset"]')).toBeNull();
  });

  it("reports when an imported theme cannot be removed", async () => {
    await registerCustomTheme("dusk", "Dusk", false);
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, autoThemeLight: "dusk" },
    }));
    mocks.failStoreWrites = true;
    await render();

    await click(body().getByRole("button", { name: "Remove Dusk" }));

    expect(settings().autoThemeLight).toBe("athas-light");
    expect(mocks.toasts).toContainEqual({
      type: "error",
      message: "Failed to remove custom theme",
      description: "store is read-only",
    });
    expect(themeRegistry.getTheme("dusk")).toBeDefined();
  });

  it("imports a theme file and switches to it", async () => {
    await render();

    await pickThemeFile(
      new File([themeFileJson("ember", "Ember")], "ember.json", { type: "application/json" }),
    );

    expect(mocks.toasts).toContainEqual(
      expect.objectContaining({ type: "success", message: "Imported Ember" }),
    );
    expect(settings().theme).toBe("ember");
    expect(themeRegistry.getThemeSource("ember")?.kind).toBe("custom");
  });

  it("sets an imported dark theme as the preferred dark theme when syncing", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, syncSystemTheme: true },
    }));
    await render();

    await pickThemeFile(
      new File([themeFileJson("coal", "Coal")], "coal.json", { type: "application/json" }),
    );

    expect(settings().autoThemeDark).toBe("coal");
    expect(settings().theme).toBe("athas-dark");
  });

  it("rejects a theme file without the json extension", async () => {
    await render();

    await pickThemeFile(new File(["{}"], "theme.txt", { type: "text/plain" }));

    expect(mocks.toasts).toContainEqual({
      type: "error",
      message: "Choose an Athas theme JSON file.",
      description: "theme.txt does not use the .json extension",
    });
    expect(settings().theme).toBe("athas-dark");
  });
});

describe("custom theme creator", () => {
  async function openCreator() {
    await render();
    await click(button("Create"));
  }

  const field = (id: string) => document.getElementById(id) as HTMLInputElement;

  it("derives the theme id from the name and installs the theme", async () => {
    await openCreator();

    await act(async () => {
      fireEvent.change(field("custom-theme-name"), { target: { value: "Night Owl!" } });
    });
    expect(field("custom-theme-id").value).toBe("night-owl");
    expect(JSON.parse(field("custom-theme-json").value).themes[0]).toMatchObject({
      id: "night-owl",
      name: "Night Owl!",
      appearance: "dark",
    });

    await click(button("Install Theme"));

    expect(mocks.toasts).toContainEqual(
      expect.objectContaining({ type: "success", message: "Installed Night Owl!" }),
    );
    expect(settings().theme).toBe("night-owl");
    expect(document.getElementById("custom-theme-name")).toBeNull();
  });

  it("keeps a manually edited id and shows validation issues for broken JSON", async () => {
    await openCreator();

    await act(async () => {
      fireEvent.change(field("custom-theme-id"), { target: { value: "custom-id" } });
    });
    await act(async () => {
      fireEvent.change(field("custom-theme-name"), { target: { value: "Other Name" } });
    });
    expect(field("custom-theme-id").value).toBe("custom-id");

    await act(async () => {
      fireEvent.change(field("custom-theme-json"), {
        target: { value: JSON.stringify({ name: "Broken", themes: [{ id: "x" }] }) },
      });
    });
    await click(button("Install Theme"));

    expect(body().getAllByText(/is required/).length).toBeGreaterThan(0);
    expect(themeRegistry.getTheme("x")).toBeUndefined();
    expect(field("custom-theme-name")).not.toBeNull();
  });

  it("refuses to overwrite a bundled theme", async () => {
    await openCreator();

    await act(async () => {
      fireEvent.change(field("custom-theme-id"), { target: { value: "nord" } });
    });
    await click(button("Install Theme"));

    expect(body().getByText('themes[0].id conflicts with the existing theme "Nord"')).toBeTruthy();
    expect(themeRegistry.getThemeSource("nord")?.kind).toBeUndefined();
  });

  it("saves the generated theme JSON to a file", async () => {
    mocks.save.mockResolvedValueOnce("/themes/my-athas-theme.json");
    await openCreator();

    await click(button("Save JSON"));

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "my-athas-theme.json" }),
    );
    const [path, contents] = mocks.writeTextFile.mock.calls[0];
    expect(path).toBe("/themes/my-athas-theme.json");
    expect(JSON.parse(contents).themes[0].id).toBe("my-athas-theme");
    expect(mocks.toasts).toContainEqual(
      expect.objectContaining({ type: "success", message: "Theme JSON saved" }),
    );
  });

  it("reports a failed save and does nothing when the save is cancelled", async () => {
    mocks.save.mockResolvedValueOnce(null);
    await openCreator();

    await click(button("Save JSON"));
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
    expect(mocks.toasts).toEqual([]);

    mocks.save.mockResolvedValueOnce("/locked/theme.json");
    mocks.writeTextFile.mockRejectedValueOnce(new Error("permission denied"));
    await click(button("Save JSON"));
    expect(mocks.toasts).toContainEqual({
      type: "error",
      message: "Failed to save theme JSON",
      description: "permission denied",
    });
  });

  it("closes without installing on cancel", async () => {
    await openCreator();

    await click(button("Cancel"));

    expect(document.getElementById("custom-theme-name")).toBeNull();
    expect(themeRegistry.getTheme("my-athas-theme")).toBeUndefined();
  });
});
