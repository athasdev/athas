// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import nordThemes from "../themes/builtin/nord.json";
import type { Theme } from "../themes/theme-schema";
import type { ThemeDefinition } from "../themes/theme.types";

const storage = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  saves: 0,
  failLoad: false,
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => {
    if (storage.failLoad) throw new Error("store unavailable");
    return {
      get: async (key: string) => storage.values.get(key),
      set: async (key: string, value: unknown) => {
        storage.values.set(key, value);
      },
      save: async () => {
        storage.saves++;
      },
    };
  },
}));

async function loadThemeModules(options: { menuFails?: boolean } = {}) {
  vi.resetModules();
  const [{ commands }, { themeRegistry }, { themeLoader }, { initializeThemeSystem }, customStore] =
    await Promise.all([
      import("@/bindings/commands"),
      import("../themes/theme-registry"),
      import("../themes/theme-loader"),
      import("../themes/theme-initializer"),
      import("../themes/custom-theme-store"),
    ]);
  vi.spyOn(commands, "rebuildMenuThemes").mockImplementation(async (themes) => {
    if (options.menuFails) throw new Error("no menu");
    menuRebuilds.push(themes as Array<{ id: string }>);
    return null;
  });
  return { themeRegistry, themeLoader, initializeThemeSystem, customStore };
}

function definition(id: string, overrides: Partial<ThemeDefinition> = {}): ThemeDefinition {
  return {
    id,
    name: id,
    description: "",
    category: "Dark",
    cssVariables: { "--background": "black" },
    isDark: true,
    ...overrides,
  };
}

function customTheme(id: string, name = id): Theme {
  return { id, name, appearance: "light", colors: { ...nordThemes.themes[0].colors } };
}

let menuRebuilds: Array<Array<{ id: string }>>;

beforeEach(() => {
  storage.values.clear();
  storage.saves = 0;
  storage.failLoad = false;
  menuRebuilds = [];
  document.documentElement.removeAttribute("style");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme registry", () => {
  it("applies a theme's variables and removes ones the next theme does not define", async () => {
    const { themeRegistry } = await loadThemeModules();
    themeRegistry.registerTheme(
      definition("first", {
        cssVariables: { "--background": "black", "--accent": "red" },
        syntaxTokens: { "--syntax-keyword": "blue" },
      }),
    );
    themeRegistry.registerTheme(
      definition("second", { cssVariables: { "--background": "white" }, isDark: false }),
    );
    const changes: string[] = [];
    themeRegistry.onThemeChange((id) => changes.push(id));

    themeRegistry.applyTheme("first");
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--accent")).toBe("red");
    expect(style.getPropertyValue("--syntax-keyword")).toBe("blue");

    themeRegistry.applyTheme("second");
    expect(style.getPropertyValue("--background")).toBe("white");
    expect(style.getPropertyValue("--accent")).toBe("");
    expect(style.getPropertyValue("--syntax-keyword")).toBe("");
    expect(document.documentElement.getAttribute("data-theme")).toBe("second");
    expect(document.documentElement.getAttribute("data-theme-type")).toBe("light");
    expect(themeRegistry.getCurrentTheme()).toBe("second");
    expect(changes).toEqual(["first", "second"]);
  });

  it("ignores unknown themes", async () => {
    const { themeRegistry } = await loadThemeModules();

    themeRegistry.applyTheme("missing");

    expect(themeRegistry.getCurrentTheme()).toBeNull();
    expect(document.documentElement.getAttribute("data-theme")).not.toBe("missing");
  });

  it("removes every theme an extension contributed and forgets it as current", async () => {
    const { themeRegistry } = await loadThemeModules();
    const source = { extensionId: "acme.themes" };
    themeRegistry.registerTheme(definition("acme-dark"), source);
    themeRegistry.registerTheme(definition("acme-light", { category: "Light" }), source);
    themeRegistry.registerTheme(definition("other"));
    themeRegistry.applyTheme("acme-dark");
    const versionBefore = themeRegistry.getVersion();

    themeRegistry.unregisterThemesByExtension("nobody");
    expect(themeRegistry.getVersion()).toBe(versionBefore);

    themeRegistry.unregisterThemesByExtension("acme.themes");

    expect(themeRegistry.getAllThemes().map((theme) => theme.id)).toEqual(["other"]);
    expect(themeRegistry.getThemeSource("acme-dark")).toBeUndefined();
    expect(themeRegistry.getCurrentTheme()).toBeNull();
    expect(themeRegistry.getVersion()).toBe(versionBefore + 1);
  });

  it("tracks sources, categories and unregistering the current theme", async () => {
    const { themeRegistry } = await loadThemeModules();
    themeRegistry.registerTheme(definition("a"), { extensionId: "x" });
    themeRegistry.registerTheme(definition("a"));
    themeRegistry.registerTheme(definition("b", { category: "Light" }));
    themeRegistry.applyTheme("b");

    expect(themeRegistry.getThemeSource("a")).toBeUndefined();
    expect(themeRegistry.getThemesByCategory("Light").map((theme) => theme.id)).toEqual(["b"]);

    themeRegistry.unregisterTheme("b");
    expect(themeRegistry.getTheme("b")).toBeUndefined();
    expect(themeRegistry.getCurrentTheme()).toBeNull();
  });

  it("keeps notifying other listeners when one throws, and stops after unsubscribe", async () => {
    const { themeRegistry } = await loadThemeModules();
    const calls: string[] = [];
    themeRegistry.onRegistryChange(() => {
      throw new Error("bad listener");
    });
    const stop = themeRegistry.onRegistryChange(() => calls.push("registry"));
    themeRegistry.onThemeChange(() => {
      throw new Error("bad theme listener");
    });
    themeRegistry.registerTheme(definition("a"));
    themeRegistry.applyTheme("a");
    stop();
    themeRegistry.registerTheme(definition("b"));

    expect(calls).toEqual(["registry"]);
    expect(console.error).toHaveBeenCalledWith(
      "Error in registry change callback:",
      expect.any(Error),
    );
    expect(console.error).toHaveBeenCalledWith(
      "Error in theme change callback:",
      expect.any(Error),
    );
  });

  it("runs ready callbacks once, immediately after the registry is ready", async () => {
    const { themeRegistry } = await loadThemeModules();
    const calls: string[] = [];
    themeRegistry.onReady(() => calls.push("early"));
    const cancelled = themeRegistry.onReady(() => calls.push("cancelled"));
    themeRegistry.onReady(() => {
      throw new Error("ready failed");
    });
    cancelled();

    expect(themeRegistry.isRegistryReady()).toBe(false);
    themeRegistry.markAsReady();
    themeRegistry.markAsReady();
    themeRegistry.onReady(() => calls.push("late"));

    expect(themeRegistry.isRegistryReady()).toBe(true);
    expect(calls).toEqual(["early", "late"]);
  });
});

