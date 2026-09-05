import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  applyTheme: vi.fn(),
  getTheme: vi.fn(),
  ready: true,
  readyListeners: new Set<() => void>(),
  registryListeners: new Set<() => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/features/settings/lib/appearance-bootstrap", () => ({
  cacheFontsForBootstrap: vi.fn(),
  cacheThemeForBootstrap: vi.fn(),
  cacheWindowTransparencyForBootstrap: vi.fn(),
}));
vi.mock("@/extensions/themes/theme-registry", () => ({
  themeRegistry: {
    applyTheme: mocks.applyTheme,
    getTheme: mocks.getTheme,
    isRegistryReady: () => mocks.ready,
    onReady: (callback: () => void) => {
      mocks.readyListeners.add(callback);
      return () => mocks.readyListeners.delete(callback);
    },
    onRegistryChange: (callback: () => void) => {
      mocks.registryListeners.add(callback);
      return () => mocks.registryListeners.delete(callback);
    },
  },
}));

describe("theme side effects", () => {
  let dark = true;
  const listeners = new Set<() => void>();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.ready = true;
    mocks.readyListeners.clear();
    mocks.registryListeners.clear();
    mocks.getTheme.mockImplementation((id: string) => ({ id, isDark: id.includes("dark") }));
    dark = true;
    listeners.clear();
    vi.stubGlobal("window", {
      matchMedia: () => ({
        get matches() {
          return dark;
        },
        addEventListener: (event: string, callback: () => void) => listeners.add(callback),
        removeEventListener: (event: string, callback: () => void) => listeners.delete(callback),
      }),
    });
    vi.stubGlobal("document", {
      documentElement: { getAttribute: () => null },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("follows repeated system changes and keeps the latest configured themes", async () => {
    const { applySettingSideEffect } = await import("@/features/settings/lib/settings-effects");
    const settings = { ...getDefaultSettingsSnapshot(), syncSystemTheme: true };
    applySettingSideEffect("syncSystemTheme", true, () => settings);
    await vi.dynamicImportSettled();
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_native_window_appearance", {
      themeType: "dark",
      transparencyEnabled: false,
      followSystem: true,
    });

    dark = false;
    listeners.forEach((callback) => callback());
    await vi.dynamicImportSettled();
    expect(mocks.applyTheme).toHaveBeenLastCalledWith("athas-light");

    settings.autoThemeDark = "vitesse-dark";
    applySettingSideEffect("autoThemeDark", settings.autoThemeDark, () => settings);
    await vi.dynamicImportSettled();
    dark = true;
    listeners.forEach((callback) => callback());
    await vi.dynamicImportSettled();
    expect(mocks.applyTheme).toHaveBeenLastCalledWith("vitesse-dark");
    expect(listeners.size).toBe(1);
  });

  it("stops following the system when returning to a manual theme", async () => {
    const { applySettingSideEffect } = await import("@/features/settings/lib/settings-effects");
    const settings = { ...getDefaultSettingsSnapshot(), syncSystemTheme: true };
    applySettingSideEffect("syncSystemTheme", true, () => settings);
    await vi.dynamicImportSettled();
    settings.syncSystemTheme = false;
    settings.theme = "vitesse-light";
    applySettingSideEffect("syncSystemTheme", false, () => settings);
    await vi.dynamicImportSettled();
    expect(listeners.size).toBe(0);
    expect(mocks.applyTheme).toHaveBeenLastCalledWith("vitesse-light");
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_native_window_appearance", {
      themeType: "light",
      transparencyEnabled: false,
      followSystem: false,
    });
  });

  it("discards outdated requests before the registry is ready", async () => {
    mocks.ready = false;
    const { applySettingSideEffect } = await import("@/features/settings/lib/settings-effects");
    const settings = getDefaultSettingsSnapshot();
    applySettingSideEffect("theme", settings.theme, () => settings);
    await vi.dynamicImportSettled();
    const staleReady = [...mocks.readyListeners][0];
    settings.theme = "athas-light";
    applySettingSideEffect("theme", settings.theme, () => settings);
    await vi.dynamicImportSettled();
    expect(mocks.readyListeners.size).toBe(1);
    staleReady();
    expect(mocks.applyTheme).not.toHaveBeenCalled();
    mocks.ready = true;
    mocks.readyListeners.forEach((callback) => callback());
    expect(mocks.applyTheme).toHaveBeenCalledExactlyOnceWith("athas-light");
  });

  it("does not apply a late extension theme after a newer theme was selected", async () => {
    mocks.getTheme.mockImplementation((id: string) =>
      id === "late-dark" ? undefined : { id, isDark: id.includes("dark") },
    );
    const { applySettingSideEffect } = await import("@/features/settings/lib/settings-effects");
    const settings = { ...getDefaultSettingsSnapshot(), theme: "late-dark" };
    applySettingSideEffect("theme", settings.theme, () => settings);
    await vi.dynamicImportSettled();
    const staleRegistration = [...mocks.registryListeners][0];
    settings.theme = "athas-light";
    applySettingSideEffect("theme", settings.theme, () => settings);
    await vi.dynamicImportSettled();
    mocks.getTheme.mockImplementation((id: string) => ({ id, isDark: id.includes("dark") }));
    staleRegistration();
    expect(mocks.registryListeners.size).toBe(0);
    expect(mocks.applyTheme).toHaveBeenCalledExactlyOnceWith("athas-light");
  });
});
