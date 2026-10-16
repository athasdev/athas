// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BUNDLED_FONTS } from "@/features/settings/config/bundled-fonts";
import type { FontInfo } from "@/features/settings/types/font.types";

const commandMocks = vi.hoisted(() => ({
  getSystemFonts: vi.fn(),
  getMonospaceFonts: vi.fn(),
  validateFont: vi.fn(),
}));

vi.mock("@/bindings/commands", () => ({ commands: commandMocks }));

const CACHE_KEY = "athas_font_cache_v3";
const DAY_MS = 24 * 60 * 60 * 1000;

function font(family: string, isMonospace: boolean): FontInfo {
  return { name: family, family, style: "Regular", is_monospace: isMonospace };
}

const systemFonts = [font("Helvetica", false), font("Menlo", true), font("Fira Code", true)];

async function loadStore() {
  vi.resetModules();
  const { useFontStore } = await import("@/features/settings/stores/font.store");
  return useFontStore;
}

function cache() {
  return JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null");
}

describe("font store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const mock of Object.values(commandMocks)) mock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("startup cache", () => {
    it("starts empty without a cache", async () => {
      const store = await loadStore();

      expect(store.getState()).toMatchObject({
        availableFonts: [],
        monospaceFonts: [],
        lastCacheTime: null,
      });
    });

    it("starts from a fresh cache", async () => {
      const timestamp = Date.now() - 1000;
      window.localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          availableFonts: systemFonts,
          monospaceFonts: [systemFonts[1]],
          timestamp,
        }),
      );
      const store = await loadStore();

      expect(store.getState()).toMatchObject({
        availableFonts: systemFonts,
        monospaceFonts: [systemFonts[1]],
        lastCacheTime: timestamp,
      });
    });

    it("discards a cache older than a day", async () => {
      window.localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          availableFonts: systemFonts,
          monospaceFonts: [],
          timestamp: Date.now() - DAY_MS - 1,
        }),
      );
      const store = await loadStore();

      expect(store.getState().availableFonts).toEqual([]);
      expect(window.localStorage.getItem(CACHE_KEY)).toBeNull();
    });

    it("discards a corrupt cache", async () => {
      window.localStorage.setItem(CACHE_KEY, "{broken");
      const store = await loadStore();

      expect(store.getState().availableFonts).toEqual([]);
      expect(window.localStorage.getItem(CACHE_KEY)).toBeNull();
    });
  });

  describe("loading all fonts", () => {
    it("loads system fonts, derives monospace fonts and caches them", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      const store = await loadStore();

      await store.getState().actions.loadAvailableFonts();

      expect(store.getState()).toMatchObject({
        availableFonts: systemFonts,
        monospaceFonts: [systemFonts[1], systemFonts[2]],
        isLoading: false,
        error: null,
        lastCacheTime: expect.any(Number),
      });
      expect(cache()).toMatchObject({
        availableFonts: systemFonts,
        monospaceFonts: [systemFonts[1], systemFonts[2]],
      });
    });

    it("skips loading when fonts are already known unless forced", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      const store = await loadStore();
      await store.getState().actions.loadAvailableFonts();

      await store.getState().actions.loadAvailableFonts();
      expect(commandMocks.getSystemFonts).toHaveBeenCalledTimes(1);

      await store.getState().actions.loadAvailableFonts(true);
      expect(commandMocks.getSystemFonts).toHaveBeenCalledTimes(2);
    });

    it("rescans a known list in the background, without a loading state", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      const store = await loadStore();
      await store.getState().actions.loadAvailableFonts();
      let resolveScan: (fonts: FontInfo[]) => void = () => {};
      commandMocks.getSystemFonts.mockReturnValueOnce(
        new Promise<FontInfo[]>((resolve) => {
          resolveScan = resolve;
        }),
      );

      const rescan = store.getState().actions.loadAvailableFonts(true);

      expect(store.getState()).toMatchObject({ isLoading: false, availableFonts: systemFonts });
      resolveScan([...systemFonts, font("Iosevka", true)]);
      await rescan;
      expect(store.getState().availableFonts.map((entry) => entry.family)).toContain("Iosevka");
    });

    it("shares one system scan between callers that ask at the same time", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      const store = await loadStore();

      await Promise.all([
        store.getState().actions.loadAvailableFonts(true),
        store.getState().actions.loadAvailableFonts(true),
      ]);

      expect(commandMocks.getSystemFonts).toHaveBeenCalledTimes(1);
    });

    it("keeps the same lists when a rescan finds the same fonts", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      const store = await loadStore();
      await store.getState().actions.loadAvailableFonts();
      const { availableFonts, monospaceFonts } = store.getState();

      commandMocks.getSystemFonts.mockResolvedValue(systemFonts.map((entry) => ({ ...entry })));
      await store.getState().actions.loadAvailableFonts(true);

      expect(store.getState().availableFonts).toBe(availableFonts);
      expect(store.getState().monospaceFonts).toBe(monospaceFonts);
    });

    it("keeps showing a known list when a background rescan fails", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      const store = await loadStore();
      await store.getState().actions.loadAvailableFonts();

      commandMocks.getSystemFonts.mockRejectedValue(new Error("enumeration failed"));
      await store.getState().actions.loadAvailableFonts(true);

      expect(store.getState()).toMatchObject({ availableFonts: systemFonts, error: null });
    });

    it("falls back to bundled fonts outside the desktop bridge", async () => {
      commandMocks.getSystemFonts.mockRejectedValue(
        new TypeError("Cannot read properties of undefined (reading '__TAURI_INTERNALS__')"),
      );
      const store = await loadStore();

      await store.getState().actions.loadAvailableFonts();

      expect(store.getState()).toMatchObject({
        availableFonts: BUNDLED_FONTS,
        monospaceFonts: BUNDLED_FONTS.filter((entry) => entry.is_monospace),
        error: null,
        isLoading: false,
      });
      expect(cache().availableFonts).toEqual(BUNDLED_FONTS);
    });

    it("reports other failures without caching", async () => {
      commandMocks.getSystemFonts.mockRejectedValue("font service crashed");
      const store = await loadStore();

      await store.getState().actions.loadAvailableFonts();

      expect(store.getState()).toMatchObject({
        availableFonts: [],
        error: "font service crashed",
        isLoading: false,
      });
      expect(cache()).toBeNull();

      store.getState().actions.clearError();
      expect(store.getState().error).toBeNull();
    });

    it("uses a default message for an empty error", async () => {
      commandMocks.getSystemFonts.mockRejectedValue(new Error(""));
      const store = await loadStore();

      await store.getState().actions.loadAvailableFonts();

      expect(store.getState().error).toBe("Failed to load fonts");
    });

    it("keeps working when the cache cannot be written", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      const store = await loadStore();

      await store.getState().actions.loadAvailableFonts();

      expect(store.getState().availableFonts).toEqual(systemFonts);
    });
  });

  describe("loading monospace fonts", () => {
    it("loads monospace fonts and refreshes the cache when all fonts are known", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      commandMocks.getMonospaceFonts.mockResolvedValue([systemFonts[2]]);
      const store = await loadStore();
      await store.getState().actions.loadAvailableFonts();

      await store.getState().actions.loadMonospaceFonts(true);

      expect(store.getState().monospaceFonts).toEqual([systemFonts[2]]);
      expect(cache().monospaceFonts).toEqual([systemFonts[2]]);
    });

    it("does not cache monospace fonts alone", async () => {
      commandMocks.getMonospaceFonts.mockResolvedValue([systemFonts[1]]);
      const store = await loadStore();

      await store.getState().actions.loadMonospaceFonts();
      await store.getState().actions.loadMonospaceFonts();

      expect(store.getState().monospaceFonts).toEqual([systemFonts[1]]);
      expect(commandMocks.getMonospaceFonts).toHaveBeenCalledTimes(1);
      expect(cache()).toBeNull();
    });

    it("falls back to bundled monospace fonts outside the desktop bridge", async () => {
      commandMocks.getMonospaceFonts.mockRejectedValue(new Error("window.postMessage failed"));
      const store = await loadStore();

      await store.getState().actions.loadMonospaceFonts();

      const bundledMono = BUNDLED_FONTS.filter((entry) => entry.is_monospace);
      expect(store.getState()).toMatchObject({ monospaceFonts: bundledMono, error: null });
      expect(cache()).toMatchObject({ availableFonts: BUNDLED_FONTS, monospaceFonts: bundledMono });
    });

    it("keeps known fonts in the cache when falling back", async () => {
      commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
      commandMocks.getMonospaceFonts.mockRejectedValue(new Error("postMessage"));
      const store = await loadStore();
      await store.getState().actions.loadAvailableFonts();

      await store.getState().actions.loadMonospaceFonts(true);

      expect(cache().availableFonts).toEqual(systemFonts);
    });

    it("reports other failures", async () => {
      commandMocks.getMonospaceFonts.mockRejectedValue(new Error("enumeration failed"));
      const store = await loadStore();

      await store.getState().actions.loadMonospaceFonts();

      expect(store.getState()).toMatchObject({ error: "enumeration failed", isLoading: false });
    });
  });

  describe("validating fonts", () => {
    it("accepts bundled fonts without asking the system", async () => {
      const store = await loadStore();

      await expect(store.getState().actions.validateFont(BUNDLED_FONTS[0].family)).resolves.toBe(
        true,
      );
      expect(commandMocks.validateFont).not.toHaveBeenCalled();
    });

    it("asks the system for other fonts", async () => {
      commandMocks.validateFont.mockImplementation(async (family: string) => family === "Menlo");
      const store = await loadStore();

      await expect(store.getState().actions.validateFont("Menlo")).resolves.toBe(true);
      await expect(store.getState().actions.validateFont("Nope Sans")).resolves.toBe(false);
    });

    it("treats validation failures as unavailable", async () => {
      commandMocks.validateFont.mockRejectedValueOnce(new Error("__TAURI_INTERNALS__ missing"));
      commandMocks.validateFont.mockRejectedValueOnce(new Error("crash"));
      const store = await loadStore();

      await expect(store.getState().actions.validateFont("Menlo")).resolves.toBe(false);
      await expect(store.getState().actions.validateFont("Menlo")).resolves.toBe(false);
    });
  });

  it("clears the cache so the next load asks the system again", async () => {
    commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
    const store = await loadStore();
    await store.getState().actions.loadAvailableFonts();

    store.getState().actions.clearCacheAndReload();

    expect(cache()).toBeNull();
    expect(store.getState()).toMatchObject({
      availableFonts: [],
      monospaceFonts: [],
      lastCacheTime: null,
    });
    await store.getState().actions.loadAvailableFonts();
    expect(commandMocks.getSystemFonts).toHaveBeenCalledTimes(2);
  });
});