describe("theme loading", () => {
  it("registers the bundled themes once", async () => {
    const { themeRegistry, themeLoader } = await loadThemeModules();

    await Promise.all([themeLoader.initialize(), themeLoader.initialize()]);

    const ids = themeRegistry.getAllThemes().map((theme) => theme.id);
    expect(ids).toContain("nord");
    expect(new Set(ids).size).toBe(ids.length);
    expect(themeLoader.getCachedThemes()).toHaveLength(ids.length);
  });

  it("loads theme definitions from a theme file url and reports bad files", async () => {
    const { themeLoader } = await loadThemeModules();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "Mine", themes: [customTheme("mine", "Mine")] })),
      )
      .mockResolvedValueOnce(new Response("", { status: 404, statusText: "Not Found" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ themes: "nope" })));
    vi.stubGlobal("fetch", fetchMock);

    expect((await themeLoader.loadFromFile("/themes/mine.json")).map((theme) => theme.id)).toEqual([
      "mine",
    ]);
    expect(await themeLoader.loadFromFile("/themes/missing.json")).toEqual([]);
    expect(await themeLoader.loadFromFile("/themes/broken.json")).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("theme system startup", () => {
  it("registers bundled and custom themes, marks the registry ready and builds the menu", async () => {
    storage.values.set("themes", [customTheme("my-light", "My Light"), customTheme("nord")]);
    const { themeRegistry, initializeThemeSystem } = await loadThemeModules();

    await initializeThemeSystem();
    await initializeThemeSystem();

    expect(themeRegistry.isRegistryReady()).toBe(true);
    expect(themeRegistry.getThemeSource("my-light")).toEqual({
      extensionId: "custom-theme.my-light",
      kind: "custom",
    });
    expect(themeRegistry.getThemeSource("nord")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'initializeThemeSystem: Skipped custom theme "nord" because that ID is already registered',
    );
    expect(menuRebuilds).toHaveLength(1);
    expect(menuRebuilds[0].map((theme) => theme.id)).toContain("my-light");

    themeRegistry.registerTheme(definition("late-addition"));
    await vi.waitFor(() => expect(menuRebuilds).toHaveLength(2));
    expect(menuRebuilds[1].map((theme) => theme.id)).toContain("late-addition");
  });

  it("still starts when custom themes or the native menu are unavailable", async () => {
    storage.failLoad = true;
    const { themeRegistry, initializeThemeSystem } = await loadThemeModules({ menuFails: true });

    await initializeThemeSystem();

    expect(themeRegistry.isRegistryReady()).toBe(true);
    expect(themeRegistry.getTheme("nord")).toBeDefined();
    expect(console.error).toHaveBeenCalledWith(
      "initializeThemeSystem: Failed to load custom themes:",
      expect.any(Error),
    );
    expect(console.error).toHaveBeenCalledWith("Failed to rebuild native menu:", expect.any(Error));
  });
});

describe("custom theme storage", () => {
  it("installs themes by id and removes them again", async () => {
    const { customStore } = await loadThemeModules();

    expect(await customStore.loadCustomThemes()).toEqual([]);
    await customStore.installCustomThemes([customTheme("forest", "Forest")]);
    await customStore.installCustomThemes([
      customTheme("forest", "Forest 2"),
      customTheme("sea", "Sea"),
    ]);

    expect((await customStore.loadCustomThemes()).map(({ id, name }) => [id, name])).toEqual([
      ["forest", "Forest 2"],
      ["sea", "Sea"],
    ]);

    await customStore.removeCustomTheme("forest");
    expect((await customStore.loadCustomThemes()).map(({ id }) => id)).toEqual(["sea"]);
    expect(storage.saves).toBe(3);
  });
});
