// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import {
  chooseThemeFile,
  deleteCustomTheme,
  installThemeJson,
  uploadTheme,
} from "../services/theme-upload";

const storage = vi.hoisted(() => ({ data: new Map<string, unknown>() }));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (key: string) => storage.data.get(key),
    set: async (key: string, value: unknown) => {
      storage.data.set(key, structuredClone(value));
    },
    save: async () => {},
  }),
}));

const COLORS = {
  background: "#101010",
  surface: "#181818",
  foreground: "#eeeeee",
  "muted-foreground": "#aaaaaa",
  "subtle-foreground": "#888888",
  border: "#333333",
  accent: "#222222",
  selected: "#2a2a2a",
  primary: "#3b82f6",
};

function themeJson(themes: Array<Record<string, unknown>>) {
  return JSON.stringify({ name: "My themes", themes });
}

function theme(id: string, overrides: Record<string, unknown> = {}) {
  return { id, name: `Theme ${id}`, appearance: "dark", colors: COLORS, ...overrides };
}

function storedIds() {
  return ((storage.data.get("themes") as Array<{ id: string }>) ?? []).map((entry) => entry.id);
}

const registered: string[] = [];

describe("theme upload", () => {
  beforeEach(() => {
    storage.data.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const id of registered.splice(0)) themeRegistry.unregisterTheme(id);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("installs every theme in a file, stores it and registers it as custom", async () => {
    registered.push("ocean", "forest");

    const result = await installThemeJson(themeJson([theme("ocean"), theme("forest")]));

    expect(result.success).toBe(true);
    expect(result.themes?.map((entry) => entry.id)).toEqual(["ocean", "forest"]);
    expect(result.theme?.id).toBe("ocean");
    expect(storedIds()).toEqual(["ocean", "forest"]);
    expect(themeRegistry.getTheme("ocean")?.name).toBe("Theme ocean");
    expect(themeRegistry.getThemeSource("forest")).toEqual({
      extensionId: "custom-theme.forest",
      kind: "custom",
    });
  });

  it("replaces an earlier import of the same theme and re-applies it when active", async () => {
    registered.push("ocean");
    await installThemeJson(themeJson([theme("ocean")]));
    themeRegistry.applyTheme("ocean");

    const result = await installThemeJson(themeJson([theme("ocean", { name: "Ocean v2" })]));

    expect(result.success).toBe(true);
    expect(storedIds()).toEqual(["ocean"]);
    expect(themeRegistry.getTheme("ocean")?.name).toBe("Ocean v2");
    expect(themeRegistry.getCurrentTheme()).toBe("ocean");
  });

  it("refuses to overwrite a built-in or extension theme", async () => {
    registered.push("builtin-x");
    themeRegistry.registerTheme({
      id: "builtin-x",
      name: "Built-in X",
      isDark: true,
      cssVariables: {},
    } as never);

    const result = await installThemeJson(themeJson([theme("builtin-x")]));

    expect(result).toEqual({
      success: false,
      error: "The theme file does not match the Athas theme format.",
      details: ['themes[0].id conflicts with the existing theme "Built-in X"'],
    });
    expect(storedIds()).toEqual([]);
  });

  it("reports validation issues for malformed files", async () => {
    const invalidJson = await installThemeJson("{not json");
    expect(invalidJson.success).toBe(false);
    expect(invalidJson.details?.[0]).toMatch(/^Invalid JSON/);

    const missingColors = await installThemeJson(
      themeJson([{ id: "Bad Id", name: "x", appearance: "dim", colors: {} }]),
    );
    expect(missingColors.success).toBe(false);
    expect(missingColors.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("themes[0].id must start with"),
        'themes[0].appearance must be either "dark" or "light"',
        "themes[0].colors.background is required",
      ]),
    );
  });

  it("rejects colors the webview cannot render", async () => {
    vi.stubGlobal("CSS", { supports: (_property: string, value: string) => value !== "nope" });

    const result = await installThemeJson(
      themeJson([theme("ocean", { colors: { ...COLORS, primary: "nope" } })]),
    );

    expect(result.success).toBe(false);
    expect(result.details).toEqual(["themes[0].colors.primary is not a supported CSS color: nope"]);
  });

  it("reports storage failures as plain errors", async () => {
    vi.spyOn(storage.data, "get").mockImplementation(() => {
      throw new Error("disk unavailable");
    });

    const result = await installThemeJson(themeJson([theme("ocean")]));

    expect(result).toEqual({ success: false, error: "disk unavailable" });
  });

  describe("uploading a file", () => {
    it("accepts a JSON file", async () => {
      registered.push("ocean");
      const file = new File([themeJson([theme("ocean")])], "Ocean.JSON", {
        type: "application/json",
      });

      await expect(uploadTheme(file)).resolves.toMatchObject({ success: true });
    });

    it("rejects files without a .json extension", async () => {
      const result = await uploadTheme(new File(["{}"], "theme.txt"));

      expect(result).toEqual({
        success: false,
        error: "Choose an Athas theme JSON file.",
        details: ["theme.txt does not use the .json extension"],
      });
    });

    it("rejects files over 2 MB", async () => {
      const file = new File(["x"], "big.json");
      Object.defineProperty(file, "size", { value: 2 * 1024 * 1024 + 1 });

      await expect(uploadTheme(file)).resolves.toMatchObject({
        success: false,
        error: "The theme file is too large.",
      });
    });

    it("reports unreadable files", async () => {
      const file = new File(["{}"], "broken.json");
      Object.defineProperty(file, "text", { value: () => Promise.reject("read failed") });

      await expect(uploadTheme(file)).resolves.toEqual({
        success: false,
        error: "Failed to import the theme file.",
      });
    });
  });

  it("removes imported themes but not other themes", async () => {
    registered.push("ocean", "builtin-y");
    await installThemeJson(themeJson([theme("ocean")]));
    themeRegistry.registerTheme({ id: "builtin-y", name: "Y" } as never);

    await deleteCustomTheme("ocean");
    expect(storedIds()).toEqual([]);
    expect(themeRegistry.getTheme("ocean")).toBeUndefined();

    await expect(deleteCustomTheme("builtin-y")).rejects.toThrow(
      "Only imported custom themes can be removed.",
    );
    expect(themeRegistry.getTheme("builtin-y")).toBeDefined();
  });

  it("opens a JSON file picker and passes on the chosen file", () => {
    const onSelect = vi.fn();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      expect(this.type).toBe("file");
      expect(this.accept).toBe("application/json,.json");
      const file = new File(["{}"], "a.json");
      Object.defineProperty(this, "files", { value: [file] });
      this.onchange?.(new Event("change"));
    });

    chooseThemeFile(onSelect);

    expect(click).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "a.json" }));
  });
});
